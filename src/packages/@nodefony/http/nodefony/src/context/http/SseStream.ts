import http from "node:http";
import type HttpContext from "./HttpContext";
import {
  checkStreamTimer,
  MAX_TIMER_MS,
  openStreamLifecycle,
  type StreamLifecycle,
} from "./StreamLifecycle";
import type { DefaultEventsMap, EventNames, EventsMap } from "nodefony";

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

/**
 * Ce qu'un événement porte en plus de ses données.
 *
 * @typeParam K - nom de l'événement : un canal du contrat quand le flux en a un.
 */
export interface ISseSendOptions<K extends string = string> {
  /** Type de l'événement (champ `event:`) — absent : `message`. */
  event?: K | undefined;
  /** Identifiant (champ `id:`) que le client renverra en `Last-Event-ID`. */
  id?: string | undefined;
}

/** Battement de cœur par défaut, en ms (§9.2.7 : « every 15 seconds or so »). */
export const SSE_HEARTBEAT_MS = 15_000;
/** Délai de blocage d'écriture par défaut, en ms. */
export const SSE_STALL_TIMEOUT_MS = 30_000;
/** Taille maximale d'un événement par défaut, en octets (1 Mio). */
export const SSE_MAX_EVENT_BYTES = 1_048_576;
/** Commentaire de battement de cœur — ignoré par tout client conforme. */
const HEARTBEAT = ":\n\n";
/** Fin de ligne : CRLF, CR ou LF (§9.2.5). */
const LINE_BREAK = /\r\n|\r|\n/;

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
 *
 * Des octets sont refusés : un flux SSE est du texte UTF-8 (WHATWG HTML
 * §9.2), et `JSON.stringify` les rendrait en objet (`[1,2,255]` →
 * `{"0":1,"1":2,"2":255}`) sans erreur (ADR-0021 S8).
 *
 * @throws TypeError quand `data` est un `ArrayBuffer` ou une vue sur octets.
 */
function serialize(data: unknown): string {
  if (typeof data === "string") return data;
  if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
    throw new TypeError(
      "SSE : un flux SSE ne porte que du texte UTF-8, des octets n'y passent pas — " +
        "les encoder en base64 dans la charge, avec leur type MIME " +
        '(ex. { mimeType: "image/png", data: "<base64>" }).',
    );
  }
  const json: unknown = JSON.stringify(data);
  return typeof json === "string" ? json : "";
}

/** Ce que le flux reçoit de son ouverture, options résolues. */
interface ISseSettings {
  heartbeat: number | false;
  maxEventBytes: number;
}

/** Préfixe chaque ligne d'un texte par `prefix` — `data: ` ou `: `. */
function lines(prefix: string, text: string): string {
  let out = "";
  for (const line of text.split(LINE_BREAK)) out += `${prefix}${line}\n`;
  return out;
}

/**
 * Charge d'un événement SSE : celle du canal nommé par `event`, ou — sans
 * `event` (« un flux = un canal ») — l'une de celles de la carte. Carte non
 * déclarée : `unknown`.
 */
export type SseEventData<Events extends EventsMap, K extends string> = [
  K,
] extends [never]
  ? Events[EventNames<Events>]
  : Events[K];

/**
 * Un flux `text/event-stream` ouvert sur une réponse.
 *
 * Il s'obtient par {@link openSseStream} (ou `this.renderSse()` dans un
 * contrôleur), jamais par `new` : l'ouverture écrit les en-têtes, et un flux
 * sans en-têtes ne se rattrape pas.
 *
 * Typé par une carte d'événements (`ContractServerEmit<C>` : le MÊME contrat
 * que la socket temps réel) : `event:` est un canal de la carte et la charge est
 * celle du canal. Deux formes se lisent sur la même carte — **multiplexé**
 * (`send(data, { event: canal })`, plusieurs canaux sur une connexion) ou **un
 * flux = un canal** (carte d'un seul canal, `send(data)` sans `event`). Sans
 * carte, le flux reste libre (porte MCP, flux hors contrat). Le type n'est pas
 * une validation, et ne coûte rien à l'exécution.
 *
 * @typeParam Events - carte des événements du flux.
 */
export class SseStream<Events extends EventsMap = DefaultEventsMap> {
  /** Cycle de vie partagé avec le flux d'octets : fin, gardes, registre. */
  readonly #lifecycle: StreamLifecycle;
  readonly #maxEventBytes: number;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  /** Attente de `drain` en cours, partagée par tous les `send()` sous pression. */
  #drain: Promise<void> | null = null;
  #releaseDrain: (() => void) | null = null;
  readonly #onDrain = (): void => this.#settleDrain();

  /** @internal — passer par {@link openSseStream}. */
  constructor(lifecycle: StreamLifecycle, settings: ISseSettings) {
    this.#lifecycle = lifecycle;
    this.#maxEventBytes = settings.maxEventBytes;
    lifecycle.onRelease(() => this.#release());
    const heartbeat = settings.heartbeat;
    if (!lifecycle.closed && heartbeat !== false && heartbeat > 0) {
      const target = lifecycle.target;
      this.#heartbeat = setInterval(() => {
        // Sous pression, un battement n'apprend rien au client : on le saute.
        if (this.#drain === null) target.write(HEARTBEAT);
      }, heartbeat);
      this.#heartbeat.unref();
    }
  }

