/* eslint-disable @typescript-eslint/no-explicit-any */
import Service, { DefaultOptionsService } from "../Service";
import Container from "../Container";
import Event from "../Event";
import { Severity, Msgid, Message } from "../syslog/Pdu";
import Cli from "../Cli";
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

interface OptionsCommandInterface extends DefaultOptionsService {
  progress?: boolean;
  sizeProgress?: number;
  showBanner?: boolean;
}

const defaultCommandOptions: OptionsCommandInterface = {
  progress: false,
  sizeProgress: 100,
  showBanner: true,
};

class Command extends Service {
  public cli: Cli | undefined | null = undefined;
  private command: Cmd | null = null;
  private program: typeof program = program;
  public json: boolean = false;
  public debug: boolean = false;
  public interactive: boolean = false;
  public builder: Builder | null = null;
  public prompts: typeof prompts = prompts;
  public progress: number = 0;
  public response: Record<string, any> = {};
  constructor(
    name: string,
    description?: string,
    cli?: Cli,
    options?: OptionsCommandInterface
  ) {
    const container: undefined | Container | null = cli?.container;
    const notificationsCenter = cli?.notificationsCenter;
    const myoptions: OptionsCommandInterface = extend(
      {},
      defaultCommandOptions,
      options
    );
    super(
      name,
      <Container>container,
      <Event>notificationsCenter,
      <OptionsCommandInterface>myoptions
    );
    if (cli) {
      this.cli = cli;
    }
    this.addCommand(name, description);
    this.command?.action(this.action.bind(this));
  }

  private async action(...args: any[]): Promise<any> {
    this.getCliOptions();
    if (this.options.showBanner) {
      await this.showBanner();
    }
    if (this.cli) {
      if (this.options.progress) {
        this.progress = 0;
        this.setProgress();
      }
      if (this.builder) {
        await this.builder.run(...args);
      }
      await this.run(...args);
    } else {
      this.program.parse();
    }
    if (this.options.progress) {
      this.fire("onProgress", this.options.sizeProgress);
    }
  }

  public async run(...args: any[]): Promise<any> {
    if (this.interactive) {
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async interaction(...args: any[]): Promise<any> {
    //console.log(`interaction`, ...args)
    //const answer = await this.prompts.confirm({ message: 'Continue?' });
    return Promise.resolve(this.response);
  }

  async generate(...args: any[]): Promise<any> {
    return Promise.resolve(args);
    // let i:  NodeJS.Timeout
    // return  new Promise ((resolve, reject)=>{
    //   //return resolve(args)
    //     i = setInterval(()=>{
    //     this.progress++
    //     this.fire("onProgress")
    //     if( this.progress === this.options.sizeProgress ){
    //       //console.log("pass clean :", i)
    //       clearInterval(i)
    //       return resolve(args);
    //     }
    //   }, 100)
    // })
  }

  private getCliOptions(): void {
    this.debug = this.cli?.commander?.opts().debug;
    this.interactive = this.cli?.commander?.opts().interactive;
  }

  private addCommand(name: string, description?: string): Cmd {
    this.command = new Cmd(name);
    if (description) {
      this.command.description(description);
    }
    return this.program.addCommand(this.command);
  }

  public addBuilder(builder: typeof Builder): Builder {
    return (this.builder = new builder(this));
  }

  public parse(argv?: string[], options?: commander.ParseOptions): Cmd {
    if (this.program) {
      return this.program?.parse(argv, options);
    }
    throw new Error(`program not found`);
  }

  private clearCommand(): void {
    if (this.cli) {
      this.cli.clearCommand();
    } else {
      while (process.argv.length > 2) {
        process.argv.pop();
      }
    }
  }

  runCommand(cmd: string, args: any[] = []): Cmd {
    this.clearCommand();
    if (cmd) {
      process.argv.push(cmd);
    }
    return this.parse(process.argv.concat(args));
  }

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
        pg?.update(++this.progress, size);
        this.on("onProgress", (step?: number) => {
          let res = null;
          if (step) {
            this.progress = step;
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

  addOption(flags: string, description?: string | undefined): Option {
    if (this.command) {
      const opt = new Option(flags, description);
      this.command.addOption(opt);
      return opt;
    }
    throw new Error(`Commander not ready`);
  }

  addArgument(arg: string, description?: string | undefined): Argument {
    if (this.command) {
      const Arg = new Argument(arg, description);
      this.command.addArgument(Arg);
      return Arg;
    }
    throw new Error(`Command not ready`);
  }

  async showBanner(): Promise<string> {
    if (this.cli) {
      return this.cli
        .asciify(`      ${this.name}`)
        .then((data) => {
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
        .catch((e) => e);
    }
    return Promise.resolve("");
  }

  override logger(pci: any, severity: Severity, msgid: Msgid, msg: Message) {
    try {
      if (!msgid) {
        msgid = `COMMAND ${this.name}`;
      }
      return super.logger(pci, severity, msgid, msg);
    } catch (e) {
      console.log(e, "\n", pci);
    }
  }
}

export default Command;

export { OptionsCommandInterface };
