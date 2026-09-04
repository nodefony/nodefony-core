import cluster from "node:cluster";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import {
  resolveTopology,
  loadClusterConfig,
} from "../../service/cluster/topology";
import { launchTopology } from "./runtimeLauncher";

const options: OptionsCommandInterface = {
  helpGroup: "LANCER",
  showBanner: false,
  // onPostReady (comme `development`/`production`) : l'UNIQUE Kernel boote complètement.
  // Décision master/worker prise dans onKernelStart (avant initServers). Plus de double-boot.
  kernelEvent: "onPostReady",
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
 * Topologie = source unique {@link resolveTopology} : `--workers` > `NF_WORKERS`
 * > config app `cluster.workers` > défaut 1. **`workers:1` = VRAI mono-process** (zéro
 * machinerie cluster, un seul Kernel) ; `>= 2` → master (superviseur + gateway IPC) +
 * N workers (chacun un seul Kernel).
 *
 * Régime de déploiement : ON pour container multi-cœurs / VPS / bare-metal ; OFF
 * (1 process/pod) pour petit pod k8s + HPA. Cf `project_cluster_backplane_vision`.
 */
class Cluster extends Command {
  constructor(cli: CliKernel) {
    super(
      "cluster",
      "Serveur en cluster : N workers isolés (cgroup-aware, respawn, arrêt gracieux)",
      cli as CliKernel,
      options,
    );
    this.addOption(
      "-w, --workers <number>",
      "Number of worker processes to fork (default: config cluster.workers / NF_WORKERS / 1)",
    );
    // Options du lancement DÉTACHÉ — consommées par le fast-path standalone de
    // CliKernel.start (detachedStart.ts), déclarées pour le help.
    this.addOption(
      "--detach",
      "spawn détaché + attente readiness (ports) + exit 0/69",
    );
    this.addOption("--wait <sec>", "plafond d'attente readiness (défaut 120)");
    this.addOption("--health <path>", "GET de santé post-boot (best-effort)");
    this.addOption("--log <file>", "log du runtime détaché (défaut tmp/)");
  }

  override async onKernelStart(opts?: { workers?: string }): Promise<void> {
    this.cli.environment = "production";
    process.env.NF_MODE_START = "cluster";
    const cfgWorkers = await loadClusterConfig();
    const topo = resolveTopology({
      flag: opts?.workers,
      config: cfgWorkers ?? undefined,
    });
    await launchTopology({
      cli: this.cli as CliKernel,
      topo,
      log: (msg, severity) => this.log(msg, severity),
    });
  }

  override async generate(): Promise<void | Kernel> {
    // Mono-process ou worker forké (le master parke dans onKernelStart). Serveurs déjà
    // montés → nommage process + retour du Kernel, sans park ni second Kernel.
    process.title = cluster.isWorker
      ? `nodefony worker ${cluster.worker?.id ?? "?"} [cluster]`
      : "nodefony server";
    return this.cli?.kernel as Kernel;
  }
}

export default Cluster;
