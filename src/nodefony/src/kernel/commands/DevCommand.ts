import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import BootReporter from "../../service/dev/BootReporter";
import {
  DEV_BUILD_ISSUE_ENV,
  devBuildIssueNotice,
  OUTPUT_MODES,
  readOutputFlag,
  reloadCount,
  resolveOutputMode,
  type StartupOutputMode,
} from "../../service/dev/outputMode";
import { SysExit } from "../../cli/sysexits";
import { enableDevSourceMaps } from "../../service/dev/sourceMaps";
import { isLoopbackHostname } from "../../Tools";
import Syslog, { STDERR_LOG_SINK } from "../../syslog/Syslog";
import {
  openDevInspector,
  parseInspectArgs,
  type IDevInspectRequest,
} from "../../service/dev/devInspector";

const options: OptionsCommandInterface = {
  helpGroup: "LANCER",
  showBanner: false,
  kernelEvent: "onPostReady",
};

/** Variable d'env distinguant le serveur enfant du process superviseur parent. */
const CHILD_ENV = "NF_DEV_CHILD";

/**
 * `true` si l'invocation demande un mode développement SANS superviseur.
 *
 * Lu sur `argv` et non sur les options analysées, comme `--detach` : ce choix décide
 * de la topologie du process, donc il se tranche AVANT que Commander n'ait rendu la
 * main. Fonction PURE (l'argv est passé) — elle s'éprouve sans lancer de serveur.
 *
 * @param args - `process.argv` ou son équivalent de test.
 */
export function isWatchDisabled(args: readonly string[]): boolean {
  return args.includes("--no-watch");
}

/**
 * Commande `nodefony development` — serveur en mode dev (front Vite/HMR + auto-restart).
 *
 * **Invariant non négociable : `development` = TOUJOURS 1 process.** La molette
 * topologie (`cluster.workers` / `--workers` / `NF_WORKERS`) est **ignorée** en
 * dev : Vite exige un process maître unique (conflit port HMR si N workers spawnaient
 * chacun leur Vite). Le multi-process se règle uniquement sur le runtime prod
 * (`nodefony cluster`). Cf décision « 2 molettes » 2026-05-24.
 *
 * Le seul « 2ᵉ process » en dev est le couple superviseur/enfant du {@link DevSupervisor}
 * (auto-restart au changement de source backend) — ce n'est PAS du cluster.
 */
class Dev extends Command {
  #reporter: BootReporter | null = null;
  /**
   * URL du débogueur ouvert dans le serveur — `null` sans `--inspect` ni
   * `nodefony debug`. Le bilan la garde à l'écran : l'annonce de Node défile,
   * et l'écran est remis à zéro quand tout va bien.
   */
  #inspectorUrl: string | null = null;

  /**
   * @param cli - le CLI hôte.
   * @param name - nom de la commande ; une sous-classe ({@link Debug}) en change
   *   l'intention sans dupliquer le pipeline.
   * @param description - ligne d'aide.
   */
  constructor(
    cli: CliKernel,
    name = "development",
    description = "démarre en développement, rechargement automatique",
  ) {
    super(name, description, cli, options);
    if (name === "development") this.alias("dev");
    // Options du lancement DÉTACHÉ — consommées par le fast-path standalone de
    // CliKernel.start (detachedStart.ts), déclarées ici pour le help + pour que
    // commander ne les rejette pas si le fast-path est court-circuité.
    this.addOption(
      "--detach",
      "spawn détaché + attente readiness (ports) + exit 0/69",
    );
    this.addOption("--wait <sec>", "plafond d'attente readiness (défaut 120)");
    this.addOption("--health <path>", "GET de santé post-boot (best-effort)");
    this.addOption("--log <file>", "log du runtime détaché (défaut tmp/)");
    this.addOption(
      "--no-watch",
      "développement SANS superviseur : un seul process, aucun rechargement automatique",
    );
    // Lues par `parseInspectArgs` sur argv, dans le SERVEUR : déclarées pour le help
    // et pour que commander ne les rejette pas.
    // Lue sur argv (`readOutputFlag`) avant que commander ne rende la main : le
    // splash en dépend. Déclarée pour le help et pour que commander l'accepte.
    this.addOption(
      "--output <mode>",
      `rendu du démarrage : ${OUTPUT_MODES.join(" | ")} (défaut : human dans un terminal, plain sinon ; aussi NF_OUTPUT)`,
    );
    this.addOption(
      "--inspect [host:port]",
      "ouvre le débogueur dans le serveur (défaut 127.0.0.1:9229)",
    );
    this.addOption(
      "--inspect-brk [host:port]",
      "idem, et attend le débogueur avant de charger l'application",
    );
  }

