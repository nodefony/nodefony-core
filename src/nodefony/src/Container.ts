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
    if (parts.length === 0) {
      // Dernière partie de la chaîne
      if (value !== undefined) {
        this[currentPart] = value;
      }
      return this[currentPart] ?? null;
    }
    // On doit descendre d'un niveau — vérifier que c'est possible
    if (this[currentPart] === undefined || this[currentPart] === null) {
      if (value !== undefined) {
        // Créer le niveau intermédiaire uniquement en écriture
        this[currentPart] = {};
      } else {
        // Pas de valeur à écrire et chemin inexistant : retourner null
        return null;
      }
    }
    // Guard : si la valeur intermédiaire n'est pas un objet, on ne peut pas descendre
    if (typeof this[currentPart] !== "object") {
      throw new Error(
        `Cannot create property '${parts[0]}' on ${typeof this[currentPart]} '${this[currentPart]}'`
      );
    }
    return parseParameterString.call(
      this[currentPart],
      parts.join("."),
      value
    );
  }
  return this;
};

// Déclaration d'un objet hétérogène
export interface DynamicService {
  [cleDynamic: string]: any;
}

export interface DynamicParam {
  [cleDynamic: string]: any;
}

export interface Scopes {
  [nameScope: string]: {
    [idContainer: string]: Container;
  };
}

export type ProtoService = { (): void; [key: string]: any };
export type ProtoParameters = { (): void; [key: string]: any };

// Le type alias utilise un objet générique — plus besoin d'accéder à un
// membre protected via Container.prototype (ce qui déclenchait TS2445)
type ProtoParametersPrototype = { [key: string]: any };

/*
 *
 *  CONTAINER CLASS
 *
 */
class Container {
  // public : session.ts (sous-classe externe) accède à protoService et
  // protoParameters directement. On conserve la visibilité d'origine.
  public protoService: ProtoService = function () {};
  protected services: ProtoService | null;
  public protoParameters: ProtoParameters = function () {};
  protected parameters: ProtoService | null;
  protected id: string;
  private scopes: Scopes = {};

  constructor(input?: Container, deep: boolean = false) {
    this.id = uuidv4();
    if (input && input instanceof Container) {
      this.services = Object.create(input.protoService.prototype);
      this.parameters = Object.create(input.protoParameters.prototype);
      this.setServices(input.services || {});
      // deep = true : les paramètres JSON-safe sont clonés (structuredClone)
      // deep = false (défaut) : shallow copy — les services restent partagés
      // (impossible de cloner des instances arbitraires)
      if (deep) {
        try {
          this.setParametersBulk(structuredClone(input.parameters ?? {}));
        } catch {
          // Fallback si les paramètres contiennent des valeurs non-clonables
          this.setParametersBulk(input.parameters || {});
        }
      } else {
        this.setParametersBulk(input.parameters || {});
      }
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
    // Guard cohérent avec get() : pas d'exception si services est null
    if (!this.services) {
      return false;
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

  // Retourne un boolean strict — plus de "boolean | any"
  public has(name: string): boolean {
    return !!this.services?.[name];
  }

  // --- Itération sur les services ---

  /** Retourne les noms de tous les services enregistrés. */
  public keys(): string[] {
    return Object.keys(this.services ?? {});
  }

  /** Retourne les paires [nom, valeur] de tous les services enregistrés. */
  public entries(): [string, unknown][] {
    return Object.entries(this.services ?? {});
  }

  // --- Gestion des scopes ---

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
    // On extrait les prototypes ici, dans Container, où l'accès à
    // this.protoService / this.protoParameters est parfaitement légal.
    // Scope les reçoit par paramètre : aucun accès cross-instance.
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
      const scopesArray = Object.values(scopesForName);
      for (const scope of scopesArray) {
        this.leaveScope(scope as Scope);
      }
      delete this.scopes[name];
    }
  }

  /** Supprime tous les scopes déclarés sur ce container. */
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
    return parseParameterString.call(this.parameters, name, ele);
  }

  public getParameters(name: string): DynamicParam | null {
    if (name) {
      return parseParameterString.call(this.parameters, name);
    }
    throw new Error(`getParameters : invalid name "${name}"`);
  }

  // --- Cycle de vie ---

  public clean(): void {
    // Purger les scopes avant de nullifier services/parameters
    // pour éviter les fuites mémoire sur les références circulaires
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
    // Les prototypes sont passés par enterScope() — qui vit dans Container
    // et accède donc légalement à ses propres membres.
    // Scope ne touche jamais à parent.protoService / parent.protoParameters.
    parentProtoService: ProtoService,
    parentProtoParameters: ProtoParameters
  ) {
    super();
    this.name = name;
    this.parent = parent;
    // Mécanisme prototype intact : le scope hérite des services/paramètres
    // du parent par délégation prototypale, sans copie explicite.
    this.services = Object.create(parentProtoService.prototype);
    this.parameters = Object.create(parentProtoParameters.prototype);
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