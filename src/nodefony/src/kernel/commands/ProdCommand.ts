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
  showBanner: true,
  // onPostReady (comme `development`) : l'UNIQUE Kernel boote complètement (serveurs
  // inclus) puis cette commande conclut. La décision mono/cluster est prise plus tôt,
  // dans onKernelStart (phase onStart, avant initServers). Plus de second Kernel.
  kernelEvent: "onPostReady",
};

/**
 * Commande `nodefony production` — runtime PROD cloud-native, **foreground**.
 *
 * Modèle « 2 molettes » (2026-05-24) : front prod (dist, pas de Vite) × topologie
 * pilotée par la molette `workers` ({@link resolveTopology} : `--workers` >
 * `NF_WORKERS` > config `cluster.workers` > défaut 1). `workers:1` = mono-process
 * (1 process = 1 pod, scaling délégué à l'orchestrateur) ; `>= 2` = cluster (master +
 * workers), via le flow partagé {@link launchTopology} (même runtime que `cluster`).
 *
 * **Un seul Kernel par process** : la commande suit la recette `development` (kernelEvent
 * `onPostReady` + profil serveur via `setRunProfile` dans `onKernelStart`) — l'unique Kernel du CLI
 * démarre lui-même les serveurs. Le double-boot historique (kernel CLI + kernel runtime)
 * est supprimé.
 *
 * **Foreground par défaut** — pensé pour k8s / systemd / Docker. Plus aucune
 * daemonisation : 1 process Node = 1 pod/container, lifecycle (restart/health/logs)
 * délégué à l'orchestrateur. (PM2 retiré du framework — cf project_pm2_deprecation.)
 */
class Prod extends Command {
  constructor(cli: CliKernel) {
    super(
      "production",
      "Serveur de production : premier plan, cloud-native (topologie via --workers)",
      cli as CliKernel,
      options,
    );
    this.alias("prod");
    // Convention de l'écosystème (npm start, next start, nest start) : `start`
    // = démarrer l'application en production. Le menu interactif, lui, vit
    // sous `menu` (et `nodefony` nu en TTY) — `start` ne l'a jamais bien nommé.
    this.alias("start");
    this.addOption(
      "-w, --workers <number>",
      "Number of worker processes (default: config cluster.workers / NF_WORKERS / 1)",
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
    process.env.MODE_START = "production";
    // Topologie = source unique : CLI `--workers` > env NF_WORKERS > config app
    // `cluster.workers` (lue standalone, sans kernel) > défaut 1. Résolue AVANT
    // initServers : master → superviseur (0 serveur) ; mono/worker → ce Kernel sert.
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
    // Atteint uniquement en mono/worker (le master parke dans onKernelStart). Les
    // serveurs sont déjà montés → on nomme le process pour `ps`/Activity Monitor et on
    // rend le Kernel. Pas de park : les serveurs gardent le process vivant.
    process.title = cluster.isWorker
      ? `nodefony worker ${cluster.worker?.id ?? "?"} [cluster]`
      : "nodefony server";
    return this.cli?.kernel as Kernel;
  }
}

export default Prod;
