import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import BootReporter from "../../service/dev/BootReporter";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onPostReady",
};

/** Variable d'env distinguant le serveur enfant du process superviseur parent. */
const CHILD_ENV = "NODEFONY_DEV_CHILD";

/**
 * Commande `nodefony development` — serveur en mode dev (front Vite/HMR + auto-restart).
 *
 * **Invariant non négociable : `development` = TOUJOURS 1 process.** La molette
 * topologie (`cluster.workers` / `--workers` / `NODEFONY_WORKERS`) est **ignorée** en
 * dev : Vite exige un process maître unique (conflit port HMR si N workers spawnaient
 * chacun leur Vite). Le multi-process se règle uniquement sur le runtime prod
 * (`nodefony cluster`). Cf décision « 2 molettes » 2026-05-24.
 *
 * Le seul « 2ᵉ process » en dev est le couple superviseur/enfant du {@link DevSupervisor}
 * (auto-restart au changement de source backend) — ce n'est PAS du cluster.
 */
class Dev extends Command {
  #reporter: BootReporter | null = null;

  constructor(cli: CliKernel) {
    super(
      "development",
      "Start Server in development Mode",
      cli as CliKernel,
      options,
    );
    this.alias("dev");
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
  }

  /**
   * Boot de rêve dev : checklist animée par phase (spinner + ✓/✗) à la place du mur
   * de logs. Branché AVANT `loadApp` (gros import) pour couvrir le gap de feedback.
   * **Enfant supervisé uniquement** (`NODEFONY_DEV_CHILD=1`) : le superviseur parent
   * ne boote pas de serveur → aucun affichage. Animation TTY non-debug ; debug/non-TTY
   * → marqueurs statiques + logs bruts (cf {@link BootReporter}).
   */
  override async onKernelPreStart(): Promise<void> {
    if (process.env[CHILD_ENV] !== "1") return;
    const kernel = this.kernel as Kernel | null;
    if (!kernel) return;
    this.#reporter = new BootReporter(kernel, {
      // Gate TTY CENTRALISÉ du Kernel (résolu 1× au boot, NO_TTY-aware) plutôt
      // qu'une relecture directe de `process.stdout.isTTY` → cohérent avec la
      // couleur ANSI et surchargeable en test/CI.
      debug: Boolean(kernel.debug),
      tty: kernel.isTTY,
    });
    this.#reporter.attach();
  }

  override async onKernelStart(): Promise<void> {
    this.cli.environment = "development";
    process.env.MODE_START = "development";

    // Enfant supervisé → boot serveur normal (HTTP/WS).
    if (process.env[CHILD_ENV] === "1") {
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
    });
    // DevSupervisor (→ chokidar) chargé à la demande : seul le superviseur parent du
    // mode dev en a besoin — le boot prod/enfant ne paie pas le watcher au chargement.
    const { default: DevSupervisor } =
      await import("../../service/dev/DevSupervisor");
    const supervisor = new DevSupervisor({
      cwd: process.cwd(),
      childEnvKey: CHILD_ENV,
    });
    await supervisor.start();
    // Parke le flow CLI (le superviseur gère le cycle de vie + Ctrl+C via ses watchers
    // fs → keepAlive inutile). Mécanisme centralisé : cf Kernel.park().
    await (this.kernel as Kernel).park();
  }

  override async generate(/*options: any*/): Promise<Kernel> {
    try {
      return this.cli?.kernel as Kernel;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }
}

export default Dev;
