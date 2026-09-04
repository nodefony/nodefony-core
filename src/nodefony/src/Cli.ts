/* eslint-disable @typescript-eslint/ban-ts-comment */

/* eslint-disable @typescript-eslint/no-explicit-any */

import path from "node:path";
import fs from "node:fs";
import {
  program,
  Command as CommanderCommand,
  ParseOptions,
  HelpContext,
  ExecutableCommandOptions,
} from "commander";
//import commander, { program } from '@commander-js/extra-typings';
import {
  spawn,
  spawnSync,
  SpawnSyncReturns,
  SpawnSyncOptionsWithStringEncoding,
  SpawnOptions,
} from "node:child_process";
import semver from "semver";
import Table, { TableConstructorOptions } from "cli-table3";
import clc, { type ColorFn, type Clc } from "./colors";
import Service, { DefaultOptionsService } from "./Service";
import {
  DEFAULT_ENGINE_ENVIRONMENT,
  defaultEngineEnvironment,
} from "./runtime/engineEnvironment";
import { extend } from "./Tools";
import Container from "./Container";
import FileClass from "./FileClass";
import Event from "./Event";
import Command from "./command/Command";
import { DebugType, EnvironmentType } from "./types/globals";
import Syslog from "./syslog/Syslog";
import Kernel from "./kernel/Kernel";

type FigletModule = (typeof import("figlet"))["default"];
let figletModule: FigletModule | null = null;

/**
 * Charge `figlet` à la demande (import dynamique, idempotent) — la bannière ASCII est
 * cosmétique : les commandes qui ne l'affichent pas ne paient pas son chargement au boot.
 */
const loadFiglet = async (): Promise<FigletModule> => {
  if (!figletModule) {
    figletModule = (await import("figlet")).default;
  }
  return figletModule;
};

interface CliDefaultOptions extends DefaultOptionsService {
  processName?: string;
  autostart?: boolean;
  asciify?: boolean;
  clear?: boolean;
  color?: ColorFn;
  prompt?: string;
  commander?: boolean;
  signals?: boolean;
  autoLogger?: boolean;
  resize?: boolean;
  version?: string;
  warning?: boolean;
  pid?: boolean;
  promiseRejection?: boolean;
  font?: string;
  environment?: EnvironmentType;
}

// const red = clc.red.bold;
// const cyan   = clc.cyan.bold;
const blue = clc.blueBright.bold;
const { green } = clc;
// const yellow = clc.yellow.bold;
const magenta = clc.magenta.bold;
const { reset } = clc; // '\x1b[0m';

let processName: string | null = null;
if (process.argv && process.argv[1]) {
  processName = path.basename(process.argv[1]);
} else {
  processName = process.title || "nodefony";
}

const defaultTableCli = {
  style: {
    head: ["cyan"],
    border: ["grey"],
  },
};

// export declare class CliCommand extends Command {
//   constructor(cli: Cli);
// }

export type PackageManagerName = "npm" | "yarn" | "pnpm" | "bun";

const defaultOptions = {
  processName,
  autostart: true,
  asciify: true,
  clear: true,
  color: blue,
  prompt: "default", // "default" || "rxjs"
  commander: true,
  signals: true,
  autoLogger: true,
  resize: false,
  version: "1.0.0",
  warning: false,
  pid: false,
  promiseRejection: true,
  // ⚠️ PAS de `environment` ici, volontairement. Un défaut posé dans les options
  // s'interpose dans la cascade du constructeur et court-circuite la seule
  // fonction qui sache distinguer « `NODE_ENV` absent » (poste de développement)
  // de « `NODE_ENV` posé mais non-moteur » (un déploiement `staging`/`canary`,
  // qui doit tourner comme la production). Vécu : avec un défaut ici, un
  // `NODE_ENV=staging` partait en développement.
};

/**
 * Traduit un `NODE_ENV` brut en mode MOTEUR, ou `null` s'il n'en désigne aucun.
 *
 * `NODE_ENV` est un axe LIBRE (`test`, `staging`, `canary`, `prod-eu`…) tandis que
 * {@link EnvironmentType} n'a que deux modes moteur : dev et prod. Les caster l'un
 * dans l'autre est un mensonge au compilateur — sous vitest, `environment` valait
 * `"test"`, une valeur ABSENTE de son propre type, propagée telle quelle à
 * `initSyslog()` et au `Kernel`.
 *
 * `null` (valeur non-moteur) fait retomber l'appelant sur son défaut explicite,
 * exactement comme si `NODE_ENV` n'était pas défini. C'est le choix CONSERVATEUR :
 * un `test` se comportait déjà comme la production (le filtre syslog teste
 * `=== "development"`, tout le reste tombe dans la branche prod). Le forcer en
 * `"development"` aurait rendu toute la suite de tests verbeuse ; le forcer en
 * `"production"` aurait fait installer `--omit=dev` sous `NODE_ENV=test`. Un axe
 * qui ne désigne pas de moteur ne doit pas en élire un à la place de l'appelant.
 *
 * L'axe de déploiement, lui, reste ENTIER : le kernel lit `process.env.NODE_ENV`
 * directement pour `runtimeEnv`/`isTest` (`buildConfigContext`) — jamais via cette
 * fonction, qui ne réécrit rien.
 */
