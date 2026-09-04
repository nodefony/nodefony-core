/* eslint-disable @typescript-eslint/no-explicit-any */
import { chargePrompts } from "../cli/prompts";
import Service, { DefaultOptionsService } from "../Service";
import Container, { Scope } from "../Container";
//import Event from "../Event";
import { Severity, Msgid, Message } from "../syslog/Pdu";
import Cli from "../Cli";
import CliKernel from "../kernel/CliKernel";
import {
  Command as Cmd,
  program,
  Option,
  Argument,
  ParseOptions,
} from "commander";
import Builder from "./Builder";
import { extend } from "../Tools";
import type { KernelEventKey, RunLifetime } from "../types/ICommand";
import type { IRunProfile } from "../kernel/Kernel";

interface OptionsCommandInterface extends DefaultOptionsService {
  showBanner?: boolean;
  kernelEvent?: KernelEventKey;
  /**
   * Durée de vie du run (capability déclarative). `"oneshot"` (défaut) = terminate une
   * fois `kernelEvent` atteint ; `"longrunning"` = daemon CONSOLE → le Kernel parke au
   * lieu de terminer (cf `Kernel.finishOrPark`). Les serveurs n'ont pas besoin de ce flag
   * (leurs sockets gardent le process vivant) ; il vise les daemons sans serveur.
   */
  lifetime?: RunLifetime;
  /**
   * Profil d'exécution DÉCLARÉ (capability statique, cf `IRunProfile`). Appliqué par
   * `CliKernel.resolveCommand()` au moment où la commande est résolue — quel que soit
   * l'instant du match (built-in avant boot, commande de module à `onPreRegister`).
   * C'est ce qui permet à une commande de MODULE d'être serveur (`servers: true` +
   * `kernelEvent: "onPostReady"`). Les profils DYNAMIQUES (dev parent/enfant,
   * master/worker cluster) restent posés par `setRunProfile()` dans `onKernelStart`.
   */
  runProfile?: IRunProfile;
  /**
   * Boot SILENCIEUX pour CETTE commande (capability déclarative).
   *
   * 🔴 Le journal de cycle de vie n'est pas la SORTIE d'une commande. Vécu :
   * `nodefony inspect modules` rendait trente lignes de `MODULE ADD`, de stores
   * résolus et d'avertissements TLS avant son tableau — la réponse à la
   * question posée arrivait en dernier, sous un mur que personne n'a demandé.
   *
   * Déclaré ICI plutôt que posé par chaque commande : le constructeur d'une
   * commande s'exécute pour TOUTES les invocations du CLI, si bien qu'un
   * `cli.quietBoot = true` écrit dans un constructeur rendrait muet le serveur
   * de développement. Le CLI ne l'applique qu'à la commande RÉELLEMENT demandée.
   *
   * Ne cache jamais une erreur : seuls NOTICE et INFO tombent, `EMERGENCY..ERROR`
   * restent, et `-d/--debug` rétablit tout.
   */
  quietBoot?: boolean;
}

export type CommandArgs = any[];

const defaultCommandOptions: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onRegister",
  lifetime: "oneshot",
};

/**
 * Classe Command représente une commande dans l'application.
 *
 * @class
 * @extends Service
 */

/**
 * Les valeurs SUGGÉRÉES d'une option, pour la complétion du shell.
 *
 * Un registre à part plutôt qu'un champ posé sur l'objet de commander : ce sont
 * ses objets, et les muter ferait dépendre le produit d'un détail non
 * documenté. `WeakMap` parce qu'une option morte ne doit rien retenir.
 */
export const OPTION_SUGGESTIONS = new WeakMap<Option, readonly string[]>();

