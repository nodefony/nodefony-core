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
 * Commande `nodefony staging` / `preprod`.
 *
 * @deprecated 2026-05-24 — fusionnée dans le runtime prod « 2 molettes ». L'ancien
 * fork `os.cpus().length` (0 respawn, 0 backplane, 0 vue pod) est REMPLACÉ par la
 * machinerie cluster moderne (cgroup-aware + respawn backoff + relay IPC + sonde pod),
 * partagée avec `nodefony cluster`. `staging` ne diffère plus de la prod que par
 * l'ENV (DB / secrets / niveau de logs), PAS la topologie : celle-ci est pilotée par
 * la molette `cluster.workers` (ou `NODEFONY_WORKERS`), comme tout runtime prod.
 *
 * → Préférer **`nodefony cluster --workers <n|auto>`**. Retrait prévu Phase 16 (post-PM2).
 */
class Staging extends Command {
  #manager: ClusterManager | null = null;
  #relay: ClusterRelay | null = null;
  #probes: ClusterProbeAggregator | null = null;

  constructor(cli: CliKernel) {
    super(
      "staging",
      "[DEPRECATED → use `cluster`] Start prod runtime (topology = cluster.workers / NODEFONY_WORKERS)",
      cli as CliKernel,
      options,
    );
    this.alias("preprod");
  }

  override async onKernelStart(): Promise<void> {
    (this.cli as CliKernel).setType("SERVER");
    this.cli.environment = "production";
    process.env.MODE_START = "staging";
    this.log(
      "`staging`/`preprod` is DEPRECATED — use `nodefony cluster --workers <n|auto>`. Topology now driven by `cluster.workers` (runtime prod unifié).",
      "WARNING",
    );
  }

  override async generate(): Promise<void | Kernel> {
    if (cluster.isPrimary) {
      // Topologie pilotée par la config app / env (pas d'option `--workers` ici :
      // commande dépréciée → on lit le knob comme tout runtime prod). > défaut 1.
      const cfgWorkers = await loadClusterConfig();
      const topo = resolveTopology({ config: cfgWorkers ?? undefined });

      // `workers: 1` = VRAI mono-process → zéro machinerie cluster (cf décision 2026-05-24).
      if (topo.workers <= 1) {
        this.log(
          `Topology: 1 process (source: ${topo.source}) — mono-process, no cluster machinery`,
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
        `Topology: ${topo.workers} workers (source: ${topo.source})`,
        "INFO",
      );
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

export default Staging;
