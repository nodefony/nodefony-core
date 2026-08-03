import { PageQueryError } from "nodefony";
import type { IRepository } from "../interfaces/IRepository";
import type { IPage, PageQuery } from "../interfaces/IPage";
import { searchCriteria } from "./criteria";

/** Réglages d'un `paginate` — ce que ce point d'entrée sait faire en plus de découper. */
export interface IPaginateOptions<T> {
  /**
   * Champs sur lesquels `?q=` cherche. **Absent ou vide ⇒ tout `q` reçu est
   * REFUSÉ**, jamais ignoré.
   *
   * Le défaut est le refus pour la même raison que pour le tri et les filtres :
   * un `q` accepté puis jeté rend la collection ENTIÈRE à qui croit lire un
   * résultat de recherche — la façon la plus discrète de mentir, puisque la
   * réponse est un `200` bien formé. Et c'est exactement ce que ce helper
   * faisait : `q` traversait son type sans être lu une seule fois.
   *
   * Comme le tri, la recherche est une capacité — elle se constate et se
   * déclare, jamais elle ne se suppose.
   */
  searchable?: ReadonlyArray<keyof T & string>;
}

/**
 * Pagine un {@link IRepository} de façon **portable** — au-dessus des primitives
 * natives `find(criteria, { limit, offset, order })` et `count(criteria)` que tout
 * adapter implémente déjà (SQL `LIMIT/OFFSET`+`COUNT`, Mongo `skip/limit`+
 * `countDocuments`…). Aucun adapter n'a à changer : un seul aller vers la page,
 * jamais de matérialisation de toute la collection.
 *
 * `hasNext` est obtenu **sans `COUNT`** par l'astuce `limit + 1` : on demande une
 * ligne de plus que la page ; si elle arrive, il y a une suite (on la retire du
 * résultat). Le `COUNT(*)` — coûteux sur les grosses tables — n'est payé que si
 * `withTotal` n'est pas `false` (mode « Page » vs « Slice », cf Spring Data).
 *
 * La **recherche** `?q=` n'est honorée que si l'appelant déclare où chercher
 * ({@link IPaginateOptions.searchable}) ; sans cela elle est refusée en `400`.
 *
 * @typeParam T - type de l'entité paginée.
 * @param repo - le repository à paginer.
 * @param page - la requête de page ({@link PageQuery}).
 * @param options - capacités de ce point d'entrée (recherche).
 * @returns une {@link Page} : au plus `limit` items, `hasNext`, et `total` si demandé.
 * @throws {@link PageQueryError} (`400`) si un `q` est reçu sans champ
 *   cherchable déclaré, ou si le critère porte déjà un `$or`.
 */
export async function paginate<T>(
  repo: IRepository<T>,
  page: PageQuery<T>,
  options: IPaginateOptions<T> = {},
): Promise<IPage<T>> {
  // Bornes sûres : une page a au moins 1 item, l'offset n'est jamais négatif.
  // Un `limit`/`offset` invalide est un bug appelant — on le normalise plutôt que
  // de propager un `find({ limit: 0 })` au comportement dépendant du dialecte.
  const limit = Math.max(1, Math.floor(page.limit));
  const offset = Math.max(0, Math.floor(page.offset ?? 0));
  const withTotal = page.withTotal ?? true;

  // Le critère est composé UNE fois, puis servi au `find` ET au `count` : deux
  // compositions divergentes rendraient un `total` qui ne décrit pas la page.
  let criteria = page.criteria;
  const recherche = searchCriteria<T>(page.q, options.searchable ?? []);
  if (recherche) {
    // `$and` n'existe pas dans la grammaire (volontairement : c'est le
    // comportement par défaut), donc deux `$or` au même niveau ne peuvent PAS
    // exprimer « (a ou b) ET (s1 ou s2) » — le second écraserait le premier et
    // rendrait des lignes que personne n'a demandées. Refuser est la seule
    // issue honnête ; ce point d'entrée doit alors chercher sur un champ unique,
    // ou composer son critère lui-même.
    if (criteria && "$or" in (criteria as Record<string, unknown>)) {
      throw new PageQueryError(
        `Cannot combine full-text search with a criteria that already uses "$or" ` +
          `(the grammar has no "$and" to nest them). Search on a single field, ` +
          `or build the criteria in the caller.`,
      );
    }
    // `...criteria` sans repli : étaler `undefined` n'ajoute rien (la garde de
    // l'`$or` ci-dessus a déjà tranché le cas où il porte quelque chose).
    criteria = { ...criteria, ...recherche } as PageQuery<T>["criteria"];
  } else if (page.q?.trim()) {
    // Déclarer la capacité est le seul moyen de la rendre vraie : sans champ
    // cherchable, ce helper ne PEUT pas honorer `q`, et rendre la collection
    // entière serait présenté au client comme le résultat de sa recherche.
    throw new PageQueryError(
      `This endpoint does not support full-text search ("q"): no searchable ` +
        `field is declared. Pass { searchable: [...] } to paginate(), or drop "q".`,
    );
  }

  // limit + 1 → connaît « y a-t-il une suite ? » sans compter la collection.
  const rows = await repo.find(criteria, {
    limit: limit + 1,
    offset,
    order: page.order,
  });
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;

  const total = withTotal ? await repo.count(criteria) : undefined;

  return { items, limit, offset, hasNext, total };
}
