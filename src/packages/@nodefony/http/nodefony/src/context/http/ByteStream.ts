import { AsyncResource } from "node:async_hooks";
import http from "node:http";
import { Readable } from "node:stream";
import type HttpContext from "./HttpContext";
import HttpError from "../../errors/httpError";
import { SSE_STALL_TIMEOUT_MS } from "./SseStream";
import {
  checkStreamTimer,
  MAX_TIMER_MS,
  openStreamLifecycle,
  type StreamLifecycle,
} from "./StreamLifecycle";

/**
 * Réponse en FLUX D'OCTETS — la sortie d'un processus, le relais d'un autre
 * service, une archive construite à la volée : toute source d'octets qui n'est
 * pas un fichier du disque.
 *
 * Le cycle de vie (prise de la réponse, session, fermeture lue sur la réponse,
 * plafond par IP, révocation, coupure d'un client qui ne lit plus) est celui de
 * la brique commune au SSE (`StreamLifecycle`). Ce fichier porte ce qui est
 * propre aux octets :
 * - les en-têtes au PREMIER morceau : une erreur de la source avant lui passe
 *   par le chemin d'erreur normal (`HttpKernel.onError`), donc un vrai 5xx ;
 * - l'arrêt de la source par `destroy()`, jamais `unpipe()` — qui la laisse en
 *   pause, et un producteur bloqué en écriture ne meurt plus ;
 * - un chien de garde sur une source MUETTE (`idleTimeout`) : un seul minuteur
 *   périodique par flux, qui compare le compteur d'octets — aucun minuteur ni
 *   appel d'horloge par morceau (mesuré : l'horodatage par morceau coûtait
 *   2 à 6 % de CPU sur des morceaux de 4 Kio) ;
 * - la coupure (jamais une fin propre) quand la source échoue après le premier
 *   octet : le client doit savoir que le corps est tronqué.
 */

/**
 * Raison de la fin d'un flux d'octets.
 *
 * - `end` : la source est finie, ou le serveur a fermé le flux (durée de vie,
 *   révocation de l'identité) ;
 * - `client` : le client est parti ;
 * - `error` : la source a échoué ;
 * - `timeout` : la source est restée muette plus de `idleTimeout` ;
 * - `stall` : le client ne lisait plus depuis `stallTimeout`.
 *
 * L'union PEUT S'AGRANDIR : un `switch` exhaustif garde une branche `default`.
 */
export type ByteStreamEndReason =
  "end" | "client" | "error" | "timeout" | "stall";

/** Ce que rend la fin d'un flux d'octets. */
export interface IByteStreamResult {
  /** Pourquoi le flux s'est terminé. */
  reason: ByteStreamEndReason;
  /** Octets écrits sur la réponse. */
  bytes: number;
}

/** Options d'une réponse en flux d'octets. */
export interface IByteStreamOptions {
  /** Statut de la réponse, entre 200 et 599. Défaut : 200. */
  status?: number | undefined;
  /**
   * En-têtes de la réponse, écrits au premier morceau. `Content-Length` est
   * repris s'il est fourni ; sinon HTTP/1.1 envoie par morceaux. Défauts posés
   * seulement s'ils manquent — ni ici, ni déjà sur la réponse :
   * `Content-Type: application/octet-stream`, et pour un flux `live`
   * `Cache-Control: no-cache, no-transform` et `X-Accel-Buffering: no`.
   */
  headers?: http.OutgoingHttpHeaders | undefined;
  /**
   * Flux VIVANT (défaut `true`) : la sortie d'un processus, un relais — un
   * proxy inverse ne doit pas le mettre en tampon, ni un cache le garder, d'où
   * `Cache-Control: no-cache, no-transform` et `X-Accel-Buffering: no` par
   * défaut. `false` pour une source FINIE et rejouable (un fichier, une
   * archive) : aucun de ces deux en-têtes n'est posé.
   */
  live?: boolean | undefined;
  /**
   * Délai maximal sans un octet de la source, en ms ; `0` le désarme. Au-delà :
   * 504 si rien n'est encore parti, coupure sinon. Le silence est constaté
   * par un tour de garde tous les quarts de délai : la coupure tombe entre
   * `idleTimeout` et 1,25 × `idleTimeout`. Défaut : le délai de réponse
   * du serveur (`responseTimeout`, 30 s). À garder sous le délai de lecture du
   * proxy inverse (`proxy_read_timeout`, 60 s chez nginx).
   */
  idleTimeout?: number | undefined;
  /**
   * Délai maximal pendant lequel une écriture peut rester bloquée — le client
   * ne lit plus —, en ms ; au-delà, la connexion est coupée. `false` pour
   * l'éteindre. Défaut : 30 000, celui du SSE.
   */
  stallTimeout?: number | false | undefined;
  /** Durée de vie maximale du flux, en ms. `false` (défaut) : pas de borne. */
  maxDuration?: number | false | undefined;
  /**
   * Appelé une fois à la fin du flux, avec sa raison — AVANT la fin de la
   * requête et la résolution de la promesse. Lié au contexte asynchrone de la
   * requête.
   */
  onClose?: ((reason: ByteStreamEndReason) => void) | undefined;
}

