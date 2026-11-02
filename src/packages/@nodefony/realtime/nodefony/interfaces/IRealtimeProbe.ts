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
// Les formes PUBLIÉES par la sonde (ce que lit le navigateur) vivent au cœur
// isomorphe : `@nodefony/realtime` les ré-exporte sous leurs noms historiques.
export type {
  IRealtimeChannelStat,
  IRealtimeProbe,
  IRealtimeHealth,
  IRealtimeClusterHealth,
  RealtimeHealthReport,
} from "nodefony";

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
  /**
   * Cumul de frames JETÉES par back-pressure sur cette connexion (monotone) :
   * drop latest-wins (`bufferedAmount ≥` seuil DROP) + la frame en cours quand on
   * coupe un slow-consumer (`close 1013`). `> 0` = ce client n'absorbe pas le flux.
   */
  readonly dropped: number;
  /**
   * Cumul de trames BINAIRES reçues et écartées faute de lecteur (monotone) :
   * connexion texte sans `onRealtimeBinary`. Absent = la connexion ne compte pas.
   */
  readonly binaryDiscarded?: number;
  /**
   * Cumul de trames reçues et écartées parce qu'illisibles par le codec de la
   * connexion (monotone). Absent = la connexion ne compte pas.
   */
  readonly malformedDiscarded?: number;
}
