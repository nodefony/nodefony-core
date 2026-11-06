import { AsyncResource } from "node:async_hooks";
import http from "node:http";
import type http2 from "node:http2";
import type HttpContext from "./HttpContext";
import Http2Response from "../http2/Response";
import HttpError from "../../errors/httpError";
import { RequestContext } from "nodefony";

/**
 * Cycle de vie d'une réponse en flux — la brique commune au flux d'événements
 * (`SseStream`) et au flux d'octets, NON exportée.
 *
 * Elle porte ce qu'un flux doit à la requête qui l'ouvre, quel que soit son
 * format :
 * - la PRISE de la réponse (`sended`), avant toute attente : le noyau ne peut
 *   plus répondre par-dessus, et l'avertissement « réponse non envoyée » se tait ;
 * - la session sauvée AVANT les en-têtes — ses cookies partent avec eux ;
 * - la fermeture lue sur la RÉPONSE, écouteur posé de façon SYNCHRONE à
 *   l'ouverture : un client parti pendant la sauvegarde de la session est vu ;
 * - le délai d'inactivité de la requête désarmé, remplacé par les gardes du
 *   flux : coupure d'un client qui ne lit plus (`stallTimeout`), durée de vie
 *   maximale (`maxDuration`) ;
 * - le plafond de connexions longues par IP (`wsMaxConnectionsPerIp`, le budget
 *   des sockets WebSocket) et la fermeture à la révocation de l'identité ;
 * - une fin unique, et des écouteurs de fin liés au contexte asynchrone.
 *
 * Le FORMAT (en-têtes, écriture, battement de cœur) appartient au flux qui la
 * porte.
 */

/** Ce sur quoi on écrit : la réponse HTTP/1.1, ou le flux HTTP/2. */
export type StreamTarget = http.ServerResponse | http2.ServerHttp2Stream;

/**
 * Ce que le registre de révocation du noyau HTTP retient d'un flux : de quoi
 * re-valider son identité, et de quoi le fermer.
 *
 * @internal
 */
export interface IWatchedStream {
  /** Identifiant de connexion de l'identité du flux — `null` pour un anonyme. */
  readonly identifier: string | null;
  /** L'identité qui a ouvert le flux est-elle toujours valable ? */
  revalidate(): Promise<boolean>;
  /** Ferme le flux et termine la requête. */
  close(): unknown;
}

/** Gardes et identité d'un flux, options résolues. */
export interface IStreamLifecycleSettings {
  stallTimeout: number | false;
  maxDuration: number | false;
  /** Revalidateur de l'identité du flux — `null` pour un anonyme. */
  revalidate: (() => Promise<boolean>) | null;
  /** Identifiant de connexion de l'identité qui ouvre le flux — `null` anonyme. */
  identifier: string | null;
}

/**
 * Le cycle de vie d'UN flux ouvert sur une réponse.
 *
 * S'obtient par {@link openStreamLifecycle} ; le constructeur n'est appelé
 * directement que par les tests.
 *
 * @internal
 */
