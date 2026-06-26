/**
 * Ordonnanceur de **maintenance périodique** (« garbage collection ») exécutée
 * HORS du chemin d'une requête — pattern unifié du framework pour purger des
 * entrées expirées d'un store (sessions, jetons/PAT, clés d'idempotence, audit…).
 *
 * Motivation : la purge ne doit JAMAIS vivre dans le hot path ni être
 * probabiliste (l'ancien modèle PHP `gc_probability` affamait les serveurs à bas
 * trafic et payait le scan p99 du tirage malchanceux). Ce composant centralise le
 * **bon** pattern — auparavant dupliqué dans `TokenService` et `SessionsService`,
 * et absent (ou dégradé) ailleurs :
 *
 * 1. **délai de départ** (laisse passer le boot) **+ jitter** borné : décale les
 *    balayages entre process d'un cluster sur un store partagé (anti
 *    *thundering herd* — N pods ne scannent pas la même base au même instant) ;
 * 2. **`unref()`** sur les timers : n'empêchent pas l'arrêt propre du process ;
 * 3. **anti-empilement** : une seule passe concurrente (si une passe déborde
 *    l'intervalle, le tick suivant est ignoré, pas empilé) ;
 * 4. **désarmement idempotent** (`stop()`) au shutdown ;
 * 5. **`intervalS ≤ 0` ⇒ désarmé** : délègue la purge à un worker cron / k8s
 *    CronJob, ou au TTL natif du store (Redis) — sans brancher de code.
 *
 * Isomorphe : n'utilise que `setTimeout`/`setInterval` (globaux) et `unref?.()`
 * (gardé — absent côté navigateur, où ce composant n'est de toute façon jamais
 * instancié). Aucune dépendance au kernel → testable et réutilisable partout.
 *
 * ⚠️ Réservé au **lifecycle** (1 instance / store / process), jamais au hot path.
 *
 * @module
 */

/** Options de construction d'un {@link GcScheduler}. */
export interface IGcSchedulerOptions {
  /**
   * Intervalle entre deux passes, en **secondes**. `≤ 0` = ordonnanceur désarmé
   * (la maintenance est déléguée à un worker externe ou au TTL natif du store).
   */
  intervalS: number;

  /**
   * La passe de maintenance (typiquement `() => store.gc()`). Peut être sync ou
   * async ; ses rejets sont capturés (jamais d'`unhandledRejection`).
   */
  run: () => Promise<unknown> | unknown;

  /**
   * Étale le **départ** d'un délai aléatoire borné (anti *thundering herd* en
   * cluster). Défaut `true`. Une fois lancés, les ticks restent décalés.
   */
  jitter?: boolean;

  /** Reçoit l'erreur d'une passe qui a levé (sinon l'échec est silencieux). */
  onError?: (error: unknown) => void;

  /**
   * Délai fixe avant la **première** passe (ms, défaut `30_000`) — laisse finir
   * le boot avant de scanner.
   */
  initialDelayMs?: number;

  /** Plafond du jitter (ms, défaut `60_000`) — borne le retard de la 1ʳᵉ passe. */
  jitterCapMs?: number;
}

const DEFAULT_INITIAL_DELAY_MS = 30_000;
const DEFAULT_JITTER_CAP_MS = 60_000;

/**
 * Timer de maintenance déterministe, jittéré et désarmable. Voir la doc du
 * module pour le rationnel complet.
 *
 * @example
 * ```ts
 * const gc = new GcScheduler({
 *   intervalS: config.gcIntervalS,
 *   jitter: config.gcJitter,
 *   run: () => store.gc(),
 *   onError: (e) => this.log(e, "WARNING"),
 * });
 * gc.start();           // au boot / onReady
 * // …
 * gc.stop();            // au onTerminate
 * ```
 */
export class GcScheduler {
  /** Timer du délai initial (jittéré) — `null` tant que non armé / après tir. */
  #start: ReturnType<typeof setTimeout> | null = null;
  /** Timer récurrent — `null` tant que la 1ʳᵉ passe n'a pas eu lieu / après stop. */
  #timer: ReturnType<typeof setInterval> | null = null;
  /** Garde-fou anti-empilement : `true` pendant qu'une passe court. */
  #running = false;
  readonly #opts: IGcSchedulerOptions;

  constructor(opts: IGcSchedulerOptions) {
    this.#opts = opts;
  }

  /** `true` si l'ordonnanceur est armé (délai initial en cours OU timer récurrent). */
  get armed(): boolean {
    return this.#start !== null || this.#timer !== null;
  }

  /**
   * Arme l'ordonnanceur. Idempotent (no-op si déjà armé). Retourne `false` si
   * `intervalS ≤ 0` (désarmé volontaire — délégation cron / TTL natif), `true`
   * si un timer a été posé. Premier balayage après `initialDelayMs (+ jitter)`,
   * puis tous les `intervalS`.
   */
  start(): boolean {
    if (this.armed) return true;
    const intervalS = this.#opts.intervalS;
    if (!Number.isFinite(intervalS) || intervalS <= 0) return false;
    const base = intervalS * 1000;
    const cap = this.#opts.jitterCapMs ?? DEFAULT_JITTER_CAP_MS;
    const initial = this.#opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    const phase =
      this.#opts.jitter === false
        ? 0
        : Math.floor(Math.random() * Math.min(base, cap));
    const start = setTimeout(() => {
      this.#start = null;
      void this.runNow(); // rattrape l'accumulation du downtime
      const timer = setInterval(() => void this.runNow(), base);
      timer.unref?.();
      this.#timer = timer;
    }, initial + phase);
    start.unref?.();
    this.#start = start;
    return true;
  }

  /**
   * Exécute une passe **immédiatement** — point d'entrée public (le timer
   * l'appelle ; un worker cron / une commande batch peut l'appeler à sa place).
   * Anti-empilement : ignore l'appel si une passe court déjà. **Ne lève jamais**
   * — une erreur va à `onError`, pour ne pas tuer le déclencheur (retry au tick
   * suivant).
   */
  async runNow(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      await this.#opts.run();
    } catch (error) {
      this.#opts.onError?.(error);
    } finally {
      this.#running = false;
    }
  }

  /** Désarme les timers (idempotent) — à appeler au shutdown. */
  stop(): void {
    if (this.#start) {
      clearTimeout(this.#start);
      this.#start = null;
    }
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
