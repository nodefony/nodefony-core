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

/**
 * Gèle un arbre de paramètres en profondeur : objets simples et tableaux
 * seulement. Une instance de classe rangée en configuration (client, store,
 * fonction) garde son état propre et n'est pas gelée. Un nœud déjà gelé
 * s'arrête là — ce qui borne aussi un arbre qui se référence lui-même.
 */
const freezeTree = (node: unknown): void => {
  if (node === null || typeof node !== "object" || Object.isFrozen(node)) {
    return;
  }
  if (!Array.isArray(node) && !isPlainObject(node)) return;
  Object.freeze(node);
  for (const key of Object.keys(node)) {
    freezeTree((node as Record<string, unknown>)[key]);
  }
};

export interface DynamicService {
  [key: string]: unknown;
}

export interface DynamicParam {
  [key: string]: unknown;
}

/**
 * Registre des scopes ouverts : nom de scope → ensemble des instances
 * vivantes. Il ne sert qu'à les COMPTER ({@link Container.scopeCount}) et à
 * les refermer toutes au {@link Container.clean} : un `Set` tenu par l'objet
 * lui-même rend ce service sans fabriquer de clé. Un index par identifiant
 * chaîne — fabriqué et haché à chaque ouverture — coûte ~70 % du cycle
 * `enterScope` + `leaveScope`, payé à chaque requête.
 */
export type Scopes = Map<string, Set<IScope>>;

