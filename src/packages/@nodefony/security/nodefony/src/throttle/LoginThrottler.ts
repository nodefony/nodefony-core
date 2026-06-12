/**
 * Politique de backoff du throttling de login (NIST SP 800-63B §5.2.2).
 *
 * JAMAIS de verrouillage dur : un lockout au N-ième échec offrirait à
 * l'attaquant un déni de service gratuit sur le compte de sa victime (5 mauvais
 * essais suffiraient à l'exclure). Le délai PROGRESSIF rend le brute-force
 * impraticable (le coût croît exponentiellement) sans donner ce levier — le
 * titulaire légitime attend au pire `capDelayS`, jamais un déblocage admin.
 */
export interface ILoginThrottleOptions {
  /** Échecs consécutifs tolérés sans délai (défaut 3 — fautes de frappe). */
  freeAttempts?: number;
  /** Délai (s) après `freeAttempts` — double à chaque échec suivant (défaut 1). */
  baseDelayS?: number;
  /** Plafond du délai (s) — défaut 900 (15 min). */
  capDelayS?: number;
  /** Borne du nombre d'identifiants suivis (anti-fuite mémoire, défaut 10 000). */
  maxTracked?: number;
}

// Suivi d'un identifiant : compteur d'échecs consécutifs + fin de fenêtre de blocage.
interface IThrottleEntry {
  failures: number;
  blockedUntil: number;
}

const DEFAULT_FREE_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_S = 1;
const DEFAULT_CAP_DELAY_S = 900;
const DEFAULT_MAX_TRACKED = 10_000;

/**
 * Limiteur de tentatives de login **en mémoire, par identifiant saisi**.
 *
 * La clé est l'identifiant TEL QUE SAISI (existant ou non en base) : un
 * identifiant martelé est ralenti qu'il corresponde à un compte ou pas — aucun
 * oracle d'énumération. Par-processus (V1) : en cluster, chaque worker porte son
 * compteur (l'attaquant gagne ×N workers — acceptable car le backoff est
 * exponentiel ; un backend partagé type Redis se branchera derrière la même
 * interface sans toucher l'authenticator).
 *
 * Coût borné (règle perf Nodefony) : `Map` allouée LAZY au premier échec (une
 * app sans échec de login ne paie rien), AUCUN timer — l'expiration est évaluée
 * à la lecture et les entrées mortes sont purgées par balayage opportuniste
 * quand la borne `maxTracked` est atteinte (puis éviction FIFO en dernier
 * recours : ~10 000 × ~100 B ≈ 1 MB au pire).
 */
export class LoginThrottler {
  readonly freeAttempts: number;
  readonly baseDelayS: number;
  readonly capDelayS: number;
  readonly maxTracked: number;

  // Lazy : null tant qu'aucun échec (hot path des logins réussis = zéro alloc).
  #entries: Map<string, IThrottleEntry> | null = null;
  // Horloge injectable (tests déterministes) — Date.now en production.
  readonly #now: () => number;

  constructor(
    options: ILoginThrottleOptions = {},
    now: () => number = Date.now,
  ) {
    this.freeAttempts = options.freeAttempts ?? DEFAULT_FREE_ATTEMPTS;
    this.baseDelayS = options.baseDelayS ?? DEFAULT_BASE_DELAY_S;
    this.capDelayS = options.capDelayS ?? DEFAULT_CAP_DELAY_S;
    this.maxTracked = options.maxTracked ?? DEFAULT_MAX_TRACKED;
    this.#now = now;
  }

  /**
   * L'identifiant peut-il tenter un login maintenant ?
   *
   * @param identifier - identifiant tel que saisi.
   * @returns `0` si autorisé, sinon les secondes restantes (→ `Retry-After`,
   *   arrondies à l'entier supérieur).
   */
  check(identifier: string): number {
    const entry = this.#entries?.get(identifier);
    if (entry === undefined) return 0;
    const remainingMs = entry.blockedUntil - this.#now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  /**
   * Enregistre un échec : au-delà de `freeAttempts`, arme un délai exponentiel
   * `baseDelayS × 2^(échecs - freeAttempts - 1)`, plafonné à `capDelayS`.
   *
   * @param identifier - identifiant tel que saisi.
   */
  recordFailure(identifier: string): void {
    const entries = (this.#entries ??= new Map());
    let entry = entries.get(identifier);
    if (entry === undefined) {
      if (entries.size >= this.maxTracked) this.#evict(entries);
      entry = { failures: 0, blockedUntil: 0 };
      entries.set(identifier, entry);
    }
    entry.failures += 1;
    const over = entry.failures - this.freeAttempts;
    if (over > 0) {
      const delayS = Math.min(
        this.baseDelayS * 2 ** (over - 1),
        this.capDelayS,
      );
      entry.blockedUntil = this.#now() + delayS * 1000;
    }
  }

  /**
   * Login réussi : oublie l'identifiant (le délai repart de zéro — NIST :
   * l'utilisateur légitime ne traîne pas la dette d'un attaquant passé).
   *
   * @param identifier - identifiant tel que saisi.
   */
  recordSuccess(identifier: string): void {
    this.#entries?.delete(identifier);
  }

  /** Nombre d'identifiants actuellement suivis (introspection / tests). */
  get trackedCount(): number {
    return this.#entries?.size ?? 0;
  }

  // Purge toute entrée qui ne bloque plus RIEN (couvre aussi les identifiants à
  // 1-2 échecs jamais bloqués — le tas que crée une énumération de masse) ; on
  // perd l'escalade des identifiants froids, on garde les blocages chauds. Si la
  // Map reste pleine, éviction FIFO (ordre d'insertion) — borner la mémoire
  // prime sur la précision du compteur.
  #evict(entries: Map<string, IThrottleEntry>): void {
    const now = this.#now();
    for (const [key, entry] of entries) {
      if (entry.blockedUntil <= now) entries.delete(key);
    }
    let excess = entries.size - this.maxTracked + 1;
    if (excess > 0) {
      for (const key of entries.keys()) {
        entries.delete(key);
        if ((excess -= 1) <= 0) break;
      }
    }
  }
}

export default LoginThrottler;
