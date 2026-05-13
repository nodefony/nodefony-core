import { v4 as uuidv4 } from "uuid";
import { extend, isPlainObject } from "./Tools";
import type { Message, Msgid, Pci, Severity } from "./syslog/Pdu";
import Syslog from "./syslog/Syslog";

const ISDefined = function (ele: unknown): boolean {
  return ele !== null && ele !== undefined;
};

const parseParameterString = function (
  this: DynamicParam,
  str: string,
  value?: unknown
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
        `Cannot create property '${parts[0]}' on ${typeof this[currentPart]} '${this[currentPart]}'`
      );
    }
    return parseParameterString.call(
      this[currentPart] as DynamicParam,
      parts.join("."),
      value
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

export interface Scopes {
  [nameScope: string]: {
    [idContainer: string]: Container;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProtoService = { (): void; [key: string]: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProtoParameters = { (): void; [key: string]: any };

/*
 *
 *  CONTAINER CLASS
 *
 */
class Container {
  public protoService: ProtoService = function () {};
  protected services: DynamicService | null;
  public protoParameters: ProtoParameters = function () {};
  protected parameters: DynamicParam | null;
  public id: string;
  private scopes: Scopes = {};

  constructor(input?: Container, deep: boolean = false) {
    this.id = uuidv4();
    if (input && input instanceof Container) {
      this.services = Object.create(input.protoService.prototype);
      this.parameters = Object.create(input.protoParameters.prototype);
      this.setServices(input.services ?? {});
      if (deep) {
        try {
          this.setParametersBulk(
            structuredClone(input.parameters ?? {}) as DynamicParam
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

  public log(
    pci: Pci,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message
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

  public set<T>(name: string, object: T): void {
    if (this.services && name) {
      this.protoService.prototype[name] = object;
      this.services[name] = object;
    } else {
      throw new Error("Container bad argument name");
    }
  }

  public get<T = unknown>(name: string): T | null {
    if (this.services && name in this.services) {
      return this.services[name] as T;
    }
    return null;
  }

  public remove(name: string): boolean {
    if (!this.services) {
      return false;
    }
    if (name in this.services) {
      delete this.services[name];
      if (name in this.protoService.prototype) {
        delete this.protoService.prototype[name];
      }
      for (const scope in this.scopes) {
        const subScopes = this.scopes[scope];
        for (const subScope in subScopes) {
          subScopes[subScope].remove(name);
        }
      }
      return true;
    }
    return false;
  }

  public has(name: string): boolean {
    return this.services != null && name in this.services;
  }

  public keys(): string[] {
    return Object.keys(this.services ?? {});
  }

  public entries(): [string, unknown][] {
    return Object.entries(this.services ?? {});
  }

  // --- Scopes ---

  public addScope(name: string): Scope | object {
    if (!this.scopes[name]) {
      return (this.scopes[name] = {});
    }
    return this.scopes[name];
  }

  public enterScope(name: string): Scope {
    if (!this.scopes[name]) {
      throw new Error(
        `Scope "${name}" not declared. Call addScope("${name}") first.`
      );
    }
    const sc = new Scope(name, this, this.protoService, this.protoParameters);
    this.scopes[name][sc.id] = sc;
    return sc;
  }

  public leaveScope(scope: Scope): void {
    if (this.scopes[scope.name]) {
      const sc = this.scopes[scope.name][scope.id];
      if (sc) {
        sc.clean();
        delete this.scopes[scope.name][scope.id];
      }
    }
  }

  public removeScope(name: string): void {
    const scopesForName = this.scopes[name];
    if (scopesForName) {
      for (const scope of Object.values(scopesForName)) {
        this.leaveScope(scope as Scope);
      }
      delete this.scopes[name];
    }
  }

  private removeAllScopes(): void {
    for (const name of Object.keys(this.scopes)) {
      this.removeScope(name);
    }
    this.scopes = {};
  }

  // --- Paramètres ---

  public setParameters<T>(name: string, ele: T): DynamicParam | null {
    if (typeof name !== "string") {
      throw new Error(
        "setParameters : container parameter name must be a string"
      );
    }
    if (ele === undefined) {
      throw new Error(
        `setParameters : ${name} container parameter value must be defined`
      );
    }
    if (!this.parameters) return null;
    return parseParameterString.call(this.parameters, name, ele);
  }

  public getParameters(name: string): DynamicParam | null {
    if (!name) {
      throw new Error(`getParameters : invalid name "${name}"`);
    }
    if (!this.parameters) return null;
    return parseParameterString.call(this.parameters, name);
  }

  // --- Cycle de vie ---

  public clean(): void {
    this.removeAllScopes();
    this.services = null;
    this.parameters = null;
  }

  public reset(): void {
    this.clean();
    this.protoService = function () {};
    this.protoParameters = function () {};
    this.services = Object.create(this.protoService.prototype);
    this.parameters = Object.create(this.protoParameters.prototype);
  }
}

/*
 *
 *  SCOPE CLASS
 *
 */
class Scope extends Container {
  public name: string;
  private parent: Container | null;

  constructor(
    name: string,
    parent: Container,
    parentProtoService: ProtoService,
    parentProtoParameters: ProtoParameters
  ) {
    super();
    this.name = name;
    this.parent = parent;
    this.services = Object.create(parentProtoService.prototype);
    this.parameters = Object.create(parentProtoParameters.prototype);
  }

  public override getParameters(
    name: string,
    merge: boolean = true,
    deep: boolean = true
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

  public override clean(): void {
    this.parent = null;
    return super.clean();
  }
}

export default Container;
export { Scope };
