/* eslint-disable @typescript-eslint/no-explicit-any */
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { Prompt } from "@inquirer/type";
type ConfigType = Parameters<Prompt<any, any>>[0];

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
          "Start Server in Production Mode",
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
    ];
  } else {
    message = "Select Nodefony Command";
    choices = [
      {
        name: "create",
        value: "create",
        description:
          command.cli?.getCommand("create")?.description() ||
          "Scaffold a new Nodefony project, module or entity",
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
        const command = this.cli.getCommand(response);
        if (command && response) {
          if (this.kernel) {
            this.cli.clearCommand();
            if (response) {
              process.argv.push(response);
            }
            // Câblage centralisé (kernel.command + runProfile déclaré + setEvents).
            // On est ICI à `onStart` (phase de cette commande) : les hooks de la
            // commande choisie câblés sur des phases déjà passées ne re-fireront
            // pas → on rejoue son `onKernelStart` à la main, puis on exécute
            // directement si sa phase cible est déjà atteinte (`isComplete`).
            (this.cli as CliKernel).resolveCommand(
              command,
              this.kernel.commandArgs,
            );
            if (command.onKernelStart) {
              await command.onKernelStart(...this.kernel.commandArgs);
            }
            // `kernelEvent === "onStart"` : on est PENDANT le fire de cette phase →
            // `progress` ne la porte pas encore (setCommandComplete arrive après) et
            // le `once` posé par setEvents ne re-firera jamais → exécution directe.
            if (
              command.isComplete() ||
              command.kernelEvent === this.kernelEvent
            ) {
              return command.action(...this.kernel.commandArgs);
            }
            // Phase cible pas encore atteinte → on retombe sur le re-parse commander
            // ci-dessous (évaluation des options de la commande choisie) ; les `once`
            // déjà posés sont protégés par le guard `eventsRegistered`.
          }
        }
        return await this.cli.runCommandAsync(response).then(() => {
          return this;
        });
      }
    }
  }

  override async showBanner(): Promise<string> {
    const name = this.kernel?.projectName as string;
    await this.cli?.showAsciify(name);
    return this.cli?.showBanner() as string;
  }
}

export default Start;
