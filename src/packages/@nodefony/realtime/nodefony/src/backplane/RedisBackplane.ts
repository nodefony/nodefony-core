import type {
  IBackplane,
  BackplaneHandler,
  IBackplaneMessage,
  IBackplaneInfo,
} from "../../interfaces/IBackplane.js";
import { resolveBackplaneOriginId } from "./originId.js";
import { openBackplaneEnvelope, sealBackplaneEnvelope } from "./envelope.js";
import {
  BackplanePublishQueue,
  DEFAULT_MAX_QUEUE_BYTES,
  type BackplaneNotice,
} from "./publishQueue.js";

/**
 * BASE du canal Redis **dédié** transportant les enveloppes realtime entre pods.
 * Un seul canal pub/sub par app (les canaux logiques voyagent DANS l'enveloppe,
 * comme le `channel` IPC du {@link ClusterBackplane}) → 1 `SUBSCRIBE` au boot, pas
 * de (dés)abonnement Redis dynamique par canal applicatif.
 *
 * ⚠️ Le `database` Redis ne cloisonne PAS le pub/sub (global au serveur) → sur un
 * Redis mutualisé, deux apps sur le même canal se parlent (cross-talk). Le canal
 * effectif est donc suffixé par un namespace via {@link resolveRedisChannel}
 * (config `backplane.namespace`, sinon dérivé de `kernel.projectName` au wiring).
 */
export const REDIS_RT_CHANNEL = "nodefony:realtime";

/**
 * Construit le canal pub/sub effectif : `nodefony:realtime:<namespace>`, ou la
 * base seule si aucun namespace n'est résolu (compat mono-app). Deux déploiements
 * de la MÊME app sur un Redis partagé (staging + prod) ont le même nom dérivé →
 * y poser un `backplane.namespace` EXPLICITE distinct.
 *
 * @param namespace - cloison logique (config `backplane.namespace` ou nom d'app).
 * @returns le nom du canal Redis à `SUBSCRIBE`/`PUBLISH`.
 */
export function resolveRedisChannel(namespace?: string): string {
  return namespace ? `${REDIS_RT_CHANNEL}:${namespace}` : REDIS_RT_CHANNEL;
}

/**
 * Transport pub/sub du backplane Redis — abstrait `PUBLISH` / `SUBSCRIBE` derrière
 * un seam **injectable** (même pattern que `IClusterBackplaneTransport`). Permet de
 * prouver le routage + l'anti-echo **sans Redis** (bus en mémoire dans les tests),
 * et de ne PAS coupler `@nodefony/realtime` à la lib `redis` ni au module
 * `@nodefony/redis` (cf {@link createRedisServiceTransport}, le seul point couplé).
 */
export interface IRedisBackplaneTransport {
  /**
   * Publie un message sérialisé sur le canal Redis.
   *
   * Rendre la promesse du client (plutôt que `void`) permet au backplane de savoir
   * QUAND la publication est acquittée, donc de **borner** ce qui est en vol : sans
   * ce signal, la file interne du client réseau grossit sans limite sous rafale (cf
   * {@link BackplanePublishQueue}). Un transport synchrone (bus mémoire de test) rend
   * `void` — il n'a pas de file, la borne reste alors inerte.
   */
  publish(channel: string, message: string): void | Promise<unknown>;
  /**
   * Abonne au canal Redis. Le listener reçoit le message brut (string) ; le tri
   * (parse + anti-echo) est fait par le backplane. Async (Redis) ou sync (fake).
   */
  subscribe(
    channel: string,
    onMessage: (message: string) => void,
  ): void | Promise<void>;
  /** Désabonne du canal Redis et libère le listener associé. Idempotent. */
  unsubscribe(channel: string): void | Promise<void>;
}

/**
 * Client Redis **publisher** — surface structurelle minimale (compatible
 * `RedisClientType` v5). Typage structurel volontaire : évite d'ajouter `redis`
 * en dépendance de `@nodefony/realtime`.
 */
export interface IRedisPublisher {
  publish(channel: string, message: string): unknown;
}

/**
 * Client Redis **subscriber** dédié — surface structurelle minimale (compatible
 * `RedisClientType` v5). Un client abonné ne peut plus émettre de commandes
 * normales (protocole Redis) → publisher et subscriber sont 2 connexions distinctes
 * (cf `@nodefony/redis` : connexions `publish` / `subscribe`).
 */
