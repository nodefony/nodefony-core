/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines-per-function */
// const Table = require('cli-table3');
import path from "node:path"
import fs from "node:fs"
import  commander , { program } from "commander";
import { 
  spawn, 
  spawnSync, 
  SpawnSyncReturns, 
  SpawnSyncOptionsWithStringEncoding, 
  SpawnOptions
} 
  from "node:child_process";
import moment from "moment";
import semver from "semver";
import asciify from "asciify";
import inquirer from "inquirer"
import Table from "cli-table3"
import {get, random} from "node-emoji"
import clc from "cli-color"
import Service, {DefaultOptions}  from "./Service";
import {extend} from "./Tools"
import Container from "./Container";
import FileClass from "./FileClass";
import Event  from "./Event"
//import { FSWatcher } from "node:fs";
import {DebugType, EnvironmentType} from './Nodefony'
import bare from "cli-color/bare";
import clui from "clui"
import Syslog from "./syslog/Syslog";
//import Rx from 'rxjs'
import Rx from 'rxjs'
//import   {rm, ls, cd ,mkdir, ln, cp ,chmod, ShellString, ShellArray } from 'shelljs'
import   shelljs from 'shelljs'


interface CliDefaultOptions extends DefaultOptions{
  processName: string
  autostart: boolean
  asciify: boolean
  clear: boolean
  color: bare.Format 
  prompt: string
  commander: boolean
  signals: boolean
  autoLogger: boolean
  resize: boolean
  version: null
  warning: boolean
  pid: boolean 
  promiseRejection: boolean,
  font?:string
}

// const red = clc.red.bold;
// const cyan   = clc.cyan.bold;
const blue = clc.blueBright.bold;
const {green} = clc;
// const yellow = clc.yellow.bold;
const magenta = clc.magenta.bold;
const {reset} = clc; // '\x1b[0m';


let processName = null;
if (process.argv && process.argv[1]) {
  processName = path.basename(process.argv[1]);
} else {
  processName = process.title || "nodefony";
}

const defaultTableCli = {
  style: {
    head: ["cyan"],
    border: ["grey"]
  }
};

const defaultOptions = {
  processName,
  autostart: true,
  asciify: true,
  clear: true,
  color: blue,
  prompt: "default", // "default" || "rxjs"
  commander: true,
  signals: true,
  autoLogger: true,
  resize: false,
  version: null,
  warning: false,
  pid: false,
  promiseRejection: true
};

class Cli extends Service {
  public  declare options : CliDefaultOptions 
  public debug : DebugType = false
  public environment : EnvironmentType | string
  public inquirer : typeof inquirer = inquirer
  public commander : typeof program  | null = null
  //public emoji: typeof emoji = emoji
  public  pid : number  | null
  public interactive : boolean = false
  public prompt :Rx.Subject<unknown>| any | null = null
  public unhandledRejections: Map<Promise<unknown>, string> = new Map();
  public response: Record<string, any> = {};
  public timers: Record<string, string> = {};
  public wrapperLog : (...data: any[]) => void = console.log 
  public version : string = "" 
  public clui:  typeof clui  = clui
  public clc :typeof clc  = clc
  public spinner : clui.Spinner |  null  = null
  public blankLine :  (() => void ) | null =  null 
  public columns : number = 0
  public rows : number = 0