const toEngineEnvironment = (raw?: string): EnvironmentType | null => {
  switch (raw) {
    case "dev":
    case "development":
    case "prod":
    case "production":
      return raw;
    default:
      return null;
  }
};

/**
 * Délai au-delà duquel on sort sans attendre le vidage des sorties.
 *
 * Le cas qu'il couvre : le destinataire du tuyau a fermé (`| head -5`), aucun
 * `drain` n'arrivera jamais, et attendre serait un blocage franc. Une seconde
 * suffit très largement — vider 100 Ko vers un tuyau vivant prend des
 * millisecondes.
 */
const EXIT_FLUSH_DEADLINE_MS = 1000;

/**
 * Sort du process APRÈS avoir vidé les sorties standard.
 *
 * 🔴 **`process.exit()` TRONQUE la sortie, et ne le dit pas.** Vers un fichier
 * ou un terminal, `process.stdout.write` est synchrone : tout part. Vers un
 * TUYAU, il est asynchrone — au-delà du tampon du système (64 Ko), le reste
 * attend dans la file, et `process.exit()` part avec. Mesuré sur
 * `nodefony inspect routes --json` : 97 825 octets vers un fichier, très
 * exactement 65 536 vers un `| jq`, qui casse alors sur un JSON incomplet.
 * L'usage était pourtant celui que la commande DOCUMENTE.
 *
 * Le défaut ne se voit pas sur une petite sortie : il apparaît le jour où
 * l'application grossit, sur la machine de quelqu'un d'autre, et il se lit
 * comme une donnée corrompue plutôt que comme une sortie coupée.
 *
 * @param code - code de sortie du process
 */
function exitWhenFlushed(code: number): void {
  const streams = [process.stdout, process.stderr].filter(
    (s) => typeof s.writableLength === "number" && s.writableLength > 0,
  );
  if (streams.length === 0) {
    return process.exit(code);
  }
  let restants = streams.length;
  const fini = (): void => {
    restants -= 1;
    if (restants === 0) {
      process.exit(code);
    }
  };
  for (const s of streams) {
    s.once("drain", fini);
  }
  // Filet, jamais le chemin normal : `unref` pour ne pas retenir l'event-loop
  // si les drains arrivent d'abord.
  const filet = setTimeout(() => process.exit(code), EXIT_FLUSH_DEADLINE_MS);
  filet.unref();
}

