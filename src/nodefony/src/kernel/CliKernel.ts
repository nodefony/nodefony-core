import path from "node:path";

import Syslog, { conditionsInterface } from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";
import { logColor } from "../syslog/logColor";
import { SysExit } from "../cli/sysexits";
import Cli, { CliDefaultOptions, PackageManagerName } from "../Cli";
import Kernel, {
  IRunProfile,
  CONSOLE_RUN_PROFILE,
  TypeKernelOptions,
} from "./Kernel";
import Command from "../command/Command";
import Start from "./commands/StartCommand";
import Dev from "./commands/DevCommand";
import Build from "./commands/BuildCommand";
import Prod from "./commands/ProdCommand";
import Cluster from "./commands/ClusterCommand";
import Install from "./commands/InstallCommand";
import Outated from "./commands/OutdatedCommand";
import { DebugType, EnvironmentType } from "../types/globals";
import Module from "./Module";
import { HelpContext, Command as commanderCommand } from "commander";
import { version } from "../../package.json";

type ModuleWithDefault<T> = {
  default?: T;
};

const cliOptions: CliDefaultOptions = {
  autoLogger: false,
  asciify: false,
  version,
  warning: true,
  pid: true,
};

export type PackageManager = (
  argv: string[],
  cwd?: string,
  env?: EnvironmentType,
) => Promise<number | Error>;

/**
 * Kernel spécialisé pour les invocations CLI (`npx nodefony <command>`).
 *
 * **N'étend PAS {@link Kernel}** mais {@link Cli} (Commander wrapper). Le `Kernel` applicatif
 * est instancié séparément par {@link start} et linké à `this.kernel`. Sa raison d'être :
 * parser argv via Commander, sélectionner une commande, configurer l'environnement
 * (`SERVER` vs `CONSOLE`), puis déléguer au `Kernel` pour le boot.
 *
 * **Piège lifecycle connu** : `environment` peut être `undefined` au constructor — les
 * sous-commandes le set dans leur hook `onKernelStart()`. Ne jamais conditionner du code
 * sur `this.environment` dans le constructor.
 *
 * @example
 * ```ts
 * // bin/nodefony.ts
 * import { CliKernel } from "nodefony";
 * const cli = new CliKernel();
 * await cli.start();   // boote le Kernel + parse argv + exécute la command
 * ```
 */
class CliKernel extends Cli {
  public runProfile: IRunProfile = { ...CONSOLE_RUN_PROFILE };
  public app: Module | null = null;
  public packageManager: PackageManager = this.pnpm;
  /**
   * Boot SILENCIEUX : pour les commandes CLI utilitaires (help global, commandes
   * de module type `frontend:status`) dont la sortie doit être propre — les logs
   * de cycle de vie (NOTICE/INFO/DEBUG) sont coupés, seuls EMERGENCY..ERROR
   * surfacent (cf {@link initSyslog}). Mis à `true` par {@link dispatchGlobalHelp}
   * et {@link dispatchModuleCommand}. `-d/--debug` rétablit le détail.
   */
  public quietBoot: boolean = false;
  /**
   * @param environment - environnement initial (`"development"` / `"production"` / `"test"`).
   *   Peut être `undefined` — sera set par la sous-commande dans `onKernelStart()`.
   */
  constructor(environment?: EnvironmentType) {
    super("NODEFONY", cliOptions);
    if (environment) {
      this.environment = environment;
    }
    this.initSyslog();
  }

  /**
   * Sélectionne le package manager pour les commandes `install`/`outdated`.
   *
   * @param manager - `"npm"` / `"yarn"` / `"pnpm"`. Défaut = `this.options.packageManager` (pnpm).
   * @returns la fonction package manager liée à `this`.
   */
  setPackageManager(
    manager: PackageManagerName = this.options?.packageManager,
  ): PackageManager {
    switch (manager) {
      case "yarn":
        this.packageManager = this.yarn as PackageManager;
        break;
      case "pnpm":
        this.packageManager = this.pnpm as PackageManager;
        break;
      default:
        this.packageManager = this.npm as PackageManager;
    }
    return this.packageManager;
  }