 // eslint-disable-next-line complexity
  constructor(name: string, container?: Container , notificationsCenter?: Event | false, options?: CliDefaultOptions) {
    options = extend({}, defaultOptions, options);
    if(options){
      name ||= options.processName; // Utilisation de l'opérateur de fusion nullish
      options = extend({}, defaultOptions, options);
    }else{
      options = extend({}, defaultOptions, options);
    }

     // Obtenez le nombre d'arguments
    const numArgs: number = arguments.length;
    switch (numArgs) {
        case 0:
        case 1:{
          // @ts-ignore
          super(name);
          break;
        }
        case 2:{
          // @ts-ignore
          super(name, undefined, undefined, container);
          break;
        }
        case 3:{
          // @ts-ignore
          super(name, <Container>container, undefined, <Event>notificationsCenter);
          break;
        }
        default:{
          // @ts-ignore
          super(name, <Container>container, <Event>notificationsCenter, options);
        }
    }
    this.options = <CliDefaultOptions>options;
    if ( process.env.NODE_ENV ){
      this.environment = process.env.NODE_ENV
    }else{
      this.environment  = "production";
    }
    
    this.setProcessTitle();
    this.pid = this.options.pid ? this.setPid() : null;
    
    if (this.options.autoLogger) {
      this.initSyslog();
    }

    this.initUi();

    // Optimisation : Utilisation de fireAsync pour les opérations asynchrones
    this.prependOnceListener("onStart", async () => {
      try {
        this.initPrompt();
        await this.fireAsync("onStart", this);
      } catch (e) {
        this.log(e, "ERROR");
      }
    });

    this.initCommander();

    // Gestion des avertissements
    if (this.options.warning) {
      this.handleWarnings();
    } else {
      process.env.NODE_NO_WARNINGS = "1"; // Utilisation d'une chaîne pour la clarté
    }

    // Gestion des signaux
    if (this.options.signals) {
      this.handleSignals();
    }

    // Gestion des rejets de promesses
    if (this.options.promiseRejection) {
      this.listenRejection();
    }

    // Affichage ASCII (asciify)
    if (name && this.options.asciify) {
      this.showAsciify(name)
        .then(async () => {
          if (this.options.autostart) {
            await this.fireAsync("onStart", this);
          }
        })
        .catch((e) => this.log(e, "ERROR"));
    } else if (this.options.autostart) {
      try {
        const func = async function(this: Cli){
          await this.fireAsync("onStart", this);
        }
        func.call(this)
      } catch (e) {
        this.log(e, "ERROR");
      }
    }
  }


  // eslint-disable-next-line complexity
  // constructor (name: string, container?: Container, notificationsCenter?: Event | false , options: CliDefaultOptions ) {
  //   switch (arguments.length) {
  //   case 0:
  //     options = extend({}, defaultOptions);
  //     name = options.processName;
  //     super(options.processName, undefined, undefined, options);
  //     break;
  //   case 1:
  //     if (typeof name === "object" && name !== null) {
  //       options = extend({}, defaultOptions, name);
  //       name = options.processName;
  //       super(options.processName, undefined, undefined, options);
  //     } else {
  //       options = extend({}, defaultOptions);
  //       name ||= options.processName;
  //       super(name, undefined, undefined, options);
  //     }
  //     break;
  //   case 2:
  //     if (container instanceof Container) {
  //       options = extend({}, defaultOptions);
  //       name ||= options.processName;
  //       super(name, container, undefined, options);
  //     } else if (typeof container === "object" && container !== null) {
  //       options = extend({}, defaultOptions, container);
  //       name ||= options.processName;
  //       super(name, undefined, undefined, options);
  //     } else {
  //       options = extend({}, defaultOptions);
  //       name ||= options.processName;
  //       super(name, container, undefined, options);
  //     }
  //     break;
  //   default:
  //     options = extend({}, defaultOptions, options);
  //     name ||= options.processName;
  //     super(name, container, notificationsCenter, options);
  //   }
  //   this.options = options
  //   this.environment = process.env.NODE_ENV || "production";
  //   // process.env.NODE_ENV = this.environment;
  //   this.unhandledRejections = new Map();

  //   this.setProcessTitle();
  //   this.pid = null;
  //   if (this.options.pid) {
  //     this.setPid();
  //   }
  //   this.wrapperLog = console.log;
  //   this.response = {};
  //   this.timers = {};
  //   if (this.options.autoLogger) {
  //     this.initSyslog();
  //   }
  //   this.initUi();
  //   this.prependOnceListener("onStart", async () => {
      
  //   });

  //   this.commander = null;
  //   this.initCommander();

  //   if (this.options.warning) {
  //     process.on("warning", (warning) => {
  //       this.log(warning, "WARNING");
  //       this.fire("onNodeWarning", warning, this);
  //     });
  //   } else {
  //     process.env.NODE_NO_WARNINGS = 1;
  //   }

