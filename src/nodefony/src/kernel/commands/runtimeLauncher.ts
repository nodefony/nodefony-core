import cluster from "node:cluster";
import CliKernel from "../CliKernel";
import {
  startClusterMaster,
  ClusterLog,
} from "../../service/cluster/clusterMaster";
import { Topology } from "../../service/cluster/topology";

/** Arguments de {@link launchTopology}. */
export interface LaunchTopologyOptions {
  /** CliKernel courant (porte l'unique Kernel en cours de boot + l'environnement). */
  cli: CliKernel;
  /** Topologie déjà résolue (cf `resolveTopology`). */
  topo: Topology;
  /** Logger (msg + sévérité). */
  log: ClusterLog;
}

/**
 * Applique la topologie résolue — flow **PARTAGÉ** par les commandes de lancement
 * (`cluster`, `production`). Appelé depuis leur `onKernelStart` (phase `onStart`),
 * donc AVANT que l'unique Kernel ne démarre ses serveurs (`onReady → initServers`).
 *
 * **Un seul Kernel par process** (fin du double-boot historique) :
 * - `workers >= 2` && process primaire → **MASTER** : {@link startClusterMaster}
 *   (fork N workers + relay IPC + sonde pod). Ne boote AUCUN serveur HTTP ; le Kernel
 *   courant reste en `CONSOLE` et on **park** le flow (le master est un superviseur
 *   pur, gardé vivant par les listeners cluster + les timers de la sonde).
 * - sinon (mono-process `workers:1` OU process **worker** forké) → on bascule le Kernel
 *   courant en `SERVER` et on **rend la main** : son pipeline de boot continue de
 *   lui-même (`onReady → initServers → onPostReady`), les serveurs HTTP/WS montent et
 *   le process reste vivant via leurs handles. Plus aucun `new Kernel` ici.
 *
 * Vit dans `kernel/commands/` (et non `service/cluster/`) pour garder le service
 * cluster **kernel-free**.
 */
export async function launchTopology(
  opts: LaunchTopologyOptions,
): Promise<void> {
  const { cli, topo, log } = opts;

  if (cluster.isPrimary && topo.workers >= 2) {
    log(
      `Cluster topology: ${topo.workers} workers (source: ${topo.source})`,
      "INFO",
    );
    // Master = superviseur + gateway IPC (relay realtime + sonde pod) ; pas de Kernel
    // HTTP. Le Kernel courant reste CONSOLE (on ne bascule pas en SERVER) → son
    // pipeline n'initialisera aucun serveur. On parke le flow : sans ça, `onKernelStart`
    // rendrait la main, le Kernel finirait son boot CONSOLE puis le CLI terminerait le
    // process → le master meurt → les workers échouent leur handshake IPC au fork.
    // L'arrêt passe par les signal handlers du ClusterManager (graceful shutdown).
    startClusterMaster({ workers: topo.workers, log });
    await new Promise<void>(() => {});
    return;
  }

  if (cluster.isPrimary) {
    log(
      `Topology: 1 process (source: ${topo.source}) — mono-process, no cluster machinery`,
      "INFO",
    );
  }
  // Mono-process OU worker forké : CE Kernel (déjà en cours de boot via le pipeline
  // CLI) démarre les serveurs. On bascule juste son type ; `onKernelStart` rend ensuite
  // la main et le boot se poursuit tout seul. Aucun park (les serveurs gardent le
  // process vivant), aucun second Kernel.
  cli.setType("SERVER");
}
