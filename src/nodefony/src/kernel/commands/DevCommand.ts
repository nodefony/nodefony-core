import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import DevSupervisor from "../../service/dev/DevSupervisor";

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
  constructor(cli: CliKernel) {
    super(
      "development",
      "Start Server in development Mode",
      cli as CliKernel,
      options,
    );
    this.alias("dev");
  }

  override async onKernelStart(): Promise<void> {
    this.cli.environment = "development";
    process.env.MODE_START = "development";

    // Enfant supervisé → boot serveur normal (HTTP/WS).
    if (process.env[CHILD_ENV] === "1") {
      (this.cli as CliKernel).setType("SERVER");
      return;
    }

    // Parent → superviseur auto-restart. Il NE boote PAS le kernel applicatif
    // (type reste CONSOLE → aucun serveur dans le parent, pas de collision de
    // port) : le serveur vit dans le process enfant, redémarré à chaque
    // changement backend. Le HMR frontend (Vite) est préservé (frontend/ exclu).
    const supervisor = new DevSupervisor({
      cwd: process.cwd(),
      childEnvKey: CHILD_ENV,
    });
    await supervisor.start();
    // Parke le flow CLI : le superviseur gère désormais le cycle de vie + Ctrl+C.
    await new Promise<void>(() => {});
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
