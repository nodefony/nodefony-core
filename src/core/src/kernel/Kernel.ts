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
import { Severity } from "../syslog/Pdu";
import Module from "./Module";

const colorLogEvent = clc.cyan.bgBlue("EVENT KERNEL");

interface KernelOptions extends DefaultOptionsService {
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

const kernelDefaultOptions: KernelOptions = {
  events: {
    nbListeners: 60,
    //captureRejections: true,
  },
};

type ClusterType = "master" | "worker";
type NodefonyStartType = "PM2" | "CONSOLE" | "NODEFONY" | "NODEFONY_CONSOLE";

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

export declare class InjectionType extends Service {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(kernel: Kernel, ...args: any[]);
}

export declare class ModuleType extends Module {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(kernel: Kernel, ...args: any[]);
}

class Kernel extends Service {
  type: KernelType;
  version: string = "1.0.0";
  started: boolean = false;
  booted: boolean = false;
  ready: boolean = false;
  postReady: boolean = false;
  preRegistered: boolean = false;
  cli: CliKernel;
  environment: EnvironmentType = "production";
  debug: DebugType = false;
  appEnvironment: AppEnvironmentType = {
    environment: process.env.NODE_ENV as string,
  };
  path: string = process.cwd();
  typeCluster: ClusterType = this.clusterIsMaster() ? "master" : "worker";
  processId: number = process.pid;
  process: NodeJS.Process = process;
  workerId: number | undefined = cluster.worker?.id;
  worker = cluster.worker;
  console: boolean = this.isConsole();
  node_start: NodefonyStartType =
    process.env.NODEFONY_START || this.options.node_start;
  platform: NodeJS.Platform = process.platform;
  projectName: string = "NODEFONY";
  uptime: number = new Date().getTime();
  numberCpu: number = os.cpus().length;
  modules: Record<string, ModuleType> = {};
  tmpDir: FileClass = new FileClass(`${process.cwd()}/tmp`);
  constructor(
    environment: EnvironmentType,
    cli: CliKernel,
    options?: KernelOptions
  ) {
    const container: Container | null | undefined = cli.container;
    super(
      "KERNEL",
      container as Container,
      undefined, //cli.notificationsCenter as Event,
      extend({}, kernelDefaultOptions, options)
    );
    Nodefony.setKernel(this);
    this.cli = this.setCli(cli);
    this.cli.setKernel(this);
    this.type = this.cli.type;
    //this.initializeLog();
    this.debug = Boolean(this.cli?.commander?.opts().debug) || false;
    this.setEnv(environment);
    // Manage Kernel Container
    this.set("kernel", this);
    this.kernel = this;
    this.set("cli", this.cli);
    this.once("onPostReady", () => {
      if (process.getuid && process.getuid() === 0) {
        // this.drop_root();
      }
      this.postReady = true;
      switch (this.environment) {
        case "production":
        case "prod":
        case "stage":
          this.clean();
          break;
        default:
          this.clean();
      }
    });
  }