export interface IRedisSubscriber {
  subscribe(
    channel: string,
    listener: (message: string, channel: string) => unknown,
  ): unknown;
  unsubscribe(
    channel: string,
    listener?: (message: string, channel: string) => unknown,
  ): unknown;
}

/**
 * Adapte deux clients Redis (publisher + subscriber dédié) au seam
 * {@link IRedisBackplaneTransport}. SEUL point de contact avec la lib `redis` —
 * et même ici le couplage est **structurel** (aucun import). Le consommateur
 * branche typiquement les connexions du module `@nodefony/redis` :
 *
 * ```ts
 * const redis = kernel.get("redis"); // RedisService
 * const bp = new RedisBackplane(
 *   createRedisServiceTransport(redis.getClient("publish")!, redis.getClient("subscribe")!),
 * );
 * defineRealtimeConfig({ backplane: { driver: "redis" } }, { backplane: bp });
 * ```
 *
 * Le listener Redis est conservé pour un `unsubscribe(channel, listener)` ciblé
 * (n'arrache pas d'éventuels autres abonnés du même client).
 */
export function createRedisServiceTransport(
  publisher: IRedisPublisher,
  subscriber: IRedisSubscriber,
): IRedisBackplaneTransport {
  let listener: ((message: string, channel: string) => void) | null = null;
  return {
    publish(channel, message): void | Promise<unknown> {
      // Retourné, pas avalé : c'est l'acquittement qui rend sa place dans la file
      // bornée du backplane — et le rejet y est absorbé (un `void` ici laissait
      // remonter un `unhandledRejection` quand Redis coupait en plein envoi).
      return publisher.publish(channel, message) as void | Promise<unknown>;
    },
    subscribe(channel, onMessage): void | Promise<void> {
      listener = (message): void => onMessage(message);
      return subscriber.subscribe(channel, listener) as void | Promise<void>;
    },
    unsubscribe(channel): void | Promise<void> {
      const current = listener;
      listener = null;
      return (
        current
          ? subscriber.unsubscribe(channel, current)
          : subscriber.unsubscribe(channel)
      ) as void | Promise<void>;
    },
  };
}

/**
 * Réglages optionnels du driver — regroupés en objet pour ne pas allonger une
 * liste de paramètres positionnels déjà à quatre entrées.
 */
export interface IRedisBackplaneOptions {
  /**
   * Seuil d'octets publiés en attente d'acquittement au-delà duquel les
   * publications sont jetées ; `0` = illimité (opt-out explicite). Défaut :
   * {@link DEFAULT_MAX_QUEUE_BYTES}.
   */
  maxQueueBytes?: number;
  /**
   * Annonce des transitions de la file (saturation / retour à la normale) — le
   * wiring y branche le syslog du module. Omis = silencieux : acceptable en test,
   * jamais en production (une dégradation doit être annoncée).
   */
  onNotice?: BackplaneNotice;
}

/**
 * Backplane **Redis pub/sub** (P13.5) — implémentation du port {@link IBackplane}
 * pour le fan-out realtime **cross-pod** (multi-host), là où le {@link ClusterBackplane}
 * ne couvrait que les workers d'un même pod (IPC). **Drop-in** : le hub ne change pas,
 * seul le driver branché change.
 *
 * Flux d'une publication cross-pod :
 *  - {@link publish} → emballe `{channel,payload,originId}` → `PUBLISH nodefony:realtime`
 *    (le fan-out **local** a déjà été fait par le hub avant cet appel) ;
 *  - réception (`SUBSCRIBE`) → {@link onMessage} handler → le hub réinjecte en
 *    fan-out **local uniquement** (`publishLocal`), jamais re-publié (anti-boucle).
 *
 * Anti-echo (2ᵉ barrière du contrat) : Redis renvoie au pod émetteur ce qu'il
 * publie (publisher + subscriber sont 2 connexions du même pod) → on **filtre son
 * propre `originId`** à la réception, sinon double fan-out local.
 *
 * Authenticité (F83) : Redis pub/sub n'authentifie PAS l'émetteur d'un message —
 * quiconque écrit dans ce Redis (autre app d'un Redis mutualisé, credential fuité,
 * SSRF vers le port) publierait sur les canaux de tous les pods. Avec un `secret`
 * partagé, l'enveloppe est **scellée** (HMAC, cf `envelope.ts`) et l'ingress devient
 * fail-closed strict : non scellé ou mal scellé = ignoré, sans downgrade possible.
 * Sans secret le transport reste ouvert (compat) — le wiring alerte alors au boot.
 *
 * Livraison : **best-effort / at-most-once** — pub/sub Redis ne persiste ni ne
 * rejoue ; un pod déconnecté rate les messages émis pendant sa coupure (le client
 * realtime re-synchronise). Ne pas sur-concevoir une fiabilité que le backing
 * n'offre pas (cf contrat {@link IBackplane}).
 *
 * Perf : hors mono-process (où le hub garde `#backplane === null`). `publish`
 * alloue 1 enveloppe + 1 `JSON.stringify` — sur le chemin broadcast realtime
 * (tickers/fan-out), PAS sur le hot path HTTP. SERVEUR uniquement (`process.pid`).
 */
