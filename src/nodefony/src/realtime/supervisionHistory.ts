/**
 * Forme de l'historique de la supervision (#618 D4/D5/D10) — le contrat que
 * le serveur produit et que la console relit, écrit UNE fois ici.
 *
 * Isomorphe et sans code : des noms de colonnes et un type. Le serveur
 * l'importe pour produire, le navigateur pour relire — aucun miroir côté
 * lecteur (#711).
 */

/** Séries de l'historique, dans l'ordre des colonnes de `values` (`Float64`). */
export const SUPERVISION_HISTORY_COLUMNS = [
  "ts",
  "cpuPercent",
  "eventLoopMeanMs",
  "eluUtilization",
  "heapUsed",
  "rss",
] as const;

/**
 * Bandes du retard de la boucle, dans l'ordre des colonnes de `loop`
 * (`Float32`, ms). Des percentiles et non les cases de l'histogramme :
 * `monitorEventLoopDelay` n'expose pas ses cases (#618 D5).
 */
export const SUPERVISION_LOOP_BANDS = ["p50", "p90", "p99", "max"] as const;

/** Un point de l'historique — une valeur par colonne et par bande. */
export type SupervisionHistoryPoint = Record<
  | (typeof SUPERVISION_HISTORY_COLUMNS)[number]
  | (typeof SUPERVISION_LOOP_BANDS)[number],
  number
>;

/**
 * Historique tel qu'il voyage : séries linéarisées du plus ancien au plus
 * récent, colonne après colonne, en octets petit-boutistes (relire par
 * `fromLittleEndianBytes`). La colonne `c` occupe les éléments
 * `[c × length, (c + 1) × length)` de la série relue.
 */
export interface ISupervisionHistory {
  /** Cadence d'échantillonnage, en ms. */
  intervalMs: number;
  /** Points retenus au plus par série. */
  capacity: number;
  /** Points présents (≤ `capacity`) — 0 à la première visite. */
  length: number;
  /** Nom des colonnes de `values` ({@link SUPERVISION_HISTORY_COLUMNS}). */
  columns: readonly string[];
  /** `Float64` petit-boutiste, `columns.length × length` éléments. */
  values: Uint8Array<ArrayBuffer>;
  /** Nom des colonnes de `loop` ({@link SUPERVISION_LOOP_BANDS}). */
  loopColumns: readonly string[];
  /** `Float32` petit-boutiste, `loopColumns.length × length` éléments (ms). */
  loop: Uint8Array<ArrayBuffer>;
}
