import { AsyncResource } from "node:async_hooks";
import http from "node:http";
import type http2 from "node:http2";
import type HttpContext from "./HttpContext";
import Http2Response from "../http2/Response";
import HttpError from "../../errors/httpError";
import { ANNOUNCE_CAP_MS } from "../../servers/http2Goaway";
import { RequestContext, REVOCATION_REVALIDATE_MS } from "nodefony";

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

/**
 * Plus long délai qu'un minuteur sait tenir (2^31-1 ms). Au-delà, Node le
 * ramène à 1 ms : un délai qui le dépasse ferait battre ou couper le flux
 * mille fois par seconde.
 */
export const MAX_TIMER_MS = 2_147_483_647;

/**
 * Délai de blocage par défaut d'un flux, en ms : un client qui ne lit plus
 * depuis ce délai est coupé. Valeur commune aux flux d'événements, d'octets et
 * aux flux RPC.
 */
export const STREAM_STALL_TIMEOUT_MS = 30_000;

/**
 * Période du balayage de blocage ({@link StallSweep}) : la moitié du délai de
 * blocage. Un client bloqué est coupé entre `stallTimeout` et
 * `stallTimeout + période` après la première contre-pression vue — jamais
 * avant le délai réglé.
 */
export const STALL_SWEEP_PERIOD_MS = STREAM_STALL_TIMEOUT_MS / 2;

/**
 * Attente maximale, à l'arrêt du serveur, des flux longs qu'on vient de
 * terminer (`HttpKernel.shutdownStreams`), avant le drain des connexions.
 *
 * Un flux qui écoute son signal se ferme en quelques millisecondes : l'attente
 * finit avec lui. Elle ne dure jusqu'à son terme que pour un gestionnaire qui
 * n'écoute rien — et ce temps s'AJOUTE au drain (`shutdownTimeout`), d'où une
 * borne courte, celle de l'annonce du GOAWAY.
 */
export const SHUTDOWN_STREAMS_WAIT_MS = ANNOUNCE_CAP_MS;

/**
 * Refuse une option de délai hors de ce qu'un minuteur sait tenir.
 *
 * @param label - préfixe du message (`SSE`, `Flux`).
 * @param name - nom de l'option.
 * @param value - valeur reçue ; `undefined` et `false` passent.
 * @throws RangeError quand la valeur n'est ni `false` ni un entier entre 1 et 2^31-1.
 *
 * @internal
 */
export function checkStreamTimer(
  label: string,
  name: string,
  value: number | false | undefined,
): void {
  if (value === undefined || value === false) return;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_MS) {
    throw new RangeError(
      `${label} : ${name} entier entre 1 et ${MAX_TIMER_MS} ms, ou false, attendu`,
    );
  }
}

/**
 * Qui a fermé le flux, quand ce n'est pas le client : le serveur (`close()` —
 * fin demandée, durée de vie, révocation), ou la coupure d'un client qui ne lit
 * plus. `null` : le client est parti, ou le flux est encore ouvert.
 */
export type StreamLifecycleCause = "server" | "stall" | null;

/** Ce sur quoi on écrit : la réponse HTTP/1.1, ou le flux HTTP/2. */
export type StreamTarget = http.ServerResponse | http2.ServerHttp2Stream;

/**
 * Constate le transport de la réponse d'un contexte : le flux en HTTP/2, la
 * réponse en HTTP/1.1. Seule implémentation de ce constat — un flux SSE,
 * d'octets ou un appel gRPC le lisent ici.
 *
 * @param context - le contexte de la requête.
 * @returns la cible d'écriture, ou `null` quand la réponse est absente ou que
 *   son transport n'est pas reconnu.
 *
 * @internal
 */
export function resolveStreamTarget(context: HttpContext): StreamTarget | null {
  const response = context.response;
  const stream = response instanceof Http2Response ? response.stream : null;
  if (stream !== null) return stream;
  const nodeResponse = response.response;
  return nodeResponse instanceof http.ServerResponse ? nodeResponse : null;
}

/**
 * Désarme le délai de réponse que Nodefony arme sur toute requête
 * (`HttpContext.setTimeout`) : celui du flux en HTTP/2, celui de la socket en
 * HTTP/1.1. Seule implémentation de cette règle — un flux long l'appelle, et
 * une réponse possédée par un tiers aussi, pour qu'à l'expiration Nodefony
 * n'écrive pas un 408/504 par-dessus (un seul écrivain).
 *
 * En HTTP/1.1, la requête suivante de la même connexion réarme la socket
 * (`HttpContext.setTimeout` compare `socket.timeout` à son délai).
 *
 * @param target - la cible d'écriture constatée par {@link resolveStreamTarget}.
 *
 * @internal
 */
