/* eslint-disable @typescript-eslint/ban-ts-comment */
import Service, { DefaultOptionsService } from "../Service";
import Container from "../Container";
import CliKernel from "./CliKernel";
import { DebugType, EnvironmentType } from "../types/globals";
import { extend } from "../Tools";
import clc from "cli-color";
import path from "node:path";
import os from "node:os";
import cluster from "node:cluster";
import FileClass from "../FileClass";
import nodefony, { Nodefony } from "../Nodefony";
import Command, { CommandArgs } from "../command/Command";
import { isSubclassOf } from "../Tools";
import { Severity } from "../syslog/Pdu";
import Module from "./Module";
//import Fetch from "../service/fetchService";
import Pm2 from "../service/pm2Service";
import Watcher from "../service/watcherService";
import Rollup from "../service/rollup/rollupService";
import Injector from "./injector/injector";
//import { StartOptions } from "pm2";

const colorLogEvent = clc.cyan.bgBlue("EVENT KERNEL");

export interface TypeKernelOptions extends DefaultOptionsService {
  node_start?: NodefonyStartType;
}

interface MemoryStats {
  rss: number; // Resident Set Size
  heapTotal: number; // Total size of the heap
  heapUsed: number; // Heap actually used
  external: number; // Memory used by external C++ objects
}

interface Stats {
  memory: MemoryStats;
  // Ajoutez d'autres propriétés avec les types appropriés ici
}

const kernelDefaultOptions: TypeKernelOptions = {
  events: {
    nbListeners: 60,
    //captureRejections: true,
  },
};

type ClusterType = "master" | "worker";
type NodefonyStartType = "PM2" | "CONSOLE" | "NODEFONY" | "NODEFONY_CONSOLE";

// type EventsType = {
//   [key: string]: number;
// };

type EventsType = Record<string, number>;

const Events: Readonly<EventsType> = Object.freeze({
  onInit: 1 << 0,
  onPreStart: 1 << 1,
  onStart: 1 << 2,
  onPreRegister: 1 << 3,
  onRegister: 1 << 4,
  onPreBoot: 1 << 5,
  onBoot: 1 << 6,
  onReady: 1 << 7,
  onServersReady: 1 << 8,
  onPostReady: 1 << 9,
  onTerminate: 1 << 10,
});

export type KernelEventsType = keyof typeof Events;

declare enum type {
  "console",
  "server",
  "CONSOLE",
  "SERVER",
}

export type KernelType = keyof typeof type;

interface AppEnvironmentType {
  environment: EnvironmentType | string;
}

export interface NetworkInterface {
  [name: string]: os.NetworkInterfaceInfo[];
}
export type FamilyType = "IPv4" | "IPv6";

export interface FilterInterface {
  type?: "local" | "external";
  family?: FamilyType;
  condition?: "&&" | "||" | "==";
}

export interface ServiceWithInitialize extends Service {
  initialize?(module?: Module): Promise<Service>;
}

export interface ServiceConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): ServiceWithInitialize;
  _inject?: { [key: number]: string };
}

export interface ModuleConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (kernel: Kernel, ...args: any[]): Module;
}

type trunkType = "javascript" | "typescript" | null;