export class RedisBackplane implements IBackplane {
  /** Nom du driver — source unique du littéral (registre + config). */
  static readonly driver = "redis";

  readonly originId: string;
  readonly #transport: IRedisBackplaneTransport;
  readonly #redisChannel: string;
  /** Secret de scellement partagé entre pods ; `null` = bus non authentifié. */
  readonly #secret: string | null;
  /** Borne mémoire des publications en vol (cf {@link BackplanePublishQueue}). */
  readonly #queue: BackplanePublishQueue;
  #handler: BackplaneHandler | null = null;
  #started = false;

  constructor(
    transport: IRedisBackplaneTransport,
    originId: string = resolveBackplaneOriginId(),
    redisChannel: string = REDIS_RT_CHANNEL,
    secret: string | null = null,
    options: IRedisBackplaneOptions = {},
  ) {
    this.#transport = transport;
    this.originId = originId;
    this.#redisChannel = redisChannel;
    this.#secret = secret;
    this.#queue = new BackplanePublishQueue(
      options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES,
      options.onNotice ?? null,
    );
  }

  /**
   * Abonne au canal Redis dédié. Idempotent (le flag est posé avant l'`await` →
   * un 2ᵉ appel concurrent ne ré-abonne pas).
   */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.#transport.subscribe(this.#redisChannel, (raw) =>
      this.#ingress(raw),
    );
  }

  /**
   * Propage une publication locale aux autres pods via Redis. NE refait PAS le
   * fan-out local (déjà fait par le hub). Sérialisé une fois ici.
   *
   * L'envoi passe par la **file bornée** : si le bus n'acquitte plus, les
   * publications suivantes sont jetées et comptées plutôt que d'empiler des
   * mégaoctets dans le client Redis (sémantique at-most-once déjà assumée par le
   * port ; le client realtime re-synchronise).
   */
  publish(channel: string, payload: unknown): void {
    const env: IBackplaneMessage = {
      channel,
      payload,
      originId: this.originId,
    };
    const raw = sealBackplaneEnvelope(env, this.#secret);
    // `byteLength` mesure ce qui partira réellement sur la socket (UTF-8) ; son
    // coût est négligeable devant le HMAC déjà calculé sur la même chaîne.
    this.#queue.send(Buffer.byteLength(raw), () =>
      this.#transport.publish(this.#redisChannel, raw),
    );
  }

  /** Un seul handler d'ingress ; un appel ultérieur remplace le précédent. */
  onMessage(handler: BackplaneHandler): void {
    this.#handler = handler;
  }

  /**
   * Ouverture d'enveloppe (parse + vérification du sceau) + anti-echo + délégation.
   * Robuste par construction : un message malformé, non scellé alors qu'un secret
   * est exigé, ou au sceau invalide, est **ignoré** — jamais réinjecté, jamais fatal.
   */
  #ingress(raw: string): void {
    const msg = openBackplaneEnvelope(raw, this.#secret);
    if (msg === null) return; // malformé / sceau absent ou invalide → jeté
    if (msg.originId === this.originId) return; // anti-echo (Redis renvoie à l'émetteur)
    this.#handler?.(msg);
  }

  /** Désabonne du canal Redis et détache le handler. Idempotent. */
  async stop(): Promise<void> {
    this.#handler = null;
    if (!this.#started) return;
    this.#started = false;
    await this.#transport.unsubscribe(this.#redisChannel);
  }

  describe(): IBackplaneInfo {
    return {
      driver: RedisBackplane.driver,
      kind: "redis-pubsub",
      originId: this.originId,
      crossPod: true,
      channel: this.#redisChannel,
      sealed: this.#secret !== null,
      queue: this.#queue.describe(),
    };
  }
}

export default RedisBackplane;
