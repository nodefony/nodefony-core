/* eslint-disable @typescript-eslint/no-explicit-any */
// Nodefony.ts
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
  isPromise,
} from "./Tools";
import { v5 as uuidv5, v4 as uuidv4 } from "uuid";

import Kernel from "./kernel/Kernel";

import Module from "./kernel/Module";
import CliKernel from "./kernel/CliKernel";
import Container from "./Container";
import Syslog from "./syslog/Syslog";
import Pdu from "./syslog/Pdu";
import Error from "./Error";
import Service from "./Service";
import Command from "./command/Command";
import Cli from "./Cli";
import Event from "./Event";
import Builder from "./command/Builder";
import Finder from "./finder/Finder";
import File from "./finder/File";
import Result from "./finder/Result";
import FileClass from "./FileClass";
import FileResult from "./finder/FileResult";
import Fetch from "./service/fetchService";
import Injector from "./kernel/injector/injector";
import { version } from "../package.json";
import {
  modules,
  injectable,
  inject,
  services,
  entities,
} from "./kernel/decorators/kernelDecorator";

import Orm from "./kernel/orm/Orm";
import Entity from "./kernel/orm/Entity";
import Connector from "./kernel/orm/Connector";
import nodefonyError from "./Error";

//import { createRequire } from "module";
//const require = createRequire(import.meta.url);
//const  {version} = require("../package.json");

class Nodefony {
  private static instance: Nodefony;
  instance: Nodefony = Nodefony.instance;
  version: string;

  static Container = Container;
  public Container: typeof Container = Container;

  static Command = Command;
  public Command: typeof Command = Command;

  public static Kernel: typeof Kernel = Kernel;
  public Kernel: typeof Kernel = Kernel;
  public static kernel: Kernel | null;
  public kernel: Kernel | null = Nodefony.kernel;

  static Error = Error;
  public Error: typeof Error = Error;

  static Syslog = Syslog;
  public Syslog: typeof Syslog = Syslog;

  static Service = Service;
  public Service: typeof Service = Service;

  static Event = Event;
  public Event: typeof Event = Event;

  static Cli = Cli;
  public Cli: typeof Cli = Cli;

  public extend: typeof extend = extend;
  public isEmptyObject: typeof isEmptyObject = isEmptyObject;
  public isPlainObject: typeof isPlainObject = isPlainObject;
  public isUndefined: typeof isUndefined = isUndefined;
  public isRegExp: typeof isRegExp = isRegExp;
  public isContainer: typeof isContainer = isContainer;
  public typeOf: typeof typeOf = typeOf;
  public isFunction: typeof isFunction = isFunction;
  public isArray: typeof isArray = isArray;
  public isPromise: typeof isPromise = isPromise;

  public sequelize: any = null;
  public mongoose: any = null;

  public warning: any = null;

  private constructor() {
    this.version = version;
  }

  public static getInstance(): Nodefony {
    if (!Nodefony.instance) {
      Nodefony.instance = new Nodefony();
    }
    return Nodefony.instance;
  }

  public static getKernel(): Kernel | null {
    return Nodefony.kernel;
  }
  public static setKernel(kernel: Kernel): Kernel {
    return (Nodefony.kernel = kernel);
  }

  generateV5Id(name: string, namespace?: string): string {
    return uuidv5(name, namespace || uuidv4());
  }
  generateId(): string {
    return uuidv4();
  }
}

const nodefony: Nodefony = Nodefony.getInstance() as Nodefony;
const kernel: Kernel = Nodefony.getKernel() as Kernel;

export default nodefony as Nodefony;
export {
  extend,
  typeOf,
  isPromise,
  Nodefony,
  nodefonyError,
  kernel,
  Kernel,
  Module,
  CliKernel,
  Syslog,
  Service,
  Container,
  Cli,
  Event,
  Command,
  Pdu,
  Builder,
  Finder,
  File,
  FileClass,
  FileResult,
  Fetch,
  Result,
  Error,
  Injector,
  Orm,
  Entity,
  Connector,
  modules,
  injectable,
  inject,
  services,
  entities,
};
