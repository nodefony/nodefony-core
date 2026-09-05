import path from "node:path";

import Syslog, { conditionsInterface } from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";
import { SysExit } from "../cli/sysexits";
import { toImportSpecifier } from "./resolveModuleEntry";
import Cli, { CliDefaultOptions, PackageManagerName } from "../Cli";
import Kernel, {
  IRunProfile,
  CONSOLE_RUN_PROFILE,
  TypeKernelOptions,
} from "./Kernel";
import Command from "../command/Command";
import Menu from "./commands/MenuCommand";
import Dev from "./commands/DevCommand";
import Build from "./commands/BuildCommand";
import Prod from "./commands/ProdCommand";
import Cluster from "./commands/ClusterCommand";
import Install from "./commands/InstallCommand";
import Outdated from "./commands/OutdatedCommand";
import Status from "./commands/StatusCommand";
import Check from "./commands/DoctorCommand";
import Inspect from "./commands/InspectCommand";
import Stop from "./commands/StopCommand";
import AiSync from "./commands/AiSyncCommand";
import AiMcp from "./commands/AiMcpCommand";
import GitHooks from "./commands/GitHooksCommand";
import {
  isStandaloneDevCommand,
  runStandaloneDevCommand,
} from "../service/dev/devStatusReport";
import {
  isDetachRequested,
  runDetachedStart,
} from "../service/dev/detachedStart";
import {
  buildCliManifest,
  writeCliManifest,
  runCompletionCommand,
  runCompleteQuery,
  type ICliManifest,
} from "../cli/completion";
import Completion from "./commands/CompletionCommand";
import Create from "./commands/CreateCommand";
import { runCreateCommand } from "../cli/create";
import { shouldColorize, usableWidth } from "./checks/report";
import {
  renderHelp,
  type IHelpCommand,
  type IHelpOption,
} from "../cli/helpReport";
import {
  isDoctorCommand,
  runDoctorCommand,
  runDoctorWithoutLive,
  wantsLiveDoctor,
} from "./checks/runDoctor";
import Env from "./commands/EnvCommand";
import { runEnvCommand } from "../cli/env";
import Card from "./commands/CardCommand";
import { runCardCommand } from "../cli/card";
import Symbols from "./commands/SymbolsCommand";
import { runSymbolsCommand } from "../cli/symbols";
import { runAiSyncCommand } from "../cli/aiSync";
import { runAiMcpCommand } from "../cli/aiMcp";
import { runGitHooksCommand } from "../cli/gitHooks";
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
   * Boot complet : instancie le Kernel, enregistre les commandes built-in, parse argv,
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
    // ─── Commandes SYSTÈME « standalone » (status/stop) : ZÉRO boot ─────────────
    // Pur outillage de process (ps + sonde ports + pidfile). Exécutées AVANT toute
    // construction de Kernel → aucun effet de bord (pas de `Nodefony.setKernel`, pas
    // de log de boot/terminate parasite) et lançables DEPUIS N'IMPORTE OÙ (hors d'un
    // projet Nodefony inclus). Même esprit que `--version` (résolu sans boot complet).
    const requested = this.getRequestedCommandName();
    if (requested !== null && isStandaloneDevCommand(requested)) {
      // Le code de sortie vient de la commande : un `stop` qui n'a pas su
      // désigner sa cible n'a rien arrêté — un script ne doit pas le lire comme
      // un succès.
      return process.exit(await runStandaloneDevCommand(requested));
    }

    // ─── `-v` / `--version` : standalone (0 Kernel, 0 log) ─────────────────────
    // La version est une DONNÉE, pas une exécution : sa sortie doit être la seule
    // ligne écrite (`VERSION=$(nodefony -v)` est un usage légitime). Passer par
    // commander construisait un Kernel dont le `terminate(0)` loggait une ligne
    // INFO par-dessus le numéro de version.
    if (this.isVersionRequested()) {
      process.stdout.write(`${version}\n`);
      return process.exit(0);
    }

    // ─── Complétion shell : `completion <shell>` (script) + `__complete` (TAB) ──
    // Standalone (0 boot, millisecondes — un TAB ne boote jamais un kernel) : la
    // donnée vient du manifest cache écrit au boot dev (commandes de module
    // incluses), fallback built-ins construits en mémoire hors projet.
    if (requested === "completion") {
      return process.exit(runCompletionCommand(process.argv));
    }
    if (requested === "__complete") {
      return process.exit(
        runCompleteQuery(process.argv, () => this.buildBuiltinManifest()),
      );
    }

    // ─── Scaffold : `create <type> <name>` — même famille standalone ──────────
    // Cas nominal = HORS de tout projet (`npx nodefony create app mon-app`) : il
    // n'y a RIEN à booter (pas de nodefony.config.ts). Templates shippés npm.
    // Async : le mode interactif (TTY) pose les questions de la spec en readline.
    if (requested === "create") {
      return process.exit(await runCreateCommand(process.argv));
    }

    // ─── `check` : contrôle de la surface des paquets — même famille ─────────
    // Il ne lit que des fichiers (`package.json` + sources). Le faire booter
    // coûtait un démarrage complet pour une réponse qui n'en dépend pas, noyait
    // le rapport sous le journal du Kernel, et le rendait inutilisable sur une
    // application qui justement ne démarre plus.
    // `check` est l'ALIAS de `doctor` (cf `DoctorCommand`) : il doit prendre le
    // même fast-path, sinon commander ne le voit pas parmi les built-ins avant
    // le chargement des modules et il partirait en dispatch différé — donc en
    // boot, précisément ce que ce raccourci évite.
    // ⚠️ `--live` SORT du fast-path, et c'est tout son sujet : l'étage 2
    // demande à l'APPLICATION (migrations, cohérence des zones), donc il faut
    // qu'elle ait démarré. Le raccourci reste la voie par défaut — celle qui
    // répond quand rien ne démarre —, et le boot ne se paie que s'il est
    // explicitement demandé.
    if (
      isDoctorCommand(requested) &&
      !wantsLiveDoctor(requested, process.argv)
    ) {
      return process.exit(await runDoctorCommand(process.argv));
    }

    // ─── `env` : la cascade des `.env` + les variables déclarées — même famille ─
    // Même raison que `check`, en plus tranchée : on cherche une variable
    // d'environnement précisément quand l'app NE démarre pas (requise manquante,
    // valeur qui ne prend pas). La faire booter la rendrait muette au seul
    // moment où elle sert.
    if (requested === "env") {
      return process.exit(await runEnvCommand(process.argv));
    }

    // ─── `card` : la carte de visite — même famille, et pour DEUX raisons ─────
    // C'est la première commande lancée dans une application qu'on ne connaît
    // pas : elle ne peut avoir aucune condition d'accès. Or elle en avait deux,
    // toutes deux constatées sur une app fraîchement générée.
    //   1. L'app n'est pas encore CONSTRUITE — `diagnoseUnbootableProject` répond
    //      « lance npm run build » à toute commande qui exige un Kernel, donc
    //      exactement au moment où l'on cherche par où commencer.
    //   2. Le terminal n'a pas posé `NODE_ENV` — la carte était portée par une
    //      commande du module `@nodefony/devkit`, `policy: "dev"` : hors
    //      développement le module n'est pas chargé, la commande n'EXISTE pas et
    //      le CLI répond `unknown command`, sans piste.
    // Ne lisant que des fichiers, ce fast-path répond dans les quatre cas (app
    // construite ou non, environnement posé ou non) — et il DIT ce qu'il ne peut
    // pas savoir sans boot : installés ≠ chargés (cf `renderCard`).
    // `devkit:card` reste reconnu : c'est le nom d'origine, déjà écrit dans les
    // `AGENTS.md` générés. Comme `doctor` pour `check`, l'alias DOIT partager le
    // fast-path, sinon il partirait en dispatch différé — donc en boot.
    if (requested === "card" || requested === "devkit:card") {
      return process.exit(runCardCommand(process.argv, version));
    }

    // ─── `symbols` : le graphe symbolique — même famille ──────────────────────
    // C'est une lecture de JSON. La faire passer par un boot coûterait un
    // démarrage complet pour répondre « où est défini ce symbole ? », et
    // rendrait muette la question précisément quand l'application ne démarre
    // plus — le moment où l'on cherche justement ce que fait une classe.
    if (requested === "symbols") {
      return process.exit(runSymbolsCommand(process.argv));
    }

    // ─── `ai:sync` : les skills d'agent livrés par les paquets — même famille ──
    // Elle ne lit et n'écrit que des fichiers. Et surtout, elle DOIT répondre
    // dans un terminal qui n'a pas posé `NODE_ENV` : portée par une commande du
    // module `@nodefony/devkit` (`policy: "dev"`), elle n'aurait pas existé là —
    // le CLI aurait répondu `unknown command`, exactement le défaut qui a fait
    // remonter `card` dans le cœur. Le CONTENU des skills reste dans les
    // paquets (il se met à jour par npm) ; seul le VERBE vit ici.
    if (requested === "ai:sync") {
      return process.exit(runAiSyncCommand(process.argv));
    }

    // ─── `ai:mcp` : le CÂBLAGE du serveur MCP, même famille ───────────────────
    // Elle n'écrit qu'un fichier (`.mcp.json`) et ne démarre RIEN : le serveur
    // MCP est une route de l'application (`POST /nodefony/mcp`), pas un process.
    // Standalone pour la même raison que `ai:sync` — la route est servie par un
    // module `policy: "dev"`, donc invisible à un terminal sans `NODE_ENV`.
    if (requested === "ai:mcp") {
      return process.exit(await runAiMcpCommand(process.argv));
    }

    // ─── `git:hooks` : hooks git natifs (core.hooksPath), même famille ────────
    // Deux fichiers sh + une clé de config, aucun boot — et JAMAIS de
    // postinstall : la pose de hooks est un choix explicite, pas un effet de
    // bord d'un `npm install`.
    if (requested === "git:hooks") {
      return process.exit(runGitHooksCommand(process.argv));
    }

    // ─── Lancement DÉTACHÉ (`<runtime> --detach`) : même famille standalone ────
    // Spawn détaché + readiness (sonde ports) + health + exit code sémantique —
    // l'expérience du script start.sh absorbée nativement (cf detachedStart.ts).
    // AUCUN boot dans CE process (le child boote, lui, normalement) ; le marqueur
    // env DETACH_CHILD coupe toute récursion. Borné aux commandes RUNTIME (la
    // readiness = ports en écoute n'a aucun sens pour build/install…) — un
    // `--detach` ailleurs suit le flux normal et sera rejeté par commander.
    const DETACHABLE = new Set([
      "development",
      "dev",
      "production",
      "prod",
      "cluster",
    ]);
    if (
      requested !== null &&
      DETACHABLE.has(requested) &&
      isDetachRequested(process.argv.slice(2))
    ) {
      const code = await runDetachedStart(process.argv);
      return process.exit(code);
    }

    this.kernel = new Kernel(this.environment, this, options);
    try {
      if (this.commander) {
        this.registerBuiltinCommands();
        // Boot SILENCIEUX de la commande DEMANDÉE — et d'elle seule.
        //
        // Le journal de cycle de vie n'est pas la sortie d'une commande :
        // `nodefony inspect modules` rendait trente lignes de `MODULE ADD`, de
        // stores résolus et d'un avertissement TLS avant son tableau. La règle
        // ne peut PAS vivre dans le constructeur de la commande — il s'exécute
        // pour toutes les invocations, et rendrait muet le serveur de dev. On
        // l'applique donc ici, une fois les intégrées enregistrées et le nom
        // demandé connu, avant que le Kernel ne démarre son journal.
        if (requested !== null && this.getCommand(requested)?.quietBoot) {
          this.quietBoot = true;
        }
        this.commander.exitOverride();
        // Le nom du PROGRAMME, pas celui du service : `this.name` vaut
        // « NODEFONY » parce que le syslog s'en sert comme identifiant de
        // message. Le donner à commander faisait afficher « Usage: NODEFONY »,
        // et la faute se propageait à l'aide de chaque sous-commande.
        this.commander.name("nodefony");
        this.commander.showHelpAfterError(false);
        this.commander.showSuggestionAfterError(true);
        this.commander.configureHelp({
          //sortSubcommands: true,
          sortOptions: true,
          showGlobalOptions: true,
          // Le nom, et SES ALIAS — jamais la « short usage » de commander, qui
          // ajoute les arguments et élargit la colonne. Rendre `cmd.name()` seul
          // rendait tous les alias INVISIBLES (`check|doctor`, et les autres
          // avant lui) : un alias qui n'apparaît nulle part n'existe pas pour
          // celui qui lit l'aide — c'est le seul endroit où il se découvre.
          subcommandTerm: (cmd) => {
            const aliases = cmd.aliases?.() ?? [];
            return aliases.length
              ? `${cmd.name()}|${aliases.join("|")}`
              : cmd.name();
          },
          // formatHelp: (cmd, help) => {
          //   return cmd.helpInformation();
          //   //return this.cli?.commander?.help();
          // },
        });

        // ─── HELP GLOBAL enrichi : modules chargés AVANT l'affichage ──────────
        // `nodefony`, `nodefony --help`, `nodefony -h` → on veut lister AUSSI les
        // commandes de module (`frontend:build`, `network`, …), pas seulement les
        // built-ins. Or les modules ne posent leurs commandes qu'à `onPreRegister`.
        // On boote donc le kernel jusqu'à cette phase (mode CONSOLE, 0 serveur),
        // PUIS on affiche le help complet et on `terminate(0)`. `--version` n'est
        // PAS concerné (résolu par commander sans boot, cf le `.catch` plus bas).
        // `nodefony` NU dans un terminal → le MENU interactif : taper le nom
        // seul est une question (« qu'est-ce que je peux faire ici ? »), pas
        // une demande de documentation. On POUSSE `menu` dans argv et on laisse
        // le flux normal parser — aucun chemin parallèle. Le help global reste
        // servi hors TTY (CI, scripts — prompter y est absurde) et sur demande
        // explicite (`-h` / `--help`). Le TTY se lit sur `kernel.isTTY`
        // (source unique, `NF_NO_TTY` respecté — les tests forcent ainsi le help).
        if (process.argv.slice(2).length === 0 && this.kernel?.isTTY) {
          process.argv.push("menu");
        }
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
        if (
          requested !== null &&
          !this.getBuiltinCommandNames().has(requested)
        ) {
          return this.dispatchModuleCommand(requested);
        }

        // Distingue un argv REFUSÉ d'un boot qui MEURT : les deux arrivent dans
        // le même `catch`, et `doctor --live` ne doit rattraper que le second.
        let booting = false;
        return this.commander
          ?.parseAsync()
          .then(async () => {
            if (!this.kernel) throw new Error(`Kernel not found`);
            booting = true;
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
            // Erreur déjà PRÉSENTÉE (ex. config invalide via Kernel.bootConfigError) →
            // ne pas re-logger une stack brute par-dessus le diagnostic clair ; le
            // code de sortie est celui porté par l'erreur (EX_CONFIG) sinon 1.
            const err = e as { presented?: boolean; exitCode?: number };

            // ─── `doctor --live` : le boot est mort, le RAPPORT reste dû ─────
            // C'est le cas pour lequel l'outil existe. Sans ce chemin, celui
            // qui tape `--live` parce que « ça ne démarre plus » obtenait une
            // pile brute et RIEN d'autre — donc moins qu'avec `doctor` nu. Le
            // bilan de l'abandon est déjà écrit (`Kernel.start` le fige avant
            // de relancer), l'étage 1 le lira ; l'étage 2 devient un état
            // d'exécution lisible plutôt qu'une absence.
            if (booting && wantsLiveDoctor(requested, process.argv)) {
              const cause =
                e instanceof Error ? e.message : String(e ?? "cause inconnue");
              const reportCode = await runDoctorWithoutLive(
                process.argv,
                `l'application n'a pas démarré — ${cause}`,
                "corrige la cause ci-dessus, puis relance `nodefony doctor --live`",
              );
              return this.kernel?.terminate(reportCode) as Promise<Kernel>;
            }

            if (!err.presented) {
              this.log(e, "ERROR");
            }
            await this.kernel?.terminate(err.exitCode ?? 1);
            throw e;
          });
      }

      throw new Error(`Commander not found`);
    } catch (e) {
      // Erreur déjà présentée (diagnostic clair émis en amont) → pas de re-log stack.
      if (!(e as { presented?: boolean }).presented) {
        this.log(e, "ERROR");
      }
      throw e;
    }
  }

  /**
   * Enregistre les commandes built-in dans commander (idempotent : skip si déjà
   * fait). Ordre = ordre des groupes dans le help (Commander rend les groupes dans
   * l'ordre de 1ʳᵉ rencontre) : Serveur → Build → Projet → Console/jobs.
   * Partagé entre `start()` et le fallback de complétion (built-ins sans boot).
   */
  registerBuiltinCommands(): void {
    if (this.commands["development"]) {
      return;
    }
    this.addCommand(Dev);
    this.addCommand(Prod);
    this.addCommand(Cluster);
    this.addCommand(Build);
    this.addCommand(Install);
    this.addCommand(Outdated);
    this.addCommand(Menu);
    this.addCommand(Status);
    this.addCommand(Stop);
    this.addCommand(Completion);
    this.addCommand(Create);
    this.addCommand(Check);
    this.addCommand(Env);
    this.addCommand(Card);
    this.addCommand(Symbols);
    this.addCommand(Inspect);
    // Standalone servis par le fast-path : ces classes n'existent que pour le
    // help et la complétion (leur `generate()` est un filet) — sans elles, une
    // commande bien réelle est INVISIBLE de `nodefony -h`, donc de personne.
    this.addCommand(AiSync);
    this.addCommand(AiMcp);
    this.addCommand(GitHooks);
  }

  /**
   * Écrit le manifest de complétion shell (cache par projet) depuis l'état COURANT
   * de commander — appelé par le Kernel à `onPreRegister` en dev, une fois les
   * commandes de module posées. Best-effort côté appelant (fire-and-forget).
   */
  async writeCompletionManifest(cwd: string = process.cwd()): Promise<void> {
    if (!this.commander) {
      return;
    }
    await writeCliManifest(this.commander, cwd, version);
  }

  /**
   * Manifest de complétion construit en MÉMOIRE depuis commander (sans cache) —
   * fallback du fast-path `__complete` hors projet.
   */
  buildBuiltinManifest(): ICliManifest {
    this.registerBuiltinCommands();
    return buildCliManifest(this.commander as commanderCommand, version);
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
   * `true` si l'invocation demande la **version globale** : `nodefony -v` ou
   * `nodefony --version` (que des options, aucun positionnel).
   *
   * Un positionnel présent → la commande décide (`nodefony dev --version` n'est pas
   * une demande de version du CLI) : on laisse commander trancher.
   *
   * @returns `true` si la version du CLI est demandée.
   */
  private isVersionRequested(): boolean {
    const args = process.argv.slice(2);
    for (const arg of args) {
      if (!arg.startsWith("-")) {
        return false;
      }
    }
    return args.includes("-v") || args.includes("--version");
  }

  /**
   * `true` si l'invocation demande le **help global** : `nodefony` nu,
   * `nodefony --help` ou `nodefony -h` (que des options, aucun positionnel).
   *
   * Exclut volontairement `--version` (fast-path standalone, cf `isVersionRequested`)
   * et `nodefony <cmd> --help` (help d'une sous-commande, laissé à commander / au
   * dispatch de module — il y a un positionnel).
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
  public getBuiltinCommandNames(): Set<string> {
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
  private async dispatchGlobalHelp(): Promise<Kernel> {
    const kernel = this.kernel as Kernel;
    // Help global → boot silencieux (aucun log de cycle de vie ne pollue le help).
    this.quietBoot = true;

    // ─── Rien à booter ICI : on décide AVANT, jamais dans un `catch` ─────────
    // `Kernel.startBoot` ne LÈVE pas quand il n'y a pas d'application : il
    // `terminate(1)` (hors TTY) ou ouvre le menu. Un repli greffé sur un rejet
    // ne pouvait donc jamais s'exécuter — et `nodefony --help` hors d'un projet
    // rendait un CRITIC et code 1, exactement là où quelqu'un découvre l'outil
    // et cherche `create app`.
    if ((await kernel.isTrunk()) === null) {
      return this.renderStandaloneHelp(kernel);
    }

    let shown = false;
    const render = async (): Promise<void> => {
      if (!shown) {
        shown = true;
        // Le manifest s'écrit ICI, et pas dans `Kernel.preRegister` comme pour
        // tout autre boot : ce rendu EST posé sur `onPreRegister`, il termine le
        // process, et la ligne d'écriture placée après le fire n'est jamais
        // atteinte. Or c'est précisément le help qui tient l'état complet — les
        // commandes de module viennent d'être posées — et c'est le geste par
        // lequel un humain découvre le CLI. Sans ça, le menu (qui relit ce
        // fichier) restait amputé chez qui n'avait jamais démarré l'application.
        // Best-effort, jamais bloquant : un help ne doit pas dépendre du disque.
        await this.writeCompletionManifest().catch(() => {});
        this.writeHelp();
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
   * L'aide des commandes INTÉGRÉES, sans démarrer quoi que ce soit.
   *
   * Le repli de {@link dispatchGlobalHelp} quand il n'y a pas d'application à
   * interroger : hors de tout projet, ou dans une application qui n'est pas
   * encore installée ni construite. Les commandes de module manqueront —
   * personne ne peut les connaître sans charger les modules — et c'est dit.
   *
   * Sort en **0** : demander de l'aide n'est pas une erreur, et un code 1
   * casse un `nodefony --help | less` autant qu'un script d'installation.
   *
   * @param kernel - le kernel, terminé après l'affichage.
   * @returns le kernel.
   */
  private async renderStandaloneHelp(kernel: Kernel): Promise<Kernel> {
    // La raison, puis le geste : un utilisateur qui découvre l'outil vient
    // d'installer le paquet et n'a rien d'autre à taper que la ligne suivante.
    // Une application présente mais non installée reçoit SON geste à elle —
    // `diagnoseUnbootableProject` les distingue déjà, et lui dire « crée une
    // application » alors qu'il en a une serait le renvoyer au mauvais endroit.
    const hint = kernel.diagnoseUnbootableProject();
    this.writeHelp(
      hint
        ? { note: hint.split("\n").join(" ") }
        : {
            note:
              "hors d'une application Nodefony : seules les commandes " +
              "intégrées sont listées.",
            noteAction: "nodefony create app <nom>",
          },
    );
    // `quiet` : rien n'a démarré, donc rien ne se termine du point de vue de
    // l'utilisateur. Le kernel n'ayant pas booté, son journal n'a jamais été
    // muselé par `quietBoot` — sans ce drapeau, un « terminate : 0 » venait
    // s'écrire au pied d'une aide qu'on lit ou qu'on redirige.
    return (await kernel.terminate(SysExit.OK, true)) as Kernel;
  }

  /**
   * Les commandes qui répondent en JSON — la seule chose qu'un agent cherche
   * d'abord, et que rien n'affichait.
   *
   * Écrite ici plutôt que dérivée d'un `--json` cherché dans les options : la
   * moitié des commandes en portent un pour un usage local (un fragment, un
   * fichier), et les lister toutes noierait celles qui rendent un DOCUMENT
   * exploitable. La liste est courte et se relit d'un coup d'œil.
   */
  private static readonly JSON_COMMANDS: readonly string[] = [
    "doctor --json",
    "inspect <sujet> --json",
    "env --json",
    "card --json",
  ];

  /**
   * Compose le modèle d'aide depuis commander, et l'écrit.
   *
   * 🔴 Le modèle se lit sur COMMANDER, jamais sur `cli.commands` : les
   * commandes de module ne sont pas dans ce registre (elles s'enregistrent
   * directement dans commander depuis `Module`), et c'est ce trou qui faisait
   * déjà perdre des commandes au menu. Le groupe voyage donc avec la commande,
   * posé par son constructeur (`OptionsCommandInterface.helpGroup`).
   *
   * @param extra - une note de situation, quand l'aide est rendue hors d'une
   *   application ou dans une application non installée.
   */
  private writeHelp(extra?: { note?: string; noteAction?: string }): void {
    const c = this.commander;
    let shownVersion = "";
    try {
      const v: unknown = c?.version();
      if (typeof v === "string") shownVersion = v;
    } catch {
      /* commander sans version — ignore */
    }

    // Le module PROPRIÉTAIRE d'une commande : il ne sert qu'à ranger celles qui
    // ne déclarent aucun groupe d'intention — un module tiers, dont personne
    // ici ne peut deviner l'intention.
    const owner: Record<string, string> = {};
    const modules = this.kernel?.getModules?.() ?? {};
    for (const name in modules) {
      const cmds = (modules[name] as { commands?: Record<string, unknown> })
        .commands;
      for (const cn in cmds ?? {}) owner[cn] = name;
    }

    const commands: IHelpCommand[] = (c?.commands ?? [])
      // `help` est la commande que commander ajoute lui-même : elle fait double
      // emploi avec `--help`, qu'on est en train de lire.
      .filter((cmd) => cmd.name() !== "help")
      .map((cmd) => {
        const group = (
          cmd as { helpGroup?: (h?: string) => unknown }
        ).helpGroup?.();
        // Ce que la commande ACCEPTE : dérivé des `choices()` de son premier
        // argument, jamais recopié — une liste réécrite ici divergerait au
        // premier sujet ajouté.
        const arg = cmd.registeredArguments?.[0] as
          { name(): string; argChoices?: string[] } | undefined;
        const values = arg?.argChoices ?? [];
        const entry: IHelpCommand = {
          name: cmd.name(),
          aliases: cmd.aliases?.() ?? [],
          description: cmd.description() || "",
        };
        if (typeof group === "string" && group) entry.group = group;
        const module = owner[cmd.name()];
        if (module) entry.module = module;
        if (values.length) {
          entry.accepts = { label: arg?.name() ?? "valeurs", values };
        }
        return entry;
      });

    const globalOptions: IHelpOption[] = (c?.options ?? [])
      .map((o) => ({ flags: o.flags, description: o.description }))
      // `-h, --help` est posé par commander lui-même et n'apparaît pas dans
      // `options` : l'omettre ferait disparaître de l'aide le drapeau qu'on
      // vient de taper.
      .concat([{ flags: "-h, --help", description: "affiche cette aide" }])
      .sort((a, b) => a.flags.localeCompare(b.flags));

    const loaded = Object.keys(modules).filter((m) => m !== "app");
    const out = process.stdout;
    const lines = renderHelp(
      {
        version: shownVersion,
        commands,
        globalOptions,
        ...(loaded.length ? { modules: loaded } : {}),
        jsonCommands: CliKernel.JSON_COMMANDS,
        ...(extra?.note ? { note: extra.note } : {}),
        ...(extra?.noteAction ? { noteAction: extra.noteAction } : {}),
      },
      {
        width: usableWidth(out.columns),
        // UNE seule porte de couleur pour toute la page. Il y en avait deux
        // (`logColor` pour l'en-tête, commander pour le corps), donc deux
        // lectures de `NO_COLOR` — et un `NF_NO_TTY` respecté d'un côté
        // seulement, ce dont les tests d'intégration dépendent.
        color: shouldColorize(process.env, Boolean(this.kernel?.isTTY)),
      },
    );
    out.write(`${lines.join("\n")}\n`);
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
   * Point UNIQUE de résolution d'une commande matchée — appelé par le callback
   * commander de {@link Command} (parse pur : le match ne fait que signaler) et par
   * `StartCommand` (sélection interactive).
   *
   * Fait, dans l'ordre :
   * 1. lie la commande au Kernel (`kernel.command` / `kernel.commandArgs`) ;
   * 2. applique le **profil déclaré** (`command.runProfile`) s'il existe —
   *    `setRunProfile` resynchronise AUSSI `kernel.runProfile`, donc une commande
   *    résolue APRÈS `onStart` (commande de module, posée à `onPreRegister`) peut
   *    être serveur : la décision de monter les serveurs se joue plus tard
   *    (`onReady → initServers`) ;
   * 3. câble les hooks lifecycle + l'exécution à `kernelEvent` (`setEvents`).
   *
   * @param command - commande matchée.
   * @param args - arguments produits par le parse commander.
   */
  resolveCommand(command: Command, args: unknown[]): void {
    const kernel = this.kernel as Kernel;
    kernel.command = command;
    kernel.commandArgs = args;
    if (command.runProfile) {
      // Copie défensive : le profil déclaré est un littéral partagé par toutes les
      // instances de la commande — ne jamais laisser le runtime muter la déclaration.
      this.setRunProfile({ ...command.runProfile });
    }
    command.setEvents(...args);
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
      const module = await import(toImportSpecifier(detectpath));
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
   * - mode MACHINE (`--json`) ou {@link quietBoot} → `[0..3]` seulement, que
   *   `Syslog.rawLog` dirige vers la sortie d'erreur : le flux de données reste
   *   pur, et un échec reste lisible.
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
    const { syslog } = this;
    // Boot SILENCIEUX (commande CLI utilitaire, cf quietBoot) : on coupe
    // NOTICE(5)/INFO(6) — le bruit de cycle de vie (MODULE ADD, ORM connected,
    // sessions…) — pour que la sortie de la commande (console.log) reste propre.
    // Seuls EMERGENCY..ERROR (0..3) surfacent. `-d/--debug` rétablit tout.
    // `debug` est résolu plus tard (preRegister) → on scanne argv ici (comme le bin
    // pour l'env) pour que `-d` lève le silence dès `loadApp`/initSyslog.
    const argvDebug =
      process.argv.includes("-d") || process.argv.includes("--debug");
    // Mode MACHINE : la sortie standard appartient aux données, le journal doit
    // s'écarter — `Syslog.rawLog` n'envoie sur `stderr` que les sévérités ≤ 3,
    // au-dessus il écrit sur `stdout` et casserait un `| jq`.
    //
    // La détection passe par argv, et c'est le SEUL endroit où elle peut être
    // juste : `--json` est déclaré sur la sous-commande (`inspect`), donc
    // `commander.opts()`, qui rend les options du programme RACINE, ne le voit
    // jamais. Une garde écrite sur `opts().json` a vécu ici sans s'exécuter une
    // seule fois — verte sous un test unitaire qui posait la valeur à la main, et
    // muette sur le seul cas qui comptait (cf BUG_REPORT, BUG-1).
    //
    // Même règle que `quietBoot`, donc même branche : un seul filtre à maintenir.
    const argvMachine =
      process.argv.includes("--json") || process.argv.includes("-j");
    const data =
      (this.quietBoot || argvMachine) && !(debug || this.debug || argvDebug)
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
    // 🔴 REMPLACER, pas empiler. `listenWithConditions` AJOUTE un abonné : un
    // second appel posait un filtre restrictif par-dessus l'ancien, resté
    // actif — et l'ancien continuait d'écrire les INFO. Symptôme : une commande
    // choisie AU MENU déclarait `quietBoot`, on réinitialisait le syslog, et le
    // journal de boot sortait quand même. `Syslog.init()` prend déjà cette
    // précaution (`removeAllListeners("onLog")`) ; ici elle manquait.
    syslog?.removeAllListeners("onLog");
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
      await this.kernel.terminate(code, quiet);
      return;
    }
    return Promise.resolve(super.terminate(code, quiet));
  }
}

export type CommandConstructor = new (cli: CliKernel) => Command;

export default CliKernel;
