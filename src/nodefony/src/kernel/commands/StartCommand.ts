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
    choices = [
      {
        name: "development",
        value: "development",
        description: "Start Server in Development Mode",
      },
      {
        name: "production",
        value: "production",
        description: "Start Server in Production Mode",
      },
      new command.prompts.Separator(),
      {
        name: "install",
        value: "install",
        description: "Install Project",
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
        description: "Manage pm2 ",
      },
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
