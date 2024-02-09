/* eslint-disable @typescript-eslint/no-explicit-any */
import Service, { DefaultOptionsService } from "../Service";
import Container from "../Container";
//import Event from "../Event";
import { Severity, Msgid, Message } from "../syslog/Pdu";
import Cli from "../Cli";
import CliKernel from "../kernel/CliKernel";
import commander, {
  Command as Cmd,
  program,
  Option,
  Argument,
} from "commander";
import Builder from "./Builder";
import * as prompts from "@inquirer/prompts";
import { extend } from "../Tools";
import clui from "clui";
import { Events } from "../kernel/Kernel";

interface CommandEvents {
  on(
    event: "onProgress",
    listener: (step: number) => void
  ): NodeJS.EventEmitter;
  on(event: "onProgressEnd", listener: (pg: Cmd) => void): NodeJS.EventEmitter;
  once(
    event: "onProgress",
    listener: (step: number) => void
  ): NodeJS.EventEmitter;
  once(
    event: "onProgressEnd",
    listener: (pg: Cmd) => void
  ): NodeJS.EventEmitter;
  fire(event: "onProgress", step: number): boolean;
  fire(event: "onProgressEnd", pg?: clui.Progress): boolean;
  emit(event: "onProgress", step: number): boolean;
  emit(event: "onProgressEnd", pg?: clui.Progress): boolean;
}

interface OptionsCommandInterface extends DefaultOptionsService {
  progress?: boolean;
  sizeProgress?: number;
  showBanner?: boolean;
  kernelEvent?: keyof typeof Events;
}

export type CommandArgs = any[];

const defaultCommandOptions: OptionsCommandInterface = {
  progress: false,
  sizeProgress: 100,
  showBanner: true,
  kernelEvent: "onRegister",
};

/**
 * Classe Command représente une commande dans l'application.
 *
 * @class
 * @extends Service
 * @implements {CommandEvents}
 */

class Command extends Service {
  // EVENTS
  override on(
    event: "onProgress",
    listener: (step?: number) => void
  ): NodeJS.EventEmitter;
  override on(
    event: "onProgressEnd",
    listener: (pg?: clui.Progress) => void
  ): NodeJS.EventEmitter;
  override on(
    event: string,
    listener: (...args: any[]) => void
  ): NodeJS.EventEmitter {
    return super.on(event, listener);
  }
  override once(
    event: "onProgress",
    listener: (step?: number) => void
  ): NodeJS.EventEmitter;
  override once(
    event: "onProgressEnd",
    listener: (pg?: clui.Progress) => void
  ): NodeJS.EventEmitter;
  override once(
    event: string,
    listener: (...args: any[]) => void
  ): NodeJS.EventEmitter {
    return super.once(event, listener);
  }
  override fire(event: "onProgress", step?: number): boolean;
  override fire(event: "onProgressEnd", pg?: clui.Progress): boolean;
  override fire(event: string, ...args: any[]): boolean {
    return super.fire(event, ...args);
  }
  override emit(event: "onProgress", step?: number): boolean;
  override emit(event: "onProgressEnd", pg?: clui.Progress): boolean;
  override emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
  //end Events
  public cli: Cli | CliKernel;
  public command: Cmd;
  public program: typeof program;
  public json: boolean = false;
  public debug: boolean = false;
  public interactive: boolean = false;
  private forceInteractive: boolean = false;
  public builder: Builder | null = null;
  public prompts = prompts;
  public progress: number = 0;
  public response: Record<string, any> = {};
  public kernelEvent: keyof typeof Events = "onRegister";
  public onKernelStart?(...args: any[]): Promise<void>;
  public onKernelRegister?(...args: any[]): Promise<void>;
  public onKernelBoot?(...args: any[]): Promise<void>;
  public onKernelReady?(...args: any[]): Promise<void>;
  public currentCommand?: Cmd;
  /**
   * Crée une instance de Command.
   *
   * @constructor
   * @param {string} name - Nom de la commande.
   * @param {string} [description] - Description de la commande.
   * @param {Cli} cli - Instance de la classe Cli.
   * @param {OptionsCommandInterface} [options] - Options spécifiques à la commande.
   */
  constructor(
    name: string,
    description: string = "",
    cli: Cli | CliKernel,
    options?: OptionsCommandInterface
  ) {
    const container: undefined | Container | null = cli.container;
    //const notificationsCenter = cli?.notificationsCenter;
    const myoptions: OptionsCommandInterface = extend(
      {},
      defaultCommandOptions,
      options
    );
    super(
      name,
      <Container>container,
      null, //<Event>notificationsCenter,
      <OptionsCommandInterface>myoptions
    );
    this.cli = cli;
    this.program = this.cli.commander as Cmd;
    this.kernelEvent = this.options.kernelEvent;
    this.command = this.createCommand(name, description);
    this.command?.action((...args: any[]) => {
      if (this.kernel) {
        this.kernel.command = this;
        this.kernel.commandArgs = args;
        this.setEvents(...args);
      } else {
        this.action(...args);
      }
    });
  }
  setEvents(...args: any[]): void {
    if (this.kernel) {
      if (this.onKernelStart) {
        this.kernel.once("onStart", this.onKernelStart.bind(this, ...args));
      }
      if (this.onKernelRegister) {
        this.kernel.once(
          "onRegister",
          this.onKernelRegister.bind(this, ...args)
        );
      }
      if (this.onKernelBoot) {
        this.kernel.once("onBoot", this.onKernelBoot.bind(this, ...args));
      }
      if (this.onKernelReady) {
        this.kernel.once("onReady", this.onKernelReady.bind(this, ...args));
      }
      this.kernel.once(
        this.kernelEvent as string,
        this.action.bind(this, ...args)
      );
    }
  }

