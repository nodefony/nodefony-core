import { constants as http2constants } from "node:http2";
import type {
  Http2SecureServer,
  Http2Server,
  ServerHttp2Session,
} from "node:http2";
import type { IHttpConfig } from "../../config/config";
import { SHUTDOWN_STREAMS_WAIT_MS } from "../context/http/StreamLifecycle";
import {
  ANNOUNCE_CAP_MS,
  GOAWAY_MAX_AGE,
  closeIdleSession,
} from "./http2Goaway";

/**
 * Taille d'une trame PING sur le fil : en-tête de 9 octets et charge de 8
 * (RFC 9113 §4.1, §6.7). Un ACK écrit en coûte exactement autant — constaté en
 * clair comme sous TLS, dont les compteurs portent le clair.
 */
const PING_FRAME_BYTES = 17;

/** Granularité minimale du tour de surveillance : borne le réveil d'une config pathologique. */
const MIN_TICK_MS = 250;

/**
 * Granularité maximale : chaque échéance (âge, grâce, keepalive) est tenue à
 * une seconde près. gRPC A9 : « implementations are generally free to
 * implement them quite coarsely ».
 */
const MAX_TICK_MS = 1000;

/** Données de débogage du GOAWAY d'un pair qui pingue trop (gRPC A8). */
const GOAWAY_TOO_MANY_PINGS: Uint8Array = new TextEncoder().encode(
  "too_many_pings",
);

/** Aucun PING de keepalive en attente de réponse. */
const NO_PENDING = -1;

/** Rappel obligatoire de `session.ping()` : partagé, aucune allocation par PING. */
const ignorePingAck = (): void => {};

/**
 * La gestion des connexions HTTP/2 lue dans la section `http2` du module,
 * résolue en nombres : `0` coupe une fonction, `Infinity` lève une borne.
 */
export interface IHttp2ConnectionPolicy {
  /** Âge maximal d'une connexion (ms), avant aléa ; `0` = jamais. */
  readonly maxConnectionAge: number;
  /** Délai de grâce après le GOAWAY d'âge (ms) ; `Infinity` = sans borne. */
  readonly maxConnectionAgeGrace: number;
  /** Silence du pair avant un PING (ms) ; `0` = aucun PING. */
  readonly keepaliveInterval: number;
  /** Attente d'un octet du pair après un PING (ms). */
  readonly keepaliveTimeout: number;
  /** Écart minimal entre deux PING reçus (ms) ; `0` = aucune police. */
  readonly minPingInterval: number;
  /** Fautes tolérées avant `ENHANCE_YOUR_CALM`. */
  readonly maxPingStrikes: number;
}

/**
 * Résout la gestion des connexions HTTP/2 depuis la config du module.
 *
 * @param config - `module.options.http2`, validée.
 * @returns la politique, ou `null` quand aucune clé n'est posée : alors rien
 *   n'est armé — ni écouteur, ni minuteur — et le serveur se comporte comme
 *   sans elle, à l'octet près.
 */
export function http2ConnectionPolicy(
  config: IHttpConfig["http2"] | undefined,
): IHttp2ConnectionPolicy | null {
  if (config === undefined) return null;
  const maxConnectionAge = config.maxConnectionAge ?? 0;
  const keepaliveInterval = config.keepaliveInterval ?? 0;
  const minPingInterval = config.minPingInterval ?? 0;
  if (
    maxConnectionAge === 0 &&
    keepaliveInterval === 0 &&
    minPingInterval === 0
  )
    return null;
  return {
    maxConnectionAge,
    maxConnectionAgeGrace: config.maxConnectionAgeGrace ?? Infinity,
    keepaliveInterval,
    keepaliveTimeout: config.keepaliveTimeout,
    minPingInterval,
    maxPingStrikes: config.maxPingStrikes,
  };
}

/**
 * Échéance d'âge d'une connexion, avec ± 10 % d'aléa propre à la connexion
 * (gRPC A9) : sans lui, les clients d'un même démarrage reconnecteraient
 * ensemble, à période fixe.
 *
 * @param now - instant d'ouverture (ms, horloge monotone)
 * @param maxAge - âge maximal (ms) ; `0` = jamais
 * @param random - tirage dans `[0, 1)`
 * @returns l'instant du GOAWAY d'âge, ou `Infinity`
 */
