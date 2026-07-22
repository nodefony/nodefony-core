/**
 * Port du **backplane** de la socket Nodefony — l'abstraction de fan-out
 * **CROSS-PROCESS** du {@link RealtimeHub}.
 *
 * Le hub fait le fan-out **local** (aux connexions du process courant). Le backplane
 * propage une publication aux **autres pairs** (autres workers d'un même pod via IPC,
 * autres pods via Redis…) et réinjecte localement ce que les pairs publient. C'est
 * **le même contrat** quel que soit le backing — c'est tout l'intérêt : on définit le
 * port UNE fois et on prouve l'archi avec plusieurs implémentations interchangeables :
 *
 *  - {@link LoopbackBackplane} — mono-process, **no-op** (aucun pair) ;
 *  - `ClusterBackplane` (IPC, master-gateway) — pairs = workers du même pod, SANS infra
 *    → « comme si Redis était là » : le banc d'essai qui stabilise l'archi multi-process ;
 *  - `RedisBackplane` (P13) — pairs = pods du cluster, **drop-in** (le hub ne change pas).
 *
 * Anti-boucle (règle absolue) : une publication locale part vers le backplane, mais un
 * message **reçu** du backplane est réinjecté en **fan-out LOCAL UNIQUEMENT** (jamais
 * re-publié vers le backplane, sinon tempête). Le hub applique cette barrière en
 * appelant `RealtimeHub.publishLocal` dans son handler. Le backplane applique la 2ᵉ
 * barrière : il **filtre son propre {@link originId}** (echo) avant d'appeler le handler.
 *
 * Sémantique de livraison : **best-effort / at-most-once** (comme un pub/sub) — aucune
 * garantie de delivery ni d'ordre cross-pair ; le client realtime re-synchronise. Ne pas
 * sur-concevoir une fiabilité que les backings (Redis pub/sub) n'offrent pas.
 *
 * Cf vision « la socket Nodefony » + mémoire `project_cluster_backplane_vision`.
 */

/**
 * Compteurs de la **file d'envoi** d'un backplane à transport réseau : ce qui est
 * publié mais pas encore acquitté par le bus. Sans borne, cette file (interne au
 * client réseau) grossit sans limite sous rafale — d'où le seuil et ses compteurs,
 * exposés jusqu'à la sonde et Studio. Cf `BackplanePublishQueue`.
 */
export interface IBackplaneQueueInfo {
  /** Octets publiés en attente d'acquittement par le transport (instantané). */
  bytes: number;
  /** Seuil au-dessus duquel une publication est jetée ; `0` = illimité. */
  maxBytes: number;
  /** Publications JETÉES faute de place (monotone). `0` en régime sain. */
  droppedTotal: number;
  /** Publications REFUSÉES par le transport (bus coupé…) (monotone). */
  failedTotal: number;
}

/**
 * Message transporté entre pairs par le backplane. Sérialisé une fois à l'émission
 * (IPC `structuredClone` / Redis JSON) ; le `payload` doit donc être structurellement
 * clonable / sérialisable (pas de fonction, pas de cycle).
 */
export interface IBackplaneMessage {
  /** Canal logique (mêmes noms que côté hub, suffixe de cadence `:<ms>` inclus). */
  channel: string;
  /** Charge applicative diffusée sur le canal. */
  payload: unknown;
  /** Identité du pair **émetteur** — sert l'anti-echo (cf {@link IBackplane.originId}). */
  originId: string;
}

/**
 * Handler d'ingress : reçoit un message publié par un **autre** pair. L'echo du pair
 * courant a déjà été filtré par l'implémentation → le handler peut réinjecter sans
 * condition (mais en fan-out **local only**).
 */
export type BackplaneHandler = (msg: IBackplaneMessage) => void;

/**
 * **Carte d'identité** d'un backplane — descripteur de DONNÉE (pas un log) décrivant
 * l'état du fond de panier. Source unique alimentant trois sorties cohérentes : la
 * ligne stdout au boot, le champ `backplane` de la sonde (`/api/health`) et la vue
 * Studio. Réutilisable par les tests / un agent IA sans dupliquer la connaissance
 * « c'est quoi ce backplane ».
 */
export interface IBackplaneInfo {
  /** Nom du driver (clé du registre). Ex. `redis`, `cluster`, `loopback`. */
  driver: string;
  /** Nature du transport. Ex. `redis-pubsub`, `ipc`, `local`. */
  kind: string;
  /** Identité de CE pair (process/pod). Ex. `String(process.pid)`. */
  originId: string;
  /** `true` si le fan-out franchit les frontières de pod (multi-host). */
  crossPod: boolean;
  /** Canal/topic de transport, si applicable (canal Redis, topic Kafka). */
  channel?: string;
  /**
   * Les messages sont-ils **scellés** (authenticité de l'émetteur vérifiée) ?
   * Renseigné par les drivers à transport PARTAGÉ, où un tiers peut écrire :
   * `false` y signale un bus ouvert. Absent quand la question n'a pas de sens
   * (mono-process, IPC master↔workers — authentifié par construction).
   */
  sealed?: boolean;
  /**
   * État de la **file d'envoi** vers le bus (octets en vol, seuil, jetés). Renseigné
   * par les drivers à transport RÉSEAU, dont les publications sont acquittées de
   * façon asynchrone : c'est là qu'un bus lent fait grossir la mémoire du pod.
   * `droppedTotal > 0` = du fan-out cross-pod a été sacrifié pour tenir la mémoire.
   * Absent quand le transport n'a pas de file (mono-process, IPC synchrone).
   */
  queue?: IBackplaneQueueInfo;
}

/**
 * Contrat d'un backplane realtime. Implémentation **stateless du point de vue métier**
 * (l'état des canaux vit dans le hub) ; le backplane ne porte que le transport vers les
 * pairs + son identité.
 */
export interface IBackplane {
  /** Identité stable de CE pair (process/pod). Discrimine l'echo. Ex. `String(process.pid)`. */
  readonly originId: string;

  /**
   * Démarre le transport vers les pairs (connexion IPC/Redis, abonnements). Idempotent.
   * Peut être synchrone (IPC) ou asynchrone (Redis) → retour `void | Promise<void>`.
   */
  start(): void | Promise<void>;

  /**
   * Propage une publication locale aux **autres** pairs. NE refait PAS le fan-out local
   * (déjà fait par le hub). No-op s'il n'y a aucun pair (mono-process).
   */
  publish(channel: string, payload: unknown): void;

  /**
   * Enregistre le handler d'ingress (messages venus des autres pairs, echo déjà filtré).
   * Un seul handler à la fois — un appel ultérieur remplace le précédent.
   */
  onMessage(handler: BackplaneHandler): void;

  /** Arrête le transport et libère les ressources (connexions, listeners). Idempotent. */
  stop(): void | Promise<void>;

  /**
   * Carte d'identité du backplane (driver, transport, origine, cross-pod, canal).
   * Donnée pure — consommée par le log de boot, la sonde santé et Studio.
   */
  describe(): IBackplaneInfo;
}

export default IBackplane;
