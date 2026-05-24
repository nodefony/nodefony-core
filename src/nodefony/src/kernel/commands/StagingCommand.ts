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
 * Commande `nodefony staging` / `preprod`.
 *
 * @deprecated 2026-05-24 — fusionnée dans le runtime prod « 2 molettes ». L'ancien
 * fork `os.cpus().length` (0 respawn, 0 backplane, 0 vue pod) est REMPLACÉ par la
 * machinerie cluster moderne, partagée avec `nodefony cluster` / `nodefony production`
 * via {@link launchTopology}. `staging` ne diffère plus de la prod que par l'ENV
 * (DB / secrets / niveau de logs), PAS la topologie : celle-ci est pilotée par la
 * molette `cluster.workers` (ou `NODEFONY_WORKERS`), comme tout runtime prod.
 *
 * → Préférer **`nodefony production`** (ou `nodefony cluster --workers <n>`). Retrait Phase 16.
 */
class Staging extends Command {
  constructor(cli: CliKernel) {
    super(
      "staging",
      "[DEPRECATED → use `production`] Start prod runtime (topology = cluster.workers / NODEFONY_WORKERS)",
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
      "`staging`/`preprod` is DEPRECATED — use `nodefony production` (topology driven by `cluster.workers`).",
      "WARNING",
    );
  }

  override async generate(): Promise<void | Kernel> {
    // Topologie pilotée par la config app / env (pas d'option `--workers` ici :
    // commande dépréciée → on lit le knob comme tout runtime prod). > défaut 1.
    const cfgWorkers = await loadClusterConfig();
    const topo = resolveTopology({ config: cfgWorkers ?? undefined });
    return launchTopology({
      cli: this.cli as CliKernel,
      options,
      topo,
      log: (msg, severity) => this.log(msg, severity),
    });
  }
}

export default Staging;
