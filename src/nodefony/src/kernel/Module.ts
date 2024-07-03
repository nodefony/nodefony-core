import { dirname, resolve, basename, isAbsolute } from "node:path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import Kernel, {
  ServiceConstructor,
  ServiceWithInitialize,
  EntityConstructor,
} from "./Kernel";
import { JSONObject } from "../types/globals";
import Service, { DefaultOptionsService } from "../Service";
import Command from "../command/Command";
import Injector from "./injector/injector";
import Container from "../Container";
import * as fs from "fs/promises";
import CliKernel from "./CliKernel";
import { extend } from "../Tools";
import cluster from "node:cluster";
import Pdu, { Severity, Msgid, Message } from "../syslog/Pdu";
import RollupService from "../service/rollup/rollupService";
import watcherService from "../service/watcherService";
//import vm from "node:vm";
const regModuleName: RegExp = /^[Mm]odule-([\w-]+)/u;
import {
  RollupWatchOptions,
  RollupOptions,
  RollupWatcher,
  rollup,
  RollupOutput,
  OutputOptions,
  LogLevel,
  RollupLog,
} from "rollup";
import { FSWatcher } from "chokidar";
import { createRequire } from "node:module";
import Entity from "./orm/Entity";

export interface PackageJson {
  name: string;
  version: string;
  description?: string;
  main?: string;
  module?: string;
  types?: string;
  scripts?: Record<string, string>;
  repository?: {
    type: string;
    url: string;
  };
  keywords?: string[];
  author?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
import { Controller } from "@nodefony/framework";
export type TypeController<T> = new (...args: any[]) => T;
const controllers: Record<string, TypeController<Controller>> = {};

class Module extends Service {
  commands: Record<string, Command> = {};
  static controllers = controllers;
  package?: PackageJson;
  path: string = "";
  isApp: boolean = false;
  rollup?: RollupService;
  watcherService?: watcherService;
  watcher?: FSWatcher;
  public onKernelRegister?(): Promise<this>;
  public onKernelBoot?(): Promise<this>;
  public onKernelReady?(): Promise<this>;
  public initialize?(kernel?: Kernel): Promise<this>;
  constructor(
    name: string,
    kernel: Kernel,
    path: string,
    options: DefaultOptionsService
  ) {
    super(name, kernel.container as Container, undefined, options);
    this.setParameters(`modules.${this.name}`, this.options);
    this.path = this.setPath(path);
    this.setEvents();
    this.kernel?.once("onBoot", async () => {
      this.rollup = this.get("rollup");
      this.watcherService = this.get("watcher");
    });
    this.kernel?.once("onPostReady", async () => {
      if (this.options.watch && this.kernel?.environment === "development") {
        await this.watch();
      }
    });
  }

  async watch(options?: RollupWatchOptions): Promise<RollupWatcher> {
    if (this.watcherService) {
      const mylog = function (this: Module, level: LogLevel, log: RollupLog) {
        this.rollup?.loggerRollup(this, level, log);
      }.bind(this);
      options = RollupService.setDefaultConfig(
        this,
        this.kernel?.environment,
        mylog
      );
      return this.watcherService?.createRollupWatcher(this, options);
    }
    throw new Error(`Watcher Service service not found`);
  }

  async build(): Promise<RollupOutput> {
    const pck = await readFile(resolve(this.path, "package.json"), "utf8");
    const jsonPck = JSON.parse(pck) as PackageJson;
    const ele = {
      path: this.path,
      package: jsonPck,
      getDependencies: () => {
        return Module.getPackageDependencies(jsonPck);
      },
    } as Module;
    const options = RollupService.setDefaultConfig(ele);
    const bundle = await rollup(options);
    const res = await bundle.write(options.output as OutputOptions);
    await bundle.close();
    return res;
  }

  setPath(myPath: string): string {
    if (/^file:\/\//.test(myPath)) {
      myPath = fileURLToPath(myPath);
    }
    const base = basename(dirname(myPath));
    let dir = null;
    if (base === "dist") {
      dir = resolve(myPath, "..");
    } else {
      dir = myPath;
    }
    return dirname(dir);
  }

  gePath(name: string = this.name): string {
    return Module.getModulePath(name);
  }

  static getModulePath(name: string): string {
    const require = createRequire(import.meta.url);
    const pth = require.resolve(name);
    if (basename(dirname(pth)) === "dist") {
      return dirname(dirname(pth));
    }
    return dirname(pth);
  }

  setEvents(): void {
    if (this.onKernelRegister) {
      this.kernel?.once("onRegister", this.onKernelRegister.bind(this));
    }
    if (this.onKernelBoot) {
      this.kernel?.once("onBoot", this.onKernelBoot.bind(this));
    }
    if (this.onKernelReady) {
      this.kernel?.once("onReady", this.onKernelReady.bind(this));
    }
    this.kernel?.prependOnceListener("onPreBoot", async () => {
      this.package = await this.getPackageJson();
      this.readOverrideModuleConfig();
    });
  }

