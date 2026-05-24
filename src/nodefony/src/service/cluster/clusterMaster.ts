import cluster from "node:cluster";
import type { Serializable } from "node:child_process";
import { Severity } from "../../syslog/Pdu";
import { ClusterManager } from "./ClusterManager";
import { ClusterRelay } from "./ClusterRelay";
import { ClusterProbeAggregator } from "./ClusterProbeAggregator";

/** Logger des composants cluster — aligné sur `ClusterManager`/`Relay`/`Aggregator`. */
export type ClusterLog = (msg: string, severity?: Severity) => void;

/** Poignées du process master, conservées par l'appelant (référence vivante). */
export interface ClusterMasterHandles {
  /** Superviseur fork/respawn/graceful shutdown. */
  manager: ClusterManager;
  /** Gateway IPC : fan-out des publications realtime cross-process. */
  relay: ClusterRelay;
  /** Agrégateur de sondes (vue pod, push) — `null` si `NODEFONY_CLUSTER_PROBE=0`. */
  probes: ClusterProbeAggregator | null;
}

/**
 * Démarre le process MASTER d'un cluster multi-worker — bootstrap partagé par les
 * commandes de lancement (`cluster`, `staging` legacy, et le futur runtime prod unifié).
 *
 * Le master ne sert **aucun HTTP** : il est superviseur + gateway IPC. Il
 * 1. marque `NODEFONY_CLUSTER=1` (hérité au fork → le module Framework branche le
 *    ClusterBackplane sur son RealtimeHub),
 * 2. branche le {@link ClusterRelay} (fan-out realtime cross-process intra-pod) et,
 *    sauf `NODEFONY_CLUSTER_PROBE=0`, le {@link ClusterProbeAggregator} (vue pod, push),
 * 3. fork N workers via {@link ClusterManager} (respawn backoff + graceful shutdown).
 *
 * Les handlers `fork`/`exit` GLOBAUX couvrent forks initiaux ET respawns → un worker
 * relancé est (ré)attaché. Attachés AVANT `manager.start()` (aucun fork manqué).
 *
 * ⚠️ À appeler uniquement quand `cluster.isPrimary` ET `workers >= 2` (le mono-process
 * `workers: 1` ne passe jamais par ici — zéro machinerie cluster).
 *
 * @param opts.workers - nombre de workers à forker (déjà résolu, `>= 2`).
 * @param opts.log - logger (msg + sévérité).
 * @returns les poignées vivantes (manager/relay/probes) à conserver par l'appelant.
 */
export function startClusterMaster(opts: {
  workers: number;
  log: ClusterLog;
}): ClusterMasterHandles {
  const { workers, log } = opts;
  // Nom de process LISIBLE dans Activity Monitor / `ps` / `top` (sinon tous les
  // process s'affichent `npm exec nodefony cluster` → master et workers indistinguables).
  process.title = `nodefony master [cluster ${workers}w]`;
  // Marque les workers (héritage env au fork) → branchement du ClusterBackplane.
  process.env.NODEFONY_CLUSTER = "1";

  const relay = new ClusterRelay({ log });
  // Sonde agrégée : opt-in, désactivable (NODEFONY_CLUSTER_PROBE=0) → bypass total.
  const probes =
    process.env.NODEFONY_CLUSTER_PROBE !== "0"
      ? new ClusterProbeAggregator({ log })
      : null;

  cluster.on("fork", (w) => {
    const handle = {
      id: w.id,
      // PID OS du worker — clé de ciblage du drill-down (Phase 2, route enrich vers ce worker).
      pid: w.process?.pid ?? -1,
      send: (m: unknown) => {
        try {
          // Les messages IPC sont des clusterMessage sérialisables (cf clusterMessage.ts).
          w.send(m as Serializable);
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

  const manager = new ClusterManager({ workers, log });
  manager.start();
  manager.installSignalHandlers();
  return { manager, relay, probes };
}
