import path from "node:path";

import Syslog, { conditionsInterface } from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";
import Cli, { CliDefaultOptions, PackageManagerName } from "../Cli";
import Kernel, { KernelType, TypeKernelOptions } from "./Kernel";
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
  public type: KernelType = "CONSOLE";
  public app: Module | null = null;
  public packageManager: PackageManager = this.pnpm;
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
        this.addCommand(Start);
        this.addCommand(Dev);
        this.addCommand(Build);
        this.addCommand(Prod);
        this.addCommand(Cluster);
        this.addCommand(Install);
        this.addCommand(Outated);
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

        // ─── Commandes de MODULE : dispatch DIFFÉRÉ ──────────────────────────
        // Les built-ins ci-dessus sont les seules commandes connues de commander
        // à ce stade. Les commandes de module (`frontend:build`, `network`, …) ne
        // sont posées qu'à `onPreRegister` (par les modules via le décorateur
        // @modules). Si la commande demandée n'est pas un built-in, parser argv
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
   * commander ignore la commande au boot (posée par le module à `onPreRegister`
   * via @modules). On parse donc argv depuis un listener `onPreRegister` lui-même
   * posé via `onStart` : `loadApp()` (qui pose le listener @modules) précède
   * `onStart`, et `emitAsync` est séquentiel → notre listener tourne APRÈS celui
   * de @modules, donc quand toutes les commandes de module sont connues, mais
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
            await this.kernel?.terminate(0);
            return;
          }
          this.log(`command not found: ${requested}`, "ERROR");
          await this.kernel?.terminate(1);
        }
      });
    });
    return kernel.start().catch(async (e) => {
      await this.kernel?.terminate(1);
      throw e;
    });
  }

  /**
   * Définit le type de kernel — `"CONSOLE"` (commands pures) vs `"SERVER"` (démarre HTTP/WS).
   *
   * @param type - `"CONSOLE"` | `"SERVER"`. Auto-uppercase.
   * @returns le type définitif (uppercase).
   */
  setType(type: KernelType): string {
    const ele = type.toLocaleUpperCase() as KernelType;
    return (this.type = ele);
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
    const data = [0, 1, 2, 3, 4, 5, 6];
    if (debug || this.debug) {
      // INFO , DEBUG , WARNING
      data.push(7);
    }
    if (
      this.kernel.type === "SERVER" &&
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
