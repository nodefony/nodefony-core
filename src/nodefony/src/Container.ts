/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from "uuid";
import { extend, isPlainObject } from "./Tools";
import { Message, Msgid, Pci, Severity, Syslog } from "nodefony";

const ISDefined = function (ele: unknown): boolean {
  return ele !== null && ele !== undefined;
};

const parseParameterString = function (
  this: Container["parameters"] | ProtoParametersPrototype,
  str: string,
  value?: any
): DynamicParam | null {
  if (!this) {
    throw new Error(`Bad call`);
  }
  const parts = str.split(".");
  const currentPart = parts.shift();
  if (currentPart !== undefined) {
    if (!this[currentPart] && parts.length > 0) {
      if (value !== undefined) {
        this[currentPart] = {};
      }
    }
    if (parts.length === 0) {
      // Dernière partie de la chaîne
      if (value !== undefined) {
        //console.log(`parseParameterString`, value, currentPart, this)
        this[currentPart] = value;
      }
      return this[currentPart];
    } else {
      if (this[currentPart]) {
        return parseParameterString.call(
          this[currentPart],
          parts.join("."),
          value
        );
      }
      return null;
    }
  }
  return this;
};

// Déclaration d'un objet hétérogène
export interface DynamicService {
  [cleDynamic: string]: any; // Propriétés dynamiques de tout type
}

export interface DynamicParam {
  [cleDynamic: string]: any; // Propriétés dynamiques de tout type
}

export interface Scopes {
  [nameScope: string]: {
    [idContainer: string]: Container;
  };
}

export type ProtoService = { (): void; [key: string]: any };
export type ProtoParameters = { (): void; [key: string]: any };
type ProtoParametersPrototype = ReturnType<
  typeof Container.prototype.protoParameters.prototype
>;

/*
 *
 *  CONTAINER CLASS
 *
 */
class Container {
  public protoService: ProtoService = function () {};
  protected services: ProtoService | null;
  public protoParameters: ProtoParameters = function () {};
  protected parameters: ProtoService | null;
  protected id: string;
  private scopes: Scopes = {};

  constructor(input?: Container) {
    this.id = uuidv4();
    if (input && input instanceof Container) {
      this.services = Object.create(input.protoService.prototype);
      this.parameters = Object.create(input.protoParameters.prototype);
      this.setServices(input.services || {});
      this.setParametersBulk(input.parameters || {});
    } else {
      this.services = Object.create(this.protoService.prototype);
      this.parameters = Object.create(this.protoParameters.prototype);
    }
  }

  private setServices(services: Record<string, any>): void {
    if (typeof services === "object") {
      for (const service in services) {
        this.set(service, services[service]);
      }
    }
  }

  private setParametersBulk(parameters: Record<string, any>): void {
    if (typeof parameters === "object") {
      for (const parameter in parameters) {
        this.setParameters(parameter, parameters[parameter]);
      }
    }
  }

  public log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message) {
    const syslog: Syslog | null = this.get("syslog");
    if (!syslog) {
      console.log(pci);
      return;
    }
    if (!msgid) {
      msgid = "SERVICES CONTAINER ";
    }
    return syslog.log(pci, severity, msgid, msg);
  }

  public set<T>(name: string, object: T): void {
    if (this.services && name) {
      // Ajouter la propriété au prototype de protoService spécifique à cette instance
      this.protoService.prototype[name] = object;
      // Ajouter la propriété au service de l'instance actuelle ?
      this.services[name] = object;
    } else {
      throw new Error("Container bad argument name");
    }
  }

  public get<T = unknown>(name: string): T | null {
    if (this.services && name in this.services) {
      return this.services[name];
    }
    return null;
  }

  public remove(name: string): boolean {
    if (!this.services) {
      throw new Error(`Bad call`);
    }
    if (this.get(name)) {
      delete this.services[name];
      if (this.protoService.prototype[name]) {
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

  public has(name: string): boolean | any {
    if (this.services) {
      return this.services[name];
    }
    return false;
  }

  public addScope(name: string): Scope | object {
    if (!this.scopes[name]) {
      return (this.scopes[name] = {});
    }
    return this.scopes[name];
  }

  public enterScope(name: string): Scope {
    const sc = new Scope(name, this);
    if (this.scopes[name]) {
      this.scopes[name][sc.id] = sc;
      return sc;
    }
    throw new Error(`Bad scope : ${name} not found use addScope before`);
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
      const scopesArray = Object.values(scopesForName);

      for (const scope of scopesArray) {
        this.leaveScope(scope as Scope); // Cast explicite à Scope
      }
      delete this.scopes[name];
    }
  }

  public setParameters<T>(name: string, ele: T): DynamicParam | null {
    if (typeof name !== "string") {
      throw new Error(
        "setParameters : container parameter name must be a string"
      );
    }
    if (ele === undefined) {
      throw new Error(
        `setParameters : ${name} container parameter value must be define`
      );
    }
    //parseParameterString.call(this.protoParameters.prototype, name, ele)
    return parseParameterString.call(this.parameters, name, ele);
  }

  public getParameters(name: string): DynamicParam | null {
    //console.log(`main getParameters : ${name}`)
    if (name) {
      const res = parseParameterString.call(this.parameters, name);
      //console.log(`main After getParameters :  `, res)
      return res;
    }
    throw new Error(`Bad name : ${name}`);
  }

  public clean(): void {
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

  constructor(name: string, parent: Container) {
    super();
    this.name = name;
    this.parent = parent;
    this.services = Object.create(this.parent.protoService.prototype);
    this.parameters = Object.create(this.parent.protoParameters.prototype);
  }

  public override getParameters(
    name: string,
    merge: boolean = true,
    deep: boolean = true
  ): DynamicParam | null {
    const res = parseParameterString.call(this.parameters, name);
    const obj = this.parent?.getParameters(name);
    if (ISDefined(res)) {
      if (merge && isPlainObject(obj) && isPlainObject(res)) {
        return extend(deep, obj, res);
      }
      return res;
    }
    return obj || null;
  }

  public override clean(): void {
    this.parent = null;
    return super.clean();
  }
}

export default Container;
export { Scope };
