import type { IRepository } from "../interfaces/IRepository";
import type { IPage, PageQuery } from "../interfaces/IPage";

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
 * @typeParam T - type de l'entité paginée.
 * @param repo - le repository à paginer.
 * @param page - la requête de page ({@link PageQuery}).
 * @returns une {@link Page} : au plus `limit` items, `hasNext`, et `total` si demandé.
 */
export async function paginate<T>(
  repo: IRepository<T>,
  page: PageQuery<T>,
): Promise<IPage<T>> {
  // Bornes sûres : une page a au moins 1 item, l'offset n'est jamais négatif.
  // Un `limit`/`offset` invalide est un bug appelant — on le normalise plutôt que
  // de propager un `find({ limit: 0 })` au comportement dépendant du dialecte.
  const limit = Math.max(1, Math.floor(page.limit));
  const offset = Math.max(0, Math.floor(page.offset ?? 0));
  const withTotal = page.withTotal ?? true;

  // limit + 1 → connaît « y a-t-il une suite ? » sans compter la collection.
  const rows = await repo.find(page.criteria, {
    limit: limit + 1,
    offset,
    order: page.order,
  });
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;

  const total = withTotal ? await repo.count(page.criteria) : undefined;

  return { items, limit, offset, hasNext, total };
}
