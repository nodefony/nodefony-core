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

//import { rollup } from "rollup";
//console.log("pass", rollup);
//const config = require("./rollup.config.js");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PackageJson = Record<string, any>;

class Module extends Service {
  commands: Record<string, Command> = {};
  package: PackageJson = {};
  path: string = "";
  public onStart?(): Promise<this>;
  public onRegister?(): Promise<this>;
  public onBoot?(): Promise<this>;
  public onReady?(): Promise<this>;
  constructor(
    name: string,
    kernel: Kernel,
    path: string,
    options: DefaultOptionsService
  ) {
    const container: Container = kernel.container as Container;
    //const event: Event = kernel.notificationsCenter as Event;
    super(name, container, undefined, options);
    this.log(`Registre Modefony Module : ${this.name}`, "DEBUG");
    this.setParameters(`modules.${this.name}`, this.options);
    this.path = this.setPath(path);
    this.setEvents();
    // this.kernel?.once("onStart", this.onStart.bind(this));
    // this.kernel?.once("onRegister", this.onRegister.bind(this));
    // this.kernel?.once("onBoot", this.onBoot.bind(this));
    // this.kernel?.once("onReady", this.onReady.bind(this));
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
    if (this.onStart) {
      this.kernel?.once("onStart", this.onStart.bind(this));
    }
    if (this.onRegister) {
      this.kernel?.once("onRegister", this.onRegister.bind(this));
    }
    if (this.onBoot) {
      this.kernel?.once("onBoot", this.onBoot.bind(this));
    }
    if (this.onReady) {
      this.kernel?.once("onReady", this.onReady.bind(this));
    }
    this.kernel?.once("onStart", async () => {
      this.package = await this.getPackageJson();
    });
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

  addService(
    service: typeof InjectionType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Service {
    const inst = new service(this, ...args);
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

  // public addCommand(cliCommand: typeof CliCommand): Command {
  //   if (this.kernel && this.kernel.cli) {
  //     const command = this.kernel.cli.addCommand(cliCommand);
  //     this.commands[command.name] = command;
  //     return command;
  //   }
  //   throw new Error(`Kernel not ready`);
  // }

  public addCommand(cliCommand: new (cli: CliKernel) => Command): Command {
    if (this.kernel && this.kernel.cli) {
      const command = new cliCommand(this.kernel.cli);
      this.commands[command.name] = command;
      return command;
    }
    throw new Error(`Kernel not ready`);
  }

  // async onStart(): Promise<this> {
  //   console.log("passs onStart", this.name);
  //   this.package = await this.getPackageJson();
  //   return this.fireAsync("onStart", this).then(() => {
  //     this.log(`MODULE ${this.name} START`, "DEBUG");
  //     return this;
  //   });
  // }

  // async onRegister(): Promise<this> {
  //   console.log("passs onRegister", this.name);
  //   return this.fireAsync("onRegister", this).then(() => {
  //     this.log(`MODULE ${this.name} REGISTER`, "DEBUG");
  //     return this;
  //   });
  // }

  // async onBoot(): Promise<this> {
  //   console.log("passs onBoot", this.name);
  //   return this.fireAsync("onBoot", this).then(() => {
  //     this.log(`MODULE ${this.name} BOOT`, "DEBUG");
  //     return this;
  //   });
  // }

  // async onReady(): Promise<this> {
  //   console.log("passs onReady", this.name);
  //   return this.fireAsync("onReady", this).then(() => {
  //     this.log(`MODULE ${this.name} READY`, "DEBUG");
  //     return this;
  //   });
  // }

  async install(): Promise<this> {
    return this;
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
}

export default Module;