// Identifiant des containers/scopes : compteur monotone in-process (base 36),
// fabriqué à la PREMIÈRE lecture de `id` seulement — le registre des scopes
// n'en a plus besoin, et une requête ordinaire ne le lit jamais.
let containerSeq = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProtoService = { (): void; [key: string]: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProtoParameters = { (): void; [key: string]: any };

/**
 * Build a prototype holder whose `prototype` has NO prototype of its own, so
 * names inherited from `Object.prototype` (`toString`, `constructor`,
 * `hasOwnProperty`…) are never mistaken for services or parameters.
 */
function createProto(): ProtoService {
  const proto = function () {} as ProtoService;
  proto.prototype = Object.create(null);
  return proto;
}

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
 * See `docs/architecture/injection-portees.md` for the high-level rationale
 * and the scope model used by the HTTP/WS request pipeline.
 */
class Container implements IContainer {
  public protoService: ProtoService;
  protected services: DynamicService | null;
  public protoParameters: ProtoParameters;
  protected parameters: DynamicParam | null;
  #id: string | null = null;
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
    this.protoService = adoptedProtoService ?? createProto();
    this.protoParameters = adoptedProtoParameters ?? createProto();
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

  /**
   * Identifiant unique du conteneur dans le process (base 36). Fabriqué à la
   * première lecture, puis stable : ouvrir un scope par requête ne coûte ni
   * chaîne ni tour de compteur tant que personne ne le lit.
   */
  public get id(): string {
    if (this.#id === null) {
      this.#id = (++containerSeq).toString(36);
    }
    return this.#id;
  }

  /**
   * `true` après {@link clean} — pour un scope, après {@link leaveScope}.
   * Services et paramètres sont alors libérés : `get()` rend `null` (même pour
   * un service hérité) et `set()` lève. {@link reset} rend un conteneur racine
   * utilisable ; un scope, lui, ne se rouvre pas.
   *
   * Lu sur l'état existant plutôt que sur un drapeau : aucun champ de plus par
   * scope, donc ni octet ni écriture ajoutés à `enterScope`.
   */
  public get closed(): boolean {
    return this.services === null;
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
   * Unregister a service. Open scopes stop inheriting it (they read through
   * the shared prototype), but a scope's OWN override of the same name is
   * left untouched — it belongs to that unit of work, not to this container.
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
   * @returns the open instances of that scope, read-only (rarely used by
   * callers — {@link scopeCount} answers the usual question)
   */
  public addScope(name: string): ReadonlySet<IScope> {
    if (this.scopes === null) {
      this.scopes = new Map();
    }
    let bucket = this.scopes.get(name);
    if (!bucket) {
      bucket = new Set();
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
    bucket.add(sc);
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
    // Retirer AVANT de nettoyer : un `clean()` qui lèverait ne doit pas laisser
    // le scope épinglé dans le registre. `delete` ne rend `true` que pour un
    // scope ouvert ICI — un second appel, ou le scope d'un autre conteneur, ne
    // fait rien.
    if (this.scopes?.get(scope.name)?.delete(scope)) {
      scope.clean();
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
      for (const scope of bucket) {
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
    // Chemin froid : une écriture de configuration n'a pas lieu par requête.
    // Refuser ICI, en nommant la clé, plutôt que laisser lever une TypeError
    // au fond de la descente, loin de l'appel qui l'a causée.
    if (Object.isFrozen(this.parameters)) {
      throw new Error(
        `setParameters : « ${name} » ne peut plus être écrit — la configuration ` +
          "du conteneur racine est figée depuis la fin du démarrage (onReady), " +
          "parce qu'elle est partagée par toutes les requêtes. Une valeur propre " +
          "à une requête s'écrit sur son scope (scope.setParameters) ; une " +
          "valeur de configuration se pose avant la fin du démarrage.",
      );
    }
    return parseParameterString.call(this.parameters, name, ele);
  }

  /**
   * Fige la configuration du conteneur : l'arbre des paramètres devient en
   * lecture seule, en profondeur, pour les objets simples et les tableaux.
   *
   * @remarks Appelé UNE fois par le kernel à la fin de `onReady`, avant que
   * le premier serveur n'écoute : l'arbre est partagé par toutes les requêtes,
   * et un scope le rend par référence pour une clé qu'il ne surcharge pas.
   * Une écriture lève alors (`TypeError` en mode strict) au lieu de modifier,
   * en silence, la configuration de toutes les requêtes concurrentes. Coût
   * payé une fois, rien par requête. `reset()` repart d'un arbre neuf.
   */
  public freezeParameters(): void {
    if (!this.parameters || Object.isFrozen(this.parameters)) return;
    Object.freeze(this.parameters);
    for (const key of Object.keys(this.parameters)) {
      freezeTree(this.parameters[key]);
    }
  }

  /**
   * Read a value (or subtree) from the parameter tree.
   *
   * @param name - dotted path (e.g. `"kernel.environment"`)
   * @returns the value, the subtree, or `null` if absent
   * @throws Error when `name` is empty
   */
  public getParameters(name: string): Readonly<DynamicParam> | null {
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
    this.protoService = createProto();
    this.protoParameters = createProto();
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
  // Objets dont la durée de vie est liée au scope (services `request`), dans
  // l'ordre de rattachement. `null` tant que rien n'est rattaché : une requête
  // qui ne résout aucun service `request` ne paie qu'un champ, jamais un tableau.
  private owned: object[] | null = null;

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
    // Scope imbriqué : chaîner sur les services du scope PARENT (qui chaînent
    // eux-mêmes sur le proto racine), sinon l'enfant ne voit pas ce que son
    // parent a posé pour la requête (controller, context…). Chemin froid.
    if (parent instanceof Scope && parent.services !== null) {
      this.services = Object.create(parent.services);
    }
  }

  /**
   * Refused on a scope: rebuilding fresh prototypes would silently detach it
   * from its parent (every inherited service would read as `null`).
   *
   * @throws Error always — close the scope with {@link Container.leaveScope}
   */
  public override reset(): void {
    throw new Error(
      `reset() is not allowed on scope "${this.name}": leave it with leaveScope() and enter a new one`,
    );
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
   * `true` si `name` est posé SUR ce scope (propriété propre) — jamais pour un
   * service hérité du parent. C'est la lecture qu'il faut pour savoir si la
   * requête possède déjà son exemplaire d'un service : `has()` suit la chaîne
   * de prototypes, et répondrait `true` pour un singleton homonyme.
   *
   * @param name - clé du service
   */
  public hasOwn(name: string): boolean {
    return (
      this.services !== null &&
      Object.prototype.hasOwnProperty.call(this.services, name)
    );
  }

  /**
   * Lie la durée de vie de `instance` à celle du scope : son `clean()`, s'il
   * en a un, sera appelé à la fermeture ({@link Container.leaveScope}), dans
   * l'ordre INVERSE des rattachements — un service créé après ceux dont il
   * dépend est nettoyé avant eux.
   *
   * @param instance - l'objet à nettoyer avec le scope
   * @throws Error si le scope est déjà fermé : l'objet ne serait jamais
   * nettoyé, puisque la fermeture a déjà eu lieu.
   */
  public own(instance: object): void {
    if (this.services === null) {
      throw new Error(
        `own() sur le scope « ${this.name} », déjà fermé : l'objet ne ` +
          `serait jamais nettoyé.`,
      );
    }
    if (this.owned === null) {
      this.owned = [instance];
    } else {
      this.owned.push(instance);
    }
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
  ): Readonly<DynamicParam> | null {
    const res = parseParameterString.call(this.parameters ?? {}, name);
    const obj = this.parent?.getParameters(name);
    if (ISDefined(res)) {
      if (merge && isPlainObject(obj) && isPlainObject(res)) {
        // Cible NEUVE : `obj` est le nœud du parent rendu par référence —
        // fusionner dedans écrirait dans l'état partagé de toutes les requêtes.
        return extend(deep, {}, obj, res) as DynamicParam;
      }
      return res;
    }
    return obj ?? null;
  }

  /**
   * Nettoie les objets rattachés ({@link own}), du dernier au premier, puis
   * rompt le lien au parent et libère le scope. Appelé par
   * {@link Container.leaveScope} quand l'unité de travail qui l'a ouvert se
   * termine.
   *
   * Les services et paramètres du scope sont encore lisibles pendant les
   * `clean()` des objets rattachés : ils sont libérés APRÈS. Un `clean()` qui
   * lève est journalisé et n'interrompt pas les suivants — sans quoi un seul
   * service fautif laisserait tous ceux créés avant lui sans nettoyage.
   *
   * `clean()` n'est pas attendu : la fermeture reste synchrone. Un `async
   * clean()` part en arrière-plan, et son rejet est journalisé — jamais une
   * `unhandledRejection`. Hors de toute bulle de requête en HTTP : y lire le
   * scope par `this.container`, pas par `RequestContext`.
   */
  public override clean(): void {
    const owned = this.owned;
    if (owned !== null) {
      this.owned = null;
      for (let i = owned.length - 1; i >= 0; i--) {
        const instance = owned[i] as { clean?: () => unknown; name?: unknown };
        try {
          const done = instance.clean?.();
          if (
            done != null &&
            typeof (done as { then?: unknown }).then === "function"
          ) {
            // Journal capturé MAINTENANT : le rejet arrive après la
            // libération du scope, où `this.log` n'aurait plus de syslog.
            const syslog = this.get<Syslog>("syslog");
            Promise.resolve(done).catch((error: unknown) => {
              const msg = Scope.cleanFailure(this.name, instance, error);
              if (syslog) syslog.log(msg, "ERROR", "SERVICES CONTAINER");
              else console.warn(`[Container] ${msg}`);
            });
          }
        } catch (error) {
          this.log(Scope.cleanFailure(this.name, instance, error), "ERROR");
        }
      }
    }
    this.parent = null;
    return super.clean();
  }

  /** Message d'un `clean()` rattaché qui a échoué (chemin froid). */
  private static cleanFailure(
    scopeName: string,
    instance: { name?: unknown },
    error: unknown,
  ): string {
    const who =
      typeof instance.name === "string"
        ? instance.name
        : instance.constructor?.name;
    return (
      `clean() de « ${who} », rattaché au scope « ${scopeName} », a levé : ` +
      `${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export default Container;
export { Scope };