/** Une source d'octets : flux Node, ou flux web (`fetch().body`). */
export type ByteStreamSource = Readable | ReadableStream<Uint8Array>;

/** Erreur d'une source après la fin de son flux : plus personne à prévenir. */
const IGNORE_LATE_ERROR = (): void => undefined;

/** Réglages d'un flux d'octets, options résolues. */
interface IByteStreamSettings {
  status: number;
  headers: http.OutgoingHttpHeaders | null;
  live: boolean;
  idleTimeout: number;
  onClose: ((reason: ByteStreamEndReason) => void) | null;
}

/**
 * Un flux d'octets en cours sur une réponse — interne : on l'obtient par
 * {@link openByteStream}, qui ne rend que sa promesse de fin.
 */
class ByteStream {
  readonly #lifecycle: StreamLifecycle;
  readonly #source: Readable;
  readonly #settings: IByteStreamSettings;
  readonly done: Promise<IByteStreamResult>;
  #resolve!: (result: IByteStreamResult) => void;
  #bytes = 0;
  /** Les en-têtes sont-ils partis ? Posé au premier morceau, ou à la fin. */
  #headed = false;
  /** Raison posée par le flux lui-même ; `null` : le cycle de vie tranchera. */
  #reason: ByteStreamEndReason | null = null;
  /** La résolution attend la fin de la requête (fin propre, erreur rendue). */
  #settleLater = false;
  #waitingDrain = false;
  /** Octets vus au dernier tour de garde où la source avait avancé. */
  #seenBytes = 0;
  /** Heure de ce tour (`Date.now()`) — une lecture par tour, jamais par morceau. */
  #seenAt = 0;
  #watchdog: ReturnType<typeof setInterval> | null = null;
  /** `Content-Length` annoncé, lu une fois aux en-têtes ; `-1` : aucun. */
  #declared = -1;
  /** Requête HEAD : aucun corps, la longueur annoncée est celle du GET. */
  #head = false;

  readonly #onData = (chunk: Buffer | string): void => this.#write(chunk);
  readonly #onEnd = (): void => this.#finishClean();
  readonly #onSourceError = (error: Error): void => this.#fail(error, "error");
  /** Une source détruite sans erreur ni fin : on la tient pour finie. */
  readonly #onSourceClose = (): void => {
    if (this.#source.errored === null) this.#finishClean();
  };
  /**
   * Écouteur `drain` PERMANENT, posé une fois (comme `pipe`) : un `once` par
   * épisode de contre-pression allouait un enrobage par morceau sur une socket
   * rapide, où presque chaque écriture de 64 Kio rend `false`.
   */
  readonly #onDrain = (): void => {
    if (!this.#waitingDrain) return;
    this.#waitingDrain = false;
    this.#lifecycle.clearStall();
    this.#source.resume();
  };
  readonly #onIdle = (): void => this.#checkIdle();

