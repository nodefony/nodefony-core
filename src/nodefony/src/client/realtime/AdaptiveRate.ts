/**
 * AdaptiveRate — cadence ADAPTATIVE automatique d'un canal d'ÉTAT, **client-driven**
 * (niveau 1, zéro changement serveur). Pendant exact de l'ABR vidéo (HLS/DASH ajustent
 * la qualité selon le buffer) et du contrôle de congestion réseau (TCP **AIMD**).
 *
 * Idée : la cadence vit dans le nom du canal (cf {@link rateChannel} — 1 canal = 1 cadence
 * = 1 ticker serveur). Si le client observe que les frames arrivent **plus lentement** que
 * demandé (famine ⇒ event-loop serveur ou réseau sous pression), il se ré-abonne à une
 * cadence **plus grossière** (`1s→2s→5s`) → moins de pushes → la pression retombe → le flux
 * récupère ; quand c'est sain durablement, il remonte **doucement** vers la cadence désirée.
 *
 * AIMD (asymétrie anti-oscillation, comme TCP) :
 *  - **Multiplicative Decrease** : famine ⇒ on monte d'un cran l'échelle (cadence grossie),
 *    immédiat. L'échelle géométrique (×2) rend la décrue multiplicative.
 *  - **Additive Increase** : on ne redescend d'un cran (cadence affinée) qu'après une
 *    **fenêtre** de N échantillons sains → reprise lente.
 *  - **bande morte** (hystérésis) entre « sain » et « famine » : aucun changement → pas de
 *    flip-flop.
 *
 * Réservé aux canaux d'**ÉTAT** (latest-wins : supervision, stats) où décimer est sans perte.
 * PAS pour les canaux d'**ÉVÉNEMENTS** (syslog, frames protocole) où chaque item compte
 * (eux se batchent, pas se décimer).
 *
 * Cette classe est la **machine à états pure** (aucun timer, aucune socket) → déterministe
 * et testable. Le câblage à une socket réelle vit dans {@link bindAdaptiveChannel}.
 *
 * @see {@link bindAdaptiveChannel} — glue socket + watchdog.
 * @see {@link rateChannel} — convention de nommage cadencé partagée client↔serveur.
 */

import { rateChannel } from "../../realtime/channelRate";
import type {
  IRealtimeSocket,
  RealtimeHandler,
} from "../../realtime/IRealtimeSocket";

/** Raison d'un changement de cadence (pour un badge UI). */
export type RateChangeReason = "init" | "decrease" | "increase";

/** Décision de la boucle AIMD : nouvelle cadence + pourquoi. `null` = ne rien changer. */
export interface RateDecision {
  /** Cadence cible (ms). */
  readonly intervalMs: number;
  /** Cause du changement. */
  readonly reason: RateChangeReason;
}

/** Réglages de la cadence adaptative. Seul `intervalMs` est requis. */
export interface AdaptiveRateOptions {
  /** Cadence désirée la plus fine (ms) = bas de l'échelle. */
  readonly intervalMs: number;
  /** Cadence par défaut serveur du canal (le canal nu la vaut). */
  readonly defaultMs?: number;
  /** Échelle de cadences (ms, croissante). Dérivée ×2 jusqu'à `maxMs` si absente. */
  readonly ladder?: number[];
  /** Famine : `gap observé > k × cadence courante` ⇒ décélère. Défaut `1.8`. */
  readonly starvationFactor?: number;
  /** Sain : `gap ≤ k × cadence` compte comme bon échantillon. Défaut `1.25`. */
  readonly healthyFactor?: number;
  /** Nb d'échantillons sains consécutifs avant d'accélérer (AI). Défaut `4`. */
  readonly recoveryWindow?: number;
  /** Plafond de l'échelle dérivée (ms). Défaut `60000`. */
  readonly maxMs?: number;
}

/** Construit une échelle géométrique ×2 de `intervalMs` à `maxMs` (bornes incluses). */
function deriveLadder(intervalMs: number, maxMs: number): number[] {
  const ladder: number[] = [];
  let ms = intervalMs;
  while (ms < maxMs) {
    ladder.push(ms);
    ms *= 2;
  }
  ladder.push(maxMs);
  return ladder;
}

