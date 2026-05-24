import cluster from "node:cluster";
import Kernel from "../Kernel";
import CliKernel from "../CliKernel";
import { OptionsCommandInterface } from "../../command/Command";
import {
  startClusterMaster,
  ClusterLog,
} from "../../service/cluster/clusterMaster";
import { Topology } from "../../service/cluster/topology";

/** Arguments de {@link launchTopology}. */
export interface LaunchTopologyOptions {
  /** CliKernel courant (environnement + logger de secours). */
  cli: CliKernel;
  /** Options de la commande (transmises au Kernel des workers / du mono-process). */
  options: OptionsCommandInterface;
  /** Topologie déjà résolue (cf `resolveTopology`). */
  topo: Topology;
  /** Logger (msg + sévérité). */
  log: ClusterLog;
}

/**
 * Lance le runtime serveur selon la topologie résolue — flow **PARTAGÉ** par toutes
 * les commandes de lancement (`cluster`, `staging` legacy, `production`). C'est la
 * source unique de la décision « mono-process vs cluster » :
 *
 * - `workers >= 2` && process primaire → process **MASTER** : {@link startClusterMaster}
 *   (fork N workers + relay IPC + sonde pod). Ne boote AUCUN serveur, reste vivant
 *   (superviseur + gateway). Les handles restent vivants via les listeners cluster +
 *   les timers de la sonde → pas de GC, pas besoin de les retenir.
 * - sinon (mono-process `workers:1` OU process **worker** forké) → boote un Kernel
 *   complet (serveurs HTTP/WS).
 *
 * Vit dans `kernel/commands/` (et non `service/cluster/`) pour garder le service
 * cluster **kernel-free** : seul ce maillon connaît `Kernel`.
 *
 * @returns le Kernel booté (mono/worker), ou `void` (process master).
 */
export async function launchTopology(
  opts: LaunchTopologyOptions,
): Promise<void | Kernel> {
  const { cli, options, topo, log } = opts;

  if (cluster.isPrimary && topo.workers >= 2) {
    log(
      `Cluster topology: ${topo.workers} workers (source: ${topo.source})`,
      "INFO",
    );
    // Master = superviseur + gateway IPC (relay realtime + sonde pod) ; pas de Kernel HTTP.
    startClusterMaster({ workers: topo.workers, log });
    // Parke le flow CLI (comme DevCommand). SANS ça : generate() retourne à `onStart`
    // → le CLI termine le process → le master meurt → les workers échouent leur
    // handshake IPC (write EPIPE) au fork. Le master reste vivant (superviseur) ;
    // l'arrêt passe par les signal handlers du ClusterManager (graceful shutdown).
    await new Promise<void>(() => {});
    return;
  }

  if (cluster.isPrimary) {
    log(
      `Topology: 1 process (source: ${topo.source}) — mono-process, no cluster machinery`,
      "INFO",
    );
  }
  // Mono-process OU worker forké : boot d'un Kernel complet (serveurs HTTP/WS).
  const kernel = new Kernel(cli.environment, cli, options);
  await kernel.start().catch((e) => {
    cli.log(e, "ERROR");
    throw e;
  });
  // Nom de process LISIBLE dans Activity Monitor / `ps` (worker N vs mono server) —
  // cf master dans clusterMaster.ts. ⚠️ APRÈS start() : Kernel.setProcessTitle() pose
  // `projectName` pendant le boot (Kernel.ts) → on doit avoir le dernier mot. Le pid
  // (= instanceId de la sonde) reste le lien avec les logs / la vue pod.
  process.title = cluster.isWorker
    ? `nodefony worker ${cluster.worker?.id ?? "?"} [cluster]`
    : "nodefony server";
  // Parke le flow CLI (comme DevCommand). À `onStart`, une fois l'action terminée la
  // chaîne de boot du kernel CLI s'arrête → le CLI ferait `terminate` (les serveurs
  // sont portés par le Kernel ci-dessus, pas par le kernel CLI). Sans ce park, le
  // worker bootait ses 4 serveurs PUIS terminait aussitôt (crash-loop respawn master).
  await new Promise<void>(() => {});
}
