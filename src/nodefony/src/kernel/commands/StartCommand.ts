/* eslint-disable @typescript-eslint/no-explicit-any */
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { Prompt } from "@inquirer/type";
type ConfigType = Parameters<Prompt<any, any>>[0];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prompt = async function (command: Command): Promise<ConfigType> {
  let choices;
  let message = "Select Command";
  if (command.cli?.kernel && (await command.cli?.kernel.isTrunk())) {
    console.log();
    choices = [
      new command.prompts.Separator(),
      {
        name: "development",
        value: "development",
        description:
          command.cli?.getCommand("development")?.description() ||
          "Start Server in Development Mode",
      },
      {
        name: "production",
        value: "production",
        description:
          command.cli?.getCommand("production")?.description() ||
          "Start Server in Production Mode (PM2 process manager)",
      },
      {
        name: "staging",
        value: "staging",
        description:
          command.cli?.getCommand("staging")?.description() ||
          "Start Server Staging  Mode ( Usefull to check Clusters Node use os.cpus().length )",
      },
      new command.prompts.Separator(),
      {
        name: "install",
        value: "install",
        description:
          command.cli?.getCommand("install")?.description() ||
          "Install Nodefony Project transpile, sync or migrate Orm (default orm migrate)",
      },
      {
        name: "outdated",
        value: "outdated",
        description:
          command.cli?.getCommand("outdated")?.description() ||
          "List Project dependencies outdated",
      },
      new command.prompts.Separator(),
      {
        name: "pm2",
        value: "pm2",
        description:
          command.cli?.getCommand("pm2")?.description() ||
          "PM2 Process Manager",
      },
    ];
  } else {
    message = "Select Nodefony Command";
    choices = [
      {
        name: "Create Web Project",
        value: "createWeb",
        description: "Create Nodefony Web and Api Project",
      },
      {
        name: "Create Microservice Project ",
        value: "createMicroservice",
        description: "Create Nodefony Microservice Project ",
      },
      new command.prompts.Separator(),
      {
        name: "Show PM2 tools",
        value: "pm2",
        description: "PM2 Process Manager",
      },
      new command.prompts.Separator(),
    ];
  }
  return {
    message,
    choices,
  };
};

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onStart",
};

class Start extends Command {
  constructor(cli: CliKernel) {
    super("start", "Start Interactive Mode", cli, options);
    //force interractive
    this.forceInteractiveMode();
  }

  override async interaction(): Promise<any> {
    return await this.prompts.select(await prompt(this)).catch((e) => {
      this.log(e.message, "ERROR");
      this.terminate(1);
    });
  }

  override async generate(response: string): Promise<this> {
    this.log(`run start : ${response}`);
    if (!this.cli) {
      throw new Error(`cli not found`);
    }
    switch (response) {
      default: {
        const command = this.cli.getCommand(response);
        if (command && response) {
          if (this.kernel) {
            this.kernel.command = command;
            this.cli.clearCommand();
            if (response) {
              process.argv.push(response);
            }
            if (command.kernelEvent === this.kernelEvent) {
              if (command.onKernelStart) {
                await command.onKernelStart(...this.kernel.commandArgs);
              }
              return command.action(...this.kernel.commandArgs);
            }
            command.setEvents(...this.kernel.commandArgs);
            if (command.onKernelStart) {
              await command.onKernelStart(...this.kernel.commandArgs);
            }
            if (command.isComplete()) {
              return command.action(...this.kernel.commandArgs);
            }
          }
        }
        return await this.cli.runCommandAsync(response).then(() => {
          return this;
        });
      }
    }
    return Promise.resolve(this);
  }

  override async showBanner(): Promise<string> {
    const name = this.kernel?.projectName as string;
    await this.cli?.showAsciify(name);
    return this.cli?.showBanner() as string;
  }
}

export default Start;