class Command extends Service {
  public cli: Cli | CliKernel;
  public command: Cmd;
  public program: typeof program;
  public json: boolean = false;
  public debug: boolean = false;
  public interactive: boolean = false;
  private forceInteractive: boolean = false;
  public builder: Builder | null = null;
  /**
   * Namespace `@inquirer/prompts` — chargé LAZY via {@link loadPrompts} (import
   * dynamique) uniquement pour les commandes interactives. Évite ~39 ms + ~7 MB
   * d'import eager sur CHAQUE boot non-interactif (la quasi-totalité). Garanti peuplé
   * avant tout usage (action() le charge si interactif ; Builder le charge défensivement).
   */
  public prompts!: typeof import("@inquirer/prompts");
  public response: Record<string, any> = {};
  public kernelEvent: KernelEventKey = "onRegister";
  /** Durée de vie déclarée (cf {@link OptionsCommandInterface.lifetime}). */
  public lifetime: RunLifetime = "oneshot";
  /** Profil d'exécution déclaré (cf {@link OptionsCommandInterface.runProfile}) — `null` si non déclaré. */
  public runProfile: IRunProfile | null = null;
  /** Boot silencieux déclaré (cf {@link OptionsCommandInterface.quietBoot}). */
  public quietBoot: boolean = false;
  // Hooks lifecycle optionnels — un par phase du Kernel (cf Events bitmask). Câblés
  // LAZY dans setEvents() : un `kernel.once(...)` n'est posé QUE si la commande définit
  // le hook → 0 listener / 0 coût pour les commandes qui ne l'utilisent pas (règle perf).
  // Disponibles pour TOUS les modes (serveur / batch one-shot / daemon CONSOLE). `onInit`
  // n'est pas exposé : il fire dans le constructeur du Kernel, avant que la commande y soit liée.
  public onKernelPreStart?(...args: any[]): Promise<void>;
  public onKernelStart?(...args: any[]): Promise<void>;
  public onKernelPreRegister?(...args: any[]): Promise<void>;
  public onKernelRegister?(...args: any[]): Promise<void>;
  public onKernelPreBoot?(...args: any[]): Promise<void>;
  public onKernelBoot?(...args: any[]): Promise<void>;
  public onKernelReady?(...args: any[]): Promise<void>;
  public onKernelServersReady?(...args: any[]): Promise<void>;
  public onKernelPostReady?(...args: any[]): Promise<void>;
  /** Cleanup / graceful shutdown — fire à `terminate()` (reçoit le code en dernier arg). */
  public onKernelTerminate?(...args: any[]): Promise<void>;
  public currentCommand?: Cmd;
  private eventsRegistered: boolean = false;
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
    options?: OptionsCommandInterface,
  ) {
    const container: Scope | Container | null | undefined = cli.container;
    //const notificationsCenter = cli?.notificationsCenter;
    const myoptions: OptionsCommandInterface = extend(
      {},
      defaultCommandOptions,
      options,
    );
    super(
      name,
      <Container>container,
      null, //<Event>notificationsCenter,
      <OptionsCommandInterface>myoptions,
    );
    this.cli = cli;
    this.program = this.cli.commander as Cmd;
    this.kernelEvent = this.options.kernelEvent;
    this.lifetime = this.options.lifetime ?? "oneshot";
    this.runProfile = this.options.runProfile ?? null;
    this.quietBoot = this.options.quietBoot === true;
    this.command = this.createCommand(name, description);
    this.command?.action((...args: any[]) => {
      if (this.kernel) {
        // Parse PUR : le match commander ne fait que SIGNALER la commande résolue.
        // Tout le câblage lifecycle (mutation kernel, runProfile déclaré, hooks) est
        // centralisé dans CliKernel.resolveCommand — point unique de résolution.
        (this.cli as CliKernel).resolveCommand(this, args);
        return undefined;
      }
      // RETOURNER la promesse de l'action : sans ça, un `generate()` qui rejette
      // produit une « unhandled rejection » flottante (commander ne peut pas
      // l'attendre via `parseAsync`). La propager rend l'erreur capturable.
      return this.action(...args);
    });
  }
  setEvents(...args: any[]): void {
    if (this.kernel && !this.eventsRegistered) {
      this.eventsRegistered = true;
      // Câblage LAZY phase par phase (ordre chronologique du boot) : un listener
      // n'est posé que si le hook est défini → aucun coût pour les commandes qui ne
      // l'utilisent pas. Couvre tous les modes (serveur / batch / daemon).
      if (this.onKernelPreStart) {
        this.kernel.once(
          "onPreStart",
          this.onKernelPreStart.bind(this, ...args),
        );
      }
      if (this.onKernelStart) {
        this.kernel.once("onStart", this.onKernelStart.bind(this, ...args));
      }
      if (this.onKernelPreRegister) {
        this.kernel.once(
          "onPreRegister",
          this.onKernelPreRegister.bind(this, ...args),
        );
      }
      if (this.onKernelRegister) {
        this.kernel.once(
          "onRegister",
          this.onKernelRegister.bind(this, ...args),
        );
      }
      if (this.onKernelPreBoot) {
        this.kernel.once("onPreBoot", this.onKernelPreBoot.bind(this, ...args));
      }
      if (this.onKernelBoot) {
        this.kernel.once("onBoot", this.onKernelBoot.bind(this, ...args));
      }
      if (this.onKernelReady) {
        this.kernel.once("onReady", this.onKernelReady.bind(this, ...args));
      }
      if (this.onKernelServersReady) {
        this.kernel.once(
          "onServersReady",
          this.onKernelServersReady.bind(this, ...args),
        );
      }
      if (this.onKernelPostReady) {
        this.kernel.once(
          "onPostReady",
          this.onKernelPostReady.bind(this, ...args),
        );
      }
      if (this.onKernelTerminate) {
        // onTerminate fire avec (kernel, code) → le hook les reçoit après ...args.
        this.kernel.once(
          "onTerminate",
          this.onKernelTerminate.bind(this, ...args),
        );
      }
      this.kernel.once(
        this.kernelEvent as string,
        this.action.bind(this, ...args),
      );
    }
  }

  isComplete(): boolean {
    if (this.kernel) {
      return this.kernel.isCommandComplete(
        this.kernel.Events[this.kernelEvent],
      );
    }
    throw new Error(`Kernel not found`);
  }

  description(): string {
    return this.command.description();
  }

  /**
   * Charge `@inquirer/prompts` à la demande (import dynamique, idempotent) et le pose
   * sur {@link prompts}. Appelé pour les commandes interactives — garde l'import lourd
   * (~39 ms / ~7 MB) HORS du boot des commandes non-interactives.
   */
  public async loadPrompts(): Promise<void> {
    if (!this.prompts) {
      // ⭐ Par la porte UNIQUE, jamais par un import direct : les questions en
      // sortent ANCRÉES sur l'event loop. Attendre une frappe est une promesse
      // en attente, et Node ne compte que les HANDLES — une commande qui ne
      // démarre rien s'arrête donc AU MILIEU de sa question, sans erreur et
      // avec un code de sortie nul. Cf `cli/prompts.ts`.
      this.prompts = (await chargePrompts()) as unknown as typeof this.prompts;
    }
  }
  /**
   * Rend un argument : celui qu'on a reçu, ou celui qu'on DEMANDE.
   *
   * 🔴 Une commande qui exige un argument positionnel (`<identifier>`) refuse
   * avant même d'exister : commander répond « error: missing required argument
   * 'identifier' » et le kernel sort en 1. C'est juste quand on TAPE la ligne
   * et qu'on a oublié un mot ; c'est absurde quand on a CHOISI la commande dans
   * le menu — on n'a rien oublié, on ne savait pas. Vécu sur
   * `security:user:add` : le menu propose le geste, la commande le refuse.
   *
   * La règle vit ICI et pas dans chaque commande : quatre commandes du dépôt
   * attendent un argument, et quatre copies d'une même règle divergent. Pour en
   * profiter, une commande déclare son argument OPTIONNEL (`[identifier]` —
   * sinon commander refuse avant nous) puis passe ce qu'elle a reçu.
   *
   * **Hors terminal, on ne demande RIEN** : un pipeline sans TTY resterait
   * suspendu sur une question que personne ne lit, jusqu'au timeout du job.
   * L'échec reste un échec — mais il montre la ligne exacte à taper.
   *
   * @param valeur - ce que la ligne de commande a fourni (souvent `undefined`)
   * @param spec - nom de l'argument, question posée, choix éventuels ; `isTTY`
   *               est INJECTABLE pour que la règle s'éprouve sans terminal
   * @returns la valeur, taillée
   * @throws Si l'argument manque et qu'aucun terminal ne peut le demander
   */
  public async askArgument(
    valeur: string | undefined,
    spec: {
      name: string;
      message: string;
      choices?: readonly string[];
      isTTY?: boolean;
    },
  ): Promise<string> {
    const donnee = typeof valeur === "string" ? valeur.trim() : "";
    if (donnee.length > 0) return donnee;

    const interactifPossible = spec.isTTY ?? Boolean(process.stdin.isTTY);
    if (!interactifPossible) {
      const exemple = spec.choices?.length
        ? `<${spec.choices.join("|")}>`
        : `<${spec.name}>`;
      throw new Error(
        `${spec.name} est requis — aucun terminal pour le demander : ` +
          `nodefony ${this.name} ${exemple}`,
      );
    }

    await this.loadPrompts();
    const reponse = spec.choices?.length
      ? await this.prompts.select({
          message: spec.message,
          choices: spec.choices.map((c) => ({ name: c, value: c })),
        })
      : await this.prompts.input({
          message: spec.message,
          validate: (v: string) =>
            v.trim().length > 0 || `${spec.name} est requis`,
        });
    return String(reponse).trim();
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
    // Charge les prompts AVANT builder + interaction (qui les consomment), seulement
    // si interactif → 0 import @inquirer pour les commandes non-interactives.
    if (this.interactive || this.forceInteractive) {
      await this.loadPrompts();
    }
    if (this.options.showBanner) {
      await this.showBanner();
    }
    if (this.builder) {
      await this.builder.run(...args);
    }
    const res = await this.run(...args);
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
      // 🔴 `.then((...response) => …)` ne recevait qu'UNE valeur — le callback
      // d'une promesse n'est jamais variadique. `interaction()` rendant ses
      // arguments (`[a, b, c]` par défaut), `generate` recevait UN argument :
      // le tableau. Toute commande passée en interactif sans surcharger
      // `interaction()` voyait donc son premier paramètre devenir un tableau —
      // c'est ce qui interdisait de propager le mode interactif depuis le menu.
      // Le menu, lui, ne le voyait pas : son `interaction()` rend une chaîne.
      const response = await this.interaction(...args);
      // Un tableau = plusieurs arguments (le cas par défaut) ; une valeur seule
      // = un argument, et surtout pas ses éléments étalés.
      return Array.isArray(response)
        ? this.generate(...response)
        : this.generate(response);
    }
    return this.generate(...args);
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
  public parse(argv?: string[], options?: ParseOptions): Cmd {
    if (this.program) {
      return this.program?.parse(argv, options);
    }
    throw new Error(`program not found`);
  }
  public parseAsync(argv?: string[], options?: ParseOptions): Promise<Cmd> {
    if (this.program) {
      return this.program?.parseAsync(argv, options);
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
  async runCommandAsync(cmd: string, args: any[] = []) {
    this.clearCommand();
    if (cmd) {
      process.argv.push(cmd);
    }
    return this.parseAsync(process.argv.concat(args));
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
  addOption(
    flags: string,
    description?: string | undefined,
    suggestions?: readonly string[],
  ): Option {
    if (this.command) {
      const opt = new Option(flags, description);
      // 🔴 Des SUGGESTIONS, pas des `choices()` : `Option.choices()` VALIDE, et
      // une option dont les valeurs sont ouvertes par nature (un environnement
      // de déploiement est une chaîne libre) deviendrait inutilisable là où
      // elle sert. Ce registre n'est consulté que par la complétion.
      if (suggestions?.length) OPTION_SUGGESTIONS.set(opt, suggestions);
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
    // 🔴 `code || 0` traduisait `undefined` en 0 — et effaçait l'échec.
    //
    // Une commande signale son échec par `process.exitCode = 1`, la façon
    // normale en Node ; puis le cadre appelle `terminate()` SANS argument pour
    // clore le kernel. Le `|| 0` en faisait un succès : « terminate : 0 »,
    // process sorti en 0, et ni un script, ni un `&&` en shell, ni une CI ne
    // voyaient quoi que ce soit. Signalé sur `security:token`, présent sur cinq
    // commandes. `undefined` doit VOYAGER : c'est le Kernel qui résout alors le
    // code réel (`process.exitCode`, sinon 0).
    //
    // ⚠️ `|| 0` était doublement faux : il transformait aussi un `terminate(0)`
    // explicite en… 0, par chance — mais tout code falsy y passait.
    return this.cli?.terminate(code);
  }
}

export default Command;
export { OptionsCommandInterface };
