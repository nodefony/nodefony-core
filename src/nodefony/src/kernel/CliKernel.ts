import path from "node:path";

import Syslog, { conditionsInterface } from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";
import Cli, { CliDefaultOptions, PackageManagerName } from "../Cli";
import Kernel, { KernelType, TypeKernelOptions } from "./Kernel";
import Command from "../command/Command";
import Start from "./commands/StartCommand";
import Dev from "./commands/DevCommand";
import Build from "./commands/BuildCommand";
import Prod from "./commands/ProdCommand";
import Staging from "./commands/StagingCommand";
import Install from "./commands/InstallCommand";
import Outated from "./commands/OutdatedCommand";
import Pm2 from "./commands/pm2/Pm2Command";
import Kill from "./commands/KillCommnand";
import { DebugType, EnvironmentType } from "../types/globals";
import Module from "./Module";
import commander from "commander";
import { version } from "../../package.json";

type ModuleWithDefault<T> = {
  default?: T;
};

const cliOptions: CliDefaultOptions = {
  autoLogger: false,
  asciify: false,
  version,
  warning: true,
  pid: true,
};

export type PackageManager = (
  argv: string[],
  cwd?: string,
  env?: EnvironmentType
) => Promise<number | Error>;

class CliKernel extends Cli {
  public type: KernelType = "CONSOLE";
  public app: Module | null = null;
  public packageManager: PackageManager = this.pnpm;
  constructor(environment?: EnvironmentType) {
    super("NODEFONY", cliOptions);
    if (environment) {
      this.environment = environment;
    }
    this.initSyslog();
  }

  setPackageManager(
    manager: PackageManagerName = this.options?.packageManager
  ): PackageManager {
    switch (manager) {
      case "yarn":
        this.packageManager = this.yarn as PackageManager;
        break;
      case "pnpm":
        this.packageManager = this.pnpm as PackageManager;
        break;
      default:
        this.packageManager = this.npm as PackageManager;
    }
    return this.packageManager;
  }

  override showHelp(
    quit: boolean,
    context: commander.HelpContext | undefined
  ): void | never {
    super.showHelp(quit, context);
  }

  parseCommand(argv?: string[]): commander.Command {
    return this.parse(argv || process.argv);
  }
  parseCommandAsync(argv?: string[]): Promise<commander.Command> {
    return this.parseAsync(argv || process.argv);
  }

  override async start(options?: TypeKernelOptions): Promise<Kernel> {
    this.kernel = new Kernel(this.environment, this, options);
    try {
      if (this.commander) {
        this.addCommand(Start);
        this.addCommand(Dev);
        this.addCommand(Build);
        this.addCommand(Prod);
        this.addCommand(Staging);
        this.addCommand(Install);
        this.addCommand(Outated);
        this.addCommand(Pm2);
        this.addCommand(Kill);
        this.commander.exitOverride();
        this.commander.name(this.name);
        this.commander.showHelpAfterError(false);
        this.commander.showSuggestionAfterError(true);
        this.commander.configureHelp({
          //sortSubcommands: true,
          sortOptions: true,
          showGlobalOptions: true,
          subcommandTerm: (cmd) => cmd.name(), // Just show the name, instead of short usage.
          // formatHelp: (cmd, help) => {
          //   return cmd.helpInformation();
          //   //return this.cli?.commander?.help();
          // },
        });

        // // @ts-expect-error: overloaded  _outputConfiguration
        // this.commander._outputConfiguration = {
        //   writeOut: (str: string) => this.log(str), //process.stdout.write(str),
        //   writeErr: (str: string) => this.log(str, "ERROR"), // process.stderr.write(str),
        //   getOutHelpWidth: () =>
        //     process.stdout.isTTY ? process.stdout.columns : undefined,
        //   getErrHelpWidth: () =>
        //     process.stderr.isTTY ? process.stderr.columns : undefined,
        //   outputError: (str: string, write: (str: string) => void) => write(str),
        // };
        // // @ts-expect-error: overloaded  _hasHelpOption
        //this.commander._hasHelpOption = false;

        return this.commander
          ?.parseAsync()
          .then(async () => {
            if (this.kernel) {
              return this.kernel.start().catch(async (e) => {
                //this.commander?.outputHelp({ error: false });
                await this.kernel?.terminate();
                throw e;
              });
            }
            throw new Error(`Kernel not found`);
          })
          .catch(async () => {
            if (this.kernel) {
              return this.kernel?.start().catch(async (e) => {
                //this.commander?.outputHelp({ error: false });
                await this.kernel?.terminate();
                throw e;
              });
            }
            throw new Error(`Kernel not found`);
          });
      }

      throw new Error(`Commander not found`);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  setType(type: KernelType): string {
    const ele = type.toLocaleUpperCase() as KernelType;
    return (this.type = ele);
  }

  public override addCommand(
    cliCommand: new (cli: CliKernel) => Command
  ): Command {
    const command = new cliCommand(this);
    this.commands[command.name] = command;
    return command;
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

  override initSyslog(
    environment?: EnvironmentType,
    debug?: DebugType,
    options?: conditionsInterface
  ): void | null {
    if (!this.kernel) {
      return super.initSyslog(environment, debug, options);
    }
    if (this.commander && this.commander.opts().json) {
      return;
    }

    const { syslog } = this;
    const data = [0, 1, 2, 3, 4, 5, 6];
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

  override async terminate(code: number = 0, quiet?: boolean): Promise<void> {
    if (this.kernel) {
      await this.kernel.terminate(code);
      return;
    }
    return Promise.resolve(super.terminate(code, quiet));
  }
}

export default CliKernel;
