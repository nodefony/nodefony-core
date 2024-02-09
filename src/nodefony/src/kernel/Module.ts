import path from "node:path";
import Kernel, { InjectionType } from "./Kernel";
//import Event from "../Event";
import { JSONObject } from "../types/globals";
import Service, { DefaultOptionsService } from "../Service";
import Command from "../command/Command";
import Container from "../Container";
//import CLi from "../Cli";
import * as fs from "fs/promises";
import { dirname, resolve, basename } from "node:path";
import CliKernel from "./CliKernel";
import { extend } from "../Tools";
import cluster from "node:cluster";

import Pdu, { Severity, Msgid, Message } from "../syslog/Pdu";

const regModuleName: RegExp = /^[Mm]odule-([\w-]+)/u;

// import { rollup } from "rollup";
// console.log("pass", rollup);
//const config = require("./rollup.config.js");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PackageJson = Record<string, any>;

class Module extends Service {
  commands: Record<string, Command> = {};
  package: PackageJson = {};
  path: string = "";
  isApp: boolean = false;
  public onKernelStart?(): Promise<this>;
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
    //this.log(`Registre Modefony Module : ${this.name}`, "DEBUG");
    this.setParameters(`modules.${this.name}`, this.options);
    this.path = this.setPath(path);
    this.setEvents();
  }

  setPath(myPath: string): string {
    const base = basename(dirname(myPath));
    let dir = null;
    if (base === "dist") {
      dir = resolve(myPath, "..");
    } else {
      dir = myPath;
    }
    return dirname(dir);
  }
  setEvents(): void {
    if (this.onKernelStart) {
      this.kernel?.once("onStart", this.onKernelStart.bind(this));
    }
    if (this.onKernelRegister) {
      this.kernel?.once("onRegister", this.onKernelRegister.bind(this));
    }
    if (this.onKernelBoot) {
      this.kernel?.once("onBoot", this.onKernelBoot.bind(this));
    }
    if (this.onKernelReady) {
      this.kernel?.once("onReady", this.onKernelReady.bind(this));
    }
    this.kernel?.prependOnceListener("onStart", async () => {
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
          this.log(`Module : ${index} register module before `, "WARNING");
          continue;
        }
        this.log(`MODULE CONFIG Override Module: ${mod.name}`, "WARNING");
        if (deep) {
          mod.options = extend(true, {}, mod.options, override);
        } else {
          mod.options = extend({}, mod.options, override);
        }
      }
    }
    return this.options;
  }

  // watch(config: rollup.RollupWatchOptions): rollup.RollupWatcher {
  //   const watcher = rollup.watch(config);
  //   watcher.on("event", (event) => {
  //     // `event.code` peut être 'START', 'BUNDLE_START', 'BUNDLE_END', 'END', ou 'ERROR'
  //     if (event.code === "END") {
  //       console.log("Le bundle a été généré avec succès!");
  //     } else if (event.code === "ERROR") {
  //       console.error(
  //         "Une erreur s'est produite lors de la création du bundle:",
  //         event.error
  //       );
  //     }
  //   });
  //   this.kernel?.on("onTerminate", () => {
  //     watcher.close();
  //   });
  //   return watcher;
  // }

  async addService(
    service: typeof InjectionType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<Service> {
    const inst = new service(this, ...args);
    this.log(`SERVICE ADD : ${inst.name}`, "DEBUG");
    if (inst.initialize) {
      this.log(`SERVICE INITIALIZE : ${inst.name}`, "DEBUG");
      await inst.initialize(this);
    }
    this.set(inst.name, inst);
    return this.get(inst.name);
  }

  async getPackageJson(): Promise<PackageJson> {
    return await this.loadJson(resolve(this.path, "package.json"));
  }

  public getModuleName(): string {
    return this.package.name;
  }

  public getModuleVersion(): string {
    return this.package.version;
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

  async install(): Promise<number | Error> {
    if (this.kernel?.cli?.packageManager) {
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
      const detectpath = path.isAbsolute(url) ? url : path.resolve(cwd, url);
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
