/**
 * Gardes de forme pour une valeur reçue en `unknown` — stockage navigateur
 * (`utils/storedJson.ts`), charge d'un canal temps réel.
 *
 * Elles remplacent la conversion `x as T`, qui passe le typage puis casse au
 * rendu : chaque lecteur reconstruit sa valeur champ par champ avec elles, et
 * abandonne ce qu'il ne reconnaît pas.
 */
import { isPlainObject } from "nodefony";

/**
 * Les seules entrées d'un objet dont la valeur passe la garde.
 *
 * `Object.fromEntries` pose chaque clé en propriété propre : une clé
 * `__proto__` relue du stockage reste une donnée, elle ne change pas le
 * prototype du résultat.
 *
 * @param value - valeur relue
 * @param isValue - garde d'une valeur
 * @returns les entrées retenues ; `{}` si `value` n'est pas un objet simple
 */
export function recordOf<T>(
  value: unknown,
  isValue: (v: unknown) => v is T,
): Record<string, T> {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, T] => isValue(e[1])),
  );
}

/**
 * Les seuls éléments d'un tableau qui passent la garde.
 *
 * @param value - valeur relue
 * @param isItem - garde d'un élément
 * @returns les éléments retenus ; `[]` si `value` n'est pas un tableau
 */
export function arrayOf<T>(
  value: unknown,
  isItem: (v: unknown) => v is T,
): T[] {
  return Array.isArray(value) ? value.filter(isItem) : [];
}

/**
 * Garde d'appartenance à une liste fermée de chaînes.
 *
 * @param values - valeurs admises
 * @returns la garde correspondante
 */
export function isOneOf<T extends string>(
  values: readonly T[],
): (v: unknown) => v is T {
  return (v): v is T => typeof v === "string" && values.some((x) => x === v);
}

/** Garde d'une chaîne. */
export const isString = (v: unknown): v is string => typeof v === "string";

/** Garde d'un booléen. */
export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

/** Garde d'un nombre fini — `NaN` et `Infinity` sont refusés. */
export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
