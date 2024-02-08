import Command, { OptionsCommandInterface } from "../../../command/Command";
import CliKernel from "../../CliKernel";
import pm2Service from "../../../service/pm2Service";
import { OptionValues } from "commander";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onStart",
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
    this.addOption("-n, --name", "Name of pm2 process");
    this.addOption("-s, --status", "Process PM2 status");
    this.addOption("-l, --line", "Nb lines for log only");
    //this.alias("status");
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

  findCommand(cmd: string, options: OptionValues): Promise<this> {
    switch (cmd) {
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
        return Promise.resolve(this);
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

  findOptions(cmd: string, options: OptionValues): Promise<this> {
    if ("list" in options) {
      return Promise.resolve(this);
    }
    if (!cmd) {
      return this.status();
    }
    throw new Error(`PM2 command ${cmd} not found`);
  }

  status(): Promise<this> {
    console.log("status");
    return Promise.resolve(this);
  }
}

export default Pm2;