  /**
   * Boot de rêve dev : checklist animée par phase (spinner + ✓/✗) à la place du mur
   * de logs, et piles d'appels traduites vers les sources `.ts`. Branché AVANT
   * `loadApp` (gros import) pour couvrir le gap de feedback.
   * **Enfant supervisé uniquement** (`NF_DEV_CHILD=1`) : le superviseur parent
   * ne boote pas de serveur → aucun affichage. Animation TTY non-debug ; debug/non-TTY
   * → marqueurs statiques + logs bruts (cf {@link BootReporter}).
   */
  override async onKernelPreStart(): Promise<void> {
    const supervised = process.env[CHILD_ENV] === "1";
    if (!supervised && !isWatchDisabled(process.argv)) return;
    if (!supervised) {
      // `--no-watch` : personne n'a bâti avant nous. Même garantie que l'enfant
      // supervisé — jamais de boot sur un `dist` périmé ou sans maps —, par la même
      // implémentation, AVANT que `loadApp` n'importe l'application.
      const { default: DevSupervisor } =
        await import("../../service/dev/DevSupervisor");
      await new DevSupervisor({
        cwd: process.cwd(),
        childEnvKey: CHILD_ENV,
      }).ensureBuilt();
    }
    // Piles d'appels vers le `.ts` de l'application (maps du build de dev). ICI et
    // pas à `onKernelStart` : Node n'analyse les maps que des fichiers chargés APRÈS
    // l'activation, et `loadApp` importe l'application entre les deux hooks.
    enableDevSourceMaps();
    // Débogueur du SERVEUR — ici pour la même raison que les maps : avant `loadApp`,
    // sans quoi `--inspect-brk` s'arrêterait après le chargement de l'application.
    const inspect = parseInspectArgs(process.argv) ?? this.defaultInspect();
    if (inspect) {
      const opened = openDevInspector(inspect);
      if (opened.supported && !isLoopbackHostname(inspect.host)) {
        // Sur stderr, sans condition de verbosité : ce n'est pas un détail.
        process.stderr.write(
          `⚠️  [debug] débogueur EXPOSÉ sur ${inspect.host}:${inspect.port} — ` +
            `quiconque joint ce port exécute du code dans le serveur. ` +
            `À réserver à un conteneur dont le port n'est publié que sur 127.0.0.1.\n`,
        );
      }
      if (opened.supported) {
        this.#inspectorUrl = opened.url;
        this.onInspectorOpened(opened.url);
      } else this.log(`débogueur non ouvert : ${opened.reason}`, "WARNING");
    }
    const kernel = this.kernel as Kernel | null;
    if (!kernel) return;
    const buildIssue = process.env[DEV_BUILD_ISSUE_ENV];
    if (buildIssue) kernel.reportBootNotice(devBuildIssueNotice(buildIssue));
    this.#reporter = new BootReporter(kernel, {
      // Gate TTY CENTRALISÉ du Kernel (résolu 1× au boot, NF_NO_TTY-aware) plutôt
      // qu'une relecture directe de `process.stdout.isTTY` → cohérent avec la
      // couleur ANSI et surchargeable en test/CI.
      debug: Boolean(kernel.debug),
      tty: kernel.isTTY,
      // Déjà validé à `onKernelStart`, qui refuse une valeur inconnue.
      mode: kernel.startupOutputMode(),
      reload: reloadCount(process.env) > 0,
      supervised: process.env[CHILD_ENV] === "1",
      inspector: this.#inspectorUrl,
    });
    this.#reporter.attach();
  }

  /**
   * Inspecteur ouvert SANS option `--inspect` — aucun en développement.
   *
   * @returns la demande par défaut, ou `null`.
   */
  protected defaultInspect(): IDevInspectRequest | null {
    return null;
  }

  /**
   * Appelée une fois l'inspecteur ouvert (Node a déjà annoncé son URL).
   *
   * @param _url - URL WebSocket du débogueur.
   */
  protected onInspectorOpened(_url: string): void {}

  /**
   * Le rendu demandé, VALIDÉ : une valeur inconnue de `--output` ou de
   * `NF_OUTPUT` arrête la commande en la nommant (code 64) — acceptée puis
   * ignorée, elle apprendrait à son auteur qu'elle a un sens.
   *
   * @returns le rendu, ou `null` si la commande a été arrêtée.
   */
  async #validatedOutputMode(): Promise<StartupOutputMode | null> {
    const kernel = this.kernel as Kernel | null;
    try {
      return resolveOutputMode(
        readOutputFlag(process.argv),
        process.env,
        kernel?.isTTY ?? false,
      );
    } catch (e) {
      process.stderr.write(`nodefony development : ${(e as Error).message}\n`);
      await kernel?.terminate(SysExit.USAGE);
      return null;
    }
  }

  override async onKernelStart(): Promise<void> {
    const mode = await this.#validatedOutputMode();
    if (mode === null) return;
    // `json` : la sortie standard est le flux du bilan, lu par une machine. Le
    // journal de CE processus — superviseur comme serveur — part sur la sortie
    // d'erreur (le serveur le refait dans `BootReporter`, qui le sait aussi).
    if (mode === "json") Syslog.setLogSink(STDERR_LOG_SINK);
    this.cli.environment = "development";
    process.env.NF_MODE_START = "development";

    // Deux chemins mènent au même boot serveur, et c'est voulu :
    //  · enfant supervisé (`NF_DEV_CHILD=1`), lancé par le superviseur ;
    //  · `--no-watch`, demandé par un humain ou une machine qui veut le mode
    //    développement SANS rechargement — une suite d'intégration au premier chef :
    //    un rebuild déclenché en plein run coupe les connexions sous les tests, et
    //    le diagnostic qui suit accuse le code plutôt que le décor.
    // Le superviseur reste le défaut ; ceci est la sortie explicite, pas un repli.
    if (process.env[CHILD_ENV] === "1" || isWatchDisabled(process.argv)) {
      // Nom de process repérable, distinct du superviseur parent
      // (`nodefony-dev-supervisor`). Posé à `onReady` car `Kernel.preRegister`
      // (onPreRegister) écrase le title avec le `projectName` (Kernel.ts:608) —
      // notre nom doit gagner APRÈS. Cf convention cluster master/worker.
      (this.kernel as Kernel | null)?.once("onReady", () => {
        process.title = "nodefony-dev-server";
      });
      (this.cli as CliKernel).setRunProfile({
        servers: true,
        lifetime: "longrunning",
        interactive: false,
        // Le serveur applicatif sert des requêtes : il lui faut l'infrastructure.
        externalServices: true,
      });
      return;
    }

    // Parent → superviseur auto-restart. Il NE boote PAS le kernel applicatif
    // (servers:false → aucun serveur dans le parent, pas de collision de port) : le
    // serveur vit dans le process enfant, redémarré à chaque changement backend. Le HMR
    // frontend (Vite) est préservé (frontend/ exclu). Profil long-running (superviseur)
    // déclaré pour l'introspection — il parke en restant CONSOLE (abort du boot ici).
    (this.cli as CliKernel).setRunProfile({
      servers: false,
      lifetime: "longrunning",
      interactive: false,
      // Le superviseur SURVEILLE des fichiers ; il ne sert aucune requête et ne
      // lit aucune donnée. Une connexion de plus ici, c'en est une par
      // redémarrage d'un développeur, pour rien.
      externalServices: false,
    });
    // DevSupervisor (→ chokidar) chargé à la demande : seul le superviseur parent du
    // mode dev en a besoin — le boot prod/enfant ne paie pas le watcher au chargement.
    const { default: DevSupervisor } =
      await import("../../service/dev/DevSupervisor");
    const supervisor = new DevSupervisor({
      cwd: process.cwd(),
      childEnvKey: CHILD_ENV,
    });
    // Le superviseur reprend la main sur les signaux, comme le master du
    // cluster (`runtimeLauncher.ts`) — et par le même geste : on retire
    // NOMMÉMENT ceux de ce CLI, rien d'autre. Laissés branchés, ils lançaient
    // `terminate()` au même Ctrl+C, et sa sortie coupait l'arrêt du
    // superviseur avant la mort du serveur : l'invite revenait pendant qu'un
    // orphelin tenait encore les ports.
    (this.cli as CliKernel).releaseSignalListeners();
    await supervisor.start();
    // Parke le flow CLI (le superviseur gère le cycle de vie + Ctrl+C via ses watchers
    // fs → keepAlive inutile). Mécanisme centralisé : cf Kernel.park().
    await (this.kernel as Kernel).park();
  }

  override async generate(/*options: any*/): Promise<Kernel> {
    try {
      return this.cli.kernel as Kernel;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }
}

export default Dev;