  constructor(
    lifecycle: StreamLifecycle,
    source: Readable,
    settings: IByteStreamSettings,
  ) {
    this.#lifecycle = lifecycle;
    this.#source = source;
    this.#settings = settings;
    this.done = new Promise<IByteStreamResult>((resolve) => {
      this.#resolve = resolve;
    });
    lifecycle.onRelease(() => this.#release());
  }

  /** Démarre le flux : HEAD, source déjà finie, ou lecture de la source. */
  start(): void {
    const lifecycle = this.#lifecycle;
    if (lifecycle.closed) return;
    lifecycle.disarmIdleTimeout();
    const source = this.#source;
    // Une erreur de la source, à tout moment, est captée — même après la fin.
    source.on("error", this.#onSourceError);
    if (lifecycle.context.getMethod() === "HEAD") {
      // Les en-têtes du GET, aucun corps : la source n'est jamais lue.
      this.#head = true;
      this.#finishClean();
      return;
    }
    if (source.errored !== null) {
      this.#fail(source.errored, "error");
      return;
    }
    if (source.destroyed || source.readableEnded) {
      this.#finishClean();
      return;
    }
    // Pas d'écouteur `error` sur la cible : la couche de compatibilité HTTP/2
    // de Node en pose déjà un sur chaque flux (`onStreamError`), et en
    // HTTP/1.1 le flux n'écrit jamais après sa fin (gardes `#reason`/`closed`).
    // Retiré, aucun banc ne rougissait — c'était du code sans preuve.
    lifecycle.target.on("drain", this.#onDrain);
    const idle = this.#settings.idleTimeout;
    if (idle > 0) {
      this.#seenAt = Date.now();
      this.#watchdog = setInterval(
        this.#onIdle,
        Math.max(1, Math.floor(idle / 4)),
      );
      this.#watchdog.unref();
    }
    source.once("end", this.#onEnd);
    source.once("close", this.#onSourceClose);
    source.on("data", this.#onData);
  }

  /**
   * En-têtes au premier morceau (ou à la fin d'une source vide).
   *
   * @param first - octets du premier morceau (0 : source vide).
   * @throws Error quand ce morceau contredit déjà `Content-Length` — levé
   *   AVANT `writeHead` : rien n'est parti, la page d'erreur le peut.
   */
  #writeHead(first: number): void {
    const context = this.#lifecycle.context;
    const { headers, live, status } = this.#settings;
    const response = context.response;
    if (headers !== null) response.setHeaders(headers);
    // Défauts posés SAUF si la réponse en porte déjà un — options comprises,
    // mais aussi ce que l'action a posé avant l'appel (`setFileMimeType`, un
    // `Cache-Control` choisi) : jamais écrasé.
    response.setDefaultHeader("Content-Type", "application/octet-stream");
    if (live) {
      response.setDefaultHeader("Cache-Control", "no-cache, no-transform");
      response.setDefaultHeader("X-Accel-Buffering", "no");
    }
    // Le corps doit faire EXACTEMENT la longueur annoncée (RFC 9112 §6.3 ;
    // RFC 9113 §8.1.1 : sinon la réponse HTTP/2 est malformée). Lue une fois.
    const length = response.getHeader("content-length");
    if (length !== undefined) {
      const declared = Number(length);
      if (Number.isSafeInteger(declared) && declared >= 0)
        this.#declared = declared;
    }
    // Déjà contredite par le premier morceau — ou par une source vide quand
    // la longueur n'est pas nulle (HEAD excepté : aucun corps, par définition).
    if (
      this.#declared !== -1 &&
      !this.#head &&
      (first === 0 ? this.#declared !== 0 : first > this.#declared)
    ) {
      throw this.#lengthMismatch(first > this.#declared ? "plus" : "moins");
    }
    context.writeHead(status);
  }

  /**
   * Les en-têtes, sans jamais lever : appelé depuis un écouteur `data` ou
   * `end`, une exception (valeur d'en-tête refusée) n'aurait personne pour la
   * rattraper et abattrait le processus. Un échec passe par le chemin d'erreur
   * d'avant le premier octet — rien n'est parti, la page d'erreur peut l'être.
   *
   * @returns `false` quand les en-têtes n'ont pas pu partir.
   */
  #tryWriteHead(first: number): boolean {
    try {
      this.#writeHead(first);
      this.#headed = true;
      return true;
    } catch (e) {
      this.#fail(e instanceof Error ? e : new Error(String(e)), "error");
      return false;
    }
  }

  #write(chunk: Buffer | string): void {
    if (this.#reason !== null || this.#lifecycle.closed) return;
    const size =
      typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
    if (!this.#headed && !this.#tryWriteHead(size)) return;
    if (this.#declared !== -1 && this.#bytes + size > this.#declared) {
      // Plus long qu'annoncé : l'excédent corromprait la connexion (HTTP/1.1
      // garde la socket pour la requête suivante). Coupure, jamais d'envoi.
      this.#fail(this.#lengthMismatch("plus"), "error");
      return;
    }
    this.#bytes += size;
    const target = this.#lifecycle.target;
    if (target.write(chunk)) return;
    // Contre-pression : la source attend que le client lise.
    this.#source.pause();
    this.#waitingDrain = true;
    this.#lifecycle.armStall();
  }

  /** Fin propre : en-têtes s'ils manquent, puis fin de la requête. */
  #finishClean(): void {
    const lifecycle = this.#lifecycle;
    if (this.#reason !== null || lifecycle.closed) return;
    if (!this.#headed && !this.#tryWriteHead(0)) return;
    if (
      !this.#head &&
      this.#declared !== -1 &&
      this.#bytes !== this.#declared
    ) {
      // Plus court qu'annoncé (fichier tronqué pendant l'envoi, longueur
      // fausse) : une fin propre laisserait le client attendre l'octet
      // manquant. Coupure — le client sait le corps incomplet.
      this.#fail(this.#lengthMismatch("moins"), "error");
      return;
    }
    this.#reason = "end";
    this.#settleLater = true;
    const closed = lifecycle.close();
    if (closed === undefined) this.#settle();
    else void closed.then(this.#settleBound, this.#settleBound);
  }

  readonly #settleBound = (): void => this.#settle();

  /** L'erreur d'un corps qui ne fait pas la longueur annoncée. */
  #lengthMismatch(direction: "plus" | "moins"): Error {
    return new Error(
      `Flux : la source rend ${direction} d'octets que Content-Length n'en annonce (${this.#declared})`,
    );
  }

  /**
   * Échec de la source, ou source muette. Avant le premier octet, la réponse
   * est ROUVERTE et l'erreur confiée au moteur d'erreurs du noyau — même
   * statut, même page qu'une action ordinaire. Après, le client voit une
   * coupure, jamais une fin propre.
   */
  #fail(failure: Error, reason: ByteStreamEndReason): void {
    const lifecycle = this.#lifecycle;
    if (this.#reason !== null || lifecycle.closed) return;
    this.#reason = reason;
    const context = lifecycle.context;
    if (!this.#headed && !context.response.isHeaderSent()) {
      this.#settleLater = true;
      lifecycle.finish();
      const kernel = context.httpKernel;
      if (kernel === null) {
        this.#settle();
        return;
      }
      // `send()` lève « Response Already sended » sous `sended` : rouvrir.
      context.sended = false;
      void this.#renderError(kernel, failure);
      return;
    }
    if (reason === "error") context.log(failure, "ERROR", "STREAM");
    // Statut INTERNE, jamais écrit sur le fil (les en-têtes sont partis) : le
    // journal d'accès doit dire que le SERVEUR a coupé — 500, le code d'une
    // `HttpError`, 504 pour une source muette — et non 499 (« client parti »),
    // que le noyau pose à la fermeture faute d'un statut d'erreur
    // (`HttpKernel.createHttpContext`).
    context.response.statusCode =
      "code" in failure &&
      typeof failure.code === "number" &&
      failure.code >= 400 &&
      failure.code <= 599
        ? failure.code
        : 500;
    const target = lifecycle.target;
    // HTTP/2 : `destroy(err)` émet RST_STREAM(INTERNAL_ERROR) (RFC 9113
    // §5.4.2). PAS `close(INTERNAL_ERROR)` : il ferme d'abord le côté écriture
    // (END_STREAM), et un client déjà à demi fermé lit une FIN PROPRE —
    // mesuré, `rstCode` 0 au lieu de 2.
    if (target instanceof http.ServerResponse) target.destroy();
    else target.destroy(failure);
    lifecycle.finish();
  }

  /**
   * Rend l'erreur d'avant le premier octet par le moteur d'erreurs du noyau,
   * puis règle la promesse — qui ne rejette jamais, même si ce rendu échoue.
   */
  async #renderError(
    kernel: NonNullable<HttpContext["httpKernel"]>,
    failure: Error,
  ): Promise<void> {
    const context = this.#lifecycle.context;
    try {
      await kernel.onError(failure, context);
    } catch (e) {
      context.log(e, "ERROR", "STREAM");
    }
    this.#settle();
  }

  /**
   * Un tour du chien de garde, tous les quarts de `idleTimeout`. La source a
   * avancé depuis le tour précédent : on note l'heure. Sinon, et depuis au
   * moins `idleTimeout` : la source est muette.
   */
  #checkIdle(): void {
    if (this.#reason !== null || this.#lifecycle.closed) return;
    const now = Date.now();
    // Sous contre-pression, c'est le CLIENT qui ne lit pas : `stallTimeout`
    // en décide, pas le silence de la source.
    if (this.#bytes !== this.#seenBytes || this.#waitingDrain) {
      this.#seenBytes = this.#bytes;
      this.#seenAt = now;
      return;
    }
    const idle = this.#settings.idleTimeout;
    if (now - this.#seenAt < idle) return;
    // Sans contexte : `HttpError` réécrirait le statut de la réponse, et une
    // coupure APRÈS les en-têtes inscrirait au journal d'accès un 504 que le
    // client n'a jamais reçu. Avant les en-têtes, `onError` pose le statut.
    this.#fail(
      new HttpError(`Flux : source muette depuis ${idle} ms`, 504),
      "timeout",
    );
  }

  /** Nettoyage, appelé UNE fois par le cycle de vie, quelle qu'en soit la cause. */
  #release(): void {
    const lifecycle = this.#lifecycle;
    const reason =
      this.#reason ??
      (lifecycle.cause === "stall"
        ? "stall"
        : lifecycle.cause === "server"
          ? "end"
          : "client");
    this.#reason = reason;
    const source = this.#source;
    // La source s'arrête AVANT tout le reste, et par `destroy()` : `unpipe` la
    // laisserait en pause, son producteur bloqué en écriture.
    source.removeListener("data", this.#onData);
    source.removeListener("end", this.#onEnd);
    source.removeListener("close", this.#onSourceClose);
    // Une erreur tardive reste captée (sinon elle abattrait le processus), mais
    // par un écouteur qui ne retient RIEN : celui du flux retenait le contexte
    // de la requête aussi longtemps que l'application garde sa source.
    source.on("error", IGNORE_LATE_ERROR);
    source.removeListener("error", this.#onSourceError);
    source.destroy();
    lifecycle.target.removeListener("drain", this.#onDrain);
    if (this.#watchdog !== null) {
      clearInterval(this.#watchdog);
      this.#watchdog = null;
    }
    const context = lifecycle.context;
    // Un relais (`fetch(url, { signal: this.context.signal })`) coupe son amont.
    if (reason !== "end") context._abortIfPending(`Flux terminé : ${reason}`);
    context.log(
      `Flux d'octets terminé (${reason}, ${this.#bytes} octets)`,
      "DEBUG",
      "STREAM",
    );
    const onClose = this.#settings.onClose;
    if (onClose !== null) {
      try {
        onClose(reason);
      } catch (e) {
        context.log(e, "ERROR", "STREAM");
      }
    }
    if (!this.#settleLater) this.#settle();
  }

  #settle(): void {
    this.#resolve({ reason: this.#reason ?? "end", bytes: this.#bytes });
  }
}

/**
 * Un flux web (`fetch().body`) lu comme un flux Node.
 *
 * Pas `Readable.fromWeb` : il attend le `ReadableStream` de `node:stream/web`,
 * que le type global d'une application compilée avec la lib DOM ne satisfait
 * pas. La lecture tient en un lecteur, et la destruction ANNULE le flux web —
 * c'est elle qui ferme la connexion amont d'un `fetch`.
 */
function fromWebStream(stream: ReadableStream<Uint8Array>): Readable {
  const reader = stream.getReader();
  // Les deux suites de lecture sont créées UNE fois par flux, pas à chaque
  // morceau lu : `read()` est appelé pour chaque morceau.
  // Type dérivé du lecteur, jamais nommé : `ReadableStreamReadResult` n'existe
  // que dans la lib DOM, absente des paquets qui compilent ces sources.
  type ReadResult = Awaited<ReturnType<typeof reader.read>>;
  const onRead = (result: ReadResult): void => {
    if (result.done) readable.push(null);
    else readable.push(result.value);
  };
  const onFail = (error: unknown): void => {
    readable.destroy(error instanceof Error ? error : new Error(String(error)));
  };
  const readable = new Readable({
    read() {
      reader.read().then(onRead, onFail);
    },
    destroy(failure, callback) {
      // L'annulation part sans être attendue : la destruction n'a rien à en
      // apprendre, et un rejet (flux déjà fermé) n'a personne à prévenir.
      reader.cancel(failure ?? undefined).catch(IGNORE_LATE_ERROR);
      callback(failure);
    },
  });
  return readable;
}

/** Refuse une option de flux d'octets hors bornes. */
function checkOptions(options: IByteStreamOptions): void {
  const { status, idleTimeout } = options;
  if (
    status !== undefined &&
    (!Number.isInteger(status) || status < 200 || status > 599)
  ) {
    throw new RangeError("Flux : status entier entre 200 et 599 attendu");
  }
  if (
    idleTimeout !== undefined &&
    (!Number.isInteger(idleTimeout) ||
      idleTimeout < 0 ||
      idleTimeout > MAX_TIMER_MS)
  ) {
    throw new RangeError(
      `Flux : idleTimeout entier entre 0 et ${MAX_TIMER_MS} ms attendu`,
    );
  }
  checkStreamTimer("Flux", "stallTimeout", options.stallTimeout);
  checkStreamTimer("Flux", "maxDuration", options.maxDuration);
}

/**
 * Répond par un flux d'octets sur la réponse d'un contexte HTTP.
 *
 * Prend la réponse à l'appel (le noyau ne peut plus répondre par-dessus) ;
 * les en-têtes partent au premier morceau de la source. La promesse se règle à
 * la fin du flux, quelle qu'en soit la raison, et ne rejette JAMAIS.
 *
 * @param context - le contexte de la requête, pas encore répondu.
 * @param source - flux Node, ou flux web (`fetch().body`) ; jamais en mode objet.
 * @param options - statut, en-têtes, délais, écouteur de fin.
 * @returns la raison de la fin et le nombre d'octets envoyés.
 * @throws TypeError quand la source est en mode objet.
 * @throws RangeError quand une option est hors bornes.
 * @throws HttpError 500 quand la réponse est déjà partie ; 429 quand l'IP a
 *   déjà tous ses flux et sockets (`wsMaxConnectionsPerIp`).
 *
 * La source appartient au flux dès l'appel : quand l'appel lève, elle est
 * DÉTRUITE (un flux web est annulé) avant que l'erreur ne remonte.
 */
export function openByteStream(
  context: HttpContext,
  source: ByteStreamSource,
  options: IByteStreamOptions = {},
): Promise<IByteStreamResult> {
  const readable = source instanceof Readable ? source : fromWebStream(source);
  let opened: StreamLifecycle | Promise<StreamLifecycle>;
  let settings: IByteStreamSettings;
  try {
    checkOptions(options);
    if (readable.readableObjectMode) {
      throw new TypeError(
        "Flux : une source en mode objet ne porte pas d'octets — " +
          "pour Readable.from(), passer { objectMode: false }.",
      );
    }
    settings = settingsOf(context, options);
    opened = openStreamLifecycle(context, {
      label: "Flux",
      stallTimeout: options.stallTimeout ?? SSE_STALL_TIMEOUT_MS,
      maxDuration: options.maxDuration ?? false,
    });
  } catch (error) {
    // La source appartient au flux dès l'appel : refusée, personne d'autre ne
    // l'arrêterait — un relais `fetch` garderait son amont ouvert, un
    // producteur enfant resterait bloqué en écriture.
    readable.on("error", IGNORE_LATE_ERROR);
    readable.destroy();
    throw error;
  }
  const start = (lifecycle: StreamLifecycle): Promise<IByteStreamResult> => {
    const stream = new ByteStream(lifecycle, readable, settings);
    stream.start();
    return stream.done;
  };
  return opened instanceof Promise ? opened.then(start) : start(opened);
}

/** Les réglages du flux, défauts résolus sur le contexte. */
function settingsOf(
  context: HttpContext,
  options: IByteStreamOptions,
): IByteStreamSettings {
  const timeout = context.response.timeout;
  return {
    status: options.status ?? 200,
    headers: options.headers ?? null,
    live: options.live ?? true,
    idleTimeout:
      options.idleTimeout ?? (typeof timeout === "number" ? timeout : 30_000),
    onClose:
      options.onClose === undefined
        ? null
        : AsyncResource.bind(options.onClose),
  };
}
