import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import {
  resolveTopology,
  loadClusterConfig,
} from "../../service/cluster/topology";
import { launchTopology } from "./runtimeLauncher";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onStart",
};

/**
 * Commande `nodefony production` — runtime PROD cloud-native, **foreground**.
 *
 * Modèle « 2 molettes » (2026-05-24) : front prod (dist, pas de Vite) × topologie
 * pilotée par la molette `workers` ({@link resolveTopology} : `--workers` >
 * `NODEFONY_WORKERS` > config `cluster.workers` > défaut 1). `workers:1` = mono-process
 * (1 process = 1 pod, scaling délégué à l'orchestrateur) ; `>= 2` = cluster (master +
 * workers), via le flow partagé {@link launchTopology} (même runtime que `cluster`).
 *
 * **Foreground par défaut** — pensé pour k8s / systemd / Docker. Plus aucune
 * daemonisation : 1 process Node = 1 pod/container, lifecycle (restart/health/logs)
 * délégué à l'orchestrateur. (PM2 retiré du framework — cf project_pm2_deprecation.)
 */
class Prod extends Command {
  constructor(cli: CliKernel) {
    super(
      "production",
      "Start Server in Production Mode (foreground, cloud-native — topology = workers)",
      cli as CliKernel,
      options,
    );
    this.alias("prod");
    this.addOption(
      "-w, --workers <number>",
      "Number of worker processes (default: config cluster.workers / NODEFONY_WORKERS / 1)",
    );
  }

  override async onKernelStart(): Promise<void> {
    (this.cli as CliKernel).setType("SERVER");
    this.cli.environment = "production";
    process.env.MODE_START = "production";
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

export default Prod;
