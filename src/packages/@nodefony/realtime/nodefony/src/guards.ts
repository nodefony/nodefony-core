/**
 * Gardes de type internes au paquet — elles remplacent une conversion (`as`)
 * par une vérification faite à l'exécution, pour qu'une valeur d'une autre
 * forme soit écartée au lieu de traverser le code sous un type qui ment.
 *
 * Non exportées par le paquet : ce sont des détails d'implémentation.
 */

/**
 * Vrai si la valeur est un objet non nul : ses propriétés se lisent alors,
 * typées `unknown`, et chacune se vérifie avant usage.
 *
 * @param value - valeur venue du réseau, d'une métadonnée ou du conteneur
 * @returns `true` pour tout objet (tableau compris), `false` pour `null` et les primitives
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Vrai si la valeur est une fonction. Toute fonction JavaScript s'appelle avec
 * n'importe quels arguments et rend une valeur inconnue : la signature annoncée
 * ne promet rien de plus que ce que `typeof` a vérifié.
 *
 * @param value - valeur lue par son nom (métadonnée, propriété dynamique)
 * @returns `true` si la valeur est appelable
 */
export function isCallable(
  value: unknown,
): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}
