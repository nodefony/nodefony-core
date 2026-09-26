/**
 * Nom du constructeur d'une valeur quelconque, ou `undefined` s'il n'y en a pas.
 *
 * Le compilateur tient tout objet pour doté d'un `constructor` : ce n'est vrai
 * ni de `null`/`undefined`, ni d'un objet créé par `Object.create(null)`, ni
 * d'une classe anonyme. Les chemins d'erreur qui nomment ce qu'ils ont reçu
 * passent donc par ici plutôt que par un `?.` que le lint typé juge inutile.
 *
 * @param value - n'importe quelle valeur.
 * @returns le nom, ou `undefined` si la valeur n'en porte pas.
 */
export function constructorName(value: unknown): string | undefined {
  const name = (
    value as { constructor?: { name?: unknown } } | null | undefined
  )?.constructor?.name;
  // Une classe anonyme rend `""` : rendu tel quel, c'est à l'appelant d'en juger.
  return typeof name === "string" ? name : undefined;
}
