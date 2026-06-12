import { extend, isPlainObject } from "./Tools";
import type { Message, Msgid, Pci, Severity } from "./syslog/Pdu";
import Syslog from "./syslog/Syslog";
import type { IContainer, IScope } from "./types/IContainer";

const ISDefined = function (ele: unknown): boolean {
  return ele !== null && ele !== undefined;
};

const parseParameterString = function (
  this: DynamicParam,
  str: string,
  value?: unknown,
): DynamicParam | null {
  if (!this) {
    throw new Error(`Bad call`);
  }
  const parts = str.split(".");
  const currentPart = parts.shift();
  if (currentPart !== undefined) {
    if (parts.length === 0) {
      if (value !== undefined) {
        this[currentPart] = value;
      }
      return (this[currentPart] ?? null) as DynamicParam | null;
    }
    if (this[currentPart] === undefined || this[currentPart] === null) {
      if (value !== undefined) {
        this[currentPart] = {};
      } else {
        return null;
      }
    }
    if (typeof this[currentPart] !== "object") {
      throw new Error(
        `Cannot create property '${parts[0]}' on ${typeof this[currentPart]} '${this[currentPart]}'`,
      );
    }
    return parseParameterString.call(
      this[currentPart] as DynamicParam,
      parts.join("."),
      value,
    );
  }
  return this;
};

export interface DynamicService {
  [key: string]: unknown;
}

export interface DynamicParam {
  [key: string]: unknown;
}

/**
 * Bookkeeping des scopes ouverts : nom de scope → instances vivantes par id.
 * `Map` (et plus un objet `delete`-é) : l'ajout/retrait a lieu à CHAQUE
 * requête — le churn de shape d'un objet ordinaire dégrade les inline caches
 * V8, la Map est conçue pour ce motif.
 */
export type Scopes = Map<string, Map<string, Scope>>;