  //   /**
  //    *  @signals
  //    */
  //   if (this.options.signals) {
  //     process.on("SIGINT", () => {
  //       this.blankLine();
  //       this.wrapperLog = console.log;
  //       this.log("SIGINT", "CRITIC");
  //       // this.clear();
  //       this.fire("onSignal", "SIGINT", this);
  //       process.nextTick(() => {
  //         this.terminate();
  //       });
  //     });
  //     process.on("SIGTERM", () => {
  //       this.blankLine();
  //       this.wrapperLog = console.log;
  //       this.log("SIGTERM", "CRITIC");
  //       this.fire("onSignal", "SIGTERM", this);
  //       process.nextTick(() => {
  //         this.terminate();
  //       });
  //     });
  //     process.on("SIGHUP", () => {
  //       this.blankLine();
  //       this.wrapperLog = console.log;
  //       this.log("SIGHUP", "CRITIC");
  //       this.fire("onSignal", "SIGHUP", this);
  //       process.nextTick(() => {
  //         this.terminate();
  //       });
  //     });
  //     process.on("SIGQUIT", () => {
  //       this.blankLine();
  //       this.wrapperLog = console.log;
  //       this.log("SIGQUIT", "CRITIC");
  //       // this.clear();
  //       this.fire("onSignal", "SIGQUIT", this);
  //       process.nextTick(() => {
  //         this.terminate();
  //       });
  //     });
  //     process.on("uncaughtException", (err) => {
  //       this.log(err, "CRITIC", "uncaughtException");
  //     });
  //   }

  //   /**
  //    *  @promiseRejection
  //    */
  //   if (this.options.promiseRejection) {
  //     this.listenRejection();
  //   }

  //   /**
  //    *    ASCIIFY
  //    */
  //   if (name && this.options.asciify) {
  //     this.showAsciify(name)
  //       .then(async () => {
  //         if (this.options.autostart) {
  //           try {
  //             await this.fireAsync("onStart", this);
  //           } catch (e) {
  //             this.log(e, "ERROR");
  //           }
  //         }
  //       });
  //   } else if (this.options.autostart) {
  //     try {
  //       async () => {
  //         try {
  //           await this.fireAsync("onStart", this);
  //         } catch (e) {
  //           this.log(e, "ERROR");
  //         }
  //       };
  //     } catch (e) {
  //       this.log(e, "ERROR");
  //     }
  //   }
  // }

    // Méthode privée pour gérer les signaux
  private handleSignals(): void {
    const signalHandler = (signal: string) => {
      if( this.blankLine){
        this.blankLine();
      }
      this.wrapperLog = console.log;
      this.log(signal, "CRITIC");
      this.fire("onSignal", signal, this);
      process.nextTick(() => {
        this.terminate();
      });
    };
    process.on("SIGINT", () => signalHandler("SIGINT"));
    process.on("SIGTERM", () => signalHandler("SIGTERM"));
    process.on("SIGHUP", () => signalHandler("SIGHUP"));
    process.on("SIGQUIT", () => signalHandler("SIGQUIT"));
  }


   // Méthode privée pour gérer les avertissements
  private handleWarnings(): void {
    process.on("warning", (warning) => {
      this.log(warning, "WARNING");
      this.fire("onNodeWarning", warning, this);
    });
  }

  start () : Promise<Cli>{
    return new Promise(async (resolve, reject) => {
      try {
        if (this.options.autostart) {
          if (this.options.asciify) {
            this.once("onStart", () => resolve(this));
          } else {
            await this.fireAsync("onStart", this);
            return resolve(this);
          }
        } else if (this.options.asciify) {
          this.once("onAsciify", async () => {
            await this.fireAsync("onStart", this);
            return resolve(this);
          });
        } else {
          await this.fireAsync("onStart", this);
          return resolve(this);
        }
      } catch (e) {
        return reject(e);
      }
    });
  }