  /**
   * Identifiant de connexion de l'identité qui a ouvert le flux (`null` pour
   * un anonyme) — le registre de révocation ferme par lui les flux d'une
   * identité dont les droits ont changé.
   *
   * @internal
   */
  get identifier(): string | null {
    return this.#lifecycle.identifier;
  }

  /** Le flux est-il fermé — par le serveur (`close()`) ou par le client parti ? */
  get closed(): boolean {
    return this.#lifecycle.closed;
  }

  /**
   * L'identité qui a ouvert le flux est-elle toujours valable ? Lu par le
   * registre de révocation du noyau HTTP.
   *
   * @internal
   */
  revalidate(): Promise<boolean> {
    return this.#lifecycle.revalidate();
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
   * @throws TypeError quand `event` ou `id` contient une fin de ligne, ou
   *   quand `data` est fait d'octets (`Uint8Array`, `Buffer`, `ArrayBuffer`) :
   *   un flux SSE ne porte que du texte, les encoder soi-même (base64).
   * @throws RangeError quand l'événement dépasse `maxEventBytes`.
   */
  send<K extends EventNames<Events> = never>(
    data: SseEventData<Events, K>,
    options?: ISseSendOptions<K>,
  ): Promise<void> | undefined {
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
    this.#lifecycle.onClose(listener);
  }

  /**
   * Ferme le flux et termine la requête. Idempotent.
   *
   * @returns la fin de la requête (hooks `onClose` du contexte compris).
   */
  close(): Promise<void> | undefined {
    return this.#lifecycle.close();
  }

  /** Écrit une trame ; une promesse seulement sous contre-pression. */
  #write(frame: string): Promise<void> | undefined {
    const lifecycle = this.#lifecycle;
    if (lifecycle.closed) return undefined;
    // Un caractère vaut au plus 3 octets UTF-8 (UTF-16 → UTF-8) : le compte
    // exact n'est payé que pour une trame qui POURRAIT dépasser.
    const max = this.#maxEventBytes;
    if (frame.length * 3 > max && Buffer.byteLength(frame) > max) {
      throw new RangeError(`SSE : événement de plus de ${max} octets refusé`);
    }
    const target = lifecycle.target;
    if (target.write(frame)) return undefined;
    if (this.#drain === null) {
      this.#drain = new Promise<void>((resolve) => {
        this.#releaseDrain = resolve;
      });
      target.once("drain", this.#onDrain);
      lifecycle.armStall();
    }
    return this.#drain;
  }

  #settleDrain(): void {
    this.#lifecycle.clearStall();
    const release = this.#releaseDrain;
    this.#drain = null;
    this.#releaseDrain = null;
    release?.();
  }

  /** Fin du flux, appelée UNE fois par le cycle de vie : battement et attentes libérés. */
  #release(): void {
    this.#lifecycle.target.removeListener("drain", this.#onDrain);
    if (this.#heartbeat !== null) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
    this.#settleDrain();
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
export function openSseStream<Events extends EventsMap = DefaultEventsMap>(
  context: HttpContext,
  options: ISseStreamOptions = {},
): SseStream<Events> | Promise<SseStream<Events>> {
  checkStreamTimer("SSE", "heartbeat", options.heartbeat);
  checkStreamTimer("SSE", "stallTimeout", options.stallTimeout);
  checkStreamTimer("SSE", "maxDuration", options.maxDuration);
  const maxEventBytes = options.maxEventBytes ?? SSE_MAX_EVENT_BYTES;
  if (!Number.isInteger(maxEventBytes) || maxEventBytes < 1) {
    throw new RangeError("SSE : maxEventBytes entier positif attendu");
  }
  const settings: ISseSettings = {
    heartbeat: options.heartbeat ?? SSE_HEARTBEAT_MS,
    maxEventBytes,
  };
  const opened = openStreamLifecycle(context, {
    label: "SSE",
    stallTimeout: options.stallTimeout ?? SSE_STALL_TIMEOUT_MS,
    maxDuration: options.maxDuration ?? false,
  });
  return opened instanceof Promise
    ? opened.then((lifecycle) =>
        startSseStream<Events>(lifecycle, options, settings),
      )
    : startSseStream<Events>(opened, options, settings);
}

/**
 * En-têtes, désarmement du délai, puis le flux. Un client parti pendant
 * l'ouverture rend un flux déjà fermé, sans rien écrire.
 */
function startSseStream<Events extends EventsMap>(
  lifecycle: StreamLifecycle,
  options: ISseStreamOptions,
  settings: ISseSettings,
): SseStream<Events> {
  if (!lifecycle.closed) {
    const context = lifecycle.context;
    context.response.setHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    context.writeHead(200);
    // HTTP/2 : `respond()` a déjà envoyé les en-têtes. HTTP/1.1 : `writeHead`
    // ne fait que préparer — sans ceci, le client n'apprend l'ouverture qu'au
    // premier événement.
    const target = lifecycle.target;
    if (target instanceof http.ServerResponse) target.flushHeaders();
    lifecycle.disarmIdleTimeout();
  }
  const sse = new SseStream<Events>(lifecycle, settings);
  if (options.retry !== undefined) void sse.retry(options.retry);
  return sse;
}
