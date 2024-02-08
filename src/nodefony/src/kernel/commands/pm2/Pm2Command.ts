/* eslint-disable @typescript-eslint/no-explicit-any */
import Command, { OptionsCommandInterface } from "../../../command/Command";
import CliKernel from "../../CliKernel";
import pm2Service from "../../../service/pm2Service";
import { OptionValues } from "commander";

type PromptObject = {
  message: string;
  choices: any[]; // ou Array<{ title: string, value: any }>
};

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onStart",
};

const prompt = (cmd: Command): PromptObject => {
  const choices: any[] = [];
  const message: string = "Select PM2 Command";
  const status = {
    name: "status",
    value: "status",
    description: "List all Production Projects",
  };
  choices.push(status);
  choices.push(new cmd.prompts.Separator());
  const cleanLOg = {
    name: "clean-log",
    value: "clean-log",
    description: "Flush logs process",
  };
  choices.push(cleanLOg);
  return {
    message,
    choices,
  };
};

class Pm2 extends Command {
  service?: pm2Service;
  constructor(cli: CliKernel) {
    super(
      "pm2",
      "PM2 tools for manage nodefony process",
      cli as CliKernel,
      options
    );
    this.addArgument("[command]", "command pm2 ");
    this.addOption("-n, --name <name>", "Name of pm2 process");
    this.addOption("-s, --status", "Process PM2 status");
    this.addOption("-l, --lines", "Nb lines for log only");
    this.alias("status");
    this.command.addHelpText(
      "after",
      `
Command :
  stop  [-n, --name]                Stop Production Project
  restart [-n, --name]              Reload Production Project
  logs [-n, --name] [-l --lines]    Stream pm2 logs  [name] is project name  and [nblines] to show 
  


Examples with pm2 native tools :

$ npx pm2 monit
$ npx pm2 --lines 1000 logs
    `
    );
  }

  override async onKernelStart(): Promise<void> {
    this.service = this.get("pm2");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  override async generate(
    cmd: string,
    options: OptionValues
  ): Promise<this | void> {
    try {
      return await this.findCommand(cmd, options).catch((e) => {
        this.log(e, "ERROR");
        return this.terminate(1);
      });
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  public override async interaction(): Promise<any> {
    return await this.prompts.select(prompt(this)).catch((e) => {
      this.log(e.message, "ERROR");
      this.terminate(1);
    });
  }

  findCommand(cmd: string, options: OptionValues): Promise<this> {
    switch (cmd) {
      case "status":
        return this.status();
      case "stop":
        return Promise.resolve(this);
      case "restart":
        return Promise.resolve(this);
      case "logs":
        return Promise.resolve(this);
      case "reload":
        return Promise.resolve(this);
      case "kill":
        return Promise.resolve(this);
      case "delete":
        return Promise.resolve(this);
      case "logrotate":
        return Promise.resolve(this);
      case "clean-log":
        return this.flush(options);
      case "save":
        return Promise.resolve(this);
      case "startup":
        return Promise.resolve(this);
      case "unstartup":
        return Promise.resolve(this);
      default: {
        if (options) {
          return this.findOptions(cmd, options);
        }
        throw new Error(`PM2 command ${cmd} not found`);
      }
    }
  }

  async findOptions(cmd: string, options: OptionValues): Promise<any> {
    if ("list" in options) {
      return Promise.resolve(this);
    }
    if (!cmd) {
      return await this.interaction().then((ele) => {
        return this.findCommand(ele, options);
      });
    }
    throw new Error(`PM2 command ${cmd} not found`);
  }

  async status(): Promise<this> {
    await pm2Service.tablePm2Process(null, this.cli, true);
    return Promise.resolve(this);
  }

  async stop(): Promise<this> {
    await pm2Service.tablePm2Process(null, this.cli, true);
    return Promise.resolve(this);
  }
  async flush(options: OptionValues): Promise<this> {
    const name: string | number | undefined = options?.name || "all";
    const result = await this.service?.flush(name);
    this.log(`clean log ${name}`);
    await pm2Service.tablePm2Process(result, this.cli, true);
    return Promise.resolve(this);
  }
}

export default Pm2;
