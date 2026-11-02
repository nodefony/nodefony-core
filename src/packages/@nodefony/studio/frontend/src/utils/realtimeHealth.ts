/**
 * Lecture commune de la santé `nodefony:socket` — la même charge que sert
 * `/nodefony/realtime/api/health`.
 *
 * Les FORMES ne vivent plus ici : elles sont publiées par le cœur isomorphe
 * (`RealtimeHealthReport`, `IRealtimeHealth`, `IRealtimeClusterHealth`…), que le
 * serveur produit et que `StudioContract` donne au canal. Ce fichier ne garde que
 * ce qui appartient à Studio : ramener la vue pod et la vue d'un seul worker au
 * même modèle, pour que chaque écran cluster-aware n'ait qu'un cas à lire.
 */
import type {
  IRealtimeClusterHealth,
  IRealtimeHealth,
  RealtimeHealthReport,
} from "nodefony";

// Ré-exportées telles quelles (aucune copie) : les écrans santé importent d'ici.
export type {
  IOrmLeanHealth,
  IRealtimeChannelStat,
  IRealtimeClusterHealth,
  IRealtimeHealth,
  RealtimeHealthReport,
} from "nodefony";

/** Totaux d'un pod — sommes des workers, ou les scalaires du seul worker. */
export type PodTotals = IRealtimeClusterHealth["totals"];

/** Vue normalisée commune (mono-process et cluster ramenés au même modèle). */
export interface NormalizedHealth {
  cluster: boolean;
  ts: number;
  instances: IRealtimeHealth[];
  totals: PodTotals;
}

/** Discriminant cluster (vs per-instance). */
export function isCluster(
  h: RealtimeHealthReport,
): h is IRealtimeClusterHealth {
  if (!("cluster" in h)) return false;
  // Valeur venue du réseau : `=== true` refuse un `"true"` ou un `1` qu'un
  // serveur mal aligné renverrait, là où le type promet un booléen.
  const flag: unknown = h.cluster;
  return flag === true;
}

/** Ramène n'importe quelle réponse santé au modèle normalisé. */
export function normalize(
  h: RealtimeHealthReport | null,
): NormalizedHealth | null {
  if (!h) return null;
  if (isCluster(h)) {
    return {
      cluster: true,
      ts: h.ts,
      instances: h.instances,
      totals: h.totals,
    };
  }
  // Per-instance : 1 worker, totaux = ses propres scalaires.
  const totals: PodTotals = {
    channelCount: h.channelCount,
    publishTotal: h.publishTotal,
    fanoutTotal: h.fanoutTotal,
    inboundTotal: h.inboundTotal,
    ingressRejectedTotal: h.ingressRejectedTotal,
    localOnlyTotal: h.localOnlyTotal,
    connectionCount: h.connectionCount,
    bytesSentTotal: h.bytesSentTotal,
    messagesSentTotal: h.messagesSentTotal,
    backpressure: h.backpressure,
  };
  // Clés facultatives : absentes plutôt que `undefined` (`exactOptionalPropertyTypes`).
  if (h.orm) totals.orm = h.orm;
  if (h.errors) totals.errors = h.errors;
  return { cluster: false, ts: h.ts, instances: [h], totals };
}
