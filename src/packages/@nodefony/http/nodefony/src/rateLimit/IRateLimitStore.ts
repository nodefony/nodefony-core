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

import type { IPage, IPageQuery } from "nodefony";

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
 * Une clé (IP) actuellement suivie, telle qu'exposée à l'INTROSPECTION admin —
 * l'état, jamais le trafic : ni URL, ni en-tête, ni corps. Une IP reste une
 * donnée personnelle → ce listing est réservé au data plane admin.
 */
export interface IRateLimitEntry {
  /** Clé suivie (IP cliente résolue). */
  readonly key: string;
  /** Hits comptés dans la fenêtre courante. */
  readonly count: number;
  /** Fin de la fenêtre courante (ms epoch). */
  readonly resetAtMs: number;
  /** `true` si la clé a dépassé le plafond de la fenêtre (elle prend des 429). */
  readonly limited: boolean;
}

/**
 * Requête de listing des clés suivies — {@link IPageQuery} + le seul filtre qui
 * a un sens ici. `q` (hérité) = préfixe de clé (« 10.0. » pour un sous-réseau),
 * pas une sous-chaîne : sur une IP, seul le préfixe est signifiant.
 */
export interface IRateLimitListQuery extends IPageQuery {
  /** `true` = seulement les clés au plafond, `false` = seulement les autres. */
  limited?: boolean;
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
  /**
   * Page des clés suivies — introspection admin (« qui me martèle ? »). Ne
   * matérialise jamais plus d'une page, filtres appliqués au store.
   *
   * **Asynchrone** alors que {@link IRateLimitStore.hit} est synchrone : ce
   * listing est hors hot-path (console admin), et un futur store distribué le
   * servira par `SCAN`. La contrainte « zéro Promise » ne vaut que pour `hit`.
   *
   * Ordre contractuel : `count` DESC (les plus bruyants d'abord — c'est LA
   * question d'exploitation), départagé par `key` ASC.
   */
  listPage(query: IRateLimitListQuery): Promise<IPage<IRateLimitEntry>>;
  /** Nombre de clés (IP) actuellement suivies — introspection / métrique. */
  readonly trackedCount: number;
  /** Total cumulé de requêtes rejetées (`429`) depuis le boot — métrique. */
  readonly rejectedTotal: number;
}
