import path from "node:path";
import * as fs from "fs/promises";
import Syslog, { conditionsInterface } from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";
import Cli from "../Cli";
import Kernel, { KernelType, TypeKernelOptions } from "./Kernel";
import Start from "./commands/StartCommand";
import Dev from "./commands/DevCommand";
import Prod from "./commands/ProdCommand";
import Install from "./commands/InstallCommand";
import { DebugType, JSONObject, EnvironmentType } from "../types/globals";

type ModuleWithDefault<T> = {
  default?: T;
};

class CliKernel extends Cli {
  //public override kernel: Kernel | null = null;
  public type: KernelType = "CONSOLE";
  public override kernel: Kernel;
  public override environment: EnvironmentType;
  constructor(
    environment: EnvironmentType = "production",
    options?: TypeKernelOptions
  ) {
    super("NODEFONY", { autoLogger: false });
    this.environment = environment;
    this.kernel = new Kernel(this.environment, this, options);
    this.initSyslog();
    this.addCommand(Start);
    this.addCommand(Dev);
    this.addCommand(Prod);
    this.addCommand(Install);
  }

  override async start(): Promise<CliKernel> {
    super.start();
    return this;
  }

  setType(type: KernelType): string {
    const ele = type.toLocaleUpperCase() as KernelType;
    return (this.type = ele);
  }

  async loadLocalModule<T>(
    moduleName: string,
    cwd: string = process.cwd()
  ): Promise<ModuleWithDefault<T> | null> {
    try {
      const detectpath = path.isAbsolute(moduleName)
        ? moduleName
        : path.resolve(cwd, moduleName);
      const module = await import(detectpath);
      return module.default as ModuleWithDefault<T>;
    } catch (error) {
      this.log(error, "ERROR");
      throw error;
    }
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

  async getProjectName(): Promise<string> {
    const res = await this.loadJson("package.json");
    return res.name as string;
  }

  async getProjectVersion(): Promise<string> {
    const res = await this.loadJson("package.json");
    return res.version as string;
  }

  override initSyslog(
    environment?: EnvironmentType,
    debug?: DebugType,
    options?: conditionsInterface
  ): void | null {
    //console.log(debug, this.debug);
    if (!this.kernel) {
      return super.initSyslog(environment, debug, options);
    }
    if (this.commander && this.commander.opts().json) {
      return;
    }

    const { syslog } = this;
    const data = [0, 1, 2, 3, 6];
    if (debug || this.debug) {
      // INFO , DEBUG , WARNING
      data.push(7);
    }
    if (this.kernel.type === "SERVER" && this.kernel.environment === "dev") {
      // EMERGENCY ALERT CRITIC ERROR INFO WARNING
      data.push(4);
      data.push(5);
    }
    const conditions: conditionsInterface = {
      severity: {
        data,
      },
    };
    const format = Syslog.formatDebug(debug || this.debug);
    if (typeof format === "object") {
      conditions.msgid = {
        data: debug,
      };
    }
    return syslog?.listenWithConditions(conditions, (pdu: Pdu) => {
      Syslog.normalizeLog(pdu, this.pid?.toString());
    });
  }
}

export default CliKernel;