  idle () {
    let resolve = null;
    let reject = null;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return (function () {
      return {
        resolve,
        promise,
        reject
      };
    }());
    // return this.idleId = setInterval(() => {}, 0);
  }

  checkVersion (version : string | semver.SemVer | null | undefined = null) {
    if (!version) {
      version = this.version;
    }
    const res = semver.valid(version);
    if (res) {
      return res;
    }
    throw new Error(`Not valid version : ${version} check  http://semver.org `);
  }

  async showAsciify (name: string | null  = null) {
    if (!name) {
      name = this.name;
    }
    
    return await this.asciify(`      ${name}`, {
      font: this.options.font || "standard"
    })
      .then((data) => {
        this.fire("onAsciify", data);
        if (this.options.clear) {
          this.clear();
        }
        const color = this.options.color || blue;
        console.log(color(data));
        return data;
      })
      .catch((err) => {
        this.log(err, "ERROR");
        throw err;
      });
  }

  showBanner () {
    const version = this.commander ? this.commander.version() : this.options.version || "1.0.0";
    let banner = null;
    if (this.options.version) {
      banner = `          Version : ${blue(version)}   Platform : ${green(process.platform)}   Process : ${green(process.title)}   Pid : ${process.pid}`;
      if( this.blankLine){
         this.blankLine();
      }
      console.log(banner);
    }
    return banner;
  }

  listenRejection () {
    process.on("rejectionHandled", (promise) => {
      this.log("PROMISE REJECTION EVENT ", "CRITIC", "rejectionHandled");
      this.unhandledRejections.delete(promise);
    });
    process.on("unhandledRejection", (reason: string, promise: Promise<unknown>) => {
      this.log(`WARNING  !!! PROMISE CHAIN BREAKING : ${reason}`, "WARNING", "unhandledRejection");
      console.trace(promise);
      this.unhandledRejections.set(promise, reason);
    });
  }

  setPid () : number {
    return this.pid = process.pid;
  }

  setProcessTitle (name?: string) {
    if (name) {
      process.title = name.replace(new RegExp("\\s", "gi"), "").toLowerCase();
    } else {
      process.title = this.name.replace(new RegExp("\\s", "gi"), "").toLowerCase();
    }
    return process.title;
  }

  logEnv () {
    return `${blue(`      \x1b ${this.name}`)} Nodefony Environment : ${magenta(this.environment)}`;
  }

  initCommander () {
    if (this.options.commander) {
      this.commander = program;
      if (this.options.version) {
        this.setCommandVersion(this.options.version);
      }
      return program;
    }
    return null;
  }

  initUi () {
    this.blankLine  = function (this: Cli) {
      // return () => {
      //    console.log("")
      // }
      const myLine = new this.clui.Line().fill();
      return () => {
        myLine.output();
      };
    }.call(this);
    if (this.options.resize) {
      this.resize();
    }
  }

  initPrompt () : void {
    this.inquirer = inquirer;
    if (this.options.prompt === "rxjs") {
      this.prompt = new Rx.Subject();
      const prompt = inquirer.createPromptModule();
      prompt(this.prompt);
    } else {
      this.prompt = inquirer.createPromptModule();
    }
  }

  getFonts () : void {
    asciify.getFonts((err, fonts) => {
      fonts.forEach((ele)=>{
        this.log(ele)
      });
    });
  }

  async asciify (txt: string, options?: object  , callback?: (error:Error, data:string) => void ):  Promise<string> {
    return new Promise((resolve, reject) => {
      asciify(txt, extend({
        font: "standard"
      }, options), (error, data) => {
        if (callback && typeof callback === "function") {
          return callback(error, data);
        }
        if (error) {
          return reject(error);
        }
        return resolve(data);
      });
    });
  }

  async parseCommand (argv:  readonly string[] | undefined)  : Promise<commander.Command>{
    if (! this.commander){
      throw new Error(`commander not found`)
    }
    const parser = await this.commander.parse(argv || process.argv);
    const {debug} = this.commander.opts();
    if (debug) {
      this.debug = debug;
    } else {
      this.debug = false;
    }
    const {interactive} = this.commander.opts();
    if (interactive) {
      this.interactive = interactive;
    } else {
      this.interactive = false;
    }
    return Promise.resolve(parser);
  }