class Kernel extends Service {
  Events: Readonly<EventsType> = Events;
  type: KernelType;
  version: string = "1.0.0";
  started: boolean = false;
  booted: boolean = false;
  ready: boolean = false;
  postReady: boolean = false;
  trunk: trunkType = null;
  core: boolean = false;
  command: Command | null = null;
  commandArgs: CommandArgs = [];
  preRegistered: boolean = false;
  registered: boolean = false;
  app: Module | null = null;
  cli: CliKernel | null | undefined;
  environment: EnvironmentType = "production";
  debug: DebugType = false;
  appEnvironment: AppEnvironmentType = {
    environment: process.env.NODE_ENV as string,
  };
  path: string = process.cwd();
  typeCluster: ClusterType = this.clusterIsMaster() ? "master" : "worker";
  pid: number = process.pid;
  //process: NodeJS.Process = process;
  workerId: number | undefined = cluster.worker?.id;
  worker = cluster.worker;
  console: boolean = this.isConsole();
  node_start: NodefonyStartType =
    process.env.NODEFONY_START || this.options.node_start;
  platform: NodeJS.Platform = process.platform;
  projectName: string = "NODEFONY";
  uptime: number = new Date().getTime();
  numberCpu: number = os.cpus().length;
  modules: Record<string, Module> = {};
  tmpDir?: FileClass;
  interfaces: NetworkInterface;
  domain: string = "localhost";
  progress: number = Events.onInit;
  pm2?: Pm2;
  injector: Injector;
  constructor(
    environment: EnvironmentType,
    cli?: CliKernel | null,
    options?: TypeKernelOptions
  ) {
    const container: Container | null | undefined = cli?.container;
    super(
      "KERNEL",
      container as Container,
      undefined, //cli.notificationsCenter as Event,
      extend({}, kernelDefaultOptions, options)
    );
    this.setMaxListeners(30);
    Nodefony.setKernel(this);
    nodefony.kernel = this;
    this.kernel = this;
    this.set("kernel", this);
    this.cli = this.setCli(cli);
    this.type = "CONSOLE";
    this.interfaces = this.getNetworkInterfaces();
    this.injector = new Injector(this);
    this.set("injector", this.injector);
    this.fire("onInit", this);
  }

  async start(): Promise<this> {
    this.debug = Boolean(this.cli?.commander?.opts().debug) || false;
    this.trunk = await this.isTrunk();
    this.initializeLog();
    if (!this.trunk && this.cli) {
      return await this.cli
        .runCommandAsync("start", ["-i"])
        .then(() => {
          if (this.command) {
            return this.command?.action(...this.commandArgs).then(() => {
              return this;
            });
          }
          return this;
        })
        .catch((e) => {
          this.log(e, "ERROR");
          throw e;
        });
    }
    this.tmpDir = new FileClass(`${process.cwd()}/tmp`);
    if (!this.started) {
      await this.fireAsync("onPreStart", this).catch((e) => {
        this.log(e, "CRITIC");
        throw e;
      });
      if (this.setCommandComplete(Events.onPreStart)) {
        return this;
      }

      // load application
      await this.loadApp().catch((e) => {
        this.log(e, "CRITIC");
        throw e;
      });
      this.domain = this.setDomain();
      if (this.app) {
        this.projectName = this.app.getModuleName() as string;
      }
      //parse command
      // if (this.cli && !this.command) {
      //   this.cli.clear();
      //   await this.cli.showAsciify(this.projectName);
      //   this.cli.showBanner();
      //   await this.cli.parseCommandAsync().catch((e) => {
      //     this.log(e, "ERROR");
      //     throw e;
      //   });
      // }
      return this.fireAsync("onStart", this)
        .then(async () => {
          // if (this.app) {
          //   this.projectName = this.app.getModuleName();
          // }
          this.started = true;
          if (this.setCommandComplete(Events.onStart)) {
            return this;
          }
          return this.preRegister();
        })
        .catch((e) => {
          //this.log(e, "CRITIC");
          throw e;
        });
    }
    return this;
  }

  async preRegister(): Promise<this> {
    await this.fireAsync("onPreRegister", this).catch((e) => {
      this.log(e, "CRITIC");
      throw e;
    });

    if (this.setCommandComplete(Events.onPreRegister)) {
      return this;
    }
    if (this.cli) {
      await this.cli
        .showAsciify(this.projectName)
        .then(async () => {
          if (this.cli) {
            this.debug = Boolean(this.cli?.commander?.opts().debug) || false;
            this.setEnv(this.cli.environment);
            this.cli.setProcessTitle(this.projectName.toLowerCase());
            //this.fixCommanderCli();
            //this.cli.setCommandVersion(this.version);
            this.cli.showBanner();
            this.cli.blankLine();
          }
        })
        .catch((e) => {
          throw e;
        });
    }
    this.setNodeEnv(this.environment);
    // Clusters
    this.initCluster();
    // Manage Template engine
    //this.initTemplate();
    if (this.cli && !this.command) {
      this.cli.clear();
      await this.cli.showAsciify(this.projectName);
      this.cli.showBanner();
      await this.cli.parseCommandAsync().catch((e) => {
        //this.log(e, "ERROR");
        throw e;
      });
    }
    return this.fireAsync("onRegister", this)
      .then(() => {
        this.registered = true;
        if (this.setCommandComplete(Events.onRegister)) {
          return this;
        }
        return this.boot();
      })
      .catch((e) => {
        //this.log(e, "CRITIC");
        throw e;
      });
  }