export function connectionAgeDeadline(
  now: number,
  maxAge: number,
  random: number,
): number {
  if (maxAge === 0) return Infinity;
  return now + maxAge * (0.9 + 0.2 * random);
}

/**
 * Ce que la surveillance retient d'UNE session HTTP/2 : la session et des
 * nombres, tous posés à la construction (forme stable).
 *
 * L'état PORTE sa session et vit dans un `Set` : le tour parcourt des valeurs,
 * sans couple clé/valeur — mesuré en A/B (Node 26.13, 100 et 10 000
 * sessions) : 4,7 à 6,2 ns par session et par tour, contre 9,9 à 12,4 pour
 * une `Map` parcourue par `forEach` ou `for…of`.
 */
export class Http2SessionState<S = ServerHttp2Session> {
  /** La session suivie. */
  readonly session: S;
  /** Instant du GOAWAY d'âge ; `Infinity` une fois annoncé ou sans âge. */
  ageDeadline: number;
  /** Fin du délai de grâce ; `Infinity` tant que l'âge n'est pas annoncé. */
  graceDeadline: number;
  /** Destruction après la fin des flux longs ; `Infinity` sinon. */
  destroyAt: number;
  /** Octets lus au dernier tour (`socket.bytesRead`). */
  lastRead: number;
  /** Instant du dernier octet lu constaté. */
  lastReadAt: number;
  /** Envoi du PING de keepalive en attente ; {@link NO_PENDING} sinon. */
  pingedAt: number;
  /** Dernier PING reçu jugé valide (gRPC A8 `last_valid_ping_time`). */
  validPingAt: number;
  /** Fautes accumulées (gRPC A8 `ping_strikes`). */
  strikes: number;
  /** Octets écrits au dernier PING reçu (`socket.bytesWritten`). */
  writtenRef: number;
  /** Octets de trames PING (ACK et keepalive) écrits depuis `writtenRef`. */
  pingBytes: number;

  /**
   * @param session - la session suivie
   * @param now - instant d'ouverture
   * @param ageDeadline - cf {@link connectionAgeDeadline}
   * @param bytesRead - octets déjà lus sur la connexion
   * @param bytesWritten - octets déjà écrits
   */
  constructor(
    session: S,
    now: number,
    ageDeadline: number,
    bytesRead: number,
    bytesWritten: number,
  ) {
    this.session = session;
    this.ageDeadline = ageDeadline;
    this.graceDeadline = Infinity;
    this.destroyAt = Infinity;
    this.lastRead = bytesRead;
    this.lastReadAt = now;
    this.pingedAt = NO_PENDING;
    this.validPingAt = -Infinity;
    this.strikes = 0;
    this.writtenRef = bytesWritten;
    this.pingBytes = 0;
  }
}

/**
 * Les gestes sur une session, séparés de la règle : la règle se prouve pas à
 * pas sur des doublures, les gestes sur de vraies sessions.
 */
export interface IHttp2SessionActions<S> {
  /** La session n'est pas détruite (sa socket se lit encore). */
  alive(session: S): boolean;
  /** Octets lus sur la connexion depuis son ouverture. */
  bytesRead(session: S): number;
  /**
   * Envoie un PING ; `false` s'il n'est pas parti — dont la session qui a
   * déjà annoncé sa fermeture : après son propre GOAWAY, Node refuse tout
   * PING (`ERR_HTTP2_PING_CANCEL`, constaté sur 26.13).
   */
  ping(session: S): boolean;
  /** GOAWAY d'âge en deux temps (« max_age »), puis fermeture douce. */
  announceAge(session: S): void;
  /** Termine les flux longs de la session ; rend leur nombre. */
  endStreams(session: S): number;
  /** Détruit la session. */
  destroy(session: S): void;
}