  setOption (flags: string, description?: string , defaultValue?: string | boolean | string[] | undefined) : commander.Command  {
    if (this.commander){
      return this.commander.option(flags, description, defaultValue);
    }
    throw new Error(`Commender not found`)
  }
    

  setCommandVersion (version: string) : commander.Command {
    if (this.commander && typeof this.commander.version === "function") {
      return this.commander.version(version, "-v, --version", "Nodefony Current Version");
    }
    throw new Error(`Commender not found`) 
  }

  setCommand (nameAndArgs: string, description:string , options?: commander.ExecutableCommandOptions | undefined): commander.Command {
    if (this.commander) {
      return this.commander.command(nameAndArgs, description, options);
    }
    throw new Error(`Commender not found`) 
  }

  showHelp (quit: boolean , context: commander.HelpContext | undefined ) : void | never{
    if( ! this.commander ){
       throw new Error(`Commender not found`) 
    }
    if (quit) {
      return this.commander.help(context);
    }
    return this.commander.outputHelp(context);
  }

  createProgress (size: number) {
    return new this.clui.Progress(size);
  }

  createSparkline (values:  number[] , suffix: string) : string{
    if (values) {
      try {
        return this.clui.Sparkline(values, suffix || "");
      } catch (e) {
        this.log(e, "ERROR");
        throw e;
      }
    }
    throw new Error(`Bad vlue : ${values}`)
  }

  getSeparator (sep: string | undefined) {
    if (sep) {
      return new inquirer.Separator(sep);
    }
    return new inquirer.Separator("--------");
  }

  getSpinner (message: string, design?: string[]) {
    return new this.clui.Spinner(message, design );
  }

