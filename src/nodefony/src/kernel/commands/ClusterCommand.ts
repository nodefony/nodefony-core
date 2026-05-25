import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import {
  resolveTopology,
  loadClusterConfig,
} from "../../service/cluster/topology";
import { launchTopology } from "./runtimeLauncher";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onStart",
};

/**
 * Commande `nodefony cluster` — démarre le serveur en mode cluster sans PM2.
 *
 * Remplace l'ancien `nodefony staging`/`preprod` (retiré 2026-05-25 — fusionné dans
 * le runtime prod « 2 molettes » : topologie = `cluster.workers`, env = `NODE_ENV`) :
 * - **cgroup-aware** — `--workers N` explicite, sinon quota CPU cgroup (conteneur),
 *   sinon `os.availableParallelism()`. Plus jamais `os.cpus().length` (bug conteneur).
 * - **respawn backoff** — un worker mort est re-forké avec backoff exponentiel (anti crash-loop).
 * - **graceful shutdown** — SIGTERM/SIGINT draine les workers (SIGKILL après timeout).
 *
 * Topologie = source unique {@link resolveTopology} : `--workers` > `NODEFONY_WORKERS`
 * > config app `cluster.workers` > défaut 1. **`workers:1` = VRAI mono-process** (zéro
 * machinerie cluster) ; `>= 2` → master (superviseur + gateway IPC) + N workers.
 *
 * Régime de déploiement : ON pour container multi-cœurs / VPS / bare-metal ; OFF
 * (1 process/pod) pour petit pod k8s + HPA. Cf `project_cluster_backplane_vision`.
 */
class Cluster extends Command {
  constructor(cli: CliKernel) {
    super(
      "cluster",
      "Start Server in cluster mode (N isolated workers — cgroup-aware, auto-respawn, graceful shutdown)",
      cli as CliKernel,
      options,
    );
    this.addOption(
      "-w, --workers <number>",
      "Number of worker processes to fork (default: config cluster.workers / NODEFONY_WORKERS / 1)",
    );
  }

  override async onKernelStart(): Promise<void> {
    (this.cli as CliKernel).setType("SERVER");
    this.cli.environment = "production";
    process.env.MODE_START = "cluster";
  }

  override async generate(opts: { workers?: string }): Promise<void | Kernel> {
    // Topologie = source unique : CLI `--workers` > env NODEFONY_WORKERS > config app
    // `cluster.workers` (lue standalone, sans kernel) > défaut 1.
    const cfgWorkers = await loadClusterConfig();
    const topo = resolveTopology({
      flag: opts?.workers,
      config: cfgWorkers ?? undefined,
    });
    return launchTopology({
      cli: this.cli as CliKernel,
      options,
      topo,
      log: (msg, severity) => this.log(msg, severity),
    });
  }
}

export default Cluster;
