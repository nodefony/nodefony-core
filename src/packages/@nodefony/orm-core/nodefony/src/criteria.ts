import type { FieldOperators } from "../interfaces/IRepository";

/**
 * Liste figée des opérateurs riches reconnus dans un critère portable.
 *
 * Source de vérité unique partagée par tous les adapters : un objet de valeur de
 * champ n'est traité comme {@link FieldOperators} que si **toutes** ses clés
 * appartiennent à cette liste (cf {@link isFieldOperators}).
 */
export const OPERATOR_KEYS = [
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$like",
  "$null",
] as const;

/** Clé d'opérateur riche reconnue. */
export type OperatorKey = (typeof OPERATOR_KEYS)[number];

const OPERATOR_SET: ReadonlySet<string> = new Set<string>(OPERATOR_KEYS);

/**
 * Indique si une valeur de champ est un objet d'{@link FieldOperators}.
 *
 * Heuristique : objet simple, non-`null`, non-tableau, dont **toutes** les clés
 * propres sont des opérateurs reconnus (et au moins une). Une valeur objet
 * « ordinaire » (colonne JSON, sous-document) n'a pas que des clés `$`-préfixées
 * reconnues → elle est traitée comme une égalité, jamais comme un filtre riche.
 *
 * @param value - valeur de critère associée à un champ.
 * @returns `true` si `value` doit être interprétée comme des opérateurs.
 */
export function isFieldOperators(
  value: unknown,
): value is FieldOperators<unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  for (const key of keys) {
    if (!OPERATOR_SET.has(key)) {
      return false;
    }
  }
  return true;
}
