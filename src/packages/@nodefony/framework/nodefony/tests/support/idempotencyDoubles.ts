import type {
  IIdempotencyKeyEntry,
  IIdempotencyListQuery,
  IPage,
} from "nodefony";

/**
 * Listing vide conforme au contrat — pour les doubles de test qui n'exercent
 * QUE la dédup (`begin`/`complete`/`abort`). Évite de recopier la même page
 * vide dans chaque double : une seule forme à corriger si `IPage` bouge.
 *
 * @param query - la requête de page (seuls `limit`/`offset` sont reflétés).
 * @returns une page vide cohérente (`hasNext:false`, `total:0`).
 */
export function emptyIdempotencyPage(
  query: IIdempotencyListQuery,
): Promise<IPage<IIdempotencyKeyEntry>> {
  return Promise.resolve({
    items: [],
    total: 0,
    limit: query.limit,
    offset: query.offset ?? 0,
    hasNext: false,
  });
}
