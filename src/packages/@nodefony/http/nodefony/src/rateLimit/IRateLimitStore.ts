/**
 * Contrat d'un compteur de **rate-limit général par IP** (P0.3) et son verdict.
 *
 * À NE PAS confondre avec `security.rateLimit` (backoff de LOGIN NIST, par
 * identifiant saisi). Ici : plafond de trafic par IP cliente, sur TOUTES les
 * routes HTTP, matérialisé par les en-têtes `X-RateLimit-*` + un `429` (RFC 6585).
 *
 * Le contrat est **SYNCHRONE** à dessein : `hit()` est appelé sur le hot-path de
 * CHAQUE requête → aucune `Promise`, aucune microtask. Un futur store distribué
 * (Redis, multi-pod) introduira son propre chemin d'exécution, pas ce contrat.
 */

/**
 * Verdict rendu par {@link IRateLimitStore.hit} — porte tout le nécessaire pour
 * émettre les en-têtes `X-RateLimit-*` (+ `Retry-After` en cas de rejet) sans
 * relire l'état du store.
 */
export interface RateLimitVerdict {
  /** `true` si la requête dépasse le quota de la fenêtre → réponse `429`. */
  readonly limited: boolean;
  /** Plafond de la fenêtre — en-tête `X-RateLimit-Limit`. */
  readonly limit: number;
  /** Requêtes restantes dans la fenêtre courante (`X-RateLimit-Remaining`, ≥ 0). */
  readonly remaining: number;
  /** Fin de la fenêtre courante, en **ms epoch** (`X-RateLimit-Reset` = `⌈/1000⌉`). */
  readonly resetAtMs: number;
  /** Secondes jusqu'au reset (`Retry-After`) ; `0` si la requête n'est pas limitée. */
  readonly retryAfterS: number;
}

/** Options de construction d'un {@link IRateLimitStore}. */
export interface IRateLimitOptions {
  /** Largeur de la fenêtre fixe, en **millisecondes**. */
  readonly windowMs: number;
  /** Nombre max de requêtes autorisées par clé (IP) et par fenêtre. */
  readonly max: number;
  /** Borne mémoire : nombre max de clés (IP) suivies simultanément. */
  readonly maxTracked: number;
}

/**
 * Compteur de rate-limit par clé (IP). Implémentation par défaut :
 * {@link import("./MemoryRateLimitStore").MemoryRateLimitStore} (fenêtre fixe,
 * en mémoire).
 */
export interface IRateLimitStore {
  /**
   * Enregistre un hit pour `key` (IP cliente résolue) et renvoie le verdict de
   * la fenêtre courante. Synchrone, O(1).
   */
  hit(key: string): RateLimitVerdict;
  /**
   * Purge les fenêtres expirées (`resetAt <= now`). Appelé hors hot-path par le
   * `GcScheduler` du core.
   *
   * @param nowMs - horloge injectable (ms epoch) ; défaut = horloge du store.
   * @returns le nombre d'entrées purgées.
   */
  gc(nowMs?: number): number;
  /** Nombre de clés (IP) actuellement suivies — introspection / métrique. */
  readonly trackedCount: number;
  /** Total cumulé de requêtes rejetées (`429`) depuis le boot — métrique. */
  readonly rejectedTotal: number;
}