export function disarmResponseTimeout(target: StreamTarget): void {
  if (target instanceof http.ServerResponse) target.socket?.setTimeout(0);
  else target.setTimeout(0);
}

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
  /**
   * L'identité du flux est morte : il prend fin — au format de son protocole
   * quand un adaptateur RPC tient les écritures, sinon par {@link close}.
   */
  revoke(): unknown;
}

/** Gardes et identité d'un flux, options résolues. */
export interface IStreamLifecycleSettings {
  stallTimeout: number | false;
  maxDuration: number | false;
  /** Revalidateur de l'identité du flux — `null` pour un anonyme. */
  revalidate: (() => Promise<boolean>) | null;
  /** Identifiant de connexion de l'identité qui ouvre le flux — `null` anonyme. */
  identifier: string | null;
  /**
   * Les écritures appartiennent à un tiers (adaptateur RPC) : la brique ne les
   * voit pas. Le blocage s'observe alors par le balayage du noyau
   * ({@link StallSweep}), et la fermeture par le serveur détruit le transport
   * au lieu de terminer la réponse — jamais un second écrivain.
   */
  foreignWriter: boolean;
  /**
   * Le flux n'a pas de fin à lui (SSE, flux RPC, sortie d'un processus) : à
   * l'arrêt du serveur, le noyau le termine AVANT le drain des connexions
   * ({@link StreamLifecycle.shutdown}), au lieu de le laisser détruire sans un
   * mot à `shutdownTimeout`. `false` pour une source FINIE (une archive) : elle
   * a le drain pour finir, comme toute réponse en vol.
   */
  endsAtShutdown: boolean;
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
  readonly #foreignWriter: boolean;
  /**
   * Le noyau des registres où le flux s'inscrit, pris À L'OUVERTURE : le
   * nettoyage du contexte (`Context.clean`) remet `context.httpKernel` à
   * `null`, et il passe à la fermeture AVANT celui du flux — relu là, le
   * retrait ne se ferait pas, et le flux fermé resterait dans les registres
   * (révocation, balayage, arrêt) avec son contexte.
   */
  readonly #kernel: HttpContext["httpKernel"];
  /** Terminé par le noyau à l'arrêt du serveur — et donc inscrit à son registre. */
  readonly #endsAtShutdown: boolean;
  /**
   * Fin d'attente d'un flux balayé : posée sur `drain` quand le balayage voit
   * une contre-pression — créée à la première, `null` avant (lazy).
   */
  #onSweptDrain: (() => void) | null = null;
  /**
   * Fenêtre laissée à un appel RPC révoqué pour se terminer à son format avant
   * la destruction du transport — armée seulement à la révocation.
   */
  #revokeGrace: ReturnType<typeof setTimeout> | null = null;
  #closed = false;
  #cause: StreamLifecycleCause = null;
  /**
   * Minuteur de la coupure d'un client qui ne lit plus — créé à la PREMIÈRE
   * contre-pression, puis réarmé au reste du délai : jamais un minuteur par
   * épisode (un flux d'octets en connaît un par morceau sur une socket rapide).
   */
  #stall: ReturnType<typeof setTimeout> | null = null;
  /** Début de l'attente de `drain` en cours (`Date.now()`) ; `0` : aucune. */
  #stallSince = 0;
  /** Fin de vie du flux — armée seulement si `maxDuration` est posé. */
  #lifetime: ReturnType<typeof setTimeout> | null = null;
  /** Nettoyage du flux qui porte la brique — posé une fois, appelé en premier. */
  #release: (() => void) | null = null;
  /** Écouteurs de fermeture — `null` tant que personne n'en pose (lazy). */
  #onClose: Array<() => void> | null = null;
  readonly #onResponseClose = (): void => this.finish();
  /**
   * Tour du minuteur de blocage. Le client ne lit plus depuis `stallTimeout` :
   * on coupe la connexion, comme s'il était parti — la fermeture de la réponse
   * termine le flux. Une attente plus récente (le client a lu entre-temps) est
   * réarmée au reste de son délai ; plus d'attente du tout : le minuteur s'éteint.
   */
  readonly #onStall = (): void => {
    this.#stall = null;
    const limit = this.#stallTimeout;
    if (this.#stallSince === 0 || this.#closed || limit === false) return;
    const waited = Date.now() - this.#stallSince;
    if (waited < limit) {
      this.#stall = setTimeout(this.#onStall, limit - waited);
      this.#stall.unref();
      return;
    }
    this.#cutStalled();
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
    this.#foreignWriter = settings.foreignWriter;
    this.#endsAtShutdown = settings.endsAtShutdown;
    const kernel = context.httpKernel;
    this.#kernel = kernel;
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
    if (this.#revalidate !== null) kernel?.watchStream(this);
    // Tout flux sans fin à lui entre au registre de l'arrêt (ADR-0026 D8).
    if (this.#endsAtShutdown) kernel?.trackStream(this);
    // Écritures invisibles : seul le balayage voit un client qui ne lit plus.
    if (this.#foreignWriter && this.#stallTimeout !== false) {
      kernel?.sweepStall(this);
    }
  }

  /** Le flux est-il fermé — par le serveur, ou par le client parti ? */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Qui a fermé le flux : le serveur, la coupure d'un client qui ne lit plus,
   * ou `null` — client parti, ou flux encore ouvert. Lu par le flux qui porte
   * la brique, dans son nettoyage, pour nommer la raison de la fin.
   */
  get cause(): StreamLifecycleCause {
    return this.#cause;
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
    if (this.#stallTimeout === false || this.#stallSince !== 0 || this.#closed)
      return;
    this.#stallSince = Date.now();
    if (this.#stall !== null) return;
    this.#stall = setTimeout(this.#onStall, this.#stallTimeout);
    this.#stall.unref();
  }

  /**
   * Désarme la coupure : le client a repris sa lecture. Le minuteur n'est pas
   * détruit — il s'éteindra seul à son tour s'il n'y a plus d'attente, ou
   * resservira à la suivante sans nouvelle allocation.
   */
  clearStall(): void {
    this.#stallSince = 0;
  }

  /**
   * Un tour du balayage de blocage, pour un flux dont un tiers tient les
   * écritures ({@link StallSweep}).
   *
   * Une contre-pression vue (`writableNeedDrain`) ouvre l'attente et pose un
   * `drain` : seul ce progrès RÉEL la ferme, jamais un tour qui verrait le
   * tampon vide — un client lent qui lit voit son tampon se remplir à nouveau
   * aussitôt, et serait sinon pris pour bloqué. Une attente qui dure
   * `stallTimeout` coupe le client.
   *
   * @param now - l'heure du tour (`Date.now()`), lue une fois pour tous les flux.
   */
  sweepStall(now: number): void {
    const limit = this.#stallTimeout;
    if (this.#closed || limit === false) return;
    if (this.#stallSince !== 0) {
      if (now - this.#stallSince >= limit) this.#cutStalled();
      return;
    }
    if (!this.target.writableNeedDrain) return;
    this.#stallSince = now;
    this.target.once(
      "drain",
      (this.#onSweptDrain ??= (): void => {
        this.#stallSince = 0;
      }),
    );
  }

  /** Coupe un client qui ne lit plus : la fermeture de la réponse termine le flux. */
  #cutStalled(): void {
    this.#cause = "stall";
    this.target.destroy();
  }

  /**
   * Désarme le délai d'inactivité de la requête : un flux n'a pas de fin
   * attendue, ses propres gardes le remplacent.
   */
  disarmIdleTimeout(): void {
    disarmResponseTimeout(this.target);
  }

  /**
   * Ferme le flux et termine la requête. Idempotent. Quand un tiers tient les
   * écritures, le transport est détruit : terminer la réponse en ferait un
   * second écrivain.
   */
  close(): Promise<void> | undefined {
    if (this.#closed) return undefined;
    this.#cause = "server";
    this.finish();
    if (this.#foreignWriter) {
      this.target.destroy();
      return undefined;
    }
    const done = this.context.close();
    return done instanceof Promise ? done.then(() => undefined) : undefined;
  }

  /**
   * L'identité qui a ouvert le flux est morte (révocation, droits changés) :
   * le flux prend fin. Idempotent.
   *
   * Quand un adaptateur RPC tient les écritures, c'est LUI qui termine l'appel,
   * au format de son protocole (`HttpContext.rpc.revoke`, gRPC : 16) : le
   * client lit un statut, pas une coupure, et aucun second écrivain ne touche
   * la réponse. Un gestionnaire qui n'entend rien — bloqué, sans message à
   * produire — est détruit à la fenêtre de re-validation suivante. Sinon :
   * {@link close}.
   */
  revoke(): Promise<void> | undefined {
    if (this.#closed) return undefined;
    const rpc = this.#foreignWriter ? this.context.rpc : null;
    if (rpc === null) return this.close();
    if (this.#revokeGrace !== null) return undefined;
    this.#cause = "server";
    rpc.revoke();
    this.#revokeGrace = setTimeout(
      StreamLifecycle.#destroyRevoked,
      REVOCATION_REVALIDATE_MS,
      this,
    );
    this.#revokeGrace.unref();
    return undefined;
  }

  /**
   * Le serveur s'arrête : le flux prend fin AVANT le drain des connexions
   * (ADR-0026 D8). Idempotent.
   *
   * Quand un adaptateur RPC tient les écritures, c'est LUI qui termine l'appel,
   * au format de son protocole (`HttpContext.rpc.shutdown`, gRPC : 14
   * `UNAVAILABLE`) : le client le rejoue ailleurs. Un gestionnaire qui n'entend
   * rien tombe avec sa connexion, détruite par le drain à `shutdownTimeout` —
   * aucun minuteur de plus. Sinon : {@link close} — `EventSource` se
   * reconnecte, vers un autre exemplaire.
   */
  shutdown(): Promise<void> | undefined {
    if (this.#closed) return undefined;
    const rpc = this.#foreignWriter ? this.context.rpc : null;
    if (rpc === null) return this.close();
    this.#cause = "server";
    rpc.shutdown();
    return undefined;
  }

  /** Fenêtre écoulée : l'appel révoqué n'a pas fini, le transport est détruit. */
  static #destroyRevoked(this: void, lifecycle: StreamLifecycle): void {
    lifecycle.#revokeGrace = null;
    if (lifecycle.#closed) return;
    lifecycle.finish();
    lifecycle.target.destroy();
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
    if (this.#revokeGrace !== null) {
      clearTimeout(this.#revokeGrace);
      this.#revokeGrace = null;
    }
    this.#stallSince = 0;
    if (this.#stall !== null) {
      // Détruit, pas laissé s'éteindre : il retiendrait le flux, donc le
      // contexte, jusqu'à son tour.
      clearTimeout(this.#stall);
      this.#stall = null;
    }
    const kernel = this.#kernel;
    if (this.#revalidate !== null) kernel?.unwatchStream(this);
    if (this.#endsAtShutdown) kernel?.untrackStream(this);
    if (this.#foreignWriter) {
      kernel?.unsweepStall(this);
      if (this.#onSweptDrain !== null) {
        this.target.removeListener("drain", this.#onSweptDrain);
      }
    }
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
  /**
   * Un tiers tient les écritures (adaptateur RPC) — cf
   * {@link IStreamLifecycleSettings.foreignWriter}. Défaut `false`.
   */
  foreignWriter?: boolean;
  /**
   * Terminé par le noyau à l'arrêt du serveur — cf
   * {@link IStreamLifecycleSettings.endsAtShutdown}. Défaut `true`.
   */
  endsAtShutdown?: boolean;
}

/**
 * Le balayage de blocage des flux dont un tiers tient les écritures : UN
 * minuteur pour tous, armé au premier flux inscrit, arrêté au dernier retiré.
 *
 * Pourquoi un balayage : l'adaptateur écrit et attend `drain` lui-même, la
 * brique ne voit aucune écriture. Le délai d'inactivité que Node tient sur un
 * flux HTTP/2 ne suffit pas : il est repoussé tant que la SESSION avance
 * (`internal/http2/core#callTimeout`), si bien qu'un flux bloqué ne serait
 * jamais coupé tant qu'un voisin de la même connexion est lu.
 *
 * Le seuil reste dans {@link StreamLifecycle.sweepStall} : une règle, une
 * implémentation.
 *
 * Coût mesuré (300 flux HTTP/2 réels, médiane de 9 passes) : ~6 ns par flux et
 * par tour ; ~60 ns pour inscrire puis retirer un flux ; 0 par message.
 *
 * @internal
 */
export class StallSweep {
  #entries: Set<StreamLifecycle> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  readonly #periodMs: number;
  readonly #tick = (): void => {
    this.sweep(Date.now());
  };

  /** @param periodMs - période du balayage (défaut {@link STALL_SWEEP_PERIOD_MS}). */
  constructor(periodMs: number = STALL_SWEEP_PERIOD_MS) {
    this.#periodMs = periodMs;
  }

  /** Nombre de flux balayés. */
  get size(): number {
    return this.#entries?.size ?? 0;
  }

  /** Le minuteur est-il armé ? */
  get running(): boolean {
    return this.#timer !== null;
  }

  /** Inscrit un flux ; arme le minuteur au premier. */
  add(lifecycle: StreamLifecycle): void {
    (this.#entries ??= new Set<StreamLifecycle>()).add(lifecycle);
    if (this.#timer === null) {
      this.#timer = setInterval(this.#tick, this.#periodMs);
      this.#timer.unref();
    }
  }

  /** Retire un flux (idempotent) ; arrête le minuteur quand il n'en reste aucun. */
  delete(lifecycle: StreamLifecycle): void {
    if (this.#entries === null) return;
    this.#entries.delete(lifecycle);
    if (this.#entries.size === 0 && this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Un tour : chaque flux inscrit juge son propre blocage.
   *
   * @param now - l'heure du tour (`Date.now()`).
   */
  sweep(now: number): void {
    if (this.#entries === null) return;
    for (const lifecycle of this.#entries) lifecycle.sweepStall(now);
  }
}

/** Ce que le registre de l'arrêt retient d'un flux : de quoi le terminer. */
export interface IShutdownStream {
  /** Le serveur s'arrête : le flux prend fin (cf {@link StreamLifecycle.shutdown}). */
  shutdown(): unknown;
}

/**
 * Le registre de l'arrêt : TOUS les flux longs ouverts qui n'ont pas de fin à
 * eux — SSE, flux RPC, flux d'octets vivants (ADR-0026 D8). À l'arrêt du
 * serveur, le noyau les termine AVANT le drain des connexions, au lieu de les
 * laisser détruire sans un mot à `shutdownTimeout`.
 *
 * Distinct du registre de révocation (`RevocationWatch`), qui ne tient que les
 * flux à identité : y mettre les anonymes ferait travailler chaque fenêtre de
 * re-validation pour rien.
 *
 * Coût : un ajout et un retrait par flux long, constants (44 à 77 ns mesurés
 * de 0 à 10 000 flux ouverts, ADR-0026 D8) ; 0 par appel unaire, 0 par
 * message.
 *
 * @internal
 */
export class ShutdownRegistry {
  readonly #entries = new Set<IShutdownStream>();
  /** L'arrêt a commencé : un flux inscrit désormais est terminé au tour suivant. */
  #closing = false;
  /** Fin de l'attente de l'arrêt, appelée au retrait du dernier flux. */
  #onEmpty: (() => void) | null = null;

  /** Nombre de flux ouverts. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Inscrit un flux. Pendant l'arrêt, il est terminé au tour suivant — une
   * fois son appel RPC relié, qui ne l'est qu'après l'ouverture.
   */
  add(stream: IShutdownStream): void {
    this.#entries.add(stream);
    if (this.#closing) setImmediate(shutdownLate, stream);
  }

  /** Retire un flux (idempotent) ; le dernier retiré met fin à l'attente. */
  delete(stream: IShutdownStream): void {
    if (!this.#entries.delete(stream) || this.#entries.size !== 0) return;
    const done = this.#onEmpty;
    this.#onEmpty = null;
    done?.();
  }

  /**
   * L'arrêt : termine chaque flux, puis attend que tous se soient retirés, au
   * plus `waitMs`.
   *
   * @param waitMs - attente maximale des fermetures.
   * @returns le nombre de flux encore ouverts à la fin de l'attente — tout de
   *   suite quand il n'y a rien à attendre, sinon sa promesse.
   */
  shutdown(waitMs: number): number | Promise<number> {
    this.#closing = true;
    // Un flux fermé se retire pendant le parcours : un `Set` le supporte,
    // l'élément retiré n'est simplement plus visité.
    for (const stream of this.#entries) stream.shutdown();
    if (this.#entries.size === 0) return 0;
    return new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        this.#onEmpty = null;
        resolve(this.#entries.size);
      }, waitMs);
      this.#onEmpty = () => {
        clearTimeout(timer);
        resolve(0);
      };
    });
  }
}

/** Termine un flux inscrit pendant l'arrêt (rappel de `setImmediate`). */
function shutdownLate(stream: IShutdownStream): void {
  stream.shutdown();
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
    // Sans contexte : `HttpError` réécrirait le statut de la réponse DÉJÀ prise
    // — celle d'un flux en cours, que le journal d'accès dirait en 500.
    throw new HttpError(`${label} : la réponse est déjà partie`, 500);
  }
  const response = context.response;
  const nodeResponse = response.response;
  if (nodeResponse === null) {
    throw new HttpError(`${label} : réponse introuvable`, 500, context);
  }
  // Le transport se CONSTATE, AVANT d'écrire quoi que ce soit : en HTTP/2 on
  // écrit sur le flux, en HTTP/1.1 sur la réponse.
  const target = resolveStreamTarget(context);
  if (target === null) {
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
    foreignWriter: options.foreignWriter ?? false,
    endsAtShutdown: options.endsAtShutdown ?? true,
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
