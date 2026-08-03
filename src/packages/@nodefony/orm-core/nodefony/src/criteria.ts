import type {
  FieldOperators,
  UpdateOperators,
} from "../interfaces/IRepository";

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

/**
 * Liste figée des opérateurs d'**écriture** reconnus dans le `update` d'un
 * `upsert` (cf {@link UpdateOperators}).
 *
 * Source de vérité unique partagée par tous les adapters — pendant, côté
 * écriture, de {@link OPERATOR_KEYS}.
 */
export const UPDATE_OPERATOR_KEYS = ["$max", "$min"] as const;

/** Clé d'opérateur d'écriture reconnue. */
export type UpdateOperatorKey = (typeof UPDATE_OPERATOR_KEYS)[number];

const UPDATE_OPERATOR_SET: ReadonlySet<string> = new Set<string>(
  UPDATE_OPERATOR_KEYS,
);

/**
 * Indique si une valeur d'écriture est un objet d'{@link UpdateOperators}.
 *
 * Même heuristique que {@link isFieldOperators} : objet simple, non-`null`,
 * non-tableau, dont **toutes** les clés propres sont des opérateurs d'écriture
 * reconnus (et au moins une). Une valeur objet « ordinaire » (colonne JSON,
 * sous-document) est donc écrite telle quelle, jamais interprétée.
 *
 * @param value - valeur d'écriture associée à un champ.
 * @returns `true` si `value` doit être interprétée comme des opérateurs.
 */
export function isUpdateOperators(
  value: unknown,
): value is UpdateOperators<unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  for (const key of keys) {
    if (!UPDATE_OPERATOR_SET.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Traduit un terme de recherche `?q=` en critère portable — **la** règle de
 * recherche d'orm-core, en un seul exemplaire.
 *
 * Elle existe parce qu'elle était écrite plusieurs fois, presque à l'identique,
 * dans des stores qui n'avaient aucun test dessus.
 *
 * **Le motif est ANCRÉ À GAUCHE** (`préfixe%`), donc **indexable**. Une
 * recherche `%terme%` interdit tout usage d'index et impose un balayage
 * complet : plus « pratique » sur dix lignes, intenable sur un million. C'est un
 * choix de conception — un besoin de sous-chaîne relève d'un index plein-texte,
 * pas de `LIKE`.
 *
 * Plusieurs champs deviennent un `$or` ; un seul reste un critère plat (les
 * deux formes sont équivalentes pour les adapters, la seconde est plus lisible
 * dans les journaux de requêtes).
 *
 * ⚠️ **Les métacaractères `%` et `_` du terme restent ACTIFS**, et ce n'est pas
 * un oubli. Les échapper exige d'émettre une clause `LIKE … ESCAPE '\'`, que la
 * traduction portable de `$like` ne produit pas : un terme échappé sans cette
 * clause est cherché **littéralement**, backslash compris, et la recherche ne
 * rend alors plus RIEN. Mesuré en SQLite — un échappement qu'on n'émet pas est
 * pire que pas d'échappement du tout, parce qu'il échoue en silence.
 *
 * La conséquence est une imprécision, jamais une fuite : le terme reste borné à
 * la table interrogée et la valeur est bindée. Un point d'entrée qui a besoin
 * d'un échappement RÉEL doit composer du SQL natif et émettre `ESCAPE`
 * lui-même — c'est ce que fait `likeIdentifierCond` du queryKit Drizzle, seul
 * endroit du dépôt qui le fasse complètement (dont la divergence MySQL, où le
 * `\` d'un littéral doit être doublé).
 *
 * @param q - le terme saisi, déjà trimé par `parsePageQuery`.
 * @param fields - les champs sur lesquels chercher, en noms de propriétés.
 * @returns le critère à fusionner, ou `null` si le terme est vide ou qu'aucun
 *   champ n'est déclaré — l'appelant décide alors quoi faire de `q`.
 */
export function searchCriteria<T>(
  q: string | undefined,
  fields: ReadonlyArray<keyof T & string>,
): Record<string, unknown> | null {
  const terme = q?.trim();
  if (!terme || fields.length === 0) return null;
  const motif = `${terme}%`;
  if (fields.length === 1) return { [fields[0]]: { $like: motif } };
  return { $or: fields.map((f) => ({ [f]: { $like: motif } })) };
}
