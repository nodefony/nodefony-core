import Command from "../../command/Command";
import CliKernel from "../CliKernel";

class Start extends Command {
  constructor(cli: CliKernel) {
    super("start", "Start Interactive Mode", cli, {
      showBanner: false,
    });
    //force interractive
    process.argv.push("-i");
  }

  override async interaction(...args: any[]): Promise<any> {
    return await this.prompts.select({
      message: "Select Command",
      choices: [
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
        new this.prompts.Separator(),
      ],
    });
  }

  override async generate(response: string): Promise<this> {
    console.log(response);
    if (!this.cli) {
      throw new Error(`cli not found`);
    }
    switch (response) {
      default:
        if (this.cli?.getCommand(response)) {
          await this.cli?.getCommand(response)?.run();
        }
    }
    return Promise.resolve(this);
  }
}

export default Start;
