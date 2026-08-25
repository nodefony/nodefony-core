import {
  Service,
  Container,
  Event,
  type Severity,
  type Msgid,
  type Message,
} from "nodefony";
import {
  createClient,
  type RedisClientType,
  type RedisClientOptions,
} from "redis";
import type RedisService from "../service/redis";

/**
 * Une connexion Redis nommée — enveloppe un client `redis` v6 et gère son cycle
 * de vie (création, écoute des événements, fermeture propre).
 *
 * Perf/mémoire : les handlers d'événements sont conservés en propriété et
 * **explicitement retirés** à la fermeture (`removeListener`) pour éviter toute
 * fuite si la connexion est recréée — règle absolue perf-mémoire du framework.
 */
export default class Connection extends Service {
  /** Client redis v6 — `null` tant que `create()` n'a pas réussi. */
  client: RedisClientType | null = null;
  /** Service Redis parent (accès container / kernel / événements). */
  service: RedisService;
  /** true entre les événements `connect` et `end`. */
  connected: boolean = false;
  /** Options `createClient` assemblées (par `buildClientOptions`). */
  override options: RedisClientOptions;

  // Handlers stockés pour cleanup explicite (anti-fuite listener).
  #onError: ((error: Error) => void) | null = null;
  #onConnect: (() => void) | null = null;
  #onReady: (() => void) | null = null;
  #onEnd: (() => void) | null = null;
  #onReconnecting: (() => void) | null = null;

  constructor(
    name: string,
    options: RedisClientOptions,
    redisService: RedisService,
  ) {
    super(
      name,
      redisService.container as Container,
      redisService.notificationsCenter as Event,
      options as Record<string, unknown>,
    );
    this.service = redisService;
    this.options = options;
  }

  override log(
    pci: unknown,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ) {
    if (!msgid) {
      // eslint-disable-next-line no-param-reassign
      msgid = `\x1b[36mREDIS CONNECTION ${this.name} \x1b[0m`;
    }
    return super.log(pci, severity, msgid, msg);
  }

  /** Hôte:port lisible pour les logs (gère le cas `url`). */
  #endpoint(): string {
    if (this.options.url) {
      return this.options.url.replace(/:[^:@/]*@/, ":***@");
    }
    const socket = this.options.socket as
      { host?: string; port?: number } | undefined;
    return `${socket?.host ?? "?"}:${socket?.port ?? "?"}`;
  }

  /**
   * Crée le client, attache les listeners, ouvre la connexion.
   *
   * @returns le client connecté.
   * @throws si la connexion échoue (propagé au service, qui logue).
   */
  async create(): Promise<RedisClientType> {
    this.client = createClient(this.options) as RedisClientType;

    this.#onError = (error: Error): void => {
      this.log(error, "ERROR");
      this.fire("onError", error, this);
    };
    this.#onConnect = (): void => {
      this.connected = true;
      this.log(`CONNECT ${this.#endpoint()}`, "INFO");
      this.fire("onConnect", this);
    };
    this.#onReady = (): void => {
      this.fire("onReady", this);
    };
    this.#onEnd = (): void => {
      this.connected = false;
      this.log(`END ${this.#endpoint()}`, "INFO");
      this.fire("onEnd", this);
    };
    this.#onReconnecting = (): void => {
      this.log(`RECONNECTING ${this.#endpoint()}`, "WARNING");
      this.fire("onReconnecting", this);
    };

    this.client.on("error", this.#onError);
    this.client.on("connect", this.#onConnect);
    this.client.on("ready", this.#onReady);
    this.client.on("end", this.#onEnd);
    this.client.on("reconnecting", this.#onReconnecting);

    await this.client.connect();
    return this.client;
  }

  /** Retire tous les listeners attachés dans `create()` (anti-fuite). */
  #removeListeners(): void {
    if (!this.client) {
      return;
    }
    if (this.#onError) this.client.removeListener("error", this.#onError);
    if (this.#onConnect) this.client.removeListener("connect", this.#onConnect);
    if (this.#onReady) this.client.removeListener("ready", this.#onReady);
    if (this.#onEnd) this.client.removeListener("end", this.#onEnd);
    if (this.#onReconnecting)
      this.client.removeListener("reconnecting", this.#onReconnecting);
    this.#onError = null;
    this.#onConnect = null;
    this.#onReady = null;
    this.#onEnd = null;
    this.#onReconnecting = null;
  }

  /**
   * Ferme proprement la connexion et nettoie les listeners.
   *
   * redis v6 : `client.close()` remplace `quit()` (déprécié, envoyait `QUIT` —
   * lui-même déprécié côté Redis 7.2). Fermeture gracieuse : draine les commandes
   * en vol puis ferme le socket. (`destroy()` = fermeture forcée, non souhaitée ici.)
   */
  async close(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      if (this.client.isOpen) {
        await this.client.close();
      }
    } finally {
      this.#removeListeners();
      this.connected = false;
      this.log("REDIS client close", "INFO");
    }
  }
}
