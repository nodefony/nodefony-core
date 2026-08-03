import { pickOrder, renameOrderFields } from "nodefony";
import type { IPageQuery } from "nodefony";

/**
 * **La** table d'alias du dialecte Mongo — `id` public → `_id` au repos.
 *
 * Elle vit ici, chez l'adapter qui possède la convention, et non dans le
 * vocabulaire de chaque ressource : ce n'est pas une propriété des jetons ni des
 * endpoints, c'est une propriété de **Mongo**, où la clé primaire s'appelle
 * `_id` et où aucun champ `id` n'existe au repos (`id` n'est qu'un virtuel de
 * lecture). Trois copies de cette même règle vivaient auparavant dans trois
 * fichiers de vocabulaire, une par ressource.
 *
 * Ce que la traduction évite : Mongo ne se plaint **pas** d'un tri sur un champ
 * absent — il rend les documents dans un ordre arbitraire. Sans elle, un
 * `?order=id` serait donc silencieusement inerte sur Mongo et correct partout
 * ailleurs, et l'écart ne se verrait qu'en production, chez un tiers.
 */
export const MONGO_ORDER_ALIASES: Readonly<Record<string, string>> = {
  id: "_id",
};

/**
 * Borne un `order` reçu à ce que le store DÉCLARE savoir trier, puis l'exprime
 * dans le schéma Mongo — les deux gestes que tout store Mongo doit faire, dans
 * cet ordre, avant de descendre le tri au driver.
 *
 * L'ordre compte : filtrer d'abord (sur le vocabulaire **public**, celui que le
 * store annonce), traduire ensuite. L'inverse comparerait des noms de colonnes à
 * une liste de noms publics, et laisserait passer ce qu'elle est censée refuser.
 *
 * @param order - l'ordre demandé, en vocabulaire public.
 * @param sortable - ce que le store déclare ({@link ISortableSource}).
 * @param fallback - l'ordre contractuel appliqué à défaut, en vocabulaire public.
 * @returns l'ordre prêt pour `.sort()` / `paginate()`, en noms de champs Mongo.
 */
export function mongoOrder(
  order: IPageQuery["order"],
  sortable: readonly string[] | undefined,
  fallback: NonNullable<IPageQuery["order"]>,
): NonNullable<IPageQuery["order"]> {
  return renameOrderFields(
    pickOrder(order, sortable ?? [], fallback),
    MONGO_ORDER_ALIASES,
  );
}

/**
 * Forme `{ champ: 1 | -1 }` attendue par `Model.sort()` — le dernier maillon,
 * pour les stores qui parlent au driver Mongo directement plutôt que par
 * `paginate()`.
 *
 * @param order - un ordre déjà borné et traduit (sortie de {@link mongoOrder}).
 */
export function toMongoSort(
  order: NonNullable<IPageQuery["order"]>,
): Record<string, 1 | -1> {
  const sort: Record<string, 1 | -1> = {};
  for (const [field, dir] of order) sort[field] = dir === "DESC" ? -1 : 1;
  return sort;
}