// Clé de bookkeeping des containers/scopes : compteur monotone in-process
// (base 36). Remplace uuid v4 — un appel crypto par requête pour une simple
// clé locale jamais exposée cross-process.
let containerSeq = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProtoService = { (): void; [key: string]: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProtoParameters = { (): void; [key: string]: any };

/**
 * Dependency Injection container — registers services by name and exposes
 * them to the rest of the framework.
 *
 * Services are stored on a prototype-backed object (`protoService`) so they
 * are inherited by child scopes (see {@link Scope}). The container also
 * carries an arbitrary parameter tree (`parameters`) used for configuration.
 *
 * Conventional usage:
 * ```ts
 * const c = new Container();
 * c.set("logger", new LoggerService());
 * c.setParameters("kernel.environment", "development");
 * const logger = c.get<LoggerService>("logger");
 * ```
 *
 * See `src/nodefony/docs/container.md` for the high-level rationale and the
 * scope model used by the HTTP/WS request pipeline.
 */
class Container implements IContainer {
  public protoService: ProtoService;
  protected services: DynamicService | null;
  public protoParameters: ProtoParameters;
  protected parameters: DynamicParam | null;
  public id: string;
  // Lazy (`null` tant qu'aucun addScope) : chaque Scope EST un Container — un
  // bucket alloué d'office serait une alloc morte par requête.
  private scopes: Scopes | null = null;

  /**
   * Create a new container. When an existing container is passed in, the
   * new instance inherits its services (via prototype chaining) and clones
   * its parameters — used by {@link Scope} to build short-lived containers
   * that share base services but isolate per-request state.
   *
   * @param input - parent container to inherit services from
   * @param deep - if `true`, parameters are deep-cloned via `structuredClone`
   * (falls back to shallow copy if `structuredClone` throws on unsupported types)
   * @param adoptedProtoService - @internal canal {@link Scope} : adopte le
   * proto-services du PARENT au lieu d'allouer une closure locale morte
   * (2 closures + 2 `Object.create` jetés par requête avant ce chemin)
   * @param adoptedProtoParameters - @internal idem pour les paramètres
   */
  constructor(
    input?: Container,
    deep: boolean = false,
    adoptedProtoService?: ProtoService,
    adoptedProtoParameters?: ProtoParameters,
  ) {
    this.id = (++containerSeq).toString(36);
    this.protoService = adoptedProtoService ?? function () {};
    this.protoParameters = adoptedProtoParameters ?? function () {};
    if (input && input instanceof Container) {
      this.services = Object.create(input.protoService.prototype);
      this.parameters = Object.create(input.protoParameters.prototype);
      this.setServices(input.services ?? {});
      if (deep) {
        try {
          this.setParametersBulk(
            structuredClone(input.parameters ?? {}) as DynamicParam,
          );
        } catch {
          this.setParametersBulk(input.parameters ?? {});
        }
      } else {
        this.setParametersBulk(input.parameters ?? {});
      }
    } else {
      this.services = Object.create(this.protoService.prototype);
      this.parameters = Object.create(this.protoParameters.prototype);
    }
  }

  private setServices(services: DynamicService): void {
    for (const service in services) {
      this.set(service, services[service]);
    }
  }

  private setParametersBulk(parameters: DynamicParam): void {
    for (const parameter in parameters) {
      this.setParameters(parameter, parameters[parameter]);
    }
  }

  /**
   * Emit a log entry through the registered `syslog` service. Falls back to
   * `console.warn` when no syslog is set (early boot, isolated test).
   *
   * @param pci - log payload (string or structured PDU body)
   * @param severity - syslog severity level
   * @param msgid - message id; defaults to `"SERVICES CONTAINER"`
   * @param msg - optional message detail
   */
  public log(
    pci: Pci,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ): ReturnType<Syslog["log"]> | void {
    const syslog = this.get<Syslog>("syslog");
    if (!syslog) {
      console.warn(`[Container] no syslog registered —`, pci);
      return;
    }
    if (!msgid) {
      msgid = "SERVICES CONTAINER";
    }
    return syslog.log(pci, severity, msgid, msg);
  }

  /**
   * Register a service under `name`. The service is stored both directly on
   * the container and on its prototype, so child scopes can read it without
   * an extra hop.
   *
   * @param name - service identifier (any non-empty string)
   * @param object - the instance to register (no type constraint — services
   * are not required to extend any base class)
   * @throws Error if `name` is empty or the container has been cleaned
   */
  public set<T>(name: string, object: T): void {
    if (this.services && name) {
      this.protoService.prototype[name] = object;
      this.services[name] = object;
    } else {
      throw new Error("Container bad argument name");
    }
  }

  /**
   * Resolve a service by name. Returns `null` if the service is unknown or
   * the container has been cleaned — callers should narrow the result
   * before use.
   *
   * @param name - service identifier
   * @returns the service instance typed as `T`, or `null`
   */
  public get<T = unknown>(name: string): T | null {
    if (this.services && name in this.services) {
      return this.services[name] as T;
    }
    return null;
  }

  /**
   * Unregister a service and cascade the removal into every child scope.
   *
   * @param name - service identifier
   * @returns `true` when a service was actually removed, `false` otherwise
   */
  public remove(name: string): boolean {
    if (!this.services) {
      return false;
    }
    if (name in this.services) {
      delete this.services[name];
      if (name in this.protoService.prototype) {
        delete this.protoService.prototype[name];
      }
      if (this.scopes) {
        for (const bucket of this.scopes.values()) {
          for (const scope of bucket.values()) {
            scope.remove(name);
          }
        }
      }
      return true;
    }
    return false;
  }

  /** Whether a service is registered under `name`. */
  public has(name: string): boolean {
    return this.services != null && name in this.services;
  }

  /** All service names currently registered on this container. */
  public keys(): string[] {
    return Object.keys(this.services ?? {});
  }

  /** All `[name, service]` pairs currently registered on this container. */
  public entries(): [string, unknown][] {
    return Object.entries(this.services ?? {});
  }

  // --- Scopes ---

  /**
   * Declare a scope. Scopes are short-lived containers (typically created
   * per HTTP/WS request) that inherit services from this container but
   * store their own per-request services and parameters. Must be called
   * once before {@link enterScope} can produce instances.
   *
   * @param name - scope identifier (e.g. `"request"`)
   * @returns the underlying scope bucket (rarely used by callers)
   */
  public addScope(name: string): Map<string, Scope> {
    if (this.scopes === null) {
      this.scopes = new Map();
    }
    let bucket = this.scopes.get(name);
    if (!bucket) {
      bucket = new Map();
      this.scopes.set(name, bucket);
    }
    return bucket;
  }

  /**
   * Open a new instance of the named scope. The returned {@link Scope}
   * inherits services from this container but tracks its own services and
   * parameters in isolation.
   *
   * @param name - scope name previously declared via {@link addScope}
   * @returns a fresh `Scope` instance with a unique `id`
   * @throws Error when the scope has not been declared
   */
  public enterScope(name: string): Scope {
    const bucket = this.scopes?.get(name);
    if (!bucket) {
      throw new Error(
        `Scope "${name}" not declared. Call addScope("${name}") first.`,
      );
    }
    const sc = new Scope(name, this, this.protoService, this.protoParameters);
    bucket.set(sc.id, sc);
    return sc;
  }

  /**
   * Close a scope instance and release its services/parameters. Always
   * called when the unit of work that opened the scope finishes (request
   * end, WS close).
   *
   * @param scope - the scope instance returned by {@link enterScope}
   */
  public leaveScope(scope: IScope): void {
    const bucket = this.scopes?.get(scope.name);
    if (bucket) {
      const sc = bucket.get(scope.id);
      if (sc) {
        sc.clean();
        bucket.delete(scope.id);
      }
    }
  }

  /**
   * Nombre d'instances VIVANTES du scope nommé — introspection bon marché
   * (sondes de fuite, Studio, diagnostics) sans exposer la structure interne.
   *
   * @param name - scope identifier (e.g. `"request"`)
   * @returns le nombre de scopes ouverts, `0` si le scope est inconnu
   */
  public scopeCount(name: string): number {
    return this.scopes?.get(name)?.size ?? 0;
  }

  /**
   * Close every open instance of the named scope and forget it. After this
   * call, {@link enterScope}(`name`) will throw until {@link addScope} is
   * called again.
   *
   * @param name - scope identifier
   */
  public removeScope(name: string): void {
    const bucket = this.scopes?.get(name);
    if (bucket) {
      for (const scope of bucket.values()) {
        this.leaveScope(scope);
      }
      this.scopes?.delete(name);
    }
  }

  private removeAllScopes(): void {
    if (!this.scopes) {
      return;
    }
    for (const name of this.scopes.keys()) {
      this.removeScope(name);
    }
    this.scopes = null;
  }

  // --- Paramètres ---

  /**
   * Set a value in the parameter tree using a dotted path. Intermediate
   * objects are created on demand (`a.b.c = 1` creates `a` and `b` if they
   * are missing).
   *
   * @param name - dotted path (e.g. `"kernel.environment"`)
   * @param ele - value to assign (must not be `undefined`)
   * @returns the parameter subtree containing the assigned value, or `null`
   * if the container has been cleaned
   * @throws Error when `name` is not a string or `ele` is `undefined`
   */
  public setParameters<T>(name: string, ele: T): DynamicParam | null {
    if (typeof name !== "string") {
      throw new Error(
        "setParameters : container parameter name must be a string",
      );
    }
    if (ele === undefined) {
      throw new Error(
        `setParameters : ${name} container parameter value must be defined`,
      );
    }
    if (!this.parameters) return null;
    return parseParameterString.call(this.parameters, name, ele);
  }

  /**
   * Read a value (or subtree) from the parameter tree.
   *
   * @param name - dotted path (e.g. `"kernel.environment"`)
   * @returns the value, the subtree, or `null` if absent
   * @throws Error when `name` is empty
   */
  public getParameters(name: string): DynamicParam | null {
    if (!name) {
      throw new Error(`getParameters : invalid name "${name}"`);
    }
    if (!this.parameters) return null;
    return parseParameterString.call(this.parameters, name);
  }

  // --- Cycle de vie ---

  /**
   * Tear the container down: close every scope, drop services and
   * parameters. After `clean()`, any `get`/`set`/`enterScope` call on this
   * instance throws or returns `null`. Called by the kernel during
   * graceful shutdown.
   */
  public clean(): void {
    this.removeAllScopes();
    this.services = null;
    this.parameters = null;
  }

  /**
   * Clean the container and rebuild fresh prototype chains, leaving it
   * ready to register services again. Used by hot-reload paths in tests
   * and dev mode; production code rarely calls this directly.
   */
  public reset(): void {
    this.clean();
    this.protoService = function () {};
    this.protoParameters = function () {};
    this.services = Object.create(this.protoService.prototype);
    this.parameters = Object.create(this.protoParameters.prototype);
  }
}

/**
 * Short-lived child container tied to a parent {@link Container}. Used by
 * the HTTP/WS kernel to isolate per-request services (e.g. request-bound
 * sessions, scoped resolvers) without polluting the global container.
 *
 * Services and parameters defined on a `Scope` shadow the parent's — reads
 * fall back to the parent transparently when nothing is found locally.
 */
class Scope extends Container implements IScope {
  public name: string;
  private parent: Container | null;

  constructor(
    name: string,
    parent: Container,
    parentProtoService: ProtoService,
    parentProtoParameters: ProtoParameters,
  ) {
    // Adoption des protos PARENTS (canal @internal du constructeur) :
    // `services`/`parameters` héritent directement de leur prototype — plus
    // de double init (2 closures + 2 Object.create jetés par requête avant).
    super(undefined, false, parentProtoService, parentProtoParameters);
    this.name = name;
    this.parent = parent;
  }

  /**
   * Register a per-request service — own property ONLY (shadowing). Depuis
   * l'adoption des protos parents, l'écriture prototype de
   * {@link Container.set} toucherait le proto PARTAGÉ du parent : un service
   * per-request (controller, context) deviendrait visible de TOUTES les
   * requêtes concurrentes. (L'ancien chemin écrivait sur un proto local mort
   * — travail perdu à chaque set.)
   */
  public override set<T>(name: string, object: T): void {
    if (this.services && name) {
      this.services[name] = object;
    } else {
      throw new Error("Container bad argument name");
    }
  }

  /**
   * Unregister a service registered ON THIS SCOPE (own property only). Les
   * services hérités du parent ne sont jamais touchés — même raison que
   * {@link Scope.set} : le proto est partagé depuis l'adoption.
   */
  public override remove(name: string): boolean {
    if (
      this.services &&
      Object.prototype.hasOwnProperty.call(this.services, name)
    ) {
      delete this.services[name];
      return true;
    }
    return false;
  }

  /**
   * Read a parameter from the scope, falling back to the parent container.
   * When both sides hold plain objects, the result is a merged view (deep
   * by default) so a scope can override a few keys without losing the rest.
   *
   * @param name - dotted path
   * @param merge - when `true` (default), merge scope and parent objects;
   * when `false`, scope value wins outright if present
   * @param deep - deep vs. shallow merge (only when `merge` is `true`)
   */
  public override getParameters(
    name: string,
    merge: boolean = true,
    deep: boolean = true,
  ): DynamicParam | null {
    const res = parseParameterString.call(this.parameters ?? {}, name);
    const obj = this.parent?.getParameters(name);
    if (ISDefined(res)) {
      if (merge && isPlainObject(obj) && isPlainObject(res)) {
        return extend(deep, obj, res) as DynamicParam;
      }
      return res;
    }
    return obj ?? null;
  }

  /**
   * Break the parent link and clean the scope. Called by
   * {@link Container.leaveScope} when the unit of work that owns the scope
   * finishes.
   */
  public override clean(): void {
    this.parent = null;
    return super.clean();
  }
}

export default Container;
export { Scope };