  override showHelp(
    quit: boolean,
    context: HelpContext | undefined,
  ): void | never {
    super.showHelp(quit, context);
  }

  /**
   * Parse argv synchroniquement via Commander (cf {@link parseCommandAsync} pour async).
   *
   * @param argv - args (défaut `process.argv`).
   * @returns instance Commander après parse.
   */
  parseCommand(argv?: string[]): commanderCommand {
    return this.parse(argv || process.argv);
  }

  /**
   * Parse argv et exécute la commande matched (peut être async — `.action(async () => ...)`).
   *
   * @param argv - args (défaut `process.argv`).
   * @returns Promise résolue avec l'instance Commander après exécution.
   */
  parseCommandAsync(argv?: string[]): Promise<commanderCommand> {
    return this.parseAsync(argv || process.argv);
  }

  /**
   * Boot complet : instancie le Kernel, enregistre les 9 commands built-in, parse argv,
   * lance `kernel.start()`.
   *
   * Comportement Commander :
   * - `--help` / `--version` → terminate(0) propre
   * - Erreur Commander (option/commande inconnue) → terminate(1) + re-throw —
   *   **JAMAIS de fallback serveur** (legacy supprimé : une erreur de parse ne doit
   *   pas démarrer un runtime).
   * - Exception kernel → terminate(1) puis re-throw
   *
   * @param options - options surchargées pour le `new Kernel(env, this, options)`.
   * @returns le Kernel booté.
   * @throws Si Commander absent OR si kernel.start() crash.
   */
  override async start(options?: TypeKernelOptions): Promise<Kernel> {
    this.kernel = new Kernel(this.environment, this, options);
    try {
      if (this.commander) {
        // Ordre = ordre des groupes dans le help (Commander rend les groupes dans
        // l'ordre de 1ʳᵉ rencontre) : Serveur → Build → Projet → Console/jobs.
        this.addCommand(Dev);
        this.addCommand(Prod);
        this.addCommand(Cluster);
        this.addCommand(Build);
        this.addCommand(Install);
        this.addCommand(Outated);
        this.addCommand(Start);
        this.commander.exitOverride();
        this.commander.name(this.name);
        this.commander.showHelpAfterError(false);
        this.commander.showSuggestionAfterError(true);
        this.commander.configureHelp({
          //sortSubcommands: true,
          sortOptions: true,
          showGlobalOptions: true,
          subcommandTerm: (cmd) => cmd.name(), // Just show the name, instead of short usage.
          // formatHelp: (cmd, help) => {
          //   return cmd.helpInformation();
          //   //return this.cli?.commander?.help();
          // },
        });

        // // @ts-expect-error: overloaded  _outputConfiguration
        // this.commander._outputConfiguration = {
        //   writeOut: (str: string) => this.log(str), //process.stdout.write(str),
        //   writeErr: (str: string) => this.log(str, "ERROR"), // process.stderr.write(str),
        //   getOutHelpWidth: () =>
        //     process.stdout.isTTY ? process.stdout.columns : undefined,
        //   getErrHelpWidth: () =>
        //     process.stderr.isTTY ? process.stderr.columns : undefined,
        //   outputError: (str: string, write: (str: string) => void) => write(str),
        // };
        // // @ts-expect-error: overloaded  _hasHelpOption
        //this.commander._hasHelpOption = false;

        // ─── HELP GLOBAL enrichi : modules chargés AVANT l'affichage ──────────
        // `nodefony`, `nodefony --help`, `nodefony -h` → on veut lister AUSSI les
        // commandes de module (`frontend:build`, `network`, …), pas seulement les
        // built-ins. Or les modules ne posent leurs commandes qu'à `onPreRegister`.
        // On boote donc le kernel jusqu'à cette phase (mode CONSOLE, 0 serveur),
        // PUIS on affiche le help complet et on `terminate(0)`. `--version` n'est
        // PAS concerné (résolu par commander sans boot, cf le `.catch` plus bas).
        if (this.isGlobalHelpRequested()) {
          return this.dispatchGlobalHelp();
        }

        // ─── Commandes de MODULE : dispatch DIFFÉRÉ ──────────────────────────
        // Les built-ins ci-dessus sont les seules commandes connues de commander
        // à ce stade. Les commandes de module (`frontend:build`, `network`, …) ne
        // sont posées qu'à `onPreRegister` (par les modules, chargés depuis le
        // manifeste `config.modules`). Si la commande demandée n'est pas un built-in, parser argv
        // MAINTENANT échouerait (`unknown command`) → fallback qui boote un serveur.
        // On diffère donc son dispatch jusqu'à ce que les modules l'aient
        // enregistrée. Cf project_cli_commands_broken_claude_ts.
        const requested = this.getRequestedCommandName();
        if (
          requested !== null &&
          !this.getBuiltinCommandNames().has(requested)
        ) {
          return this.dispatchModuleCommand(requested);
        }

        return this.commander
          ?.parseAsync()
          .then(async () => {
            if (!this.kernel) throw new Error(`Kernel not found`);
            return (this.kernel as Kernel).start();
          })
          .catch(async (e: unknown) => {
            // Sorties normales Commander (help affiché, --help, --version) → terminer
            // proprement (exit 0). `commander.help` = invocation nue `nodefony` (aucune
            // commande → commander affiche le help) ; `commander.helpDisplayed` = `--help`.
            const code = (e as { code?: string })?.code;
            if (
              code === "commander.help" ||
              code === "commander.helpDisplayed" ||
              code === "commander.version"
            ) {
              return this.kernel?.terminate(0) as Promise<Kernel>;
            }
            // Toute autre erreur (option/commande inconnue OU échec de boot) → on
            // termine en erreur et on propage. PLUS de fallback « relancer un kernel
            // serveur » (legacy retiré) : un parse qui échoue ne démarre jamais de runtime.
            this.log(e, "ERROR");
            await this.kernel?.terminate(1);
            throw e;
          });
      }

      throw new Error(`Commander not found`);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  /**
   * Nom de la commande demandée = premier token non-option de `process.argv`.
   *
   * `null` si aucun (invocation nue, `--help`, `--version`) → on retombe sur le
   * flow built-in inchangé.
   *
   * @returns nom de commande demandé ou `null`.
   */
  private getRequestedCommandName(): string | null {
    for (const arg of process.argv.slice(2)) {
      if (!arg.startsWith("-")) {
        return arg;
      }
    }
    return null;
  }

  /**
   * `true` si l'invocation demande le **help global** : `nodefony` nu,
   * `nodefony --help` ou `nodefony -h` (que des options, aucun positionnel).
   *
   * Exclut volontairement `--version` (résolu par commander sans booter les
   * modules) et `nodefony <cmd> --help` (help d'une sous-commande, laissé à
   * commander / au dispatch de module — il y a un positionnel).
   *
   * @returns `true` si le help global est demandé.
   */
  private isGlobalHelpRequested(): boolean {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      return true;
    }
    // Un positionnel présent → c'est une commande (ou son help) : pas le help global.
    for (const arg of args) {
      if (!arg.startsWith("-")) {
        return false;
      }
    }
    return args.includes("-h") || args.includes("--help");
  }

  /**
   * Noms + alias des commandes built-in déjà enregistrées dans commander.
   *
   * Dérivé de commander (pas de liste en dur → suit l'ajout/retrait de built-ins).
   * À appeler APRÈS `addCommand(...)` des built-ins et AVANT que les modules
   * n'enregistrent les leurs.
   *
   * @returns set des noms et alias built-in.
   */
  private getBuiltinCommandNames(): Set<string> {
    const names = new Set<string>();
    for (const cmd of this.commander?.commands ?? []) {
      names.add(cmd.name());
      for (const alias of cmd.aliases?.() ?? []) {
        names.add(alias);
      }
    }
    return names;
  }

  /**
   * Dispatch DIFFÉRÉ d'une commande de module.
   *
   * commander ignore la commande au boot (posée par le module à `onPreRegister`,
   * chargé depuis `config.modules`). On parse donc argv depuis un listener
   * `onPreRegister` lui-même posé via `onStart` : `loadApp()` (qui pose le listener
   * `loadModulesFromManifest`) précède `onStart`, et `emitAsync` est séquentiel →
   * notre listener tourne APRÈS le chargement des modules, donc quand toutes les
   * commandes de module sont connues, mais
   * AVANT les phases qu'elles ciblent (`onRegister`/`onReady`/…) → leur
   * `kernel.once(kernelEvent)` fire normalement. Le kernel reste en mode CONSOLE
   * (aucune commande serveur ne fixe `type=SERVER`) → 0 serveur démarré. Commande
   * réellement introuvable (typo) → `terminate(1)`, jamais de fallback serveur.
   *
   * @param requested - nom de commande demandé (pour le message d'erreur).
   * @returns le Kernel booté (terminé après exécution de la commande).
   */
  private dispatchModuleCommand(requested: string): Promise<Kernel> {
    const kernel = this.kernel as Kernel;
    // Commande CLI utilitaire → boot silencieux (sortie propre, cf quietBoot).
    this.quietBoot = true;
    kernel.once("onStart", () => {
      kernel.once("onPreRegister", async () => {
        try {
          await this.commander?.parseAsync();
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (
            code === "commander.helpDisplayed" ||
            code === "commander.version"
          ) {
            await this.kernel?.terminate(SysExit.OK);
            return;
          }
          // Commande inconnue / mauvais usage → EX_USAGE (sysexits.h).
          this.log(`command not found: ${requested}`, "ERROR");
          await this.kernel?.terminate(SysExit.USAGE);
        }
      });
    });
    return kernel.start().catch(async (e) => {
      // Code de sortie porté par l'erreur si présent (ex. config invalide →
      // EX_CONFIG=78, l'orchestrateur distingue « mauvaise config » d'un crash) ;
      // sinon échec de boot générique → EX_SOFTWARE (sysexits.h).
      const code = (e as { exitCode?: number }).exitCode ?? SysExit.SOFTWARE;
      await this.kernel?.terminate(code);
      throw e;
    });
  }

  /**
   * Boote le kernel jusqu'à `onPreRegister` (modules instanciés → leurs commandes
   * sont posées dans commander), affiche le help COMPLET puis `terminate(0)`.
   *
   * Même mécanique de timing que {@link dispatchModuleCommand} : le listener
   * `onPreRegister` est posé depuis `onStart` pour passer APRÈS le chargement des modules
   * (`emitAsync` séquentiel). Le kernel reste CONSOLE (aucune commande → 0 serveur)
   * et `terminate(0)` stoppe le boot avant `onRegister` (process.exit au nextTick).
   *
   * Boot KO (hors d'une app, config invalide) → fallback : help built-in seul
   * (déjà enregistré dans commander) + `terminate(0)`. L'utilisateur a toujours un help.
   *
   * @returns le Kernel (terminé après affichage du help).
   */
  private dispatchGlobalHelp(): Promise<Kernel> {
    const kernel = this.kernel as Kernel;
    // Help global → boot silencieux (aucun log de cycle de vie ne pollue le help).
    this.quietBoot = true;
    let shown = false;
    const render = async (): Promise<void> => {
      if (!shown) {
        shown = true;
        this.printHelpHeader();
        this.assignHelpGroups();
        this.showHelp(false, undefined);
        this.printHelpFooter();
      }
      await this.kernel?.terminate(SysExit.OK);
    };
    kernel.once("onStart", () => {
      kernel.once("onPreRegister", render);
    });
    return kernel.start().catch(async () => {
      await render();
      return kernel;
    }) as Promise<Kernel>;
  }

  /**
   * En-tête brandé du help global (1ʳᵉ ligne, pas de ligne vide en tête — norme
   * sortie CLI). Couleur gatée par `logColor` (isTTY + NO_COLOR/FORCE_COLOR).
   */
  private printHelpHeader(): void {
    let version = "";
    try {
      const v: unknown = this.commander?.version();
      if (typeof v === "string") version = v;
    } catch {
      /* commander sans version — ignore */
    }
    const tag = version ? ` ${logColor.blackBright(`v${version}`)}` : "";
    console.log(
      `  ${logColor.cyan("⬢")} ${logColor.cyanBold("Nodefony")}${tag}   ` +
        `${logColor.blackBright("framework fullstack Node.js — HTTP · WS · ORM · IA")}\n`,
    );
  }

  /**
   * Affecte un groupe d'aide (`helpGroup`) à chaque commande pour un help
   * sectionné (Commander 15) : built-ins par catégorie statique ; commandes de
   * module regroupées sous leur module propriétaire (résolu via `module.commands`).
   */
  private assignHelpGroups(): void {
    const c = this.commander;
    if (!c) {
      return;
    }
    const builtin: Record<string, string> = {
      development: "Serveur",
      production: "Serveur",
      cluster: "Serveur",
      build: "Build & frontend",
      start: "Console / jobs",
      install: "Projet",
      outdated: "Projet",
    };
    // commande → module propriétaire (chaque Module garde ses commandes).
    const owner: Record<string, string> = {};
    const modules = this.kernel?.getModules?.() ?? {};
    for (const name in modules) {
      const cmds = (modules[name] as { commands?: Record<string, unknown> })
        .commands;
      if (cmds) {
        for (const cn in cmds) {
          owner[cn] = name;
        }
      }
    }
    for (const cmd of c.commands) {
      const n = cmd.name();
      const group = builtin[n] ?? (owner[n] ? `Module ${owner[n]}` : undefined);
      const hg = (cmd as { helpGroup?: (h: string) => unknown }).helpGroup;
      if (group && typeof hg === "function") {
        hg.call(cmd, group);
      }
    }
  }

  /**
   * Pied du help global : modules chargés (introspection — tous, y compris ceux
   * sans commande) + lien docs. Se termine par un seul `\n` (norme sortie CLI).
   */
  private printHelpFooter(): void {
    const modules = Object.keys(this.kernel?.getModules?.() ?? {}).filter(
      (m) => m !== "app",
    );
    if (modules.length) {
      console.log(
        `\n  ${logColor.cyanBold(`Modules chargés (${modules.length})`)}`,
      );
      console.log(`  ${logColor.blackBright(modules.join(" · "))}`);
    }
    console.log(
      `\n  ${logColor.blackBright("Docs :")} github.com/nodefony/nodefony-core` +
        `   ${logColor.blackBright("·")}   nodefony <cmd> -h\n`,
    );
  }

  /**
   * Définit le profil d'exécution du run (cf {@link IRunProfile}) — déclaré par les
   * commandes serveur/daemon. Le Kernel le recopie depuis `cli.runProfile` à `onStart`.
   *
   * @param profile - profil à appliquer (`servers`/`lifetime`/`interactive`).
   * @returns le profil appliqué.
   */
  setRunProfile(profile: IRunProfile): IRunProfile {
    this.runProfile = profile;
    if (this.kernel) {
      this.kernel.runProfile = profile;
    }
    return this.runProfile;
  }

  /**
   * Enregistre une commande CLI dans le registre du CliKernel + Commander.
   *
   * @param cliCommand - constructeur de la commande (signature `new (cli: CliKernel) => Command`).
   * @returns instance de la commande créée.
   */
  public override addCommand(
    cliCommand: new (cli: CliKernel) => Command,
  ): Command {
    const command = new cliCommand(this);
    this.commands[command.name] = command;
    return command;
  }

  /**
   * Charge dynamiquement un module ES depuis le filesystem local.
   *
   * Résout les chemins relatifs par rapport à `cwd`. Capture les erreurs d'import et les log
   * en ERROR avant de les re-throw.
   *
   * @param moduleName - chemin absolu OR relatif vers le module à importer.
   * @param cwd - racine pour résoudre `moduleName` (défaut `process.cwd()`).
   * @returns export default du module ou `null`.
   * @throws L'erreur d'import est re-throw après log.
   */
  async loadLocalModule<T>(
    moduleName: string,
    cwd: string = process.cwd(),
  ): Promise<ModuleWithDefault<T> | null> {
    try {
      const detectpath = path.isAbsolute(moduleName)
        ? moduleName
        : path.resolve(cwd, moduleName);
      const module = await import(detectpath);
      return module.default as ModuleWithDefault<T>;
    } catch (error) {
      this.log(error, "ERROR");
      throw error;
    }
  }

  /**
   * Configure le pipeline Syslog selon environnement et mode debug.
   *
   * Sans kernel attaché → délègue à {@link Cli.initSyslog} parent. Avec kernel :
   * - Sévérités `[0..6]` (EMERGENCY..INFO) toujours
   * - `+7` (DEBUG) si `debug === true` OR `this.debug`
   * - `+4, +5` (WARNING, NOTICE) si type === SERVER et env === development
   * - `commander.opts().json` truthy → mode silencieux (return immédiat)
   *
   * Le `pid` est ajouté en préfixe de chaque ligne SAUF en dev mono-process.
   *
   * @param environment - environnement (override de `this.environment`).
   * @param debug - active sévérité DEBUG (override de `this.debug`).
   * @param options - conditions de filtrage Syslog custom.
   */
  override initSyslog(
    environment?: EnvironmentType,
    debug?: DebugType,
    options?: conditionsInterface,
  ): void | null {
    if (!this.kernel) {
      return super.initSyslog(environment, debug, options);
    }
    if (this.commander && this.commander.opts().json) {
      return;
    }

    const { syslog } = this;
    // Boot SILENCIEUX (commande CLI utilitaire, cf quietBoot) : on coupe
    // NOTICE(5)/INFO(6) — le bruit de cycle de vie (MODULE ADD, ORM connected,
    // sessions…) — pour que la sortie de la commande (console.log) reste propre.
    // Seuls EMERGENCY..ERROR (0..3) surfacent. `-d/--debug` rétablit tout.
    // `debug` est résolu plus tard (preRegister) → on scanne argv ici (comme le bin
    // pour l'env) pour que `-d` lève le silence dès `loadApp`/initSyslog.
    const argvDebug =
      process.argv.includes("-d") || process.argv.includes("--debug");
    const data =
      this.quietBoot && !(debug || this.debug || argvDebug)
        ? [0, 1, 2, 3]
        : [0, 1, 2, 3, 4, 5, 6];
    if (debug || this.debug) {
      // INFO , DEBUG , WARNING
      data.push(7);
    }
    if (
      this.kernel.runProfile?.servers &&
      this.kernel.environment === "development"
    ) {
      // EMERGENCY ALERT CRITIC ERROR INFO WARNING
      data.push(4);
      data.push(5);
    }
    const conditions: conditionsInterface = {
      severity: {
        data,
      },
    };
    const format = Syslog.formatDebug(debug || this.debug);
    if (typeof format === "object") {
      conditions.msgid = {
        data: format,
      };
    }
    return syslog?.listenWithConditions(conditions, (pdu: Pdu) => {
      // En dev mono-process le pid pollue chaque ligne sans valeur ajoutée
      // (process unique, déjà connu via `ps`). En prod cluster il distingue
      // les workers — toujours préfixé.
      // `environment` est résolu dynamiquement : la sous-commande CLI le set
      // après `new CliKernel()`, donc figer au constructor ne marcherait pas.
      const pid =
        this.environment === "development" ? "" : this.pid?.toString();
      // rawLog = write direct sur process.stdout/stderr (1 write, sans overhead
      // console) → passe par le sink bufférisable (cf Syslog.setOutputBuffering).
      // normalizeLog passait par console.* → 1 syscall non coalescible/log.
      Syslog.rawLog(pdu, pid);
    });
  }

  /**
   * Arrêt propre — délègue à `kernel.terminate()` si kernel présent, sinon `super.terminate()`.
   *
   * @param code - exit code Unix (0 = succès, 1+ = erreur). Défaut `0`.
   * @param quiet - supprime les messages de terminaison si `true`.
   */
  override async terminate(code: number = 0, quiet?: boolean): Promise<void> {
    if (this.kernel) {
      await this.kernel.terminate(code);
      return;
    }
    return Promise.resolve(super.terminate(code, quiet));
  }
}

export type CommandConstructor = new (cli: CliKernel) => Command;

export default CliKernel;