  // fix workaround commander twice call options
  private fixCommanderCli(version = true, debug = false): void {
    if (this.cli && this.cli.commander && this.cli.commander?.options.length) {
      // fix workaround commander twice call options
      if (version) {
        const optionVersionExists = this.cli?.commander?.options.some(
          (opt) => opt.short === "-v" || opt.long === "--version"
        );
        if (optionVersionExists) {
          const index = this.cli.commander.options.findIndex((value) => {
            if (value.flags === "-v, --version") {
              return value;
            }
          });
          if (index >= 0) {
            // @ts-ignore
            this.cli.commander?.options.splice(index, 1);
          }
        }
      }
      if (debug) {
        const optionDebugExists = this.cli?.commander?.options.some(
          (opt) => opt.short === "-d" || opt.long === "--debug"
        );
        if (optionDebugExists) {
          const index = this.cli.commander.options.findIndex((value) => {
            if (value.flags === "-d, --debug") {
              return value;
            }
          });
          if (index >= 0) {
            // @ts-ignore
            this.cli.commander?.options.splice(index, 1);
          }
        }
      }
    }
  }

  async boot(): Promise<this> {
    await this.fireAsync("onPreBoot", this).catch((e) => {
      throw e;
    });
    if (this.setCommandComplete(Events.onPreBoot)) {
      return this;
    }
    //return;
    return this.fireAsync("onBoot", this)
      .then(() => {
        this.booted = true;
        if (this.setCommandComplete(Events.onBoot)) {
          return this;
        }
        return this.onReady();
      })
      .catch((e) => {
        //this.log(e, "CRITIC");
        throw e;
      });
  }

