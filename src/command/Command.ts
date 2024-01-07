/* eslint-disable @typescript-eslint/no-explicit-any */
import Service from '../Service'
import Container from "../Container"
import Event  from '../Event'
import { Severity, Msgid, Message} from '../syslog/Pdu'
import Cli from '../Cli'
import {Command as Cmd, program, Option, Argument} from 'commander'
//import { Command as Program, program, Option } from '@commander-js/extra-typings';
import Builder from './Builder'
import * as prompts from '@inquirer/prompts';

class Command extends Service {

  public cli : Cli | undefined | null  = undefined
  private command: Cmd | null = null
  private program : typeof program = program
  public json : boolean  = false
  public debug : boolean  = false
  public interactive : boolean = false
  public builder :  Builder| null = null
  public prompts : typeof prompts = prompts
  constructor(name: string , description?: string, cli?: Cli){
    const container: undefined | Container | null = cli?.container
    const notificationsCenter =  cli?.notificationsCenter
    const options =  cli?.options
    super(name, <Container>container, <Event>notificationsCenter , options)
    if( cli ){
      this.cli = cli
    }
    this.addCommand(name, description)
    this.command?.action(this.action.bind(this))
  }

  private getCliOptions(): void{
    this.debug = this.cli?.commander?.opts().debug
    this.interactive = this.cli?.commander?.opts().interactive
  }

  private addCommand(name: string, description?: string): Cmd{
    this.command = new Cmd(name);
    if( description){
      this.command.description(description)
    }
    return this.program.addCommand(this.command)
  }

  public addBuilder(builder: typeof Builder): Builder{
    return this.builder = new builder(this)
  }

  public parse(argv?: string[]): this {
     this.program.parse(argv)
     return this
  }

  async action(...args: any[]): Promise<any>{
    // console.log(`action`, ...args)
    this.getCliOptions()
    await this.showBanner()
    if(this.cli){
      await this.run(...args)
    }else{
      this.program.parse()
    }
  }

  async run (...args: any[]) : Promise<any>{
    //console.log(`run`, ...args)
    if (this.interactive) {
      return this.interaction(...args)
        .then((...response) => this.generate(...response))
        .catch((e) => {
          throw e;
        });
    }
    return this.generate(...args)
      .catch((e) => {
        throw e;
      });
  }

  async generate (...args: any[]) : Promise<any> {
    //console.log(`generate`, ...args)
    if(this.builder){
      console.log("pass")
    }
    return Promise.resolve(args);
  }

  async interaction (...args: any[]): Promise<any>{
    //console.log(`interaction`, ...args)
    //const answer = await this.prompts.confirm({ message: 'Continue?' });
    return Promise.resolve([...args]);
  }

  addOption(flags: string, description?: string | undefined) : Option{
    if( this.command ){
      const opt = new Option(flags, description)
      this.command.addOption(opt)
      return opt
    }
    throw new Error(`Commander not ready`)
  }

  addArgument(arg: string, description?: string | undefined): Argument{
    if( this.command ){
      const Arg =  new Argument(arg, description)
      this.command.addArgument(Arg)
      return Arg
    }
    throw new Error(`Command not ready`)
  }

  async showBanner () : Promise<string> {
    if( this.cli ){
      return this.cli.asciify(`      ${this.name}`)
      .then((data) => {
        if (this.json) {
          return data;
        }
        if( this.cli ){
          if( this.cli.options.clear){
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
    return Promise.resolve("")
  }

  override logger (pci: any, severity: Severity , msgid: Msgid , msg: Message) {
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

export default Command 