export class AdaptiveRate {
  private readonly ladder: number[];
  private readonly starvationFactor: number;
  private readonly healthyFactor: number;
  private readonly recoveryWindow: number;
  /** Position dans l'échelle (0 = cadence la plus fine = désirée). */
  private idx = 0;
  /** Échantillons sains consécutifs depuis le dernier changement. */
  private healthy = 0;
  /** Timestamp (ms) de la dernière frame ; `null` = pas de référence (post-switch/init). */
  private lastFrameTs: number | null = null;

  constructor(options: AdaptiveRateOptions) {
    const maxMs = options.maxMs ?? 60000;
    const ladder =
      options.ladder && options.ladder.length > 0
        ? [...options.ladder].sort((a, b) => a - b)
        : deriveLadder(options.intervalMs, Math.max(options.intervalMs, maxMs));
    this.ladder = ladder;
    this.starvationFactor = options.starvationFactor ?? 1.8;
    this.healthyFactor = options.healthyFactor ?? 1.25;
    this.recoveryWindow = options.recoveryWindow ?? 4;
  }

  /** Cadence courante (ms). */
  current(): number {
    return this.ladder[this.idx];
  }

  /** Décale d'un cran vers le grossier (MD) ; renvoie `true` si la cadence a changé. */
  private decrease(): boolean {
    if (this.idx >= this.ladder.length - 1) return false;
    this.idx += 1;
    return true;
  }

  /** Décale d'un cran vers le fin (AI) ; renvoie `true` si la cadence a changé. */
  private increase(): boolean {
    if (this.idx <= 0) return false;
    this.idx -= 1;
    return true;
  }

  /** Réamorce la mesure (après un changement de cadence). */
  private resetSample(): void {
    this.lastFrameTs = null;
    this.healthy = 0;
  }

  /**
   * À appeler à CHAQUE frame reçue. Pilote l'**AI** (reprise) et détecte aussi la famine
   * sur frames lentes (**MD**).
   *
   * @param now - horloge (ms).
   * @returns une {@link RateDecision} si la cadence doit changer, sinon `null`.
   */
  noteFrame(now: number): RateDecision | null {
    const prev = this.lastFrameTs;
    this.lastFrameTs = now;
    if (prev === null) return null; // 1ʳᵉ frame : pas de gap mesurable
    const gap = now - prev;
    const cur = this.current();

    if (gap > this.starvationFactor * cur) {
      if (this.decrease()) {
        this.resetSample();
        return { intervalMs: this.current(), reason: "decrease" };
      }
      this.healthy = 0;
      return null;
    }

    if (gap <= this.healthyFactor * cur) {
      this.healthy += 1;
      if (this.healthy >= this.recoveryWindow && this.increase()) {
        this.resetSample();
        return { intervalMs: this.current(), reason: "increase" };
      }
      return null;
    }

    // bande morte : ni sain ni famine → reset du compteur de reprise, pas de changement.
    this.healthy = 0;
    return null;
  }

  /**
   * Watchdog : à appeler périodiquement. Détecte la famine **totale** (plus aucune frame)
   * que {@link noteFrame} ne verrait pas (faute de frame).
   *
   * @param now - horloge (ms).
   * @returns une {@link RateDecision} (toujours `"decrease"`) si la cadence doit grossir.
   */
  checkStarvation(now: number): RateDecision | null {
    if (this.lastFrameTs === null) return null;
    if (now - this.lastFrameTs > this.starvationFactor * this.current()) {
      if (this.decrease()) {
        this.resetSample();
        return { intervalMs: this.current(), reason: "decrease" };
      }
    }
    return null;
  }
}

