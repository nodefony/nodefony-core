/**
 * Types MIROIR de la sonde santé `nodefony:socket` (frontière isomorphe : on ne
 * JAMAIS importer le runtime serveur `@nodefony/framework` dans le bundle client).
 *
 * Source de vérité = les contrats core `IRealtimeProbe.ts` (process + socket +
 * ORM lean + erreurs) servis par le data plane `/nodefony/realtime/api/health` ET
 * poussés sur le canal `nodefony:socket`. **Un seul** mirror partagé ici → évite la
 * dérive silencieuse vue ailleurs (Cluster, RealtimeConsole, ProcessGraphGrid en
 * portaient chacun une copie). Toute page cluster-aware importe d'ICI.
 */

/** Santé PROCESS d'un worker (miroir de `IProcessHealth`, core). */
export interface ProcessHealth {
  pid: number;
  uptime: number;
  cpuPercent: number;
  eventLoopMs: number;
  eluUtilization: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  ts: number;
}

/** Backpressure agrégée d'une connexion/instance (risque mémoire #1). */
export interface Backpressure {
  maxBufferedAmount: number;
  totalBufferedAmount: number;
  slowConsumers: number;
}

/** Stat per-canal (fan-out). */
export interface ChannelStat {
  channel: string;
  subscribers: number;
  messages: number;
}

/** Santé ORM lean d'un worker (miroir de `IOrmLeanHealth`, core). Cumuls monotones. */
export interface OrmLeanHealth {
  connectors: number;
  connected: number;
  queryTotal: number;
  slowTotal: number;
  errorTotal: number;
  reconnectTotal: number;
  maxEwmaMs: number | null;
}

/** Erreurs Syslog d'un worker (miroir de `IInstanceErrorHealth`, core). Cumuls monotones. */
export interface InstanceErrorHealth {
  errorTotal: number;
  criticTotal: number;
}

/** Santé per-instance d'UN worker (miroir de `IRealtimeHealth`). */
export interface InstanceHealth {
  instanceId: string;
  ts: number;
  channels: ChannelStat[];
  channelCount: number;
  publishTotal: number;
  fanoutTotal: number;
  inboundTotal: number;
  connectionCount: number;
  bytesSentTotal: number;
  messagesSentTotal: number;
  backpressure: Backpressure;
  /** Optionnel : absent si la sonde process est coupée. */
  process?: ProcessHealth;
  /** Optionnel : absent si aucun driver ORM n'a branché sa sonde. */
  orm?: OrmLeanHealth;
  /** Optionnel : absent si la sonde n'a pu lire le syslog du kernel. */
  errors?: InstanceErrorHealth;
  /** Ingress backplane refusés (canal non diffusable) — signal de sécurité. */
  ingressRejectedTotal?: number;
  /** Fond de panier realtime de l'instance (bus inter-process). */
  /**
   * Drivers de backplane enregistrés dans ce process (registre ouvert) — ce qu'on
   * POURRAIT brancher, là où `backplane.driver` ne dit que l'actif.
   */
  backplaneDrivers?: string[];
  backplane?: {
    driver?: string;
    kind?: string;
    crossPod?: boolean;
    /** Canal de transport effectif (canal Redis, topic…). */
    channel?: string;
    /** Identité de CE pair sur le bus (pod/process) — qui publie. */
    originId?: string;
    /** Messages scellés (authenticité vérifiée) — pertinent sur bus partagé. */
    sealed?: boolean;
    /**
     * File d'envoi vers le bus — présente sur les transports réseau, dont les
     * publications sont acquittées de façon asynchrone. `droppedTotal > 0` = du
     * fan-out a été sacrifié pour tenir la mémoire du processus.
     */
    queue?: {
      /** Octets publiés en attente d'acquittement (instantané). */
      bytes?: number;
      /** Seuil de jet ; `0` = illimité. */
      maxBytes?: number;
      /** Publications jetées faute de place (cumul). */
      droppedTotal?: number;
      /** Publications refusées par le bus (cumul). */
      failedTotal?: number;
    };
  };
}

/** Totaux pod (miroir de `IRealtimeClusterHealth.totals`). */
export interface PodTotals {
  channelCount: number;
  publishTotal: number;
  fanoutTotal: number;
  inboundTotal: number;
  /** Ingress backplane refusés, tous workers (signal de sécurité pod-wide). */
  ingressRejectedTotal?: number;
  connectionCount: number;
  bytesSentTotal: number;
  messagesSentTotal: number;
  backpressure: Backpressure;
  /** Agrégat ORM pod (sommes ; `maxEwmaMs` = pire worker). Absent si aucun worker ne le remonte. */
  orm?: OrmLeanHealth;
  /** Agrégat erreurs pod (sommes). Absent si aucun worker ne le remonte. */
  errors?: InstanceErrorHealth;
}

/** Vue POD agrégée (miroir de `IRealtimeClusterHealth`). */
export interface ClusterHealth {
  cluster: true;
  ts: number;
  instanceCount: number;
  instances: InstanceHealth[];
  totals: PodTotals;
}

/** Réponse de l'endpoint santé : vue pod OU snapshot per-instance. */
export type HealthPayload = ClusterHealth | InstanceHealth;

/** Vue normalisée commune (mono-process et cluster ramenés au même modèle). */
export interface NormalizedHealth {
  cluster: boolean;
  ts: number;
  instances: InstanceHealth[];
  totals: PodTotals;
}

/** Discriminant cluster (vs per-instance). */
export function isCluster(h: HealthPayload): h is ClusterHealth {
  return (h as ClusterHealth).cluster === true;
}

/** Ramène n'importe quelle réponse santé au modèle normalisé. */
export function normalize(h: HealthPayload | null): NormalizedHealth | null {
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
  return {
    cluster: false,
    ts: h.ts,
    instances: [h],
    totals: {
      channelCount: h.channelCount,
      publishTotal: h.publishTotal,
      fanoutTotal: h.fanoutTotal,
      inboundTotal: h.inboundTotal,
      ingressRejectedTotal: h.ingressRejectedTotal,
      connectionCount: h.connectionCount,
      bytesSentTotal: h.bytesSentTotal,
      messagesSentTotal: h.messagesSentTotal,
      backpressure: h.backpressure,
      orm: h.orm,
      errors: h.errors,
    },
  };
}