export class StreamLifecycle implements IWatchedStream {
  readonly context: HttpContext;
  /** Où l'on écrit : la réponse HTTP/1.1, ou le flux HTTP/2. */
  readonly target: StreamTarget;
  /** La réponse dont on écoute la fermeture — en HTTP/2, l'objet de compatibilité. */
  readonly #response: http.ServerResponse | http2.Http2ServerResponse;
  readonly #stallTimeout: number | false;
  readonly #revalidate: (() => Promise<boolean>) | null;
  readonly identifier: string | null;
  #closed = false;
  /** Coupure d'un client qui ne lit plus — armée seulement sous pression. */
  #stall: ReturnType<typeof setTimeout> | null = null;
  /** Fin de vie du flux — armée seulement si `maxDuration` est posé. */
  #lifetime: ReturnType<typeof setTimeout> | null = null;
  /** Nettoyage du flux qui porte la brique — posé une fois, appelé en premier. */
  #release: (() => void) | null = null;
  /** Écouteurs de fermeture — `null` tant que personne n'en pose (lazy). */
  #onClose: Array<() => void> | null = null;
  readonly #onResponseClose = (): void => this.finish();
  /**
   * Le client ne lit plus depuis `stallTimeout` : on coupe la connexion, comme
   * s'il était parti — la fermeture de la réponse termine le flux.
   */
  readonly #onStall = (): void => {
    this.#stall = null;
    this.target.destroy();
  };

  constructor(
    context: HttpContext,
    target: StreamTarget,
    response: http.ServerResponse | http2.Http2ServerResponse,
    settings: IStreamLifecycleSettings,
  ) {
    this.context = context;
    this.target = target;
    this.#response = response;
    this.#stallTimeout = settings.stallTimeout;
    this.#revalidate = settings.revalidate;
    this.identifier = settings.identifier;
    // Posé AVANT toute attente : la fermeture d'un client parti pendant la
    // sauvegarde de la session ne doit pas passer inaperçue.
    response.on("close", this.#onResponseClose);
    if (settings.maxDuration !== false) {
      this.#lifetime = setTimeout(
        () => void this.close(),
        settings.maxDuration,
      );
      this.#lifetime.unref();
    }
    // Seule une identité révocable entre au registre : un anonyme n'a rien à
    // perdre, et ne coûte rien.
    if (this.#revalidate !== null) context.httpKernel?.watchStream(this);
  }

  /** Le flux est-il fermé — par le serveur, ou par le client parti ? */
  get closed(): boolean {
    return this.#closed;
  }

  /** L'identité qui a ouvert le flux est-elle toujours valable ? */
  revalidate(): Promise<boolean> {
    return this.#revalidate === null
      ? Promise.resolve(true)
      : this.#revalidate();
  }

  /**
   * Pose le nettoyage du flux qui porte la brique (minuteurs, attentes) : il
   * passe AVANT les écouteurs de l'application. Un cycle déjà fermé l'appelle
   * aussitôt.
   */
  onRelease(release: () => void): void {
    if (this.#closed) {
      release();
      return;
    }
    this.#release = release;
  }

  /**
   * Appelle `listener` à la fermeture du flux, quelle qu'en soit la cause.
   *
   * L'écouteur est lié au contexte asynchrone de la requête au moment de
   * l'enregistrement : la fermeture par le client part de la SOCKET, hors de
   * la bulle de la requête. Un flux déjà fermé appelle l'écouteur au tour
   * suivant.
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
   * Arme la coupure d'un client qui ne lit plus — à appeler quand une écriture
   * attend `drain`. Sans effet si elle est déjà armée ou désactivée.
   */
  armStall(): void {
    if (this.#stallTimeout === false || this.#stall !== null || this.#closed)
      return;
    this.#stall = setTimeout(this.#onStall, this.#stallTimeout);
    this.#stall.unref();
  }

  /** Désarme la coupure : le client a repris sa lecture. */
  clearStall(): void {
    if (this.#stall === null) return;
    clearTimeout(this.#stall);
    this.#stall = null;
  }

  /**
   * Désarme le délai d'inactivité de la requête : un flux n'a pas de fin
   * attendue, ses propres gardes le remplacent.
   */
  disarmIdleTimeout(): void {
    const target = this.target;
    if (target instanceof http.ServerResponse) target.socket?.setTimeout(0);
    else target.setTimeout(0);
  }

  /** Ferme le flux et termine la requête. Idempotent. */
  close(): Promise<void> | undefined {
    if (this.#closed) return undefined;
    this.finish();
    const done = this.context.close();
    return done instanceof Promise ? done.then(() => undefined) : undefined;
  }

  /** Fin du flux : minuteurs, écouteurs et registre libérés, une seule fois. */
  finish(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#response.removeListener("close", this.#onResponseClose);
    if (this.#lifetime !== null) {
      clearTimeout(this.#lifetime);
      this.#lifetime = null;
    }
    this.clearStall();
    if (this.#revalidate !== null) this.context.httpKernel?.unwatchStream(this);
    const release = this.#release;
    this.#release = null;
    release?.();
    const listeners = this.#onClose;
    this.#onClose = null;
    if (listeners !== null) for (const listener of listeners) listener();
  }
}

/** Ce que l'ouverture reçoit de l'appelant. */
export interface IOpenStreamLifecycle {
  /** Préfixe des messages d'erreur (`SSE`, `Flux`). */
  label: string;
  stallTimeout: number | false;
  maxDuration: number | false;
}

/**
 * Ouvre le cycle de vie d'un flux sur la réponse d'un contexte HTTP.
 *
 * Prend la réponse, pose l'écoute de sa fermeture, puis sauve la session —
 * sans rien écrire : les en-têtes appartiennent au flux. Un client parti
 * pendant la sauvegarde rend un cycle déjà fermé (`closed`) : le flux n'écrit
 * alors rien.
 *
 * @param context - le contexte de la requête, pas encore répondu.
 * @param options - gardes du flux et préfixe des messages.
 * @returns le cycle de vie, ou sa promesse quand une session est à sauver.
 * @throws HttpError 500 quand la réponse est déjà partie, ou que son
 *   transport n'est pas reconnu.
 * @throws HttpError 429 quand l'IP du client a déjà tous ses flux et sockets
 *   (`wsMaxConnectionsPerIp`) — refusé AVANT d'écrire quoi que ce soit.
 *
 * @internal
 */
export function openStreamLifecycle(
  context: HttpContext,
  options: IOpenStreamLifecycle,
): StreamLifecycle | Promise<StreamLifecycle> {
  const { label } = options;
  if (context.sended || context.finished || context.response.isHeaderSent()) {
    throw new HttpError(`${label} : la réponse est déjà partie`, 500, context);
  }
  const response = context.response;
  const nodeResponse = response.response;
  if (nodeResponse === null) {
    throw new HttpError(`${label} : réponse introuvable`, 500, context);
  }
  // Le transport se CONSTATE, AVANT d'écrire quoi que ce soit : en HTTP/2 on
  // écrit sur le flux, en HTTP/1.1 sur la réponse.
  const stream = response instanceof Http2Response ? response.stream : null;
  let target: StreamTarget;
  if (stream !== null) target = stream;
  else if (nodeResponse instanceof http.ServerResponse) target = nodeResponse;
  else {
    throw new HttpError(
      `${label} : transport de réponse inconnu`,
      500,
      context,
    );
  }
  // Un client déjà parti n'émettra plus `close` : le cycle naît fermé, et ne
  // prend pas de place de connexion qu'aucune fermeture ne rendrait.
  const gone = target.destroyed;
  // Une connexion longue de plus pour cette IP : le budget est celui des
  // sockets WebSocket. La place est rendue à la fermeture de la réponse.
  const kernel = context.httpKernel;
  if (
    !gone &&
    kernel !== null &&
    !kernel.acquireConnectionSlot(context.request.request, nodeResponse)
  ) {
    throw new HttpError(
      `${label} : trop de connexions ouvertes depuis cette adresse`,
      429,
      context,
    );
  }
  // Lu dans la bulle de la requête, là où le pare-feu a posé l'identité.
  const revalidate = kernel?.firewall?.currentRevalidator?.() ?? null;
  const identifier =
    revalidate === null
      ? null
      : (RequestContext.getAuthenticatedUser()?.identifier ?? null);
  // Pris AVANT toute attente : l'action ne doit plus pouvoir répondre autrement.
  context.sended = true;
  const lifecycle = new StreamLifecycle(context, target, nodeResponse, {
    stallTimeout: options.stallTimeout,
    maxDuration: options.maxDuration,
    revalidate,
    identifier,
  });
  if (gone) {
    lifecycle.finish();
    return lifecycle;
  }
  if (context.session == null) return lifecycle;
  return context
    .saveSession()
    .catch((e: unknown) => {
      context.log(e, "ERROR", "SESSION-STORE");
      return null;
    })
    .then(() => {
      // Parti avant la pose de l'écouteur, ou réponse détruite sans `close`
      // encore émis : rien ne sera écrit.
      if (target.destroyed) lifecycle.finish();
      return lifecycle;
    });
}