  async onReady(): Promise<this> {
    return this.fireAsync("onReady", this)
      .then(async () => {
        this.ready = true;
        if (this.setCommandComplete(Events.onReady)) {
          return this;
        }
        //PM2
        if (
          this.command?.name === "production" &&
          process.env.MODE_START !== "PM2"
        ) {
          return this.command.action(...this.commandArgs).then(() => {
            return this;
          });
        }
        return this.initServers().then(async (servers) => {
          if (global && global.gc) {
            this.memoryUsage("MEMORY POST READY ");
            setTimeout(() => {
              if (global && global.gc) global.gc();
              this.memoryUsage("EXPOSE GARBADGE COLLECTOR ON START");
            }, 20000);
          } else {
            this.memoryUsage("MEMORY POST READY ");
          }
          return this.fireAsync("onPostReady", this)
            .then(() => {
              servers.map((server) => {
                server.showBanner();
              });
              if (this.setCommandComplete(Events.onPostReady)) {
                this.log(`Live cycle terminate`, "DEBUG");
                return this;
              } else {
                return this;
              }
            })
            .catch((e) => {
              //this.log(e, "CRITIC");
              throw e;
            });
        });
      })
      .catch((e) => {
        //this.log(e, "CRITIC");
        throw e;
      });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async initServers(): Promise<any[]> {
    const httpKernel = this.get("HttpKernel");
    if (httpKernel)
      return await httpKernel
        .initServers()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((servers: any[]) => {
          this.fireAsync("onServersReady");
          return servers;
        })
        .catch((e: Error) => {
          //this.log(e, "CRITIC");
          throw e;
        });
    return [];
  }

  override clean() {
    console.trace("pass clean");
  }

  setCommand(command: Command): void {
    this.command = command;
  }

  setDomain(): string {
    if (this.options.domain == "selectAuto") {
      return this.getFirstExternalInterface()?.address || "localhost";
    } else {
      return this.options.domain || "localhost";
    }
  }

  readConfig(config?: TypeKernelOptions): TypeKernelOptions {
    if (!config) {
      return this.options;
    }
    return extend(this.options, config);
  }

  async addService(
    service: ServiceConstructor,
    module: Module,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    return module.addService(service, ...args);
  }

  async loadService(
    service: string,
    module: Module | null = this.app,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    if (!module) {
      throw new Error(`Applcation not ready`);
    }
    const res = await import(service);
    return this.addService(res.default, module, ...args);
  }

  async loadModule(
    moduleName: string,
    build: boolean = false
  ): Promise<Module> {
    if (build) {
      await Module.build(moduleName);
    }
    const module = await import(moduleName);
    return this.use(module.default);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async use(Mod: ModuleConstructor, ...args: any[]): Promise<Module> {
    const mod = new Mod(this, ...args);
    this.modules[mod.name] = mod;
    this.log(`MODULE ADD : ${mod.name}`, "INFO");
    if (mod.initialize) {
      this.log(`MODULE INITIALIZE : ${mod.name}`, "DEBUG");
      await mod.initialize(this);
      //await this.fireAsync("onInitialize", mod);
    }

    return mod as Module;
  }

  getModule(name: string): Module {
    return this.modules[name];
  }
  getModules(): Record<string, Module> {
    return this.modules;
  }

  private async loadApp(config?: TypeKernelOptions): Promise<Module> {
    this.app = await this.loadModule(`${this.path}/dist/index.js`);
    this.app.isApp = true;
    this.options = this.readConfig(extend(this.app.options, config));
    this.initializeLog();
    this.cli?.setPackageManager(this.options.packageManager);
    this.core = await this.isCore();
    await this.addService(Rollup, this.app);
    await this.addService(Watcher, this.app);
    this.pm2 = (await this.addService(Pm2, this.app, this.options.pm2)) as Pm2;
    this.app.package = await this.app.getPackageJson();
    this.version = this.app?.getModuleVersion() as string;
    this.fixCommanderCli();
    this.cli?.setCommandVersion(this.version);
    await this.fireAsync("onAppLoad", this.app);
    return this.app;
  }

  isTypeScript(): boolean {
    try {
      new FileClass(`${this.path}/index.ts`);
      return true;
    } catch (e) {
      return false;
    }
  }

  async isTrunk(): Promise<trunkType> {
    if (this.isTypeScript()) {
      try {
        const module = await import(`${this.path}/dist/index.js`);
        if (this.isModule(module.default)) {
          return "typescript";
        }
        this.log(new Error(`No Nodeofny Trunk Detected`), "ERROR");
        return null;
      } catch (e) {
        this.log(e, "ERROR");
        return null;
      }
    } else {
      try {
        const module = await import(`${this.path}/index.js`);
        if (this.isModule(module.default)) {
          return "javascript";
        }
        return null;
      } catch (e) {
        //this.log(e, "ERROR");
        return null;
      }
    }
  }

  async isCore(): Promise<boolean> {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isModule(subclass: any): boolean {
    return isSubclassOf(subclass, Module);
  }

  getEventName(event: number): string {
    return Object.keys(Events).find((key) => Events[key] === event) as string;
  }

  setCommandComplete(progress: number): boolean {
    const index = this.getEventName(progress);
    this.progress |= Events[index];
    return this.isCommandComplete(progress);
  }

  isCommandComplete(progress: number): boolean {
    const index = this.getEventName(progress);
    if (this.command) {
      const int: number = Events[this.command.kernelEvent];
      const res = !!(this.progress & int);
      this.log(
        `Ckeck Command event : ${this.getEventName(int)}   Progress:  ${index}  :  Complete : ${res}`,
        "DEBUG",
        `COMMAND ${this.command.name}`
      );
      return res;
    }
    return false;
  }

  initializeLog(): void | null {
    this.syslog?.removeAllListeners();

    if (this.options.log && !this.options.log.active) {
      return;
    }
    if (this.debug) {
      if (this.options.log) {
        this.debug = Boolean(this.options.log.debug) || true;
      }
    }
    if (this.cli) {
      return this.cli.initSyslog(this.environment, this.debug);
    } else {
      return this.initSyslog(this.environment, this.debug);
    }
  }

  setCli(cli?: CliKernel | null): CliKernel | null {
    if (cli) {
      this.type = cli.type;
      this.debug = Boolean(this.cli?.commander?.opts().debug) || false;
      if (this.typeCluster === "worker") {
        cli.setPid();
      }
      this.set("cli", cli);
      return cli;
    }
    return null;
  }

  isConsole(): boolean {
    return this.type === "CONSOLE" || this.type === "console";
  }

  setNodeEnv(environment: EnvironmentType): void {
    if (environment) {
      switch (environment) {
        case "dev":
        case "development":
          process.env.NODE_ENV = "development";
          process.env.BABEL_ENV = "development";
          break;
        default:
          process.env.NODE_ENV = "production";
          process.env.BABEL_ENV = "production";
      }
    }
    process.env.NODE_DEBUG = this.debug ? "true" : "false";
  }

  setEnv(environment: EnvironmentType) {
    if (environment) {
      switch (environment) {
        case "dev":
        case "development":
          this.environment = "development";
          this.appEnvironment.environment = "development";
          break;
        default:
          this.environment = "production";
          this.appEnvironment.environment = "production";
      }
    }
  }

  logEnv(): string {
    if (this.cli) {
      this.type = this.cli.type;
    }
    let txt = `      \x1b ${clc.blue(this.type)} `;
    txt += ` ${clc.magenta("Cluster")} : ${this.typeCluster} `;
    txt += ` ${clc.magenta("Nodefony Environment")} : ${this.environment}  `;
    if (this.appEnvironment) {
      txt += ` ${clc.magenta("App Environment")} : ${
        this.appEnvironment.environment
      }  `;
    }
    txt += ` ${clc.magenta("Debug")} : ${this.debug}\n`;
    return txt;
  }

  clusterIsMaster(): boolean {
    return cluster.isPrimary;
  }

  initCluster(): void {
    this.pid = process.pid;
    //this.process = process;
    if (
      this.console &&
      this.cli &&
      this.cli.commander &&
      this.cli.commander.opts().json
    ) {
      return;
    }
    if (cluster.isPrimary) {
      console.log(this.logEnv());
      this.fire("onCluster", "MASTER", this, process);
    } else if (cluster.isWorker) {
      console.log(this.logEnv());
      this.workerId = cluster.worker?.id;
      this.worker = cluster.worker;
      this.fire("onCluster", "WORKER", this, process);
      process.on("message", (msg) => {
        this.log(msg, "INFO", "IPC MESSAGE");
        this.fire("onMessage", msg);
      });
    }
    // if (nodefony.warning) {
    //   this.log(nodefony.warning, "WARNING");
    // }
  }

  getOrm(): string {
    return this.options.orm;
  }

  getOrmStrategy() {
    return this.getORM().options.strategy;
  }

  getORM() {
    return this.get(this.getOrm());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fire(event: KernelEventsType, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.fire(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: KernelEventsType, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emit(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emitAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fireAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  checkPath(myPath: string): string | null {
    if (!myPath) {
      return null;
    }
    const abs = path.isAbsolute(myPath);
    if (abs) {
      return myPath;
    }
    return path.resolve(this.path, myPath);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendMessage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handle?: any,
    options?: { swallowErrors?: boolean | undefined },
    callback?: ((error: Error | null) => void) | undefined
  ): boolean {
    if (process.send) {
      return process.send(
        {
          type: "process:msg",
          data: message,
        },
        handle,
        options,
        callback
      );
    }
    throw new Error(`process.send not found `);
  }

  memoryUsage(message?: string, severity: Severity = "DEBUG") {
    const { memory } = this.stats();
    for (const ele in memory) {
      switch (ele) {
        case "rss":
          this.log(
            `${message || ele} ( Resident Set Size ) PID ( ${
              this.pid
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`
          );
          break;
        case "heapTotal":
          this.log(
            `${message || ele} ( Total Size of the Heap ) PID ( ${
              this.pid
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`
          );
          break;
        case "heapUsed":
          this.log(
            `${message || ele} ( Heap actually Used ) PID ( ${
              this.pid
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`
          );
          break;
        case "external":
          this.log(
            `${message || ele} PID ( ${
              this.pid
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`
          );
          break;
      }
    }
  }

  stats(): Stats {
    const stat: Stats = {
      memory: process.memoryUsage(),
    };
    return stat;
  }

  interfacesFilter(filters?: FilterInterface): NetworkInterface {
    if (filters) {
      let condition = (ele: boolean, ele2: boolean): boolean => {
        return ele && ele2;
      };
      if (filters.condition && filters.condition === "||") {
        condition = (ele: boolean, ele2: boolean): boolean => {
          return ele || ele2;
        };
      }
      const interfaces: NetworkInterface = {};
      for (const myinterface in this.interfaces) {
        interfaces[myinterface] = [];
        for (const infos of this.interfaces[myinterface]) {
          let matchType = false;
          let matchFamily = false;
          for (const filter in filters) {
            switch (filter) {
              case "type":
                if (filters["type"] === "external") {
                  if (!infos.internal) {
                    matchType = true;
                  }
                }
                if (filters["type"] === "local") {
                  if (infos.internal) {
                    matchType = true;
                  }
                }
                break;
              case "family":
                if (filters["family"] === infos.family) {
                  matchFamily = true;
                }
                break;
            }
          }
          if (condition(matchType, matchFamily))
            interfaces[myinterface].push(infos);
        }
      }
      return interfaces;
    }
    return this.interfaces;
  }

  getNetworkInterfaces(): { [name: string]: os.NetworkInterfaceInfo[] } {
    const nets = os.networkInterfaces();
    const devices: { [name: string]: os.NetworkInterfaceInfo[] } = {};
    Object.entries(nets).forEach(([name, ni]) => {
      if (!ni) return;
      devices[name] = ni;
    });
    return devices;
  }

  getNetwork() {
    return {
      external: this.interfacesFilter({ type: "external" }),
      local: this.interfacesFilter({ type: "local", condition: "==" }),
      ipv4: this.interfacesFilter({ family: "IPv4" }),
      ipv6: this.interfacesFilter({ family: "IPv6" }),
      interfaces: this.interfaces,
    };
  }

  getFirstExternalInterface(
    family?: FamilyType
  ): os.NetworkInterfaceInfo | undefined {
    const filter: FilterInterface = {
      type: "external",
      family: family || "IPv4",
      condition: "&&",
    };
    const res: NetworkInterface = this.interfacesFilter(filter);
    const ele: os.NetworkInterfaceInfo[] = [];
    for (const myinterface in res) {
      for (const info of res[myinterface]) {
        ele.push(info);
      }
    }
    return ele[0] || undefined;
  }

  // async getProjectName(): Promise<string> {
  //   const res = await this.loadJson("package.json");
  //   return res.name as string;
  // }

  // async getProjectVersion(): Promise<string> {
  //   const res = await this.loadJson("package.json");
  //   return res.version as string;
  // }

  async terminate(code?: number): Promise<void> {
    if (code === undefined) {
      code = 0;
    }
    if (this.debug) {
      console.trace(`terminate : ${code}`);
    }
    try {
      //console.log(this.notificationsCenter?._events);
      await this.fireAsync("onTerminate", this, code);
    } catch (e) {
      this.log(e, "ERROR");
      code = 1;
    }
    return new Promise((resolve, reject) => {
      process.nextTick(() => {
        this.log(
          `NODEFONY Kernel Life Cycle Terminate CODE : ${code}`,
          "DEBUG"
        );
        try {
          return resolve(CliKernel.quit(code as number));
        } catch (e) {
          this.log(e, "ERROR");
          return reject(CliKernel.quit(code as number));
        }
      });
    });
  }
}

export default Kernel;

export { Events };
