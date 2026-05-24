import cluster from "node:cluster";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import { resolveWorkerCount } from "../../service/cluster/cpuQuota";
import { ClusterManager } from "../../service/cluster/ClusterManager";
import { ClusterRelay } from "../../service/cluster/ClusterRelay";
import { ClusterProbeAggregator } from "../../service/cluster/ClusterProbeAggregator";

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
  #relay: ClusterRelay | null = null;
  #probes: ClusterProbeAggregator | null = null;

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
      // Marque les workers (héritage env au fork) → le module Framework branche
      // alors le ClusterBackplane sur son RealtimeHub (cf index.ts @nodefony/framework).
      process.env.NODEFONY_CLUSTER = "1";

      const requested =
        opts?.workers !== undefined ? Number(opts.workers) : undefined;
      const workers = resolveWorkerCount({ requested });

      // Master = GATEWAY IPC : relaie les publications realtime d'un worker vers les
      // AUTRES (fan-out cross-process intra-pod, « comme si Redis était là ») ET agrège
      // les sondes des workers pour servir la vue POD (Phase 4c, push). Les events GLOBAUX
      // `fork`/`exit` couvrent les forks initiaux ET les respawns du ClusterManager → un
      // worker relancé est (ré)attaché. Attachés AVANT `manager.start()` (aucun fork manqué).
      const relay = new ClusterRelay({
        log: (msg, severity) => this.log(msg, severity),
      });
      this.#relay = relay;
      // Sonde agrégée : opt-in, désactivable (NODEFONY_CLUSTER_PROBE=0) → bypass total
      // (aucun agrégateur, aucun timer de diffusion ; chaque worker sert sa vue per-instance).
      const probes =
        process.env.NODEFONY_CLUSTER_PROBE !== "0"
          ? new ClusterProbeAggregator({
              log: (msg, severity) => this.log(msg, severity),
            })
          : null;
      this.#probes = probes;
      cluster.on("fork", (w) => {
        const handle = {
          id: w.id,
          send: (m: unknown) => {
            try {
              w.send(m);
            } catch {
              /* worker en cours de fork / déjà mort : ignoré */
            }
          },
          onMessage: (cb: (msg: unknown) => void) => w.on("message", cb),
        };
        relay.attach(handle);
        probes?.attach(handle);
      });
      cluster.on("exit", (w) => {
        relay.detach(w.id);
        probes?.detach(w.id);
      });
      probes?.start();

      this.#manager = new ClusterManager({
        workers,
        log: (msg, severity) => this.log(msg, severity),
      });
      this.#manager.start();
      this.#manager.installSignalHandlers();
      // Le master reste vivant (superviseur + gateway IPC) — pas de Kernel HTTP ici.
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