  readOverrideModuleConfig(deep: boolean = true): DefaultOptionsService {
    for (const ele in this.options) {
      let index: RegExpExecArray | null = null;
      const override: DefaultOptionsService = this.options[ele];
      index = regModuleName.exec(ele);
      if (index && index[1]) {
        const mod = this.kernel?.getModule(index[1] as string);
        if (!mod) {
          this.log(
            `Can't Override Configuration Module : ${index[1]} is not ready, Register module before`,
            "ERROR"
          );
          continue;
        }
        this.log(`Override Configuration Module: ${mod.name}`, "WARNING");
        if (deep) {
          mod.options = extend(true, {}, mod.options, override);
        } else {
          mod.options = extend({}, mod.options, override);
        }
      }
    }
    return this.options;
  }

  async getRollupConfig(): Promise<RollupOptions> {
    return (await this.rollup?.getRollupConfigTs(this)) as RollupOptions;
  }

  registerService(
    service: ServiceConstructor,
    name: string
  ): ServiceConstructor {
    return Injector.register(name || service.constructor.name, service);
  }

  async addService(
    service: ServiceConstructor,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    const inst = Injector.instantiate(service, this, ...args);
    if (this.get(inst.name)) {
      this.log(
        `SERVICE ALREADY EXIST  override old service  : ${inst.name}`,
        "WARNING"
      );
    }
    this.log(`SERVICE ADD : ${inst.name}`, "DEBUG");
    const serviceInit: ServiceWithInitialize = inst;
    if (serviceInit.initialize) {
      this.log(`SERVICE INITIALIZE : ${inst.name}`, "DEBUG");
      await serviceInit.initialize(this);
    }
    this.set(inst.name, inst);
    return this.get(inst.name);
  }

  async loadService(
    service: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    // if (!module) {
    //   throw new Error(`Applcation not ready`);
    // }
    const res = await import(service);
    return this.addService(res.default, ...args);
  }

  async getPackageJson(cwd?: string): Promise<PackageJson> {
    return (await this.loadJson(
      resolve(this.path, "package.json"),
      cwd
    )) as PackageJson;
  }

  getController(name: string) {
    if (name && Module.controllers[name]) {
      return Module.controllers[name];
    }
    if (!name) {
      throw new Error(`Module getController argument name is mandatory`);
    }
    throw new Error(`Controller ${name} not exist`);
  }
  getControllers() {
    return Module.controllers;
  }

  async loadEntity(entity: string) {
    const res = await import(entity);
    return this.addEntity(res.default);
  }

  addEntity(entity: EntityConstructor): Entity {
    const inst = new entity(this);
    return inst;
  }

  getDependencies(): string[] {
    return Module.getPackageDependencies(this.package as PackageJson);
  }

  static getPackageDependencies(mypackage: PackageJson): string[] {
    if (mypackage) {
      const dependencies = Object.keys(mypackage.dependencies || {});
      const peerDependencies = Object.keys(mypackage.peerDependencies || {});
      return [...dependencies, ...peerDependencies];
    }
    return [];
  }

  public getModuleName(): string | undefined {
    return this.package?.name;
  }

  public getModuleVersion(): string | undefined {
    return this.package?.version;
  }

  public addCommand(
    cliCommand: new (cli: CliKernel) => Command
  ): Command | void {
    if (this.kernel && this.kernel.cli) {
      try {
        const command = new cliCommand(this.kernel.cli);
        this.commands[command.name] = command;
        return command;
      } catch (e) {
        if (cluster.isPrimary) {
          throw e;
        } else if (cluster.isWorker) {
          return;
        }
      }
    }
    throw new Error(`Kernel not ready`);
  }

  async install(force: boolean = false): Promise<number | Error> {
    if (this.kernel?.cli?.packageManager) {
      if (force) {
        return await this.kernel?.cli?.packageManager(
          ["install", "--force"],
          this.path
        );
      }
      return await this.kernel?.cli?.packageManager(["install"], this.path);
    }
    throw new Error(`Package Manager not found`);
  }

  async outdated(): Promise<number | Error> {
    if (this.kernel?.cli?.packageManager) {
      return await this.kernel?.cli?.packageManager(["outdated"], this.path);
    }
    throw new Error(`Package Manager not found`);
  }

  async loadJson(
    url: string,
    cwd: string = process.cwd()
  ): Promise<JSONObject> {
    try {
      const detectpath = isAbsolute(url) ? url : resolve(cwd, url);
      const fileContent = await fs.readFile(detectpath, "utf-8");
      const parsedJson = JSON.parse(fileContent);
      return parsedJson;
    } catch (error) {
      this.log(error, "ERROR");
      throw error;
    }
  }

  override log(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pci: any,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message
  ): Pdu {
    if (!msgid) {
      msgid = `MODULE ${this.name}`;
    }
    return super.log(pci, severity, msgid, msg);
  }
}

export default Module;
