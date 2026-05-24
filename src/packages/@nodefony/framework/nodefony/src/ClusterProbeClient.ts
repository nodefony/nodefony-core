import {
  CLUSTER_PROBE_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
  isClusterMessage,
} from "nodefony";
import type {
  IRealtimeHealth,
  IRealtimeClusterHealth,
} from "../interfaces/IRealtimeProbe.js";

/**
 * Transport IPC de la sonde cluster côté worker — abstrait `process.send` / la réception
 * des snapshots du master, derrière un seam **injectable** (même pattern que
 * `IClusterBackplaneTransport`). Permet de tester le report + le cache **sans forker**.
 */
export interface IClusterProbeTransport {
  /** Émet une remontée de sonde vers le master (worker → master). No-op hors cluster. */
  send(report: unknown): void;
  /** Enregistre le récepteur des snapshots agrégés du master (master → worker). */
  onReceive(cb: (msg: unknown) => void): void;
}

/** Transport de production : `process.send` + `process.on("message")`. */
export const processProbeTransport: IClusterProbeTransport = {
  send(report) {
    process.send?.(report);
  },
  onReceive(cb) {
    process.on("message", (msg) => cb(msg));
  },
};

/**
 * Consolide N santés per-instance en une vue **POD** ({@link IRealtimeClusterHealth}).
 * Pur (aucune I/O) : somme les scalaires ; la backpressure `maxBufferedAmount` est un MAX
 * (le pire worker), `totalBufferedAmount`/`slowConsumers` des sommes.
 *
 * @param instances - santés per-instance (chaque worker, snapshot master).
 * @param ts - horodatage du snapshot (défaut maintenant).
 */
export function mergeClusterHealth(
  instances: IRealtimeHealth[],
  ts: number = Date.now(),
): IRealtimeClusterHealth {
  const totals = {
    channelCount: 0,
    publishTotal: 0,
    fanoutTotal: 0,
    inboundTotal: 0,
    connectionCount: 0,
    bytesSentTotal: 0,
    messagesSentTotal: 0,
    backpressure: {
      maxBufferedAmount: 0,
      totalBufferedAmount: 0,
      slowConsumers: 0,
    },
  };
  for (const h of instances) {
    totals.channelCount += h.channelCount;
    totals.publishTotal += h.publishTotal;
    totals.fanoutTotal += h.fanoutTotal;
    totals.inboundTotal += h.inboundTotal;
    totals.connectionCount += h.connectionCount;
    totals.bytesSentTotal += h.bytesSentTotal;
    totals.messagesSentTotal += h.messagesSentTotal;
    const bp = h.backpressure;
    if (bp.maxBufferedAmount > totals.backpressure.maxBufferedAmount) {
      totals.backpressure.maxBufferedAmount = bp.maxBufferedAmount;
    }
    totals.backpressure.totalBufferedAmount += bp.totalBufferedAmount;
    totals.backpressure.slowConsumers += bp.slowConsumers;
  }
  return {
    cluster: true,
    ts,
    instanceCount: instances.length,
    instances,
    totals,
  };
}

/**
 * Client de sonde cluster **côté worker** (Phase 4c) — le pendant de
 * {@link ClusterProbeAggregator} (master). Deux rôles :
 *  - **report** : envoie périodiquement sa santé per-instance au master (`CLUSTER_PROBE_KIND`) ;
 *  - **cache** : reçoit le snapshot agrégé du master (`CLUSTER_PROBE_SNAPSHOT_KIND`) et le garde
 *    → n'importe quel worker sert la vue POD en O(1) (modèle push : 0 latence de requête).
 *
 * **Bypass total quand désactivé** : ce client n'est instancié/`start()` QUE par le module
 * Framework en worker de cluster AVEC la sonde activée. Sinon (mono-process, ou sonde coupée)
 * il n'existe pas → aucun timer, aucun listener, aucun IPC, et {@link clusterProbeHealth}
 * renvoie `null` → l'endpoint santé retombe sur la vue per-instance. Aucun coût « au cas où ».
 *
 * Perf : 1 timer `unref` (report) + 1 listener IPC. Le report sérialise 1 santé / intervalle
 * (≥ 1 s, jamais hot path). SERVEUR uniquement.
 */
export class ClusterProbeClient {
  readonly #transport: IClusterProbeTransport;
  readonly #intervalMs: number;
  #lastInstances: IRealtimeHealth[] | null = null;
  #snapTs = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #started = false;

  constructor(
    transport: IClusterProbeTransport = processProbeTransport,
    intervalMs = 2000,
  ) {
    this.#transport = transport;
    this.#intervalMs = intervalMs;
  }

  /**
   * Démarre le report périodique + l'écoute des snapshots. Idempotent. 1ᵉʳ report immédiat.
   *
   * @param buildOwn - fournit la santé per-instance courante (capturée à chaque tick).
   */
  start(buildOwn: () => IRealtimeHealth): void {
    if (this.#started) return;
    this.#started = true;
    this.#transport.onReceive((msg) => this.#ingest(msg));
    this.#report(buildOwn); // 1ᵉʳ report immédiat (pas d'attente)
    this.#timer = setInterval(() => this.#report(buildOwn), this.#intervalMs);
    (this.#timer as { unref?: () => void }).unref?.();
  }

  #report(buildOwn: () => IRealtimeHealth): void {
    this.#transport.send({
      kind: CLUSTER_PROBE_KIND,
      payload: buildOwn(),
    });
  }

  /** Met en cache le dernier snapshot agrégé. Ignore les autres kinds + malformés. */
  #ingest(msg: unknown): void {
    if (!isClusterMessage(msg) || msg.kind !== CLUSTER_PROBE_SNAPSHOT_KIND) {
      return;
    }
    const snap = msg as { ts?: unknown; instances?: unknown };
    if (Array.isArray(snap.instances)) {
      this.#lastInstances = snap.instances as IRealtimeHealth[];
      this.#snapTs = typeof snap.ts === "number" ? snap.ts : Date.now();
    }
  }

  /** Vue POD agrégée, ou `null` tant qu'aucun snapshot n'est reçu (cold start). */
  getClusterHealth(): IRealtimeClusterHealth | null {
    if (this.#lastInstances === null) return null;
    return mergeClusterHealth(this.#lastInstances, this.#snapTs);
  }

  /** Arrête le report et purge le cache. Idempotent. */
  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#started = false;
    this.#lastInstances = null;
  }
}

// Singleton worker (1 par process). `null` = sonde cluster non branchée (mono-process ou
// désactivée) → bypass total. Branché par le module Framework en worker de cluster.
let _client: ClusterProbeClient | null = null;

/** Branche le client de sonde cluster du process (worker). Remplace un éventuel précédent. */
export function setClusterProbeClient(
  client: ClusterProbeClient,
): ClusterProbeClient {
  _client = client;
  return client;
}

/**
 * Vue POD agrégée si la sonde cluster est branchée ET a reçu un snapshot, sinon `null`.
 * `null` ⇒ l'endpoint santé sert la vue per-instance (mono-process / sonde désactivée /
 * cold start). Lecture pure, jamais throw.
 */
export function clusterProbeHealth(): IRealtimeClusterHealth | null {
  return _client?.getClusterHealth() ?? null;
}

export default ClusterProbeClient;
