/**
 * Coupe-circuit des admissions (décision de l'auteur sur #622) : 50 délais
 * dépassés en 5 s suspendent les appels d'`allow` pendant 5 s. Constantes
 * internes : un exploitant règle le délai et les plafonds, pas la mécanique qui
 * protège sa base quand elle ne répond plus.
 */
const BREAKER_THRESHOLD = 50;
const BREAKER_WINDOW_MS = 5000;
const BREAKER_OPEN_MS = 5000;

/** Un avertissement par cause et par fenêtre : sous une base bloquée, un journal par abonné serait un amplificateur. */
const WARN_INTERVAL_MS = 10_000;

/** Rendu par {@link AdmissionBudget.acquire} quand une place est réservée. */
export const ADMISSION_GRANTED = -1;

/** Rendu par {@link AdmissionBudget.authenticateWithin} quand l'authentification n'a pas répondu à temps. */
export const AUTHENTICATE_TIMED_OUT: unique symbol = Symbol(
  "authenticate-timed-out",
);

/** Bornes des admissions, lues dans la configuration realtime (`authenticateTimeoutMs`, `allowTimeoutMs`, `maxPendingAllowsPerConnection`, `maxPendingAllowsTotal`). */
export interface IAdmissionLimits {
  readonly authenticateTimeoutMs: number;
  readonly allowTimeoutMs: number;
  readonly maxPendingAllowsPerConnection: number;
  readonly maxPendingAllowsTotal: number;
}

/**
 * Budget des admissions d'UN exemplaire — appels d'`allow` en vol, coupe-circuit et compteurs de refus (ADR-0021 §S10 bis point 3, §S9).
 *
 * Partagé par toutes les connexions du hub ; chaque connexion garde sa propre
 * file ({@link ConnectionAdmission}). Aucune horloge n'est lue tant que le
 * coupe-circuit est fermé : une règle synchrone ne paie que deux incréments.
 */
export class AdmissionBudget {
  /** Délai de l'authentification à la poignée de main (ADR-0021 §S11). */
  authenticateTimeoutMs = 10_000;
  /** Délai d'un appel d'`allow`, compté depuis la réception du `subscribe`, file comprise. */
  timeoutMs = 5000;
  /** Appels d'`allow` en vol par connexion ; au-delà, la demande attend son tour. */
  maxPerConnection = 8;
  #maxTotal = 512;
  #pending = 0;
  #timedOutTotal = 0;
  #saturatedTotal = 0;
  #authenticateTimedOutTotal = 0;
  // `-Infinity` : la fenêtre s'ouvre au PREMIER délai dépassé, jamais au
  // démarrage du processus (une fenêtre ancrée à 0 coupait une rafale en deux).
  #windowStart = -Infinity;
  #windowTimeouts = 0;
  // `0` = fermé : `performance.now()` dépasse 0 dès le démarrage, donc une
  // échéance posée n'est jamais nulle.
  #openUntil = 0;
  #lastTimeoutWarn = -Infinity;
  #lastThrowWarn = -Infinity;
  #lastAuthenticateWarn = -Infinity;

  /** Applique les bornes de la configuration (boot, cold path). */
  configure(limits: IAdmissionLimits): void {
    this.authenticateTimeoutMs = limits.authenticateTimeoutMs;
    this.timeoutMs = limits.allowTimeoutMs;
    this.maxPerConnection = limits.maxPendingAllowsPerConnection;
    this.#maxTotal = limits.maxPendingAllowsTotal;
  }

