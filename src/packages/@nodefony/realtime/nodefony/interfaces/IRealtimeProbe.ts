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
import type {
  IProcessHealth,
  IProcessRich,
  IOrmLeanHealth,
  IInstanceErrorHealth,
} from "nodefony";
import type { IBackplaneInfo } from "./IBackplane";

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
  /**
   * Messages d'ingress backplane REFUSÉS (canal non déclaré broadcast) — monotone.
   * Reste à 0 en fonctionnement normal : un pair légitime n'émet que des canaux
   * broadcast. Un compteur qui décolle = pair mal configuré, ou écriture tierce
   * dans un bus partagé (Redis mutualisé). Cf `RealtimeHub` (contrôle d'admission).
   */
  ingressRejectedTotal: number;
  /**
   * Abonnements clients REFUSÉS par le plancher des canaux de plateforme —
   * monotone. Un canal réservé (`syslog:`, `orm:`…) a été demandé alors qu'aucun
   * module de sécurité n'est chargé : sans identité vérifiable, le hub ferme.
   * `> 0` signale une configuration incomplète (sécurité absente) autant qu'une
   * tentative d'accès — dans les deux cas, quelque chose est à regarder.
   */
  systemFloorDeniedTotal: number;
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
    /**
     * Cumul de frames jetées par back-pressure (drop latest-wins + close
     * slow-consumer), toutes connexions (monotone) → taux de perte dérivé côté
     * lecteur. `0` en régime sain ; croît = des clients lents sont contenus pour
     * protéger la mémoire process (sinon file `ws` non bornée → OOM).
     */
    drops: number;
  };
  /**
   * Carte d'identité du backplane effectif (driver, transport, cross-pod, canal).
   * Reflète l'état RÉEL : `local` si le hub n'a aucun backplane (mono-process ou
   * fallback fail-soft), sinon le descripteur du driver branché. Optionnel pour
   * rétrocompat des consommateurs qui construisent un probe partiel.
   */
  backplane?: IBackplaneInfo;
}

/** Snapshot enrichi de l'identité d'instance — santé per-instance d'un worker/pod. */
export interface IRealtimeHealth extends IRealtimeProbe {
  /** Identifiant de CE process/pod (per-instance). */
  instanceId: string;
  /**
   * Santé PROCESS du worker (CPU/mém/event-loop) — additif : la grille « salle des
   * machines » de la vue pod lit `instances[].process` par worker. Optionnel (absent si
   * sonde process coupée) → les consommateurs realtime existants l'ignorent (non-breaking).
   */
  process?: IProcessHealth;
  /**
   * Sonde process **riche** (GC/heap-spaces/handles/ELU active-idle/ctx-switches) —
   * présente UNIQUEMENT pendant un drill-down de CE worker (Phase 2 : le master a envoyé
   * `nf:probe:enrich` à ce pid). Absente sinon → « on paie ce qu'on regarde » (0 surcoût
   * hors drill). Fusionnée côté front avec `process` pour la vue Supervision complète.
   */
  rich?: IProcessRich;
  /**
   * Santé ORM **lean** du worker (connecteurs/requêtes/erreurs/latence EWMA) — additif,
   * comme `process`. Présent si un driver ORM a branché sa sonde (`setOrmHealthProvider`),
   * absent sinon → les consommateurs realtime l'ignorent (non-breaking). Agrégée pod dans
   * {@link IRealtimeClusterHealth.totals}.`orm`.
   */
  orm?: IOrmLeanHealth;
  /**
   * Compteurs d'erreurs Syslog du worker (ERROR/CRITIC cumulés) — additif. Permet une
   * carte « erreurs par worker » + un taux d'erreur pod (delta côté lecteur). Absent si la
   * sonde n'a pu lire le syslog du kernel.
   */
  errors?: IInstanceErrorHealth;
  /**
   * Diagnostic ORM **riche** du worker (par connecteur : ping/latence/stockage/pool +
   * flux requêtes) — blob OPAQUE `{ health, flow }` produit par le driver, présent
   * UNIQUEMENT pendant un drill ORM de CE worker (facette `"orm"` : le master a envoyé
   * `nf:probe:enrich {facet:"orm"}` à ce pid). Absent sinon → « on paie ce qu'on regarde »
   * (0 ping ORM hors drill). Consommé par la page drill `/nodefony/orm/<pid>` (canal
   * `nodefony:orm:rich@<pid>`) → diagnostic riche du pid EXACT (≠ round-robin).
   */
  ormRich?: unknown;
}

/**
 * Vue **POD agrégée** de la socket (Phase 4c, mode cluster) — la santé de TOUS les workers
 * du pod consolidée. Servie par n'importe quel worker via l'endpoint santé quand le master
 * pousse le snapshot agrégé (sinon on retombe sur {@link IRealtimeHealth} per-instance).
 *
 * `cluster: true` est le discriminant : un consommateur (Studio) distingue la vue pod de la
 * vue per-instance. `instances` garde le détail par worker (drill-down) ; `totals` somme les
 * scalaires (la backpressure `maxBufferedAmount` est un MAX, pas une somme — c'est le pire pod).
 */
export interface IRealtimeClusterHealth {
  /** Discriminant : vue agrégée multi-worker (≠ {@link IRealtimeHealth} per-instance). */
  cluster: true;
  /** Horodatage du snapshot agrégé (ms epoch). */
  ts: number;
  /** Nombre de workers présents dans l'agrégat. */
  instanceCount: number;
  /** Santé par worker (détail per-instance pour le drill-down). */
  instances: IRealtimeHealth[];
  /** Totaux pod (sommes des scalaires ; backpressure max = pire worker). */
  totals: {
    channelCount: number;
    publishTotal: number;
    fanoutTotal: number;
    inboundTotal: number;
    /** Ingress backplane refusés, tous workers (signal de sécurité pod-wide). */
    ingressRejectedTotal: number;
    connectionCount: number;
    bytesSentTotal: number;
    messagesSentTotal: number;
    backpressure: {
      /** Pire `maxBufferedAmount` parmi les workers (octets) — pas une somme. */
      maxBufferedAmount: number;
      /** Somme des octets en attente, tous workers. */
      totalBufferedAmount: number;
      /** Total des slow-consumers du pod. */
      slowConsumers: number;
      /** Total des frames jetées par back-pressure (drop + close), tous workers. */
      drops: number;
    };
    /**
     * Santé ORM agrégée du pod (sommes ; `maxEwmaMs` = pire worker). Présent si ≥ 1 worker
     * a remonté sa sonde ORM, absent sinon.
     */
    orm?: IOrmLeanHealth;
    /** Erreurs Syslog agrégées du pod (sommes). Présent si ≥ 1 worker a remonté ses compteurs. */
    errors?: IInstanceErrorHealth;
  };
}
