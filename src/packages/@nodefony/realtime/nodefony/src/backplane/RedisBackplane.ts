import type {
  IBackplane,
  BackplaneHandler,
  IBackplaneMessage,
} from "../../interfaces/IBackplane.js";

/**
 * Canal Redis **dédié** transportant toutes les enveloppes realtime entre pods.
 * Un seul canal pub/sub par défaut (les canaux logiques voyagent DANS l'enveloppe,
 * comme le `channel` IPC du {@link ClusterBackplane}) → 1 `SUBSCRIBE` au boot, pas
 * de (dés)abonnement Redis dynamique par canal applicatif. Surchargeable au
 * constructeur si plusieurs apps partagent le même Redis (namespacing).
 */
export const REDIS_RT_CHANNEL = "nodefony:realtime";

/**
 * Transport pub/sub du backplane Redis — abstrait `PUBLISH` / `SUBSCRIBE` derrière
 * un seam **injectable** (même pattern que `IClusterBackplaneTransport`). Permet de
 * prouver le routage + l'anti-echo **sans Redis** (bus en mémoire dans les tests),
 * et de ne PAS coupler `@nodefony/realtime` à la lib `redis` ni au module
 * `@nodefony/redis` (cf {@link createRedisServiceTransport}, le seul point couplé).
 */
export interface IRedisBackplaneTransport {
  /** Publie un message sérialisé sur le canal Redis (fire-and-forget côté backplane). */
  publish(channel: string, message: string): void;
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
    publish(channel, message): void {
      void publisher.publish(channel, message);
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
 * Type-guard d'enveloppe realtime — narrowing sûr d'un message Redis parsé.
 * Le canal Redis est dédié, mais on reste robuste : un autre process publiant un
 * JSON malformé sur le même canal ne doit pas faire crasher l'ingress.
 */
function isMessage(m: unknown): m is IBackplaneMessage {
  if (typeof m !== "object" || m === null) return false;
  const e = m as Partial<IBackplaneMessage>;
  return typeof e.channel === "string" && typeof e.originId === "string";
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
  #handler: BackplaneHandler | null = null;
  #started = false;

  constructor(
    transport: IRedisBackplaneTransport,
    originId: string = String(process.pid),
    redisChannel: string = REDIS_RT_CHANNEL,
  ) {
    this.#transport = transport;
    this.originId = originId;
    this.#redisChannel = redisChannel;
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
   */
  publish(channel: string, payload: unknown): void {
    const env: IBackplaneMessage = {
      channel,
      payload,
      originId: this.originId,
    };
    this.#transport.publish(this.#redisChannel, JSON.stringify(env));
  }

  /** Un seul handler d'ingress ; un appel ultérieur remplace le précédent. */
  onMessage(handler: BackplaneHandler): void {
    this.#handler = handler;
  }

  /** Parse + anti-echo + délégation. Robuste : ignore tout message non conforme. */
  #ingress(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // JSON malformé sur le canal partagé
    }
    if (!isMessage(parsed)) return;
    if (parsed.originId === this.originId) return; // anti-echo (Redis renvoie à l'émetteur)
    this.#handler?.({
      channel: parsed.channel,
      payload: parsed.payload,
      originId: parsed.originId,
    });
  }

  /** Désabonne du canal Redis et détache le handler. Idempotent. */
  async stop(): Promise<void> {
    this.#handler = null;
    if (!this.#started) return;
    this.#started = false;
    await this.#transport.unsubscribe(this.#redisChannel);
  }
}

export default RedisBackplane;
