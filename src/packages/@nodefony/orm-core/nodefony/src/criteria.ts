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
 * Le caractère d'échappement des motifs `$like` du contrat portable.
 *
 * Il ne se choisit pas librement : **PostgreSQL et MySQL appliquent déjà `\`**
 * quand aucune clause `ESCAPE` n'est écrite, si bien qu'un motif portant un
 * antislash se comportait DÉJÀ différemment selon le moteur (SQLite, lui, n'a
 * aucun échappement par défaut : il cherchait l'antislash littéral). Fixer `\`
 * et l'émettre explicitement ne change donc pas la sémantique du contrat — cela
 * la fait exister, en alignant les trois moteurs sur celui des deux
 * comportements qui était déjà majoritaire.
 *
 * @see {@link escapeLikeTerm} pour construire un motif, {@link likePatternToRegExp}
 *   pour l'interpréter là où il n'y a pas de SQL (Mongo, mémoire).
 */
export const LIKE_ESCAPE_CHAR = "\\";

/**
 * Neutralise les métacaractères d'un **texte** pour l'insérer dans un motif
 * `$like` — `%`, `_` et l'antislash lui-même.
 *
 * À utiliser dès qu'un fragment de motif vient d'un humain ou d'une donnée :
 * sans elle, chercher `50%` demande « 50 suivi de n'importe quoi », et chercher
 * `a_b` ramène `axb`. L'utilisateur ne lit pas ça comme une imprécision, il le
 * lit comme un résultat.
 *
 * L'échappement n'a de valeur que si la clause `ESCAPE` correspondante est
 * ÉMISE : un motif échappé sans elle est cherché littéralement, antislash
 * compris, et ne rend plus rien — en silence. C'est pourquoi les deux vont
 * ensemble et vivent ici, et non chez chaque appelant.
 *
 * @param text - le fragment littéral à insérer dans un motif.
 * @returns le même texte, ses métacaractères neutralisés.
 *
 * @example
 * ```ts
 * { discount: { $like: `${escapeLikeTerm("50%")}%` } }  // → "50\%%"
 * ```
 */
export function escapeLikeTerm(text: string): string {
  return text.replace(/[\\%_]/g, (c) => LIKE_ESCAPE_CHAR + c);
}

/**
 * Traduit un motif `$like` en expression régulière **ancrée** — pour les stores
 * qui n'ont pas de `LIKE` (MongoDB, implémentations en mémoire).
 *
 * C'est la contrepartie exacte de ce qu'un moteur SQL fait avec
 * `LIKE … ESCAPE '\'` : `%` vaut « n'importe quelle suite », `_` « un
 * caractère », et un caractère précédé de {@link LIKE_ESCAPE_CHAR} vaut
 * lui-même. Sans cette lecture, un adapter documentaire rendrait des résultats
 * différents d'un adapter SQL pour le même critère portable — la divergence la
 * plus coûteuse qui soit, puisqu'elle ne se voit qu'en changeant de backend.
 *
 * Un antislash final sans caractère à échapper est traité comme un antislash
 * littéral, comme le font les moteurs SQL.
 *
 * @param pattern - le motif du contrat (`préfixe%`, `a\_b`…).
 * @returns une `RegExp` ancrée aux deux bouts.
 */
export function likePatternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === LIKE_ESCAPE_CHAR && i + 1 < pattern.length) {
      source += escapeRegExpChar(pattern[++i]);
    } else if (c === "%") {
      source += ".*";
    } else if (c === "_") {
      source += ".";
    } else {
      source += escapeRegExpChar(c);
    }
  }
  return new RegExp(`^${source}$`);
}

/** Neutralise UN caractère pour l'insérer dans une expression régulière. */
function escapeRegExpChar(c: string): string {
  return /[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
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
 * Le terme est **échappé** ({@link escapeLikeTerm}) : chercher `50%` cherche
 * « 50% », et `a_b` ne ramène pas `axb`. Ça n'a été possible qu'une fois la
 * clause `ESCAPE` émise par la traduction de `$like` — auparavant un terme
 * échappé était cherché littéralement, antislash compris, et ne rendait plus
 * rien du tout, en silence. Les deux gestes sont indissociables : c'est pourquoi
 * ils vivent dans le même fichier.
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
  const motif = `${escapeLikeTerm(terme)}%`;
  if (fields.length === 1) return { [fields[0]]: { $like: motif } };
  return { $or: fields.map((f) => ({ [f]: { $like: motif } })) };
}