class Cli extends Service {
  public override options: CliDefaultOptions = extend({}, defaultOptions);
  public debug: DebugType = false;
  public environment: EnvironmentType = DEFAULT_ENGINE_ENVIRONMENT;
  public commander: typeof program | null = null;
  protected commands: Record<string, Command> = {};
  public pid: number | null = null;
  public interactive: boolean = false;
  public unhandledRejections: Map<Promise<unknown>, string> = new Map();
  public response: Record<string, any> = {};
  public timers: Record<string, string> = {};
  public version: string = "";
  public clc: Clc = clc;
  public blankLine: () => void = () => {};
  public columns: number = 0;
  public rows: number = 0;
  /**
   * Vrai dès le 1ᵉʳ signal d'arrêt reçu. Empêche un 2ᵉ signal de relancer un
   * `terminate()` gracieux complet (re-fire `onTerminate`, double SHUTDOWN des
   * serveurs). Le 2ᵉ signal force la sortie immédiate — cf {@link handleSignals}.
   */
  protected shuttingDown: boolean = false;
  /**
   * Retraits des listeners posés sur `process` — `null` tant qu'aucun n'est
   * attaché (une instance qui n'écoute rien n'alloue rien).
   *
   * Chaque entrée est le retrait de SON listener, fermé sur la référence exacte :
   * un handler anonyme passé à `process.on` ne peut plus jamais être retiré, et
   * c'est ce qui faisait de chaque instance une fuite. En production le process
   * meurt avec son unique `Cli`, mais un runner de tests en crée des dizaines
   * dans le MÊME process : au 11ᵉ, Node crie `MaxListenersExceededWarning` — et
   * comme le warning porte l'objet `process` entier, chacun coûtait ~500 lignes
   * de journal (216 000 lignes sur un seul job de CI, tronqué par GitHub).
   *
   * @see {@link releaseProcessListeners}
   */
  #detachProcess: Array<{ off: () => void; signal: boolean }> | null = null;
  /** Numéros POSIX → code de sortie forcé `128 + signum` au 2ᵉ signal. */
  protected static readonly SIGNUM: Record<string, number> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGTERM: 15,
  };

  constructor(name?: string);
  constructor(name: string, options: CliDefaultOptions);
  constructor(
    name: string,
    container: Container | null | undefined,
    options: CliDefaultOptions,
  );
  constructor(
    name: string,
    container: Container | null | undefined,
    notificationsCenter: Event | false | undefined,
    options: CliDefaultOptions,
  );
  constructor(name?: string, ...args: any[]) {
    const container: Container | undefined | null =
      args[0] instanceof Container ? args[0] : undefined;
    const notificationsCenter: Event | undefined | false =
      args[1] instanceof Event
        ? args[1]
        : args[1] === false
          ? false
          : undefined;
    const last = args[args.length - 1];
    let options = null;
    if (last instanceof Container || last instanceof Event || last === false) {
      options = extend({}, defaultOptions);
    } else {
      options = extend({}, defaultOptions, last || {});
    }
    super(
      name || <string>options.processName,
      container,
      notificationsCenter,
      options,
    );
    this.options = <CliDefaultOptions>options;
    this.environment =
      toEngineEnvironment(process.env.NODE_ENV) ??
      this.options.environment ??
      // ⚠️ Pas `DEFAULT_ENGINE_ENVIRONMENT` nu : une valeur POSÉE mais
      // non-moteur (`staging`, `canary`, `prod-eu`) nomme un déploiement, et
      // un déploiement tourne comme la production. Seule l'ABSENCE désigne un
      // poste de développement.
      defaultEngineEnvironment(process.env.NODE_ENV);
    this.setProcessTitle();
    this.pid = this.options.pid ? this.setPid() : null;
    if (this.options.autoLogger) {
      this.initSyslog();
    }
    this.initUi();
    // Optimisation : Utilisation de fireAsync pour les opérations asynchrones
    this.prependOnceListener("onStart", async () => {
      try {
        await this.fireAsync("onStart", this);
      } catch (e) {
        this.log(e, "ERROR");
      }
    });
    this.initCommander();
    // Gestion des avertissements
    if (this.options.warning) {
      this.handleWarnings();
    } else {
      process.env.NODE_NO_WARNINGS = "1"; // Utilisation d'une chaîne pour la clarté
    }
    // Gestion des signaux
    if (this.options.signals) {
      this.handleSignals();
    }
    // Gestion des rejets de promesses
    if (this.options.promiseRejection) {
      this.listenRejection();
    }
    // Affichage ASCII (asciify)
    if (name && this.options.asciify) {
      this.showAsciify(name)
        .then(async () => {
          if (this.options.autostart) {
            await this.fireAsync("onStart", this);
          }
        })
        .catch((e) => this.log(e, "ERROR"));
    } else if (this.options.autostart) {
      try {
        const func = async function (this: Cli) {
          await this.fireAsync("onStart", this);
        };
        func.call(this);
      } catch (e) {
        this.log(e, "ERROR");
      }
    }
  }

  //Méthode privée pour gérer les signaux
  protected handleSignals(): void {
    const signalHandler = (signal: string) => {
      // 2ᵉ signal (Ctrl+C insistant, ou SIGTERM de l'orchestrateur/DevSupervisor
      // qui suit le SIGINT du terminal) → arrêt FORCÉ immédiat. Pattern graceful
      // shutdown standard : le 1ᵉʳ signal draine, le 2ᵉ tue. Sans ça, le handler
      // n'étant pas idempotent, le 2ᵉ signal relançait un `terminate()` complet
      // (double fire `onTerminate`, double "SHUTDOWN" des serveurs HTTP/WS).
      if (this.shuttingDown) {
        this.log(`${signal} received again — force exit`, "WARNING");
        process.exit(128 + (Cli.SIGNUM[signal] ?? 0));
      }
      this.shuttingDown = true;
      if (this.blankLine) {
        this.blankLine();
      }
      this.log(signal, "CRITIC");
      this.fire("onSignal", signal, this);
      process.nextTick(() => {
        this.terminate();
      });
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const) {
      const handler = () => signalHandler(signal);
      process.on(signal, handler);
      this.trackProcessListener(
        () => process.removeListener(signal, handler),
        true,
      );
    }
  }

  /**
   * Mémorise DE QUOI retirer un listener de `process`.
   *
   * Prend le retrait déjà fermé sur la référence du handler, plutôt que le
   * couple (événement, handler) : c'est ce qui permet de garder chaque listener
   * typé exactement (`NodeJS.Signals`, `Error`, `Promise<unknown>`) sans un seul
   * cast au moment de le retirer.
   *
   * @param off - retire le listener correspondant, et rien d'autre.
   * @param signal - `true` s'il s'agit d'un gestionnaire de SIGNAL. Ce n'est
   *   pas une étiquette de confort : le mode cluster doit reprendre la main sur
   *   les signaux SANS toucher aux autres listeners de cette instance
   *   (`warning`, `unhandledRejection`), que le master garde. Cf
   *   {@link releaseSignalListeners}.
   */
  protected trackProcessListener(off: () => void, signal = false): void {
    (this.#detachProcess ??= []).push({ off, signal });
  }

  /**
   * Retire tous les listeners que cette instance a posés sur `process`.
   *
   * Sans effet utile en production — le process meurt avec son `Cli` — mais
   * indispensable dès qu'un même process en instancie plusieurs (tests, outils
   * qui enchaînent des commandes) : sinon chaque instance ajoute sept listeners
   * que personne ne peut plus retirer.
   *
   * Idempotent : un second appel ne retire rien et rend `0`.
   *
   * @returns le nombre de listeners effectivement retirés.
   */
  releaseProcessListeners(): number {
    if (!this.#detachProcess) {
      return 0;
    }
    const released = this.#detachProcess.length;
    for (const { off } of this.#detachProcess) {
      off();
    }
    this.#detachProcess = null;
    return released;
  }

  /**
   * Retire les gestionnaires de SIGNAUX de cette instance — et rien d'autre.
   *
   * 🔴 Il existe pour remplacer un `process.removeAllListeners(sig)`, qui
   * arrachait AUSSI les gestionnaires qu'un module tiers avait posés sur
   * `SIGTERM` pour son propre arrêt propre. Ce module ne recevait plus rien, et
   * rien ne le lui disait : son code était juste, ses tests passaient, et son
   * nettoyage cessait simplement de s'exécuter le jour où l'application passait
   * en cluster — au moment le plus coûteux, l'arrêt.
   *
   * On ne retire donc que ce qu'on a posé soi-même. Les autres listeners de
   * cette instance (`warning`, `unhandledRejection`, `uncaughtException`)
   * restent : le master cluster en a besoin autant que n'importe quel process.
   *
   * @returns le nombre de gestionnaires de signaux retirés.
   */
  releaseSignalListeners(): number {
    if (!this.#detachProcess) {
      return 0;
    }
    const signaux = this.#detachProcess.filter((e) => e.signal);
    for (const { off } of signaux) {
      off();
    }
    this.#detachProcess = this.#detachProcess.filter((e) => !e.signal);
    return signaux.length;
  }

  // Méthode privée pour gérer les avertissements
  private handleWarnings(): void {
    const handler = (warning: Error) => {
      this.log(warning, "WARNING");
      this.fire("onNodeWarning", warning, this);
    };
    process.on("warning", handler);
    this.trackProcessListener(() => process.removeListener("warning", handler));
  }

  start(): Promise<Cli | Kernel> {
    // L'exécuteur reste SYNCHRONE : un exécuteur `async` avale ses propres
    // rejets (la promesse ne se règle jamais). Le travail asynchrone vit dans
    // `run()`, dont le rejet est rebranché sur `reject` — y compris celui des
    // callbacks DIFFÉRÉS (`once`), qu'un try/catch d'exécuteur ne couvre pas :
    // ils s'exécutent après que l'exécuteur a rendu la main.
    return new Promise((resolve, reject) => {
      const run = async (): Promise<void> => {
        if (this.options.autostart) {
          if (this.options.asciify) {
            this.once("onStart", () => resolve(this));
            return;
          }
          await this.fireAsync("onStart", this);
          resolve(this);
          return;
        }
        if (this.options.asciify) {
          this.once("onAsciify", () => {
            this.fireAsync("onStart", this).then(() => resolve(this), reject);
          });
          return;
        }
        await this.fireAsync("onStart", this);
        resolve(this);
      };
      run().catch(reject);
    });
  }

  idle() {
    let resolve = null;
    let reject = null;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return (function () {
      return {
        resolve,
        promise,
        reject,
      };
    })();
    // return this.idleId = setInterval(() => {}, 0);
  }

  checkVersion(version: string | semver.SemVer | null | undefined = null) {
    if (!version) {
      version = this.version;
    }
    const res = semver.valid(version);
    if (res) {
      return res;
    }
    throw new Error(`Not valid version : ${version} check  http://semver.org `);
  }

  async showAsciify(name: string | null = null): Promise<this> {
    if (!name) {
      name = this.name;
    }
    return await this.asciify(`      ${name}`, {
      font: this.options.font || "Standard",
    })
      .then((data: string) => {
        this.fire("onAsciify", data);
        if (this.options.clear) {
          this.clear();
        }
        const color = this.options.color || blue;
        console.log(color(data));
        return this;
      })
      .catch((err: Error) => {
        this.log(err, "ERROR");
        throw err;
      });
  }

  showBanner() {
    const version =
      (this.commander ? this.commander.version() : this.options.version) ||
      "1.0.0";
    let banner = null;
    if (this.options.version) {
      banner = `          Version : ${blue(version)}   Platform : ${green(
        process.platform,
      )}   Process : ${green(process.title)}   Pid : ${process.pid}`;
      if (this.blankLine) {
        this.blankLine();
      }
      console.log(banner);
    }
    return banner;
  }

  listenRejection() {
    const onHandled = (promise: Promise<unknown>) => {
      this.log("PROMISE REJECTION EVENT ", "CRITIC", "rejectionHandled");
      this.unhandledRejections.delete(promise);
    };
    process.on("rejectionHandled", onHandled);
    this.trackProcessListener(() =>
      process.removeListener("rejectionHandled", onHandled),
    );
    const onUnhandled = (reason: string, promise: Promise<unknown>) => {
      this.log(
        `WARNING  !!! PROMISE CHAIN BREAKING : ${reason}`,
        "WARNING",
        "unhandledRejection",
      );
      console.trace(promise);
      this.unhandledRejections.set(promise, reason);
    };
    process.on("unhandledRejection", onUnhandled);
    this.trackProcessListener(() =>
      process.removeListener("unhandledRejection", onUnhandled),
    );
  }

  setPid(): number {
    return (this.pid = process.pid);
  }

  setProcessTitle(name?: string) {
    if (name) {
      process.title = name.replace(new RegExp("\\s", "gi"), "").toLowerCase();
    } else {
      process.title = this.name
        .replace(new RegExp("\\s", "gi"), "")
        .toLowerCase();
    }
    return process.title;
  }

  logEnv() {
    return `${blue(`      \x1b ${this.name}`)} Nodefony Environment : ${magenta(
      this.environment,
    )}`;
  }

  initCommander(): typeof program | null {
    if (this.options.commander) {
      this.commander = new CommanderCommand();
      const optionInteractiveExists = this.commander.options.some(
        (opt) => opt.short === "-i" || opt.long === "--interactive",
      );
      if (!optionInteractiveExists) {
        this.commander.option("-i, --interactive", "Interaction mode");
      }
      const optionDebugExists = this.commander.options.some(
        (opt) => opt.short === "-d" || opt.long === "--debug",
      );
      if (!optionDebugExists) {
        this.commander.option("-d, --debug", "Debug mode");
      }
      const optionOptExists = this.commander.options.some(
        (opt) => opt.short === "-v" || opt.long === "--version",
      );
      if (!optionOptExists && this.options.version) {
        this.setCommandVersion(this.options.version);
      }
      return this.commander;
    }
    return null;
  }

  initUi(): void {
    this.blankLine = () => {
      process.stdout.write("\n");
    };
    if (this.options.resize) {
      this.resize();
    }
  }

  async getFonts(): Promise<void> {
    const figlet = await loadFiglet();
    figlet.fonts((_err, fonts) => {
      fonts?.forEach((ele) => {
        this.log(ele);
      });
    });
  }

  async asciify(
    txt: string,
    options?: object,
    callback?: (error: Error, data: string) => void,
  ): Promise<string> {
    const figlet = await loadFiglet();
    return new Promise((resolve, reject) => {
      figlet(
        txt,
        extend(
          {
            font: "Standard",
          },
          options,
        ),
        (error, data) => {
          if (callback && typeof callback === "function") {
            return callback(error as Error, data ?? "");
          }
          if (error) {
            return reject(error);
          }
          return resolve(data ?? "");
        },
      );
    });
  }

  public parse(argv?: string[], options?: ParseOptions): CommanderCommand {
    if (this.commander) {
      return this.commander?.parse(argv, options);
    }
    throw new Error(`Commander not found`);
  }

  public parseAsync(
    argv?: string[],
    options?: ParseOptions,
  ): Promise<CommanderCommand> {
    if (this.commander) {
      return this.commander?.parseAsync(argv, options).catch((e) => {
        throw e;
      });
    }
    throw new Error(`Commander not found`);
  }

  public clearCommand(): void {
    this.commander?.setOptionValue("interactive", false);
    this.commander?.setOptionValue("debug", false);
    while (process.argv.length > 2) {
      process.argv.pop();
    }
  }

  runCommand(cmd: string, args: any[] = []): CommanderCommand {
    // this.log(`Commnand : ${cmd} Arguments : ${args}`, "DEBUG", "COMMAND");
    this.clearCommand();
    if (cmd) {
      process.argv.push(cmd);
    }
    return this.parse(process.argv.concat(args));
  }

  runCommandAsync(cmd: string, args: any[] = []): Promise<CommanderCommand> {
    //this.log(`Commnand : ${cmd} Arguments : ${args}`, "DEBUG", "COMMAND");
    this.clearCommand();
    if (cmd) {
      process.argv.push(cmd);
    }
    return this.parseAsync(process.argv.concat(args));
  }

  setCommandOption(
    flags: string,
    description?: string,
    defaultValue?: string | boolean | string[] | undefined,
  ): CommanderCommand {
    if (this.commander) {
      return this.commander.option(flags, description, defaultValue);
    }
    throw new Error(`Commender not found`);
  }

  setCommandVersion(version: string): CommanderCommand {
    if (this.commander && typeof this.commander.version === "function") {
      return this.commander.version(
        version,
        "-v, --version",
        "Nodefony Current Version",
      );
    }
    throw new Error(`Commender not found`);
  }

  setCommand(
    nameAndArgs: string,
    description: string,
    options?: ExecutableCommandOptions | undefined,
  ): CommanderCommand {
    if (this.commander) {
      return this.commander.command(nameAndArgs, description, options);
    }
    throw new Error(`Commander not found`);
  }

  public addCommand(cliCommand: new (cli: this) => Command): Command {
    const command = new cliCommand(this);
    this.commands[command.name] = command;
    return command;
  }

  public hasCommand(name: string): boolean {
    if (this.commands[name]) {
      return true;
    }
    return false;
  }

  public getCommand(name: string): Command | null {
    if (this.commands[name]) {
      return this.commands[name];
    }
    return null;
  }

  showHelp(quit: boolean, context: HelpContext | undefined): void | never {
    if (!this.commander) {
      throw new Error(`Commender not found`);
    }
    if (quit) {
      return this.commander.help(context);
    }
    return this.commander.outputHelp(context);
  }

  displayTable(
    datas: any[],
    options: TableConstructorOptions,
    syslog: Syslog | null = null,
  ) {
    if (!datas || !datas.length) {
      return new Table(extend({}, defaultTableCli, options));
    }
    const table = new Table(extend({}, defaultTableCli, options));
    if (datas) {
      for (let i = 0; i < datas.length; i++) {
        table.push(datas[i]);
      }
      if (syslog) {
        syslog.log(`\n${table.toString()}`);
      } else {
        console.log(table.toString());
      }
    }
    return table;
  }

  static niceBytes(x: string | number) {
    const units: string[] = [
      "bytes",
      "KB",
      "MB",
      "GB",
      "TB",
      "PB",
      "EB",
      "ZB",
      "YB",
    ];
    let n = parseInt(<string>x, 10) || 0,
      l = 0;
    while (n >= 1024) {
      n /= 1024;
      l++;
    }
    return `${n.toFixed(n >= 10 || l < 1 ? 0 : 1)} ${units[l]}`;
  }

  /**
   * Temps relatif lisible ("a few seconds ago", "24 years ago") — natif via
   * `Intl.RelativeTimeFormat` (remplace `moment().fromNow()`, dep supprimée).
   *
   * @param date - instant de référence (Date, timestamp ms, ou string parsable).
   * @param suffix - `true` = sans suffixe "ago"/"in" (parité `moment.fromNow(true)`).
   */
  static niceUptime(
    date: Date | number | string,
    suffix?: boolean | undefined,
  ): string {
    const ts = date instanceof Date ? date.getTime() : new Date(date).getTime();
    const deltaSec = (ts - Date.now()) / 1000; // < 0 = passé
    const abs = Math.abs(deltaSec);
    const ladder: [Intl.RelativeTimeFormatUnit, number][] = [
      ["year", 31536000],
      ["month", 2592000],
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60],
      ["second", 1],
    ];
    let unit: Intl.RelativeTimeFormatUnit = "second";
    let value = 0;
    for (const [u, s] of ladder) {
      if (abs >= s || u === "second") {
        unit = u;
        value = Math.round(deltaSec / s);
        break;
      }
    }
    if (suffix) {
      const n = Math.abs(value);
      return `${n} ${unit}${n === 1 ? "" : "s"}`;
    }
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
      value,
      unit,
    );
  }

  /**
   * Formate une date selon des tokens `moment`-like (`YYYY MM DD HH mm ss SSS`)
   * en heure **locale** — natif (remplace `moment().format()`, dep supprimée).
   *
   * @param date - Date, timestamp ms, ou string parsable.
   * @param format - patron (défaut `"YYYY-MM-DD HH:mm:ss"`).
   */
  static niceDate(
    date: Date | number | string,
    format?: string | undefined,
  ): string {
    const d = date instanceof Date ? date : new Date(date);
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    const map: Record<string, string> = {
      YYYY: String(d.getFullYear()),
      MM: pad(d.getMonth() + 1),
      DD: pad(d.getDate()),
      HH: pad(d.getHours()),
      mm: pad(d.getMinutes()),
      ss: pad(d.getSeconds()),
      SSS: pad(d.getMilliseconds(), 3),
    };
    return (format || "YYYY-MM-DD HH:mm:ss").replace(
      /YYYY|SSS|MM|DD|HH|mm|ss/g,
      (t) => map[t],
    );
  }

  clear() {
    console.clear();
  }

  reset() {
    process.stdout.write(reset);
  }

  resize() {
    process.stdout.on("resize", () => {
      this.columns = process.stdout.columns;
      this.rows = process.stdout.rows;
      this.fire("onResize", this.columns, this.rows, this);
    });
  }

  async createDirectory(
    myPath: fs.PathLike,
    mode?: fs.MakeDirectoryOptions | fs.Mode | null,
    force: boolean = false,
  ): Promise<FileClass> {
    try {
      await fs.promises.mkdir(myPath, mode);
      return new FileClass(myPath);
    } catch (e: any) {
      switch (e.code) {
        case "EEXIST":
          if (force) {
            return new FileClass(myPath);
          }
          break;
      }
      throw e;
    }
  }

  existsSync(myPath: fs.PathLike) {
    if (!myPath) {
      throw new Error("existsSync no path found");
    }
    return fs.existsSync(myPath);
  }

  exists(
    myPath: fs.PathLike,
    mode?: number | undefined,
    callback?: fs.NoParamCallback,
  ) {
    if (!myPath) {
      throw new Error("exists no path found");
    }
    if (!mode) {
      mode = fs.constants.R_OK | fs.constants.W_OK;
    }
    if (callback) {
      return fs.access(myPath, mode, callback);
    }
    return fs.existsSync(myPath);
  }

  async terminate(code: number = 0, quiet?: boolean): Promise<void | never> {
    // Avant toute sortie, y compris la sortie « silencieuse » : une instance qui
    // se termine ne doit rien laisser sur `process`.
    this.releaseProcessListeners();
    if (quiet) {
      return;
    }
    if (code === 0) {
      process.exitCode = code;
    }
    exitWhenFlushed(code);
  }

  static quit(code: number): void {
    if (code === 0) {
      process.exitCode = code;
    }
    return exitWhenFlushed(code);
  }

  startTimer(name: string) {
    if (name in this.timers) {
      throw new Error(`Timer : ${name} already exist !! stopTimer to clear`);
    }
    try {
      this.log(`BEGIN TIMER : ${name}`, "INFO");
      this.timers[name] = name;
      return console.time(name);
    } catch (e) {
      if (name in this.timers) {
        delete this.timers[name];
      }
      throw e;
    }
  }

  stopTimer(name: string) {
    if (!name) {
      for (const timer in this.timers) {
        this.stopTimer(this.timers[timer]);
      }
    }
    try {
      if (name in this.timers) {
        this.log(`END TIMER : ${name}`, "INFO");
        delete this.timers[name];
        return console.timeEnd(name);
      }
      throw new Error(`Timer : ${name} not exist !! startTimer before`);
    } catch (e) {
      if (name in this.timers) {
        delete this.timers[name];
      }
      throw e;
    }
  }

  getCommandManager(manager: string) {
    if (process.platform === "win32") {
      switch (manager) {
        case "npm":
          return "npm.cmd";
        case "yarn":
          return "yarn.cmd";
        case "pnpm":
          return "pnpm.cmd";
        default:
          throw new Error(`bad manager : ${manager}`);
      }
    } else {
      switch (manager) {
        case "npm":
          return "npm";
        case "yarn":
          return "yarn";
        case "pnpm":
          return "pnpm";
        default:
          throw new Error(`bad manager : ${manager}`);
      }
    }
  }

  runPackageManager(
    argv: string[] = [],
    cwd: string = path.resolve("."),
    env: EnvironmentType,
    manager: string,
  ): Promise<number | Error> {
    const currentenv = process.env.NODE_ENV;
    switch (env) {
      case "dev":
      case "development":
        switch (manager) {
          case "npm":
          case "yarn":
          case "pnpm":
            break;
        }
        process.env.NODE_ENV = "development";
        break;
      case "prod":
      case "production":
        switch (manager) {
          case "npm":
            argv.push("--omit=dev");
            break;
          case "yarn":
            argv.push("--production");
            break;
          case "pnpm":
            argv.push("--prod");
            break;
        }
        process.env.NODE_ENV = "production";
        break;
      default:
        process.env.NODE_ENV = this.environment;
    }
    return new Promise((resolve, reject) => {
      try {
        this.debug = Boolean(this.commander?.opts().debug) || false;
        // this.debug = this.commander
        //   ? this.commander.opts().debug || false
        //   : false;
        this.log(`Command : ${manager} ${argv.join(" ")} in cwd : ${cwd}`);
        const exe = this.getCommandManager(manager);
        this.spawn(
          exe,
          argv,
          {
            cwd,
            env: process.env,
            stdio: "inherit",
          },
          (code: number) => {
            process.env.NODE_ENV = currentenv;
            if (code === 0) {
              return resolve(code);
            }
            return resolve(
              new Error(
                `Command : ${manager} ${argv.join(
                  " ",
                )}  cwd : ${cwd} Error Code : ${code}`,
              ),
            );
          },
        );
      } catch (e) {
        process.env.NODE_ENV = currentenv;
        this.log(e, "ERROR");
        return reject(e);
      }
    });
  }

  async npm(
    argv: string[] = [],
    cwd = path.resolve("."),
    env: EnvironmentType = "dev",
  ) {
    return this.runPackageManager(argv, cwd, env, "npm");
  }

  async yarn(
    argv: string[] = [],
    cwd = path.resolve("."),
    env: EnvironmentType = "dev",
  ) {
    return this.runPackageManager(argv, cwd, env, "yarn");
  }

  async pnpm(
    argv: string[] = [],
    cwd = path.resolve("."),
    env: EnvironmentType = "dev",
  ) {
    return this.runPackageManager(argv, cwd, env, "pnpm");
  }

  spawn(
    command: string,
    args: readonly string[] | undefined,
    options: SpawnOptions | undefined,
    close: ((code: number) => void) | null = null,
  ) {
    return new Promise((resolve, reject) => {
      let cmd = null;
      try {
        if (!args) {
          args = [];
        }
        this.log(`Spawn : ${command} ${args.join(" ")}`, "INFO");
        cmd = spawn(command, args, options || {});
        if (cmd.stdout) {
          cmd.stdout.on("data", (data) => {
            const str = data.toString();
            if (str) {
              if (this.debug) {
                this.log(`${command} :\n`, "INFO", "STDOUT");
              }
              process.stdout.write(str);
            }
          });
        }
        if (cmd.stderr) {
          cmd.stderr.on("data", (data) => {
            const str = data.toString();
            if (str) {
              if (this.debug) {
                this.log(`${command} :\n`, "INFO", "STDERR");
              }
              process.stdout.write(str);
            }
          });
        }
        cmd.on("close", (code: number) => {
          if (this.debug) {
            this.log(`Child Process exited with code ${code}`, "DEBUG");
          }
          if (close) {
            close(code);
          }
          if (code !== 0) {
            if (!args) {
              args = [];
            }
            this.log(
              `Spawn : ${command} ${args.join(" ")} Error Code : ${code}`,
              "ERROR",
            );
          }
          return resolve(code);
        });
        cmd.on("error", (err) => {
          this.log(err, "ERROR");
          return reject(err);
        });
        if (cmd.stdin) {
          process.stdin.pipe(cmd.stdin);
        }
      } catch (e) {
        this.log(e, "ERROR");
        return reject(e);
      }
    });
  }

  spawnSync(
    command: string,
    args: readonly string[],
    options: SpawnSyncOptionsWithStringEncoding,
  ): SpawnSyncReturns<string> {
    let cmd = null;
    try {
      cmd = spawnSync(command, args, options);
      if (cmd.error) {
        throw cmd.error;
      }
      if (cmd.stderr) {
        this.log(cmd.stderr.toString(), "ERROR");
      }
      if (cmd.stdout) {
        this.log(cmd.stdout.toString(), "INFO");
      }
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
    return cmd;
  }
}

export default Cli;
export { CliDefaultOptions };
