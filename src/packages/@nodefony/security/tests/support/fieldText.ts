/**
 * Forme texte d'une valeur de champ lue dans un store, pour comparer deux
 * ordres de tri.
 *
 * `String()` sur un objet rend `[object Object]` : deux valeurs distinctes s'y
 * confondraient et un tri faux passerait pour juste. Un objet (hors `Date`) est
 * donc sérialisé en JSON ; tout le reste garde la forme de `String()`.
 *
 * @param value - valeur du champ, telle que le store l'a rendue.
 * @returns sa forme texte, stable d'une lecture à l'autre.
 */
export function fieldText(value: unknown): string {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    case "undefined":
      return "undefined";
    case "symbol":
      return value.toString();
    case "function":
      return "function";
    case "object":
    default: // inatteignable : `typeof` n'a pas d'autre valeur
      if (value === null) return "null";
      if (value instanceof Date) return value.toString();
      return JSON.stringify(value);
  }
}