/**
 * Un tour de surveillance : âge, délai de grâce et keepalive de chaque session.
 *
 * Fonction PURE du temps (l'horloge est passée en argument) : la règle se
 * prouve pas à pas, sans minuteur réel — comme le battement des WebSocket.
 *
 * - **Keepalive** (gRPC A9, « independent of whether there are outstanding
 *   RPCs ») : un PING part quand le pair n'a rien envoyé depuis
 *   `keepaliveInterval` ; tout octet lu ensuite prouve la vie (gRPC A8 :
 *   « not receiving any bytes ») ; rien pendant `keepaliveTimeout` → détruite.
 *   Limite de Node : aucun PING ne part après le GOAWAY de la session (âge ou
 *   inactivité) — celui déjà en vol est encore jugé ; ensuite, seul le délai
 *   de grâce borne la connexion.
 * - **Âge** (gRPC A9) : à l'échéance, GOAWAY `NO_ERROR` « max_age » en deux
 *   temps (RFC 9113 §6.8) ; les flux en cours vont à leur terme.
 * - **Grâce** : comptée depuis l'annonce (l'idéal A9 est le second GOAWAY, au
 *   plus {@link ANNOUNCE_CAP_MS} plus tard) ; à son terme, les flux longs
 *   reçoivent leur fin (ADR-0026 D8), puis la session est détruite au plus
 *   {@link SHUTDOWN_STREAMS_WAIT_MS} après — aussitôt s'il n'y en a aucun.
 *
 * @param states - l'état de chaque session suivie
 * @param now - l'instant du tour (`performance.now()` en production)
 * @param policy - la politique résolue
 * @param actions - les gestes sur une session
 */
export function http2ConnectionTick<S>(
  states: Iterable<Http2SessionState<S>>,
  now: number,
  policy: IHttp2ConnectionPolicy,
  actions: IHttp2SessionActions<S>,
): void {
  const keepalive = policy.keepaliveInterval > 0;
  for (const state of states) {
    const session = state.session;
    if (!actions.alive(session)) continue;
    if (now >= state.destroyAt) {
      actions.destroy(session);
      continue;
    }
    if (keepalive && keepaliveTick(state, now, policy, actions)) continue;
    if (now >= state.ageDeadline) {
      state.ageDeadline = Infinity;
      state.graceDeadline = now + policy.maxConnectionAgeGrace;
      actions.announceAge(session);
    } else if (now >= state.graceDeadline) {
      state.graceDeadline = Infinity;
      if (actions.endStreams(session) === 0) actions.destroy(session);
      else state.destroyAt = now + SHUTDOWN_STREAMS_WAIT_MS;
    }
  }
}

/** Le keepalive d'une session ; `true` si elle vient d'être détruite. */
function keepaliveTick<S>(
  state: Http2SessionState<S>,
  now: number,
  policy: IHttp2ConnectionPolicy,
  actions: IHttp2SessionActions<S>,
): boolean {
  const session = state.session;
  const read = actions.bytesRead(session);
  if (read !== state.lastRead) {
    state.lastRead = read;
    state.lastReadAt = now;
    state.pingedAt = NO_PENDING;
    return false;
  }
  if (state.pingedAt !== NO_PENDING) {
    if (now - state.pingedAt < policy.keepaliveTimeout) return false;
    actions.destroy(session);
    return true;
  }
  if (
    now - state.lastReadAt >= policy.keepaliveInterval &&
    actions.ping(session)
  ) {
    state.pingedAt = now;
    state.pingBytes += PING_FRAME_BYTES;
  }
  return false;
}

/**
 * Juge un PING reçu (gRPC A8, « Server Enforcement ») : trop proche du dernier
 * PING valide, c'est une faute ; au-delà de `maxPingStrikes` fautes, le pair
 * abuse.
 *
 * Toute trame écrite par le serveur depuis le PING précédent, hors trames
 * PING, remet le compte à zéro — A8 : « When a HEADERS or DATA frame is sent,
 * set last_valid_ping_time = epoch; ping_strikes = 0 ». Elle se lit sur les
 * octets écrits : au-delà de ceux des PING, quelque chose d'autre est parti.
 * Une trame de contrôle (SETTINGS, WINDOW_UPDATE) remet aussi à zéro — le
 * flou est du côté de l'indulgence, qu'A8 demande (« some fuzziness »).
 *
 * @param state - l'état de la session
 * @param now - instant de réception (ms, horloge monotone)
 * @param bytesWritten - octets écrits sur la connexion à cet instant
 * @param policy - la politique résolue (`minPingInterval > 0`)
 * @returns `true` si le pair abuse
 */