  startSpinner (message: string, design?: string[]) : clui.Spinner | null {
    try {
      this.spinner = this.getSpinner(message, design);
      this.wrapperLog = this.spinner.message;
      this.spinner.start();
      return this.spinner;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  stopSpinner (/* message, options*/) {
    if (this.spinner) {
      this.spinner.stop();
      this.wrapperLog = console.log;
      this.spinner = null;
      return true;
    }
    this.log(new Error("Spinner is not started "), "ERROR");
    return false;
  }

  displayTable (datas : any[], options = defaultTableCli, syslog : Syslog | null = null) {
    if (!datas || !datas.length) {
      return new Table(extend({}, defaultTableCli, options));
    }
    const table = new Table(extend({}, defaultTableCli, options));
    if (datas) {
      for (let i = 0; i < datas.length; i++) {
        table.push(datas[i]);
      }
      if (syslog) {
        syslog.log(`\n${table.toString()}`);
      } else {
        console.log(table.toString());
      }
    }
    return table;
  }

  static niceBytes (x: string | number) {
    const units :string[] = ["bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    let n = parseInt(<string>x, 10) || 0,
      l = 0;
    while (n >= 1024) {
      n /= 1024;
      l++;
    }
    return `${n.toFixed(n >= 10 || l < 1 ? 0 : 1)} ${units[l]}`;
  }

  static niceUptime (date: moment.MomentInput, suffix: boolean | undefined) {
    return moment(date).fromNow(suffix || false);
  }
  static niceDate (date: moment.MomentInput, format: string | undefined) {
    return moment(date).format(format);
  }

  getEmoji (name: string) {
    if (name) {
      return get(name);
    }
    return random().emoji;
  }

  clear () {
    console.clear()
  }

  reset () {
    process.stdout.write(reset);
  }

  resize () {
    process.stdout.on("resize", () => {
      this.columns = process.stdout.columns;
      this.rows = process.stdout.rows;
      this.fire("onResize", this.columns, this.rows, this);
    });
  }

  rm (...files: string[] ) : shelljs.ShellString {
    return shelljs.rm(...files );
  }

  // cp (options: string, source: string | string[], dest: string) :  ShellString{
  //   return cp(options, source, dest ); 
  // }

  // cd (dir?: string | undefined) :  ShellString{
  //   return cd( dir);
  // }

  // ln (options: string, source: string, dest: string):  ShellString {
  //   return ln(options, source, dest );
  // }

  // mkdir (...dir: string[]):  ShellString{
  //   return mkdir(...dir );
  // }

  // chmod (options: string, mode: string | number, file: string): ShellString {
  //   return chmod(options, mode, file);
  // }

  // ls (...paths: string[]):  ShellArray{
  //   return ls(...paths);
  // }

  createDirectory (
    myPath: fs.PathLike | fs.PathOrFileDescriptor , 
    mode : fs.MakeDirectoryOptions | fs.Mode | null | undefined, 
    callback: (file:FileClass) =>void | null, 
    force: boolean
  ){
    let file = null;
    if (!callback) {
      return new Promise((resolve, reject) => {
        try {
          fs.mkdirSync(<fs.PathLike>myPath, mode);
          file = new FileClass(myPath);
          return resolve(file);
        } catch (e: any) {
          switch (e.code) {
          case "EEXIST":
            if (force) {
              file = new FileClass(myPath);
              return resolve(file);
            }
            break;
          }
          return reject(e);
        }
      })
        .catch((e) => {
          throw e;
        });
    }
    try {
      fs.mkdirSync(<fs.PathLike>myPath, mode);
      file = new FileClass(myPath);
      callback(file);
      return file;
    } catch (e: any) {
      switch (e.code) {
      case "EEXIST":
        if (force) {
          file = new FileClass(myPath);
          callback(file);
          return file;
        }
        break;
      }
      throw e;
    }
  }

  existsSync (myPath: fs.PathLike) {
    if (!myPath) {
      throw new Error("existsSync no path found");
    }
    return fs.existsSync(myPath);
  }

  exists (myPath: fs.PathLike, mode: number | undefined, callback: fs.NoParamCallback) {
    if (!myPath) {
      throw new Error("exists no path found");
    }
    if (!mode) {
      mode = fs.constants.R_OK | fs.constants.W_OK;
    }
    if (callback) {
      return fs.access(myPath, mode, callback);
    }
    return fs.existsSync(myPath);
  }

  terminate (code: number= 0, quiet?: boolean) {
    if (quiet) {
      return code;
    }
    if (code === 0) {
      process.exitCode = code;
    }
    process.exit(code);
  }

  static quit (code:  number) {
    if (code === 0) {
      process.exitCode = code;
    }
    process.exit(code);
  }

  startTimer (name: string) {
    if (name in this.timers) {
      throw new Error(`Timer : ${name} already exist !! stopTimer to clear`);
    }
    try {
      this.log(`BEGIN TIMER : ${name}`, "INFO");
      this.timers[name] = name;
      return console.time(name);
    } catch (e) {
      if (name in this.timers) {
        delete this.timers[name];
      }
      throw e;
    }
  }

  stopTimer (name: string) {
    if (!name) {
      for (const timer in this.timers) {
        this.stopTimer(this.timers[timer]);
      }
    }
    try {
      if (name in this.timers) {
        this.log(`END TIMER : ${name}`, "INFO");
        delete this.timers[name];
        return console.timeEnd(name);
      }
      throw new Error(`Timer : ${name} not exist !! startTimer before`);
    } catch (e) {
      if (name in this.timers) {
        delete this.timers[name];
      }
      throw e;
    }
  }

  getCommandManager (manager: string) {
    if (process.platform === "win32") {
      switch (manager) {
      case "npm":
        return "npm.cmd";
      case "yarn":
        return "yarn.cmd";
      case "pnpm":
        return "pnpm.cmd";
      default:
        throw new Error(`bad manager : ${manager}`);
      }
    } else {
      switch (manager) {
      case "npm":
        return "npm";
      case "yarn":
        return "yarn";
      case "pnpm":
        return "pnpm";
      default:
        throw new Error(`bad manager : ${manager}`);
      }
    }
  }

  runPackageManager (argv : string[]= [], cwd :string= path.resolve("."), env: EnvironmentType , manager: string) {
    const currentenv = process.env.NODE_ENV;
    switch (env) {
    case "dev":
    case "development":
      switch (manager) {
      case "npm":
      case "yarn":
      case "pnpm":
        break;
      }
      process.env.NODE_ENV = "development";
      break;
    case "prod":
    case "production":
      switch (manager) {
      case "npm":
        argv.push("--omit=dev");
        break;
      case "yarn":
        argv.push("--production");
        break;
      case "pnpm":
        argv.push("--prod");
        break;
      }
      process.env.NODE_ENV = "production";
      break;
    default:
      process.env.NODE_ENV = this.environment;
    }
    return new Promise((resolve, reject) => {
      try {
        this.debug = this.commander ? this.commander.opts().debug || false : false;
        this.log(`Command : ${manager} ${argv.join(" ")} in cwd : ${cwd}`);
        const exe = this.getCommandManager(manager);
        this.spawn(exe, argv, {
          cwd,
          env: process.env,
          stdio:  "inherit"
        }, (code: number) => {
          process.env.NODE_ENV = currentenv;
          if (code === 0) {
            return resolve(code);
          }
          return resolve(new Error(`Command : ${manager} ${argv.join(" ")}  cwd : ${cwd} Error Code : ${code}`));
        });
      } catch (e) {
        process.env.NODE_ENV = currentenv;
        this.log(e, "ERROR");
        return reject(e);
      }
    });
  }

  async npm (argv = [], cwd = path.resolve("."), env : EnvironmentType= "dev") {
    return this.runPackageManager(argv, cwd, env, "npm");
  }

  async yarn (argv = [], cwd = path.resolve("."), env : EnvironmentType= "dev") {
    return this.runPackageManager(argv, cwd, env, "yarn");
  }

  async pnpm (argv = [], cwd = path.resolve("."), env : EnvironmentType= "dev") {
    return this.runPackageManager(argv, cwd, env, "pnpm");
  }

  spawn (command: string, args: readonly string[] | undefined, options : SpawnOptions | undefined , close : ((code:number) =>void) | null= null) {
    return new Promise((resolve, reject) => {
      let cmd = null;
      try {
        if (!args ){
          args=[]
        }
        this.log(`Spawn : ${command} ${args.join(" ")}`, "INFO");
        cmd = spawn(command, args, options || {});
        if (cmd.stdout) {
          cmd.stdout.on("data", (data) => {
            const str = data.toString();
            if (str) {
              if (this.debug) {
                this.log(`${command} :\n`, "INFO", "STDOUT");
              }
              process.stdout.write(str);
            }
          });
        }
        if (cmd.stderr) {
          cmd.stderr.on("data", (data) => {
            const str = data.toString();
            if (str) {
              if (this.debug) {
                this.log(`${command} :\n`, "INFO", "STDERR");
              }
              process.stdout.write(str);
            }
          });
        }
        cmd.on("close", (code: number) => {
          if (this.debug) {
            this.log(`Child Process exited with code ${code}`, "DEBUG");
          }
          if (close) {
            close(code);
          }
          if (code !== 0) {
            if (!args){
              args =[]
            }
            this.log(`Spawn : ${command} ${args.join(" ")} Error Code : ${code}`, "ERROR");
          }
          return resolve(code);
        });
        cmd.on("error", (err) => {
          this.log(err, "ERROR");
          return reject(err);
        });
        if (cmd.stdin) {
          process.stdin.pipe(cmd.stdin);
        }
      } catch (e) {
        this.log(e, "ERROR");
        return reject(e);
      }
    });
  }

  spawnSync (command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding) : SpawnSyncReturns<string> {
    let cmd = null;
    try {
      cmd = spawnSync(command, args, options);
      if (cmd.error) {
        throw cmd.error;
      }
      if (cmd.stderr) {
        this.log(cmd.stderr.toString(), "ERROR");
      }
      if (cmd.stdout) {
        this.log(cmd.stdout.toString(), "INFO");
      }
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
    return cmd;
  }
}

export default  Cli;
