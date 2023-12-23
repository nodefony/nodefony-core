/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';
import {extend, isPlainObject} from './Tools'

const generateId = function (): string {
  return uuidv4();
};

const ISDefined = function (ele: any): boolean {
  if (ele !== null && ele !== undefined) {
    return true;
  }
  return false;
};

const parseParameterString = function (this: Container['parameters'] | ProtoParametersPrototype, str: string, value?: any): DynamicParam | null {
  if (!this) {
    throw new Error(`Bad call`);
  }
  const parts = str.split('.');
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
      if( this[currentPart] ){
        return parseParameterString.call(this[currentPart], parts.join('.'), value);
      }
      return null
    }
  }
  return this;
};

// Déclaration d'un objet hétérogène
interface DynamicService  {
  [cleDynamic: string]: any; // Propriétés dynamiques de tout type
}

interface DynamicParam  {
  [cleDynamic: string]: any; // Propriétés dynamiques de tout type
}

interface Scopes {
  [nameScope: string]: {
    [idContainer: string] : Container;
  };
}

type ProtoService = { (): void; [key: string]: any };
type ProtoParameters = { (): void; [key: string]: any };
type ProtoParametersPrototype = ReturnType<typeof Container.prototype.protoParameters.prototype>;

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


  private id: string;
  private scopes: Scopes = {};
  

  constructor(services: DynamicService = {}, parameters: DynamicParam= {}) {
    this.id = generateId();
    this.services = Object.create(this.protoService.prototype); 
    this.parameters = Object.create(this.protoParameters.prototype);
    if (services && typeof services === "object") {
      for (const service in services) {
        this.set(service, services[service]);
      }
    }
    if (parameters && typeof parameters === "object") {
      for (const parameter in parameters) {
        this.setParameters(parameter, parameters[parameter]);
      }
    }
  }

  public log(pci: any, severity?: any, msgid?: any, msg?: any) {
    const syslog = this.get("syslog");
    if (!syslog) {
      console.log(pci);
      return;
    }
    if (!msgid) {
      msgid = "SERVICES CONTAINER ";
    }
    return syslog.log(pci, severity, msgid, msg);
  }

   public set(name: string, object: any) {
    if (this.services && name) {
      // Ajouter la propriété au prototype de protoService spécifique à cette instance
      this.protoService.prototype[name] = object;
      // Ajouter la propriété au service de l'instance actuelle ?
      this.services[name] = object;
    } else {
      throw new Error("Container bad argument name");
    }
  }

  public get(name: string) : any{
    if (this.services && (name in this.services)) {
      return this.services[name];
    }
    return null;
  }

  public remove(name: string): boolean {
    if (! this.services) {
      throw new Error(`Bad call`)
    }
    if (this.get(name)) {
      delete this.services[name];
      if ((this.protoService.prototype)[name]) {
        delete (this.protoService.prototype)[name];
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

  public has(name: string) : boolean | any {
    if( this.services){
      return this.services[name]
    }
    return false 
  }

  public addScope(name: string)  :  Scope | object {
    if (!this.scopes[name]) {
      return (this.scopes[name] = {});
    }
    return this.scopes[name];
  }

  public enterScope(name: string) :Scope {
    const sc = new Scope(name, this);
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

  public removeScope(name: string) : void {
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
      throw new Error("setParameters : container parameter name must be a string")
    }
    if (ele === undefined) {   
      throw new Error(`setParameters : ${name} container parameter value must be define`);
    }
    //parseParameterString.call(this.protoParameters.prototype, name, ele)
    return parseParameterString.call(this.parameters, name, ele)
  }

  public getParameters(name: string): DynamicParam | null{
    //console.log(`main getParameters : ${name}`)
    if(name){
      const res = parseParameterString.call(this.parameters, name);
      //console.log(`main After getParameters :  `, res)
      return res
    }
    throw new Error(`Bad name : ${name}`)
  }

  public clean() : void {
    this.services = null;    
    this.parameters = null;
  }
}

/*
 *
 *  SCOPE CLASS
 *
 */
class Scope extends Container {
  public name: string;
  private parent: any;

  constructor(name: string, parent: Container) {
    super();
    this.name = name;
    this.parent = parent;
    this.services = Object.create(this.parent.protoService.prototype);
    this.parameters = Object.create(this.parent.protoParameters.prototype);
  }

  public override getParameters(name: string, merge: boolean = true, deep: boolean = true) : DynamicParam | null{
    const res = parseParameterString.call(this.parameters, name)
    const obj = this.parent.getParameters(name)
    if(ISDefined(res)) {
      if( merge && isPlainObject(obj) && isPlainObject(res) ){
        return extend(deep, obj, res)
      }
      return res
    }
    return obj
  }
    
  public override clean() : void{
    this.parent = null;
    return super.clean();
  }
}

export default Container
export{
  DynamicParam
}

