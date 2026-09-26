/**
 * Message lisible d'une valeur LEVÉE (`catch`, rejet) dont on ignore le type.
 *
 * Même rendu que `String(value)` pour une `Error` (son `message`) et pour les
 * primitives ; un objet quelconque rend son étiquette (`[object Object]`) sans
 * appeler un `toString` arbitraire ni sérialiser son contenu — ce texte peut
 * finir dans une réponse ou un journal, il ne doit rien divulguer.
 *
 * @param value - la valeur levée.
 * @returns un texte court, jamais vide pour une valeur définie.
 */
export function thrownMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
      return String(value);
    case "object":
    case "function":
      return value === null ? "null" : Object.prototype.toString.call(value);
  }
}
