import { AsyncResource } from "node:async_hooks";
import http from "node:http";
import type http2 from "node:http2";
import type HttpContext from "./HttpContext";
import Http2Response from "../http2/Response";
import HttpError from "../../errors/httpError";

/**
 * Le flux d'événements serveur (SSE) d'une réponse HTTP — `text/event-stream`.
 *
 * SSE n'est pas une méthode : c'est un FORMAT de réponse, choisi à l'exécution
 * par l'action. La route reste déclarée `GET` ou `POST`, et le même `POST` peut
 * répondre en JSON ou en flux selon l'en-tête `Accept`.
 *
 * Ce que la classe porte, et qu'une action écrite à la main oubliait :
 * - les en-têtes du flux (`Cache-Control: no-cache, no-transform`,
 *   `X-Accel-Buffering: no` pour qu'un nginx ne mette pas le flux en tampon) ;
 * - HTTP/1.1 ET HTTP/2 : en HTTP/1.1 Node découpe le corps en morceaux
 *   (RFC 9112 §7.1) ; en HTTP/2 l'écriture passe par le FLUX, et aucun
 *   `Transfer-Encoding` n'est posé (interdit, RFC 9113 §8.2.2) ;
 * - la fermeture lue sur la RÉPONSE, jamais sur la requête : en HTTP/2,
 *   `request.on("close")` part dès la fin du corps de la requête — c'est le
 *   défaut qui avait tué l'ancien flux de la console d'administration ;
 * - le délai d'inactivité de la requête DÉSARMÉ (un flux n'a pas de fin
 *   attendue), remplacé par un battement de cœur sur un minuteur `unref` ;
 * - la contre-pression : un client lent freine l'émetteur qui attend `send()` ;
 *   un client qui ne lit PLUS est coupé au bout de `stallTimeout` ;
 * - les gardes des connexions longues, les mêmes que pour une socket
 *   WebSocket : plafond de connexions par IP (`wsMaxConnectionsPerIp`, un seul
 *   budget pour les deux transports) et fermeture du flux quand l'identité qui
 *   l'a ouvert est révoquée (`RevocationWatch`, cœur).
 *
 * Norme : WHATWG HTML §9.2 (copie hors ligne
 * `nodefony-framework-dev/references/rfc/specs/whatwg-sse.md`).
 */

/** Options d'ouverture d'un flux. */
export interface ISseStreamOptions {
  /**
   * Période du battement de cœur (commentaire `:`), en ms entre 1 et 2^31-1 —
   * `false` pour l'éteindre. Défaut : 15 000, la valeur que la norme suggère
   * contre les proxys qui coupent une connexion muette (§9.2.7).
   */
  heartbeat?: number | false | undefined;
  /** Délai de reconnexion imposé au client (champ `retry:`), en ms. */
  retry?: number | undefined;
  /**
   * Délai maximal pendant lequel une écriture peut rester bloquée — le client
   * ne lit plus —, en ms entre 1 et 2^31-1 ; au-delà, la connexion est coupée.
   * Remplace le délai d'inactivité de la requête, désarmé pendant un flux.
   * `false` pour l'éteindre. Défaut : 30 000.
   */
  stallTimeout?: number | false | undefined;
  /**
   * Taille maximale d'un événement écrit, en octets (UTF-8). Au-delà, `send()`
   * lève une `RangeError` au lieu d'écrire. Défaut : 1 Mio.
   */
  maxEventBytes?: number | undefined;
  /**
   * Durée de vie maximale du flux, en ms entre 1 et 2^31-1 : il est fermé
   * ensuite, et un `EventSource` se reconnecte — en repassant par le pare-feu.
   * `false` (défaut) : pas de borne.
   */
  maxDuration?: number | false | undefined;
}

/** Ce qu'un événement porte en plus de ses données. */
export interface ISseSendOptions {
  /** Type de l'événement (champ `event:`) — absent : `message`. */
  event?: string | undefined;
  /** Identifiant (champ `id:`) que le client renverra en `Last-Event-ID`. */
  id?: string | undefined;
}