  async readConfig(): Promise<KernelOptions> {
    const res = await this.cli?.loadModule("./config/config.js");
    return extend(this.options, res);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addService(service: typeof InjectionType, ...args: any[]): Service {
    const inst = new service(this, ...args);
    this.set(inst.name, inst);
    return this.get(inst.name);
  }

  async loadNodefonyModule(moduleName: string) {
    const module = await import(moduleName);
    return this.use(module.default);
  }

  use(Mod: typeof ModuleType): Module {
    const mod = new Mod(this);
    this.modules[mod.name] = mod;
    //console.log(`Use module ${mod.name}`);
    return mod as Module;
  }

  getModule(name: string): Module {
    return this.modules[name];
  }

  async start(): Promise<this> {
    if (!this.started) {
      await this.fireAsync("onKerneStart", this);
      this.projectName = await this.cli?.getProjectName();
      return this.cli
        .showAsciify(this.projectName)
        .then(async () => {
          this.cli?.setProcessTitle(this.projectName.toLowerCase());
          this.version = await this.cli?.getProjectVersion();
          this.cli?.setCommandVersion(this.version);
          this.cli?.showBanner();
          this.cli?.blankLine();
          // config
          await this.readConfig();
          this.initializeLog();
          this.setNodeEnv(this.environment);
          // Clusters
          this.initCluster();
          // Manage Template engine
          //this.initTemplate();
          this.started = true;
          await this.fireAsync("onStart", this);
          return await this.preRegister();
        })
        .catch(async (e) => {
          throw e;
        });
    }
    return this;
  }

  async preRegister(): Promise<this> {
    await this.fireAsync("onPreRegister", this);
    return this.boot();
  }

  async boot(): Promise<this> {
    this.booted = true;
    await this.fireAsync("onBoot", this);
    return this.onReady();
  }

  async onReady(): Promise<this> {
    this.ready = true;
    await this.fireAsync("onReady", this);
    return new Promise(() => {
      setInterval(() => {
        //this.log(this.memoryUsage());
        this.memoryUsage(undefined, "INFO");
      }, 5000);
    }).then(async () => {
      await this.fireAsync("onFinish", this);
      return this;
    });
    //return Promise.resolve(this);
  }

  initializeLog(): void | null {
    //this.syslog?.removeAllListeners();
    if (this.type === "CONSOLE") {
      return this.cli.initSyslog(this.environment, this.debug);
    }
    if (this.options.log && !this.options.log.active) {
      return;
    }
    if (this.debug) {
      if (this.options.log) {
        this.debug = Boolean(this.options.log.debug) || true;
      }
    }
    return this.cli.initSyslog(this.environment, this.debug);
  }

  setCli(cli: CliKernel): CliKernel {
    if (this.typeCluster === "worker") {
      cli.setPid();
    }
    // this.cli.syslog.removeAllListeners();
    cli.reset();
    return cli;
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
          this.environment = "dev";
          if (!this.appEnvironment.environment) {
            this.appEnvironment.environment = "development";
          }
          break;
        default:
          this.environment = "prod";
          if (!this.appEnvironment.environment) {
            this.appEnvironment.environment = "production";
          }
      }
    }
  }

  logEnv(): string {
    let txt = `      \x1b ${this.cli.clc.blue(this.type)} `;
    txt += ` ${this.cli.clc.magenta("Cluster")} : ${this.typeCluster} `;
    txt += ` ${this.cli.clc.magenta("Nodefony Environment")} : ${
      this.environment
    }  `;
    if (this.appEnvironment) {
      txt += ` ${this.cli.clc.magenta("App Environment")} : ${
        this.appEnvironment.environment
      }  `;
    }
    txt += ` ${this.cli.clc.magenta("Debug")} : ${this.debug}\n`;
    return txt;
  }

  clusterIsMaster(): boolean {
    return cluster.isPrimary;
  }

  initCluster(): void {
    this.processId = process.pid;
    this.process = process;
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
      // process.on("message", this.listen(this, "onMessage"));
      process.on("message", (msg) => {
        this.fire("onMessage", msg);
      });
    }
    if (nodefony.warning) {
      this.log(nodefony.warning, "WARNING");
    }
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
  override fire(event: string | symbol, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.fire(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string | symbol, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emit(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emitAsync(event: string | symbol, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fireAsync(event: string | symbol, ...args: any[]): Promise<any> {
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
              this.processId
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`
          );
          break;
        case "heapTotal":
          this.log(
            `${message || ele} ( Total Size of the Heap ) PID ( ${
              this.processId
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`
          );
          break;
        case "heapUsed":
          this.log(
            `${message || ele} ( Heap actually Used ) PID ( ${
              this.processId
            } ) : ${CliKernel.niceBytes(memory[ele])}`,
            severity,
            `MEMORY ${ele}`
          );
          break;
        case "external":
          this.log(
            `${message || ele} PID ( ${
              this.processId
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

  async terminate(code: number): Promise<number> {
    if (code === undefined) {
      code = 0;
    }
    if (this.debug) {
      console.trace(`terminate : ${code}`);
    }
    try {
      await this.fireAsync("onTerminate", this, code);
    } catch (e) {
      this.log(e, "ERROR");
      code = 1;
    }
    process.nextTick(() => {
      this.log(`NODEFONY Kernel Life Cycle Terminate CODE : ${code}`, "INFO");
      try {
        CliKernel.quit(code);
      } catch (e) {
        this.log(e, "ERROR");
      }
    });
    return code;
  }
}

export default Kernel;
