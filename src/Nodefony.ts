// Nodefony.ts
import Kernel from './Kernel';
import Container from './Container';
import Syslog from './syslog/Syslog';
import Error from './Error'
import Service from './Service'
import {
  extend,
  isEmptyObject,
  isPlainObject,
  isUndefined,
  isRegExp,
  isContainer,
  typeOf,
  isFunction,
  isArray,
  isPromise } from './Tools'
import {version} from '../package.json';
//import { createRequire } from "module";
//const require = createRequire(import.meta.url);
//const  {version} = require("../package.json");


class Nodefony {
  private static instance: Nodefony ;
  version: string;

  static Container = Container;
  public Container: typeof Container  = Container;

  public static Kernel = Kernel;
  public Kernel: typeof Kernel  = Kernel;
  public static kernel: Kernel  ;
  public kernel:  Kernel | null  = Nodefony.kernel;

  static Error = Error;
  public Error: typeof Error  = Error;

  static Syslog = Syslog;
  public Syslog: typeof Syslog  = Syslog;

  static Service = Service;
  public Service: typeof Service  = Service;

  public extend : typeof extend = extend;
  public isEmptyObject : typeof isEmptyObject = isEmptyObject;
  public isPlainObject : typeof isPlainObject = isPlainObject;
  public isUndefined : typeof isUndefined = isUndefined;
  public isRegExp : typeof isRegExp = isRegExp;
  public isContainer : typeof isContainer = isContainer;
  public typeOf : typeof typeOf = typeOf;
  public isFunction : typeof isFunction = isFunction;
  public isArray : typeof isArray = isArray;
  public isPromise : typeof isPromise = isPromise;


  public sequelize : any = null
  public mongoose : any = null

  private constructor() {
    this.version = version
  }

  public static  getInstance(): Nodefony {
    if (!Nodefony.instance) {
      Nodefony.instance = new Nodefony()
    }
    return Nodefony.instance;
  }

  public static  getKernel(): Kernel {
    if (!Nodefony.kernel) {
      Nodefony.kernel = new Kernel()
    }
    return Nodefony.kernel;
  }
}

const nodefony = Nodefony.getInstance()

export default nodefony
export const kernel = Nodefony.getKernel()

