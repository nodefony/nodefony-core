/**
 * Contrats d'**auto-observabilité de la socket Nodefony** — la sonde SERVEUR du
 * {@link RealtimeHub}. Applique le patron sondes+hub (comme les sondes ORM) à la
 * couche realtime elle-même : « la socket s'observe à travers elle-même ».
 *
 * Trois familles de signaux, dérivées de l'analyse du multiplexing N canaux / 1 WS
 * (le design est bon mais déplace 3 responsabilités sur le hub) :
 *  - **fan-out** : combien de canaux, d'abonnés, de livraisons (chatter du broker) ;
 *  - **backpressure** (risque #1, SEUL vrai blocker mémoire) : `bufferedAmount` par
 *    connexion — une connexion lente fait grossir la file `ws` → OOM, et le
 *    multiplexing CONCENTRE (1 WS lente bloque TOUS ses canaux) ;
 *  - **débit octets/frames** : matière à mesurer AVANT d'optimiser (stringify unique,
 *    seuil de drop). Tous les cumuls sont **monotones** → le débit/s se dérive côté
 *    lecteur (delta `total`/`ts`, comme le CPU% ou le flux ORM) : 0 état de lecture.
 */

/** Vue d'UNE connexion realtime pour la sonde (backpressure = risque #1). */
export interface IRealtimeConnProbe {
  /** État du transport (0..3, aligné `WebSocket.readyState`). */
  readonly readyState: number;
  /**
   * Octets en file d'envoi NON encore drainés vers le réseau (`ws.bufferedAmount`).
   * > 0 durablement = slow-consumer → la file interne grossit (borne = timeout TCP)
   * → pression mémoire. C'est LE signal du blocker #1.
   */
  readonly bufferedAmount: number;
  /** Cumul d'octets envoyés à cette connexion (monotone). */
  readonly bytesSent: number;
  /** Cumul de frames envoyées à cette connexion (monotone). */
  readonly messagesSent: number;
}

/** Stat per-canal du hub (fan-out). */
export interface IRealtimeChannelStat {
  /** Nom du canal (suffixe `:<ms>` de granularité inclus). */
  channel: string;
  /** Abonnés locaux vivants (sinks) — instantané. */
  subscribers: number;
  /** Publications cumulées sur ce canal (monotone) → débit dérivé côté lecteur. */
  messages: number;
}

/**
 * Snapshot PUR du hub (sans identité process) — ce que renvoie
 * {@link RealtimeHub.probe}. Per-instance/pod (cloud-native) ; l'agrégat multi-pod
 * = backplane Redis / Prometheus (P13).
 */
export interface IRealtimeProbe {
  /** Horodatage du snapshot (ms epoch) — base du calcul de débit côté lecteur. */
  ts: number;
  /** Canaux actifs (≥ 1 abonné) avec abonnés + publications cumulées. */
  channels: IRealtimeChannelStat[];
  /** Nombre de canaux actifs (= 1 provider/canal/pod). */
  channelCount: number;
  /** Appels `publish` cumulés (monotone). */
  publishTotal: number;
  /** Livraisons cumulées (`publish` × abonnés) — vrai coût de fan-out (monotone). */
  fanoutTotal: number;
  /** Frames entrantes full-duplex cumulées (canaux gated SIP/bridge) (monotone). */
  inboundTotal: number;
  /** Connexions realtime vivantes. */
  connectionCount: number;
  /** Somme cumulée des octets envoyés, toutes connexions (monotone). */
  bytesSentTotal: number;
  /** Somme cumulée des frames envoyées, toutes connexions (monotone). */
  messagesSentTotal: number;
  /** Backpressure agrégée (instantanée) — risque #1. */
  backpressure: {
    /** Pire `bufferedAmount` parmi les connexions (octets). */
    maxBufferedAmount: number;
    /** Somme des `bufferedAmount` (octets en attente process-wide). */
    totalBufferedAmount: number;
    /** Connexions au-dessus du seuil d'alerte slow-consumer. */
    slowConsumers: number;
  };
}

/** Snapshot enrichi de l'identité d'instance — sortie de `buildRealtimeHealth`. */
export interface IRealtimeHealth extends IRealtimeProbe {
  /** Identifiant de CE process/pod (per-instance). */
  instanceId: string;
}