/** Battement de cœur par défaut, en ms (§9.2.7 : « every 15 seconds or so »). */
export const SSE_HEARTBEAT_MS = 15_000;
/** Délai de blocage d'écriture par défaut, en ms. */
export const SSE_STALL_TIMEOUT_MS = 30_000;
/** Taille maximale d'un événement par défaut, en octets (1 Mio). */
export const SSE_MAX_EVENT_BYTES = 1_048_576;
/**
 * Plus long délai qu'un minuteur sait tenir (2^31-1 ms). Au-delà, Node le
 * ramène à 1 ms : un `retry` qui le dépasse ferait reconnecter le client en
 * rafale, un battement qui le dépasse battrait mille fois par seconde.
 */
const MAX_TIMER_MS = 2_147_483_647;
/** Commentaire de battement de cœur — ignoré par tout client conforme. */
const HEARTBEAT = ":\n\n";
/** Fin de ligne : CRLF, CR ou LF (§9.2.5). */
const LINE_BREAK = /\r\n|\r|\n/;

/** Ce sur quoi on écrit : la réponse HTTP/1.1, ou le flux HTTP/2. */
type SseTarget = http.ServerResponse | http2.ServerHttp2Stream;

/**
 * Refuse un champ d'une seule ligne qui contiendrait une fin de ligne.
 *
 * Laisser passer un CR ou un LF dans `event` ou `id` permettrait à une valeur
 * venue d'un utilisateur de clore l'événement et d'en FORGER un autre dans le
 * flux — l'équivalent SSE d'une injection d'en-tête.
 *
 * @throws TypeError quand la valeur contient CR, LF ou NUL.
 */
function singleLine(name: string, value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new TypeError(
      `Champ SSE « ${name} » : fin de ligne ou NUL interdits`,
    );
  }
  return value;
}

/**
 * Texte d'un événement : la chaîne telle quelle, sinon son JSON.
 *
 * `JSON.stringify` rend `undefined` pour `undefined`, une fonction ou un
 * symbole, et son type `string` le tait : on l'élargit avant de le lire.
 */
function serialize(data: unknown): string {
  if (typeof data === "string") return data;
  const json: unknown = JSON.stringify(data);
  return typeof json === "string" ? json : "";
}

/**
 * Refuse une option de délai hors de ce qu'un minuteur sait tenir.
 *
 * @throws RangeError quand la valeur n'est ni `false` ni un entier entre 1 et 2^31-1.
 */
function checkTimer(name: string, value: number | false | undefined): void {
  if (value === undefined || value === false) return;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_MS) {
    throw new RangeError(
      `SSE : ${name} entier entre 1 et ${MAX_TIMER_MS} ms, ou false, attendu`,
    );
  }
}

/** Ce que le flux reçoit de son ouverture, options résolues. */
interface ISseSettings {
  heartbeat: number | false;
  stallTimeout: number | false;
  maxEventBytes: number;
  maxDuration: number | false;
  /** Revalidateur de l'identité du flux — `null` pour un anonyme. */
  revalidate: (() => Promise<boolean>) | null;
}

/** Préfixe chaque ligne d'un texte par `prefix` — `data: ` ou `: `. */
function lines(prefix: string, text: string): string {
  let out = "";
  for (const line of text.split(LINE_BREAK)) out += `${prefix}${line}\n`;
  return out;
}

/**
 * Un flux `text/event-stream` ouvert sur une réponse.
 *
 * Il s'obtient par {@link openSseStream} (ou `this.renderSse()` dans un
 * contrôleur), jamais par `new` : l'ouverture écrit les en-têtes, et un flux
 * sans en-têtes ne se rattrape pas.
 */