  isComplete(): boolean {
    if (this.kernel) {
      return this.kernel.isCommandComplete(
        this.kernel.Events[this.kernelEvent]
      );
    }
    throw new Error(`Kernel not founf`);
  }

  description(): string {
    return this.command.description();
  }
  /**
   * Méthode d'action de la commande.
   *
   * @private
   * @param {...any} args - Arguments passés à la commande.
   * @returns {Promise<any>} Promise résolue avec le résultat de l'action.
   */
  public async action(...args: any[]): Promise<any> {
    const current = args[args.length - 1];
    this.getCliOptions();
    if (this.options.showBanner) {
      await this.showBanner();
    }
    if (this.options.progress) {
      this.progress = 0;
      this.setProgress();
    }
    if (this.builder) {
      await this.builder.run(...args);
    }
    const res = await this.run(...args).catch((e) => {
      if (this.options.progress) {
        this.fire("onProgress", this.options.sizeProgress);
      }
      throw e;
    });
    if (this.options.progress) {
      this.fire("onProgress", this.options.sizeProgress);
    }
    this.currentCommand = current;
    return res;
  }
  /**
   * Méthode principale pour exécuter la commande.
   *
   * @public
   * @param {...any} args - Arguments passés à la commande.
   * @returns {Promise<any>} Promise résolue avec le résultat de l'exécution.
   */
  public async run(...args: any[]): Promise<this> {
    if (this.kernel) this.kernel.command = this;
    if (this.interactive || this.forceInteractive) {
      return this.interaction(...args)
        .then((...response) => this.generate(...response))
        .catch((e) => {
          throw e;
        });
    }
    return this.generate(...args).catch((e) => {
      throw e;
    });
  }
  public forceInteractiveMode(): void {
    this.forceInteractive = true;
  }
  /**
   * Méthode pour l'interaction avec l'utilisateur.
   *
   * @public
   * @param {...any} args - Arguments passés à la commande.
   * @returns {Promise<any>} Promise résolue avec le résultat de l'interaction.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async interaction(...args: any[]): Promise<any> {
    return Promise.resolve(args);
  }
  /**
   * Méthode pour générer le résultat de la commande.
   *
   * @public
   * @param {...any} args - Arguments passés à la commande.
   * @returns {Promise<any>} Promise résolue avec le résultat généré.
   */
  async generate(...args: any[]): Promise<any> {
    return Promise.resolve(args);
  }
  private getCliOptions(): void {
    this.debug = this.cli?.commander?.opts().debug || false;
    this.interactive = this.cli?.commander?.opts().interactive || false;
  }
  private createCommand(name: string, description?: string): Cmd {
    const cmd = new Cmd(name);
    if (description) {
      cmd.description(description);
    }
    this.program.addCommand(cmd);
    return cmd;
  }
  public alias(name: string): Cmd | undefined {
    return this.command?.alias(name);
  }
  public addBuilder(builder: typeof Builder): Builder {
    return (this.builder = new builder(this));
  }
  /**
   * Méthode pour analyser les arguments de la commande.
   *
   * @public
   * @param {string[]} [argv] - Tableau d'arguments à analyser.
   * @param {commander.ParseOptions|undefined} [options] - Options de l'analyseur.
   * @returns {Cmd} Instance de la classe Commander.
   * @throws {Error} Lance une erreur si Commander n'est pas prêt.
   */
  public parse(argv?: string[], options?: commander.ParseOptions): Cmd {
    if (this.program) {
      return this.program?.parse(argv, options);
    }
    throw new Error(`program not found`);
  }
  /**
   * Méthode pour effacer la commande actuelle.
   *
   * @private
   */
  private clearCommand(): void {
    if (this.cli) {
      this.cli.clearCommand();
    } else {
      while (process.argv.length > 2) {
        process.argv.pop();
      }
    }
  }
  /**
   * Méthode pour exécuter une commande avec des arguments spécifiques.
   *
   * @public
   * @param {string} cmd - Commande à exécuter.
   * @param {any[]} [args=[]] - Arguments de la commande.
   * @returns {Cmd} Instance de la classe Commander.
   */
  runCommand(cmd: string, args: any[] = []): Cmd {
    this.clearCommand();
    if (cmd) {
      process.argv.push(cmd);
    }
    return this.parse(process.argv.concat(args));
  }
  /**
   * Méthode pour mettre en place une barre de progression.
   *
   * @public
   * @param {number} [size=this.options.sizeProgress] - Taille de la barre de progression.
   * @returns {Promise<clui.Progress|null|undefined>} Promise résolue avec la barre de progression.
   */
  public setProgress(
    size: number = this.options.sizeProgress
  ): Promise<clui.Progress | null | undefined> {
    if (!this.cli || this.json) {
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      try {
        this.log(`START PROGRESS : ${this.cli?.getEmoji("clapper")}`);
        const pg = this.cli?.createProgress(size);
        this.on("onProgress", (step?: number) => {
          let res = null;
          if (step) {
            this.progress += step;
            res = pg?.update(this.progress, this.options.sizeProgress);
          } else {
            res = pg?.update(++this.progress, this.options.sizeProgress);
          }
          this.log(res, "SPINNER");
          if (
            this.progress === this.options.sizeProgress ||
            this.progress > this.options.sizeProgress
          ) {
            this.progress = this.options.sizeProgress;
            this.fire("onProgressEnd", pg);
          }
        });
        this.on("onProgressEnd", () => {
          this.cli?.blankLine();
          this.log(
            `\u001b[13pEND PROGRESS : ${this.cli?.getEmoji("checkered_flag")}`
          );
          this.removeAllListeners("onProgress");
          this.removeAllListeners("onProgressEnd");
        });
        return resolve(pg);
      } catch (e) {
        return reject(e);
      }
    });
  }
  /**
   * Méthode pour ajouter une option à la commande.
   *
   * @public
   * @param {string} flags - Drapeaux de l'option.
   * @param {string|undefined} [description] - Description de l'option.
   * @returns {Option} Instance de la classe Option.
   * @throws {Error} Lance une erreur si Commander n'est pas prêt.
   */
  addOption(flags: string, description?: string | undefined): Option {
    if (this.command) {
      const opt = new Option(flags, description);
      this.command.addOption(opt);
      return opt;
    }
    throw new Error(`Commander not ready`);
  }
  /**
   * Méthode pour ajouter un argument à la commande.
   *
   * @public
   * @param {string} arg - Argument de la commande.
   * @param {string|undefined} [description] - Description de l'argument.
   * @returns {Argument} Instance de la classe Argument.
   * @throws {Error} Lance une erreur si Commander n'est pas prêt.
   */
  addArgument(arg: string, description?: string | undefined): Argument {
    if (this.command) {
      const Arg = new Argument(arg, description);
      this.command.addArgument(Arg);
      return Arg;
    }
    throw new Error(`Command not ready`);
  }
  /**
   * Méthode pour afficher une bannière liée à la commande.
   *
   * @public
   * @returns {Promise<string>} Promise résolue avec la bannière générée.
   */
  async showBanner(): Promise<string> {
    if (this.cli) {
      return this.cli
        .asciify(`      ${this.name}`)
        .then((data: any) => {
          if (this.json) {
            return data;
          }
          if (this.cli) {
            if (this.cli.options.clear) {
              this.cli.clear();
            }
            const color = this.cli.clc.blueBright.bold;
            console.log(color(data));
            this.cli.blankLine();
          }
          return data;
        })
        .catch((e: Error) => e);
    }
    return Promise.resolve("");
  }
  /**
   * Méthode pour gérer la journalisation de la commande.
   *
   * @public
   * @param {any} pci - Informations du client.
   * @param {Severity} severity - Sévérité du message.
   * @param {Msgid} msgid - Identifiant du message.
   * @param {Message} msg - Contenu du message.
   */
  override logger(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message) {
    try {
      if (!msgid) {
        msgid = `COMMAND ${this.name}`;
      }
      return super.logger(pci, severity, msgid, msg);
    } catch (e) {
      console.log(e, "\n", pci);
    }
  }
  async terminate(code?: number): Promise<void> {
    return this.cli?.terminate(code || 0);
  }
}

export default Command;
export { OptionsCommandInterface, CommandEvents };