  /**
   * Réserve une place pour UN appel d'`allow`.
   *
   * @returns {@link ADMISSION_GRANTED} si la place est prise ; sinon la demande
   *   est comptée dans `allowSaturatedTotal` et la valeur rendue est le délai à
   *   annoncer au client (`retryAfterMs`, coupe-circuit ouvert), ou `0` quand il
   *   n'est pas connu (plafond global atteint).
   */
  acquire(): number {
    if (this.#openUntil !== 0) {
      const now = performance.now();
      if (now < this.#openUntil) {
        this.#saturatedTotal += 1;
        return Math.ceil(this.#openUntil - now);
      }
      this.#openUntil = 0;
    }
    if (this.#pending >= this.#maxTotal) {
      this.#saturatedTotal += 1;
      return 0;
    }
    this.#pending += 1;
    return ADMISSION_GRANTED;
  }

  /** Rend la place d'un appel terminé, dépassé ou abandonné à la fermeture. */
  release(): void {
    // Plancher : `reset()` (tests, hub vidé) peut passer entre une réservation
    // et sa restitution — jamais un compte négatif qui ouvrirait le plafond.
    if (this.#pending > 0) this.#pending -= 1;
  }

  /** Un appel d'`allow` n'a pas répondu dans son délai : compté, et porté au coupe-circuit. */
  recordTimeout(now: number): void {
    this.#timedOutTotal += 1;
    if (now - this.#windowStart >= BREAKER_WINDOW_MS) {
      this.#windowStart = now;
      this.#windowTimeouts = 0;
    }
    this.#windowTimeouts += 1;
    if (this.#windowTimeouts >= BREAKER_THRESHOLD) {
      this.#openUntil = now + BREAKER_OPEN_MS;
      this.#windowTimeouts = 0;
    }
  }

  /** Une demande a épuisé son délai dans la file, sans appel d'`allow`. */
  recordQueueExpired(): void {
    this.#saturatedTotal += 1;
  }

  /** Délai restant du coupe-circuit à `now`, ou `undefined` s'il est fermé. */
  retryAfter(now: number): number | undefined {
    return this.#openUntil > now ? Math.ceil(this.#openUntil - now) : undefined;
  }

  /** Faut-il journaliser cette cause maintenant ? Vrai au plus une fois par fenêtre et par cause. */
  shouldWarn(kind: "timeout" | "throw" | "authenticate", now: number): boolean {
    if (kind === "authenticate") {
      if (now - this.#lastAuthenticateWarn < WARN_INTERVAL_MS) return false;
      this.#lastAuthenticateWarn = now;
      return true;
    }
    if (kind === "timeout") {
      if (now - this.#lastTimeoutWarn < WARN_INTERVAL_MS) return false;
      this.#lastTimeoutWarn = now;
      return true;
    }
    if (now - this.#lastThrowWarn < WARN_INTERVAL_MS) return false;
    this.#lastThrowWarn = now;
    return true;
  }

  /**
   * Borne l'authentification d'une poignée de main par `authenticateTimeoutMs` (ADR-0021 §S11).
   *
   * Une identité arrivée après le délai est IGNORÉE : la promesse rendue est
   * déjà réglée sur {@link AUTHENTICATE_TIMED_OUT}, et un rejet tardif ne lève
   * rien (la promesse d'origine garde son gestionnaire). Le minuteur est coupé
   * dès la réponse et ne retient pas le processus à l'arrêt. Chaque dépassement
   * compte une poignée de main dans `authenticateTimedOutTotal`.
   *
   * @param pending - la promesse rendue par `authenticate()`
   * @returns le jeton, ou {@link AUTHENTICATE_TIMED_OUT} au dépassement
   */
  authenticateWithin<T>(
    pending: Promise<T>,
  ): Promise<T | typeof AUTHENTICATE_TIMED_OUT> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#authenticateTimedOutTotal++;
        resolve(AUTHENTICATE_TIMED_OUT);
      }, this.authenticateTimeoutMs);
      timer.unref();
      pending.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /** Appels d'`allow` en vol sur l'exemplaire. */
  get pending(): number {
    return this.#pending;
  }

  /** Cumul `allowTimedOutTotal` — unité : un appel d'`allow`. */
  get timedOutTotal(): number {
    return this.#timedOutTotal;
  }

  /** Cumul `allowSaturatedTotal` — unité : une demande d'abonnement. */
  get saturatedTotal(): number {
    return this.#saturatedTotal;
  }

  /** Cumul `authenticateTimedOutTotal` — unité : une poignée de main. */
  get authenticateTimedOutTotal(): number {
    return this.#authenticateTimedOutTotal;
  }

  /** Remet compteurs, coupe-circuit et bornes à leurs défauts (hub vidé). */
  reset(): void {
    this.authenticateTimeoutMs = 10_000;
    this.#authenticateTimedOutTotal = 0;
    this.#lastAuthenticateWarn = -Infinity;
    this.timeoutMs = 5000;
    this.maxPerConnection = 8;
    this.#maxTotal = 512;
    this.#pending = 0;
    this.#timedOutTotal = 0;
    this.#saturatedTotal = 0;
    this.#windowStart = -Infinity;
    this.#windowTimeouts = 0;
    this.#openUntil = 0;
    this.#lastTimeoutWarn = -Infinity;
    this.#lastThrowWarn = -Infinity;
  }
}
