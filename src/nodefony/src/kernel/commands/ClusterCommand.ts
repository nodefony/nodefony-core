import cluster from "node:cluster";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import { resolveWorkerCount } from "../../service/cluster/cpuQuota";
import { ClusterManager } from "../../service/cluster/ClusterManager";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onStart",
};

/**
 * Commande `nodefony cluster` — démarre le serveur en mode cluster sans PM2.
 *
 * Refonte « beaucoup mieux » de l'ancien `nodefony staging`/`preprod` :
 * - **cgroup-aware** — `--workers N` explicite, sinon quota CPU cgroup (conteneur),
 *   sinon `os.availableParallelism()`. Plus jamais `os.cpus().length` (bug conteneur).
 * - **respawn backoff** — un worker mort est re-forké avec backoff exponentiel (anti crash-loop).
 * - **graceful shutdown** — SIGTERM/SIGINT draine les workers (SIGKILL après timeout).
 *
 * Le process MASTER ne sert aucun HTTP : c'est un superviseur (et, en Phase 3, la
 * gateway IPC du `ClusterBackplane`). Chaque worker boote un `Kernel` complet.
 *
 * Régime de déploiement : ON pour container multi-cœurs / VPS / bare-metal ; OFF
 * (1 process/pod) pour petit pod k8s + HPA. Cf `project_cluster_backplane_vision`.
 */
class Cluster extends Command {
  #manager: ClusterManager | null = null;

  constructor(cli: CliKernel) {
    super(
      "cluster",
      "Start Server in cluster mode (N isolated workers — cgroup-aware, auto-respawn, graceful shutdown)",
      cli as CliKernel,
      options,
    );
    this.addOption(
      "-w, --workers <number>",
      "Number of worker processes to fork (default: cgroup CPU quota → availableParallelism)",
    );
  }

  override async onKernelStart(): Promise<void> {
    (this.cli as CliKernel).setType("SERVER");
    this.cli.environment = "production";
    process.env.MODE_START = "cluster";
  }

  override async generate(opts: { workers?: string }): Promise<void | Kernel> {
    if (cluster.isPrimary) {
      const requested =
        opts?.workers !== undefined ? Number(opts.workers) : undefined;
      const workers = resolveWorkerCount({ requested });
      this.#manager = new ClusterManager({
        workers,
        log: (msg, severity) => this.log(msg, severity),
      });
      this.#manager.start();
      this.#manager.installSignalHandlers();
      // Le master reste vivant (superviseur) — pas de Kernel HTTP ici.
      return;
    }
    // Process worker : boot d'un Kernel complet (serveurs HTTP/WS).
    const kernel = new Kernel(
      this.cli.environment,
      this.cli as CliKernel,
      options,
    );
    return kernel.start().catch((e) => {
      this.cli.log(e, "ERROR");
      throw e;
    });
  }
}

export default Cluster;
