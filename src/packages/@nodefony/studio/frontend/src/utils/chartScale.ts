/**
 * Échelle verticale des mini-graphes temps réel — fonctions pures, partagées
 * par `MiniChart` et testées sans rendu.
 */

/**
 * Plafond « rond » au-dessus de `v` : 1, 2, 2,5 ou 5 × 10ⁿ.
 *
 * @param v - valeur à couvrir.
 * @returns le plus petit plafond rond ≥ `v` (1 si `v` ≤ 0).
 */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  const m = v / e;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * e;
}

/**
 * Échelle verticale STABLE : elle monte dès qu'une valeur la dépasse, mais ne
 * redescend que si le plafond utile tombe sous la moitié — sinon chaque pic qui
 * entre ou sort de la fenêtre fait sauter toute la courbe.
 *
 * @param prev - plafond affiché jusqu'ici (`null` au premier rendu).
 * @param rawMax - plus grande valeur de la fenêtre.
 * @returns le plafond à afficher.
 */
export function stableTop(prev: number | null, rawMax: number): number {
  const target = niceCeil(Math.max(1, rawMax) * 1.15);
  if (prev === null || target > prev || target < prev * 0.5) return target;
  return prev;
}
