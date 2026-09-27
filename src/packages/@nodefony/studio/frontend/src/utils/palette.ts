/** Liste d'au moins un élément : `list[0]` y est toujours défini. */
export type NonEmptyList<T> = readonly [T, ...T[]];

/**
 * Élément d'une liste NON VIDE choisi par index cyclique (palette de séries, de nœuds).
 *
 * @param list - liste non vide (palette)
 * @param i - index quelconque, ramené dans la liste par modulo
 * @returns l'élément `i mod longueur` ; le premier si `i` est négatif
 */
export function cyclicPick<T>(list: NonEmptyList<T>, i: number): T {
  return list[i % list.length] ?? list[0];
}

/** Palette stable des séries de débit par connecteur ORM (assignée par index). */
export const FLOW_PALETTE: NonEmptyList<string> = [
  "var(--mantine-color-yellow-6)",
  "var(--mantine-color-blue-6)",
  "var(--mantine-color-teal-6)",
  "var(--mantine-color-grape-6)",
  "var(--mantine-color-orange-6)",
  "var(--mantine-color-cyan-6)",
];