export function judgeReceivedPing<S>(
  state: Http2SessionState<S>,
  now: number,
  bytesWritten: number,
  policy: IHttp2ConnectionPolicy,
): boolean {
  if (bytesWritten - state.writtenRef > state.pingBytes) {
    state.validPingAt = -Infinity;
    state.strikes = 0;
  }
  // L'ACK de CE PING part avant ou après cet instant : il est compté ici.
  state.writtenRef = bytesWritten;
  state.pingBytes = PING_FRAME_BYTES;
  if (now - state.validPingAt >= policy.minPingInterval) {
    state.validPingAt = now;
    return false;
  }
  state.strikes += 1;
  return state.strikes > policy.maxPingStrikes;
}

/**
 * Désarme le délai d'inactivité AVANT la destruction : Node (26.13) marque la
 * session détruite puis désarme son minuteur, qui la retiendrait alors jusqu'à
 * son échéance (nodejs/node#66885, corrigé par nodejs/node#66886).
 */
function destroySession(session: ServerHttp2Session): void {
  if (session.destroyed) return;
  session.setTimeout(0);
  session.destroy();
}

/** Les gestes réels sur une session de Node. */
function sessionActions(
  endStreams: (session: ServerHttp2Session) => number,
): IHttp2SessionActions<ServerHttp2Session> {
  return {
    alive: (session) => !session.destroyed,
    bytesRead: (session) => session.socket.bytesRead,
    // Fermée : le PING serait annulé, et son erreur allouée à chaque tour.
    ping: (session) => !session.closed && session.ping(ignorePingAck),
    announceAge: (session) =>
      closeIdleSession(session, ANNOUNCE_CAP_MS, GOAWAY_MAX_AGE),
    endStreams,
    destroy: destroySession,
  };
}

/**
 * Gère les connexions HTTP/2 d'UN serveur — TLS (5152) comme h2c — selon la
 * section `http2` : âge maximal et délai de grâce (gRPC A9), PING de
 * keepalive (gRPC A9, RFC 9113 §6.7), police des PING reçus (gRPC A8,
 * RFC 9113 §10.5).
 *
 * Coût : par CONNEXION, un état de dix nombres et un ou deux écouteurs sur la
 * session (libérés avec elle) ; par SERVEUR, un seul minuteur `unref`, armé
 * à la première session et arrêté à la dernière. Rien par requête ni par
 * trame, hors un jugement de quelques additions par PING reçu.
 */
export class Http2ConnectionManager {
  readonly policy: IHttp2ConnectionPolicy;
  readonly #states = new Set<Http2SessionState>();
  readonly #actions: IHttp2SessionActions<ServerHttp2Session>;
  readonly #onAbuse: (remoteAddress: string | undefined) => void;
  readonly #random: () => number;
  /** Période du tour ; `0` quand seule la police des PING est armée. */
  readonly #tickMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #stopped = false;

  /**
   * @param policy - la politique résolue ({@link http2ConnectionPolicy})
   * @param endStreams - termine les flux longs d'une session (noyau HTTP)
   * @param onAbuse - prévenu quand un pair est fermé pour PING abusifs
   * @param random - tirage de l'aléa d'âge (injectable pour les tests)
   */
  constructor(
    policy: IHttp2ConnectionPolicy,
    endStreams: (session: ServerHttp2Session) => number,
    onAbuse: (remoteAddress: string | undefined) => void,
    random: () => number = Math.random,
  ) {
    this.policy = policy;
    this.#actions = sessionActions(endStreams);
    this.#onAbuse = onAbuse;
    this.#random = random;
    this.#tickMs = tickPeriod(policy);
  }

  /** Nombre de sessions suivies. */
  get size(): number {
    return this.#states.size;
  }

  /** Le minuteur du tour est armé. */
  get ticking(): boolean {
    return this.#timer !== null;
  }

