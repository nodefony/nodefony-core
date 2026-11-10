import type {
  IBackplane,
  BackplaneHandler,
  IBackplaneMessage,
  IBackplaneInfo,
} from "../../interfaces/IBackplane.js";
import { containsBytes, type IFrameCodec } from "nodefony";
import { resolveBackplaneOriginId } from "./originId.js";
import { isCallable, isRecord, isThenable } from "../guards.js";
import {
  sealBackplaneEnvelope,
  sealBackplaneEnvelopeBytes,
} from "./envelope.js";
import { BackplaneIngress } from "./ingress.js";
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
 * Construit le **sujet binaire** du bus (ADR-0021 S6) : le canal texte suffixé du
 * protocole du codec. Un second sujet, versionné par son nom, que les exemplaires
 * plus anciens n'écoutent pas — le message texte n'est pas touché, et un codec
 * binaire d'un autre format aurait son propre sujet.
 *
 * @param redisChannel - le canal texte effectif ({@link resolveRedisChannel}).
 * @param codec - le codec binaire du serveur.
 * @returns le nom du canal Redis qui porte les enveloppes binaires.
 */
export function resolveRedisBytesChannel(
  redisChannel: string,
  codec: IFrameCodec,
): string {
  return `${redisChannel}:${codec.protocol}`;
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
  publish(
    channel: string,
    message: string | Uint8Array,
  ): void | Promise<unknown>;
  /**
   * Abonne au canal Redis. Le listener reçoit le message brut (string) ; le tri
   * (parse + anti-echo) est fait par le backplane. Async (Redis) ou sync (fake).
   */
  subscribe(
    channel: string,
    onMessage: (message: string) => void,
  ): void | Promise<void>;
  /**
   * Abonne au canal Redis en mode **octets** : le listener reçoit le message tel
   * que publié, sans décodage UTF-8 (sujet binaire, ADR-0021 S6). Optionnel : un
   * transport qui ne l'offre pas laisse les octets sur le serveur qui les publie.
   */
  subscribeBytes?(
    channel: string,
    onMessage: (message: Uint8Array) => void,
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
  publish(channel: string, message: string | Buffer): unknown;
}

/** Écouteur texte d'un client Redis abonné. */
type RedisTextListener = (message: string, channel: string) => unknown;
/** Écouteur octets d'un client Redis abonné (`bufferMode`). */
type RedisBytesListener = (message: Buffer, channel: Buffer) => unknown;

/**
 * Client Redis **subscriber** dédié — surface structurelle minimale (compatible
 * `RedisClientType` v5). Un client abonné ne peut plus émettre de commandes
 * normales (protocole Redis) → publisher et subscriber sont 2 connexions distinctes
 * (cf `@nodefony/redis` : connexions `publish` / `subscribe`).
 *
 */
export interface IRedisSubscriber {
  subscribe(channel: string, listener: RedisTextListener): unknown;
  unsubscribe(channel: string, listener?: RedisTextListener): unknown;
}

/**
 * Client Redis abonné en mode **octets** — le troisième argument `true`
 * (`bufferMode` de node-redis) rend les messages en `Buffer`, sans décodage
 * UTF-8 : c'est lui qui porte le sujet binaire intact (ADR-0021 S6).
 *
 * Interface SÉPARÉE de {@link IRedisSubscriber}, et non une surcharge de
 * celle-ci : les deux formes réunies dans une même interface ne sont plus
 * satisfaites ni par le type de node-redis (générique sur le mode), ni par une
 * doublure de test qui ne connaît que le texte. Séparées, chacune l'est.
 */
export interface IRedisBytesSubscriber {
  subscribe(
    channel: string,
    listener: RedisBytesListener,
    bufferMode: true,
  ): unknown;
  unsubscribe(
    channel: string,
    listener: RedisBytesListener,
    bufferMode: true,
  ): unknown;
}

/**
 * Vrai si la valeur expose la surface d'un client Redis publisher — vérifié au
 * démarrage, sur le client que rend le service `redis`.
 */
export function isRedisPublisher(value: unknown): value is IRedisPublisher {
  return isRecord(value) && isCallable(value.publish);
}

/** Vrai si la valeur expose la surface d'un client Redis subscriber dédié. */
export function isRedisSubscriber(value: unknown): value is IRedisSubscriber {
  return (
    isRecord(value) &&
    isCallable(value.subscribe) &&
    isCallable(value.unsubscribe)
  );
}

/**
 * Vrai si la valeur expose la surface d'un client abonné capable du mode octets.
 *
 * La forme ne dit pas si le troisième argument est compris : ce garde vaut pour
 * le client que rend le service `redis` (node-redis, qui l'accepte). Un client qui
 * l'ignorerait livrerait du texte au sujet binaire — illisible pour le codec,
 * donc jeté, compté sous un secret (`sealRejectedTotal`), jamais réinjecté.
 */
export function isRedisBytesSubscriber(
  value: unknown,
): value is IRedisBytesSubscriber {
  return isRedisSubscriber(value);
}

/** Ramène l'acquittement d'une commande Redis au contrat du transport. */
function settled(ack: unknown): void | Promise<void> {
  return isThenable(ack) ? ack.then(() => undefined) : undefined;
}

/** Écouteur posé sur un canal Redis, avec le mode qui a servi à l'abonner. */
type RegisteredListener =
  | { readonly bytes: false; readonly fn: RedisTextListener }
  | { readonly bytes: true; readonly fn: RedisBytesListener };

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
 * Chaque listener Redis est conservé, par canal, pour un `unsubscribe(channel,
 * listener)` ciblé (n'arrache pas d'éventuels autres abonnés du même client).
 *
 * @param publisher - connexion de publication.
 * @param subscriber - connexion d'abonnement dédiée.
 * @param bytesSubscriber - la MÊME connexion d'abonnement, vue en mode octets
 *   ({@link IRedisBytesSubscriber}) ; absente, le transport n'offre pas de sujet
 *   binaire et les octets restent sur le serveur qui les publie.
 * @returns le transport du {@link RedisBackplane}.
 */
export function createRedisServiceTransport(
  publisher: IRedisPublisher,
  subscriber: IRedisSubscriber,
  bytesSubscriber?: IRedisBytesSubscriber,
): IRedisBackplaneTransport {
  // Un écouteur PAR canal : le sujet texte et le sujet binaire sont deux canaux
  // Redis, chacun désabonné avec SON écouteur et SON mode.
  const listeners = new Map<string, RegisteredListener>();
  const transport: IRedisBackplaneTransport = {
    publish(channel, message): void | Promise<unknown> {
      // Retourné, pas avalé : c'est l'acquittement qui rend sa place dans la file
      // bornée du backplane — et le rejet y est absorbé (un `void` ici laissait
      // remonter un `unhandledRejection` quand Redis coupait en plein envoi).
      // Une vérification de forme par publication (quelques ns face à un
      // aller-retour réseau) plutôt qu'une conversion crue sur parole.
      // Des octets passent en `Buffer` VUE sur la même mémoire : aucune copie.
      const ack = publisher.publish(
        channel,
        typeof message === "string"
          ? message
          : Buffer.from(message.buffer, message.byteOffset, message.byteLength),
      );
      return isThenable(ack) ? ack : undefined;
    },
    subscribe(channel, onMessage): void | Promise<void> {
      const fn: RedisTextListener = (message): void => onMessage(message);
      listeners.set(channel, { bytes: false, fn });
      return settled(subscriber.subscribe(channel, fn));
    },
    unsubscribe(channel): void | Promise<void> {
      const current = listeners.get(channel);
      listeners.delete(channel);
      if (current === undefined)
        return settled(subscriber.unsubscribe(channel));
      if (!current.bytes)
        return settled(subscriber.unsubscribe(channel, current.fn));
      return settled(bytesSubscriber?.unsubscribe(channel, current.fn, true));
    },
  };
  if (bytesSubscriber !== undefined) {
    transport.subscribeBytes = (channel, onMessage): void | Promise<void> => {
      const fn: RedisBytesListener = (message): void => onMessage(message);
      listeners.set(channel, { bytes: true, fn });
      return settled(bytesSubscriber.subscribe(channel, fn, true));
    };
  }
  return transport;
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
   * Annonce des transitions de la file (saturation / retour à la normale) et des
   * sceaux refusés à l'entrée — le wiring y branche le syslog du module. Omis = silencieux : acceptable en test,
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
  readonly #notice: BackplaneNotice | null;
  /** Tri de l'entrée : écho, sceau, refus comptés (brique commune aux pilotes). */
  readonly #ingress: BackplaneIngress;
  #handler: BackplaneHandler | null = null;
  #started = false;
  /**
   * Sujet binaire : son codec et son canal Redis ({@link resolveRedisBytesChannel}) ;
   * `null` tant que {@link enableBytes} n'a pas armé les octets.
   */
  #bytes: { readonly codec: IFrameCodec; readonly channel: string } | null =
    null;

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
    this.#notice = options.onNotice ?? null;
    this.#queue = new BackplanePublishQueue(
      options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES,
      this.#notice,
    );
    this.#ingress = new BackplaneIngress(originId, secret, this.#notice);
  }

  /**
   * Abonne au canal Redis dédié. Idempotent (le flag est posé avant l'`await` →
   * un 2ᵉ appel concurrent ne ré-abonne pas).
   */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await Promise.all([
      this.#transport.subscribe(this.#redisChannel, (raw) =>
        this.#receive(raw),
      ),
      this.#subscribeBytes(),
    ]);
  }

  /**
   * Arme le sujet binaire (ADR-0021 S6) : les charges qui contiennent des octets
   * partent en enveloppe encodée par `codec` sur un second canal Redis, et ce
   * canal est écouté. Les charges sans octets gardent le sujet texte, intact pour
   * les exemplaires plus anciens. Idempotent.
   *
   * @param codec - le codec binaire du serveur.
   * @returns `false` si le transport ne sait pas s'abonner en octets.
   */
  enableBytes(codec: IFrameCodec): boolean {
    if (this.#transport.subscribeBytes === undefined) return false;
    if (this.#bytes !== null) return true;
    this.#bytes = {
      codec,
      channel: resolveRedisBytesChannel(this.#redisChannel, codec),
    };
    // Armé après `start()` : l'abonnement part maintenant ; avant, `start()` le fera.
    if (this.#started) {
      void this.#subscribeBytes().catch((err: unknown) =>
        this.#notice?.(
          `backplane : abonnement au sujet binaire en échec — les octets des autres exemplaires ne seront pas reçus (${err instanceof Error ? err.message : String(err)})`,
          "WARNING",
        ),
      );
    }
    return true;
  }

  /** Abonne le sujet binaire s'il est armé ; sinon rien. */
  async #subscribeBytes(): Promise<void> {
    const bytes = this.#bytes;
    if (bytes === null) return;
    await this.#transport.subscribeBytes?.(bytes.channel, (raw) =>
      this.#receiveBytes(raw, bytes.codec),
    );
  }

  /**
   * Propage une publication locale aux autres pods via Redis. NE refait PAS le
   * fan-out local (déjà fait par le hub). Sérialisé une fois ici.
   *
   * L'envoi passe par la **file bornée** : si le bus n'acquitte plus, les
   * publications suivantes sont jetées et comptées plutôt que d'empiler des
   * mégaoctets dans le client Redis (sémantique at-most-once déjà assumée par le
   * port ; le client realtime re-synchronise). Un ordre de contrôle, lui, part
   * toujours (cf {@link BackplanePublishQueue.send}).
   */
  publish(channel: string, payload: unknown): void {
    const env: IBackplaneMessage = {
      channel,
      payload,
      originId: this.originId,
    };
    // Le parcours qui cherche des octets n'est payé que si le sujet binaire est
    // armé — même règle que la convention `$bytes` du codec texte (ADR-0022 §2).
    const bytes = this.#bytes;
    if (bytes !== null && containsBytes(payload)) {
      const bin = sealBackplaneEnvelopeBytes(env, bytes.codec, this.#secret);
      this.#queue.send(channel, bin.byteLength, () =>
        this.#transport.publish(bytes.channel, bin),
      );
      return;
    }
    const raw = sealBackplaneEnvelope(env, this.#secret);
    // `byteLength` mesure ce qui partira réellement sur la socket (UTF-8) ; son
    // coût est négligeable devant le HMAC déjà calculé sur la même chaîne.
    this.#queue.send(channel, Buffer.byteLength(raw), () =>
      this.#transport.publish(this.#redisChannel, raw),
    );
  }

  /** Un seul handler d'ingress ; un appel ultérieur remplace le précédent. */
  onMessage(handler: BackplaneHandler): void {
    this.#handler = handler;
  }

  /**
   * Remet au hub ce que le tri d'entrée admet ({@link BackplaneIngress}) : l'écho
   * de ce pod (Redis renvoie à l'émetteur) est compté sans être décodé ; un message
   * malformé ou au sceau refusé est **ignoré** — jamais réinjecté, jamais fatal —,
   * compté et annoncé la première fois puis une fois sur cent (ADR-0021 S6).
   */
  #receive(raw: string): void {
    const msg = this.#ingress.text(raw);
    if (msg !== null) this.#handler?.(msg);
  }

  /** Même tri que {@link #receive}, sur le sujet binaire. */
  #receiveBytes(raw: Uint8Array, codec: IFrameCodec): void {
    const msg = this.#ingress.bytes(raw, codec);
    if (msg !== null) this.#handler?.(msg);
  }

  /**
   * Laisse partir les publications déjà émises (acquittées ou refusées par Redis), puis désabonne du canal et détache le handler. Idempotent.
   *
   * Sans l'attente, un arrêt suivi de la sortie du processus perdait ce qui
   * était encore dans la file — la preuve de vie FINALE de la présence comprise,
   * et les pairs gardaient alors ce pod jusqu'au délai d'oubli. Un Redis qui ne
   * répond plus fait attendre : l'appelant borne (l'arrêt du module le fait).
   */
  async stop(): Promise<void> {
    this.#handler = null;
    if (!this.#started) return;
    this.#started = false;
    await this.#queue.settled();
    await Promise.all([
      this.#transport.unsubscribe(this.#redisChannel),
      this.#bytes !== null
        ? this.#transport.unsubscribe(this.#bytes.channel)
        : undefined,
    ]);
  }

  describe(): IBackplaneInfo {
    return {
      driver: RedisBackplane.driver,
      kind: "redis-pubsub",
      originId: this.originId,
      crossPod: true,
      channel: this.#redisChannel,
      sealed: this.#secret !== null,
      ...(this.#secret !== null && {
        sealRejectedTotal: this.#ingress.sealRejectedTotal,
      }),
      echoTotal: this.#ingress.echoTotal,
      queue: this.#queue.describe(),
      ...(this.#bytes !== null && { bytes: true }),
    };
  }
}

export default RedisBackplane;