/** Planificateur du watchdog — injectable pour des tests déterministes (défaut : globals). */
export interface AdaptiveScheduler {
  set(cb: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultScheduler: AdaptiveScheduler = {
  set: (cb, ms) => setInterval(cb, ms),
  clear: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

const defaultClock = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/** Réglages du câblage adaptatif = {@link AdaptiveRateOptions} + crochets/injection. */
export interface BindAdaptiveOptions extends AdaptiveRateOptions {
  /**
   * Active l'AIMD. `false` ⇒ **mode fixe** : abonnement simple à `intervalMs` (aucun
   * watchdog, aucune mesure, aucun ré-abonnement). Défaut `true`. Permet à l'UI de
   * basculer adaptatif ⇄ fixe sans changer de code d'appel.
   */
  enabled?: boolean;
  /** Notifié à chaque cadence effective (incl. `"init"`) — utile pour un badge UI. */
  onRate?: (intervalMs: number, reason: RateChangeReason) => void;
  /** Horloge (ms). Défaut `performance.now()`/`Date.now()`. */
  clock?: () => number;
  /** Planificateur du watchdog. Défaut `setInterval`/`clearInterval`. */
  scheduler?: AdaptiveScheduler;
}

/** Poignée du canal adaptatif — cadence courante + coupure. */
export interface AdaptiveChannelBinding {
  /** Cadence courante (ms). */
  readonly intervalMs: number;
  /** Canal effectivement abonné (`base` ou `base:<ms>`). */
  readonly channel: string;
  /** Coupe tout : watchdog + handler + `unsubscribe`. Idempotent. */
  dispose(): void;
}

/**
 * Câble un {@link AdaptiveRate} à une socket réelle : abonne `base` à sa cadence désirée,
 * mesure la gigue d'arrivée, et **ré-abonne** automatiquement à une cadence plus grossière
 * en cas de famine (MD) puis plus fine quand c'est sain (AI). Les frames continuent d'être
 * livrées à `handler` à travers les changements de cadence.
 *
 * Réservé aux canaux d'ÉTAT (latest-wins). Pour les canaux d'événements, ne pas décimer.
 *
 * @param socket - la socket Nodefony ({@link IRealtimeSocket}).
 * @param base - canal de base (sans suffixe de cadence).
 * @param handler - reçoit le payload de chaque frame.
 * @param options - cadence désirée + réglages AIMD + injections.
 * @returns une {@link AdaptiveChannelBinding} (cadence courante + `dispose`).
 */
export function bindAdaptiveChannel(
  socket: IRealtimeSocket,
  base: string,
  handler: RealtimeHandler,
  options: BindAdaptiveOptions,
): AdaptiveChannelBinding {
  // Mode fixe : adaptatif coupé → abonnement simple à la cadence désirée, 0 watchdog.
  if (options.enabled === false) {
    const channel = rateChannel(base, options.intervalMs, options.defaultMs);
    socket.subscribe(channel);
    const offFixed = socket.on(channel, handler);
    options.onRate?.(options.intervalMs, "init");
    let downFixed = false;
    return {
      get intervalMs() {
        return options.intervalMs;
      },
      get channel() {
        return channel;
      },
      dispose() {
        if (downFixed) return;
        downFixed = true;
        offFixed();
        socket.unsubscribe(channel);
      },
    };
  }

  const clock = options.clock ?? defaultClock;
  const scheduler = options.scheduler ?? defaultScheduler;
  const ar = new AdaptiveRate(options);

  let currentMs = ar.current();
  let currentChannel = rateChannel(base, currentMs, options.defaultMs);
  let off: (() => void) | null = null;
  let watchdog: unknown;
  let disposed = false;

  const wrapped: RealtimeHandler = (...args: unknown[]) => {
    const decision = ar.noteFrame(clock());
    handler(...args); // livrer la frame d'abord (sur le canal courant)
    if (decision) applyDecision(decision);
  };

  const armWatchdog = (): void => {
    if (watchdog !== undefined) scheduler.clear(watchdog);
    watchdog = scheduler.set(() => {
      const decision = ar.checkStarvation(clock());
      if (decision) applyDecision(decision);
    }, currentMs);
  };

  function applyDecision(decision: RateDecision): void {
    if (disposed) return;
    const nextChannel = rateChannel(
      base,
      decision.intervalMs,
      options.defaultMs,
    );
    currentMs = decision.intervalMs;
    if (nextChannel !== currentChannel) {
      const oldChannel = currentChannel;
      const oldOff = off;
      socket.subscribe(nextChannel); // abonner le neuf AVANT de couper l'ancien
      off = socket.on(nextChannel, wrapped);
      oldOff?.();
      socket.unsubscribe(oldChannel);
      currentChannel = nextChannel;
    }
    armWatchdog(); // ré-aligne la période du watchdog sur la nouvelle cadence
    options.onRate?.(currentMs, decision.reason);
  }

  // Abonnement initial.
  socket.subscribe(currentChannel);
  off = socket.on(currentChannel, wrapped);
  armWatchdog();
  options.onRate?.(currentMs, "init");

  return {
    get intervalMs() {
      return currentMs;
    },
    get channel() {
      return currentChannel;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (watchdog !== undefined) scheduler.clear(watchdog);
      off?.();
      socket.unsubscribe(currentChannel);
    },
  };
}

export default AdaptiveRate;