  /**
   * Suit une session neuve (événement `session` du serveur).
   *
   * @param session - la session ouverte
   */
  add(session: ServerHttp2Session): void {
    if (this.#stopped || session.destroyed) return;
    const now = performance.now();
    const socket = session.socket;
    const state = new Http2SessionState(
      session,
      now,
      connectionAgeDeadline(now, this.policy.maxConnectionAge, this.#random()),
      socket.bytesRead,
      socket.bytesWritten,
    );
    this.#states.add(state);
    session.once("close", () => {
      this.#states.delete(state);
      if (this.#states.size === 0) this.#clearTimer();
    });
    if (this.policy.minPingInterval > 0) {
      session.on("ping", () => {
        if (
          judgeReceivedPing(
            state,
            performance.now(),
            session.socket.bytesWritten,
            this.policy,
          )
        )
          this.#calm(session);
      });
    }
    if (this.#tickMs > 0 && this.#timer === null) {
      this.#timer = setInterval(
        () => this.tick(performance.now()),
        this.#tickMs,
      );
      this.#timer.unref();
    }
  }

  /**
   * Un tour de surveillance à l'instant donné (cf {@link http2ConnectionTick}).
   *
   * @param now - instant du tour
   */
  tick(now: number): void {
    http2ConnectionTick(this.#states, now, this.policy, this.#actions);
  }

  /**
   * Arrête la surveillance — à l'arrêt du serveur, dont le drain ferme alors
   * les sessions seul. Idempotent.
   */
  stop(): void {
    this.#stopped = true;
    this.#clearTimer();
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * GOAWAY `ENHANCE_YOUR_CALM` « too_many_pings », puis fermeture immédiate
   * (gRPC A8 : elle fait échouer les appels en cours, ce qui rend la
   * mauvaise configuration visible au client).
   */
  #calm(session: ServerHttp2Session): void {
    if (session.destroyed) return;
    const remoteAddress = session.socket.remoteAddress;
    session.goaway(
      http2constants.NGHTTP2_ENHANCE_YOUR_CALM,
      session.state.lastProcStreamID ?? 0,
      GOAWAY_TOO_MANY_PINGS,
    );
    destroySession(session);
    this.#onAbuse(remoteAddress);
  }
}

/** Période du tour : la plus courte fenêtre armée, bornée à `[250, 1000]` ms. */
function tickPeriod(policy: IHttp2ConnectionPolicy): number {
  let shortest = Infinity;
  if (policy.maxConnectionAge > 0) {
    shortest = Math.min(shortest, policy.maxConnectionAge);
    if (policy.maxConnectionAgeGrace > 0)
      shortest = Math.min(shortest, policy.maxConnectionAgeGrace);
  }
  if (policy.keepaliveInterval > 0) {
    shortest = Math.min(
      shortest,
      policy.keepaliveInterval,
      policy.keepaliveTimeout,
    );
  }
  if (shortest === Infinity) return 0;
  return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, shortest));
}

/**
 * Arme la gestion des connexions d'un serveur HTTP/2 si la section `http2`
 * la demande. Règle UNIQUE des serveurs HTTP/2 — TLS (5152) comme h2c.
 *
 * @param server - le serveur HTTP/2, avant son `listen`
 * @param config - `module.options.http2`
 * @param endStreams - termine les flux longs d'une session (noyau HTTP)
 * @param onAbuse - prévenu quand un pair est fermé pour PING abusifs
 * @returns le gestionnaire, à arrêter au drain ; `null` si rien n'est posé —
 *   aucun écouteur n'est alors ajouté au serveur.
 */
export function manageHttp2Connections(
  server: Http2Server | Http2SecureServer,
  config: IHttpConfig["http2"] | undefined,
  endStreams: (session: ServerHttp2Session) => number,
  onAbuse: (remoteAddress: string | undefined) => void,
): Http2ConnectionManager | null {
  const policy = http2ConnectionPolicy(config);
  if (policy === null) return null;
  const manager = new Http2ConnectionManager(policy, endStreams, onAbuse);
  server.on("session", (session: ServerHttp2Session) => manager.add(session));
  return manager;
}
