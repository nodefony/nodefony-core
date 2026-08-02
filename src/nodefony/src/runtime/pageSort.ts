import type { IPageQuery } from "../types/IPage";

/**
 * Lit la valeur d'un champ triable sur un élément. Chaque store fournit la
 * sienne : le nom du champ est **public** (celui de l'URL), la façon de
 * l'atteindre est interne.
 *
 * @typeParam T - type des éléments triés.
 */
export type FieldReader<T> = (item: T, field: string) => unknown;

/** Une valeur absente ne se compare pas — elle se range à part. */
const missing = (v: unknown): boolean => v === null || v === undefined;

/**
 * Compare deux valeurs de tri **présentes**, tous types confondus. Le cas des
 * absentes est traité par {@link compareByOrder}, en dehors de l'inversion de
 * sens : les y laisser reviendrait à les faire remonter en tête d'un tri `DESC`,
 * ce qui n'a jamais renseigné personne.
 */
function compareValues(a: unknown, b: unknown): number {
  if (a instanceof Date || b instanceof Date) {
    return Number(a) - Number(b);
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  return String(a).localeCompare(String(b));
}

/**
 * Fabrique le comparateur d'un `order` du contrat de page — **le** tri en
 * mémoire de Nodefony, partagé par tous les stores qui n'ont pas de moteur pour
 * le faire à leur place.
 *
 * Il existe parce que chaque store mémoire réécrivait le sien, en dur et inline :
 * le tri d'un backend mémoire différait alors de celui du backend SQL de la même
 * ressource, si bien qu'un test vert en mémoire ne disait rien de la production.
 * Les backends SQL et Mongo, eux, n'en ont pas besoin — ils poussent l'`order`
 * dans la requête, où il est infiniment moins cher.
 *
 * Les couples sont appliqués **dans l'ordre** : le premier qui départage
 * l'emporte, les suivants ne servent qu'aux ex æquo. Un `order` vide rend un
 * comparateur neutre (`0` partout), ce qui laisse `Array.prototype.sort` stable
 * et préserve donc l'ordre d'origine.
 *
 * @param order - les couples `[champ, sens]` du contrat.
 * @param read - comment lire un champ sur un élément.
 * @returns un comparateur utilisable tel quel dans `.sort()`.
 *
 * @example
 * ```ts
 * const order = query.order?.length ? query.order : DEFAULT_ORDER;
 * rows.sort(compareByOrder(order, (r, field) => r[field as keyof Row]));
 * ```
 */
export function compareByOrder<T>(
  order: NonNullable<IPageQuery["order"]>,
  read: FieldReader<T>,
): (a: T, b: T) => number {
  return (a, b) => {
    for (const [field, dir] of order) {
      const va = read(a, field);
      const vb = read(b, field);
      // Les absentes se rangent en QUEUE dans les deux sens — hors inversion,
      // sinon `DESC` les remonterait en tête.
      if (missing(va) || missing(vb)) {
        if (missing(va) && missing(vb)) continue;
        return missing(va) ? 1 : -1;
      }
      const cmp = compareValues(va, vb);
      if (cmp !== 0) return dir === "DESC" ? -cmp : cmp;
    }
    return 0;
  };
}