export class SseStream {
  readonly #context: HttpContext;
  readonly #target: SseTarget;
  /** La réponse dont on écoute la fermeture — en HTTP/2, l'objet de compatibilité. */
  readonly #response: http.ServerResponse | http2.Http2ServerResponse;
  readonly #stallTimeout: number | false;
  readonly #maxEventBytes: number;
  readonly #revalidate: (() => Promise<boolean>) | null;
  #closed = false;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  /** Coupure d'un client qui ne lit plus — armée seulement sous pression. */
  #stall: ReturnType<typeof setTimeout> | null = null;
  /** Fin de vie du flux — armée seulement si `maxDuration` est posé. */
  #lifetime: ReturnType<typeof setTimeout> | null = null;
  /** Écouteurs de fermeture — `null` tant que personne n'en pose (lazy). */
  #onClose: Array<() => void> | null = null;
  /** Attente de `drain` en cours, partagée par tous les `send()` sous pression. */
  #drain: Promise<void> | null = null;
  #releaseDrain: (() => void) | null = null;
  readonly #onResponseClose = (): void => this.#finish();
  readonly #onDrain = (): void => this.#settleDrain();
  /**
   * Le client ne lit plus depuis `stallTimeout` : on coupe la connexion, comme
   * s'il était parti — la fermeture de la réponse termine le flux.
   */
  readonly #onStall = (): void => {
    this.#stall = null;
    this.#target.destroy();
  };

  /** @internal — passer par {@link openSseStream}. */
  constructor(
    context: HttpContext,
    target: SseTarget,
    response: http.ServerResponse | http2.Http2ServerResponse,
    settings: ISseSettings,
  ) {
    this.#context = context;
    this.#target = target;
    this.#response = response;
    this.#stallTimeout = settings.stallTimeout;
    this.#maxEventBytes = settings.maxEventBytes;
    this.#revalidate = settings.revalidate;
    response.on("close", this.#onResponseClose);
    const heartbeat = settings.heartbeat;
    if (settings.maxDuration !== false) {
      this.#lifetime = setTimeout(
        () => void this.close(),
        settings.maxDuration,
      );
      this.#lifetime.unref();
    }
    if (heartbeat !== false && heartbeat > 0) {
      this.#heartbeat = setInterval(() => {
        // Sous pression, un battement n'apprend rien au client : on le saute.
        if (this.#drain === null) this.#target.write(HEARTBEAT);
      }, heartbeat);
      this.#heartbeat.unref();
    }
  }

  /** Le flux est-il fermé — par le serveur (`close()`) ou par le client parti ? */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * L'identité qui a ouvert le flux est-elle toujours valable ? Lu par le
   * registre de révocation du noyau HTTP.
   *
   * @internal
   */
  revalidate(): Promise<boolean> {
    return this.#revalidate === null
      ? Promise.resolve(true)
      : this.#revalidate();
  }

  /**
   * Envoie un événement.
   *
   * @param data - texte envoyé tel quel, ou valeur sérialisée en JSON ; un
   *   texte de plusieurs lignes part en autant de champs `data:`.
   * @param options - type (`event`) et identifiant (`id`) de l'événement.
   * @returns rien quand l'écriture est acceptée ; une promesse réglée au
   *   `drain` quand le client lit moins vite qu'on écrit — l'attendre borne la
   *   mémoire du serveur. Sans effet une fois le flux fermé.
   * @throws TypeError quand `event` ou `id` contient une fin de ligne.
   * @throws RangeError quand l'événement dépasse `maxEventBytes`.
   */
  send(data: unknown, options?: ISseSendOptions): Promise<void> | undefined {
    let frame = "";
    if (options?.event !== undefined) {
      frame += `event: ${singleLine("event", options.event)}\n`;
    }
    if (options?.id !== undefined) {
      frame += `id: ${singleLine("id", options.id)}\n`;
    }
    frame += `${lines("data: ", serialize(data))}\n`;
    return this.#write(frame);
  }

  /**
   * Envoie un commentaire — ignoré par le client, utile pour garder une
   * connexion vivante ou marquer le flux à la lecture.
   *
   * @returns comme {@link send}.
   */
  comment(text = ""): Promise<void> | undefined {
    return this.#write(`${lines(": ", text)}\n`);
  }

  /**
   * Impose au client un délai de reconnexion (champ `retry:`).
   *
   * @param ms - délai en millisecondes, entier positif.
   * @returns comme {@link send}.
   * @throws RangeError quand `ms` n'est pas un entier entre 0 et 2^31-1.
   */
  retry(ms: number): Promise<void> | undefined {
    if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIMER_MS) {
      throw new RangeError(
        `retry : entier entre 0 et ${MAX_TIMER_MS} ms attendu`,
      );
    }
    return this.#write(`retry: ${ms}\n\n`);
  }

  /**
   * Appelle `listener` à la fermeture du flux, quelle qu'en soit la cause.
   *
   * L'écouteur est lié au contexte asynchrone de la requête au moment de
   * l'enregistrement : la fermeture par le client part de la SOCKET, hors de
   * la bulle de la requête, et un `RequestContext.get()` y rendrait `undefined`.
   * Un flux déjà fermé appelle l'écouteur au tour suivant.
   */
  onClose(listener: () => void): void {
    const bound = AsyncResource.bind(listener);
    if (this.#closed) {
      queueMicrotask(bound);
      return;
    }
    this.#onClose ??= [];
    this.#onClose.push(bound);
  }

  /**
   * Ferme le flux et termine la requête. Idempotent.
   *
   * @returns la fin de la requête (hooks `onClose` du contexte compris).
   */
  close(): Promise<void> | undefined {
    if (this.#closed) return undefined;
    this.#finish();
    const done = this.#context.close();
    return done instanceof Promise ? done.then(() => undefined) : undefined;
  }

  /** Écrit une trame ; une promesse seulement sous contre-pression. */
  #write(frame: string): Promise<void> | undefined {
    if (this.#closed) return undefined;
    // Un caractère vaut au plus 3 octets UTF-8 (UTF-16 → UTF-8) : le compte
    // exact n'est payé que pour une trame qui POURRAIT dépasser.
    const max = this.#maxEventBytes;
    if (frame.length * 3 > max && Buffer.byteLength(frame) > max) {
      throw new RangeError(`SSE : événement de plus de ${max} octets refusé`);
    }
    if (this.#target.write(frame)) return undefined;
    if (this.#drain === null) {
      this.#drain = new Promise<void>((resolve) => {
        this.#releaseDrain = resolve;
      });
      this.#target.once("drain", this.#onDrain);
      if (this.#stallTimeout !== false) {
        this.#stall = setTimeout(this.#onStall, this.#stallTimeout);
        this.#stall.unref();
      }
    }
    return this.#drain;
  }

  #settleDrain(): void {
    if (this.#stall !== null) {
      clearTimeout(this.#stall);
      this.#stall = null;
    }
    const release = this.#releaseDrain;
    this.#drain = null;
    this.#releaseDrain = null;
    release?.();
  }

  /** Fin du flux : minuteur, écouteurs et attentes libérés, une seule fois. */
  #finish(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#response.removeListener("close", this.#onResponseClose);
    this.#target.removeListener("drain", this.#onDrain);
    if (this.#heartbeat !== null) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
    if (this.#lifetime !== null) {
      clearTimeout(this.#lifetime);
      this.#lifetime = null;
    }
    if (this.#revalidate !== null)
      this.#context.httpKernel?.unwatchStream(this);
    this.#settleDrain();
    const listeners = this.#onClose;
    this.#onClose = null;
    if (listeners !== null) for (const listener of listeners) listener();
  }
}

/**
 * Le client accepte-t-il un flux d'événements ? Lit l'en-tête `Accept`.
 *
 * Un même `POST` répond en JSON ou en flux selon ce que demande le client
 * (porte MCP) : c'est cette fonction qui tranche, et elle seule. Une plage
 * `q=0` est un REFUS explicite (RFC 9110 §12.4.2) ; `*\/*` ne suffit pas — un
 * client qui ne nomme pas le flux ne sait pas le lire.
 *
 * @param accept - valeur de l'en-tête `Accept`, absente ou multiple.
 * @returns `true` quand `text/event-stream` est nommé avec un poids non nul.
 */
export function acceptsEventStream(
  accept: string | string[] | undefined,
): boolean {
  if (accept === undefined) return false;
  const value = Array.isArray(accept) ? accept.join(",") : accept;
  for (const range of value.split(",")) {
    const [type, ...params] = range.split(";");
    if (type?.trim().toLowerCase() !== "text/event-stream") continue;
    const q = params
      .map((p) => p.trim().toLowerCase())
      .find((p) => p.startsWith("q="));
    if (q === undefined || Number.parseFloat(q.slice(2)) > 0) return true;
  }
  return false;
}

/**
 * Ouvre un flux d'événements sur la réponse d'un contexte HTTP.
 *
 * Sauve la session d'abord — ses cookies partent avec les en-têtes, qu'on ne
 * pourra plus toucher —, puis écrit les en-têtes du flux et désarme le délai
 * d'inactivité de la requête.
 *
 * @param context - le contexte de la requête, pas encore répondu.
 * @param options - battement de cœur, délai `retry:` initial.
 * @returns le flux ouvert, ou sa promesse quand une session est à sauver.
 * @throws HttpError 500 quand la réponse est déjà partie.
 * @throws HttpError 429 quand l'IP du client a déjà tous ses flux et sockets
 *   (`wsMaxConnectionsPerIp`) — refusé AVANT d'écrire quoi que ce soit.
 * @throws RangeError quand un délai n'est ni `false` ni un entier entre 1 et
 *   2^31-1, ou que `maxEventBytes` n'est pas un entier positif.
 */
export function openSseStream(
  context: HttpContext,
  options: ISseStreamOptions = {},
): SseStream | Promise<SseStream> {
  checkTimer("heartbeat", options.heartbeat);
  checkTimer("stallTimeout", options.stallTimeout);
  checkTimer("maxDuration", options.maxDuration);
  const maxEventBytes = options.maxEventBytes ?? SSE_MAX_EVENT_BYTES;
  if (!Number.isInteger(maxEventBytes) || maxEventBytes < 1) {
    throw new RangeError("SSE : maxEventBytes entier positif attendu");
  }
  if (context.sended || context.finished || context.response.isHeaderSent()) {
    throw new HttpError("SSE : la réponse est déjà partie", 500, context);
  }
  // Une connexion longue de plus pour cette IP : le budget est celui des
  // sockets WebSocket. La place est rendue à la fermeture de la réponse.
  const kernel = context.httpKernel;
  const nodeResponse = context.response.response;
  if (
    kernel !== null &&
    nodeResponse !== null &&
    !kernel.acquireConnectionSlot(context.request.request, nodeResponse)
  ) {
    throw new HttpError(
      "SSE : trop de connexions ouvertes depuis cette adresse",
      429,
      context,
    );
  }
  // Lu dans la bulle de la requête, là où le pare-feu a posé l'identité.
  const revalidate = kernel?.firewall?.currentRevalidator?.() ?? null;
  const settings: ISseSettings = {
    heartbeat: options.heartbeat ?? SSE_HEARTBEAT_MS,
    stallTimeout: options.stallTimeout ?? SSE_STALL_TIMEOUT_MS,
    maxEventBytes,
    maxDuration: options.maxDuration ?? false,
    revalidate,
  };
  // Pris AVANT toute attente : l'action ne doit plus pouvoir répondre autrement.
  context.sended = true;
  if (context.session != null) {
    return context
      .saveSession()
      .catch((e: unknown) => {
        context.log(e, "ERROR", "SESSION-STORE");
        return null;
      })
      .then(() => startSseStream(context, options, settings));
  }
  return startSseStream(context, options, settings);
}

/** En-têtes, désarmement du délai, puis le flux. */
function startSseStream(
  context: HttpContext,
  options: ISseStreamOptions,
  settings: ISseSettings,
): SseStream {
  const response = context.response;
  const nodeResponse = response.response;
  if (nodeResponse === null) {
    throw new HttpError("SSE : réponse introuvable", 500, context);
  }
  // Le transport se CONSTATE, AVANT d'écrire quoi que ce soit : en HTTP/2 on
  // écrit sur le flux, en HTTP/1.1 sur la réponse.
  const stream = response instanceof Http2Response ? response.stream : null;
  const h1 = nodeResponse instanceof http.ServerResponse ? nodeResponse : null;
  let target: SseTarget;
  if (stream !== null) target = stream;
  else if (h1 !== null) target = h1;
  else throw new HttpError("SSE : transport de réponse inconnu", 500, context);
  response.setHeaders({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  context.writeHead(200);
  if (stream !== null) {
    // HTTP/2 : `respond()` a déjà envoyé les en-têtes ; délai par flux.
    stream.setTimeout(0);
  } else if (h1 !== null) {
    // `writeHead` ne fait que préparer : sans ceci, le client n'apprend
    // l'ouverture qu'au premier événement.
    h1.flushHeaders();
    h1.socket?.setTimeout(0);
  }
  const sse = new SseStream(context, target, nodeResponse, settings);
  // Seule une identité révocable entre au registre : un anonyme n'a rien à
  // perdre, et ne coûte rien.
  if (settings.revalidate !== null) context.httpKernel?.watchStream(sse);
  if (options.retry !== undefined) void sse.retry(options.retry);
  return sse;
}
