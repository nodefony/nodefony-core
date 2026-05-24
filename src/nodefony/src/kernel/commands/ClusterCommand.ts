import cluster from "node:cluster";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import {
  resolveTopology,
  loadClusterConfig,
} from "../../service/cluster/topology";
import { startClusterMaster } from "../../service/cluster/clusterMaster";
import type { ClusterManager } from "../../service/cluster/ClusterManager";
import type { ClusterRelay } from "../../service/cluster/ClusterRelay";
import type { ClusterProbeAggregator } from "../../service/cluster/ClusterProbeAggregator";

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
      // Topologie = source unique de vérité : CLI `--workers` > env NODEFONY_WORKERS
      // > config app `cluster.workers` (lue standalone, sans kernel) > défaut 1.
      const cfgWorkers = await loadClusterConfig();
      const topo = resolveTopology({
        flag: opts?.workers,
        config: cfgWorkers ?? undefined,
      });

      // `workers: 1` = VRAI mono-process → ZÉRO machinerie cluster (pas de master,
      // pas de backplane, pas d'agrégateur, pas de 2ᵉ process). On boote directement
      // un Kernel dans CE process. (Décision « 2 molettes » 2026-05-24.)
      if (topo.workers <= 1) {
        this.log(
          `Cluster topology: 1 process (source: ${topo.source}) — mono-process, no cluster machinery`,
          "INFO",
        );
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

      this.log(
        `Cluster topology: ${topo.workers} workers (source: ${topo.source})`,
        "INFO",
      );
      // Master = superviseur + gateway IPC (relay realtime + sonde pod). Bootstrap
      // partagé (cf clusterMaster.ts) — pas de Kernel HTTP ici, le master reste vivant.
      const handles = startClusterMaster({
        workers: topo.workers,
        log: (msg, severity) => this.log(msg, severity),
      });
      this.#manager = handles.manager;
      this.#relay = handles.relay;
      this.#probes = handles.probes;
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
