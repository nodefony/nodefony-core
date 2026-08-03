import type { IPageQuery } from "nodefony";

/**
 * **Le vocabulaire de tri des jetons**, en noms PUBLICS — ceux qu'un client écrit
 * dans l'URL (`?order=createdAt:DESC`), jamais des noms de colonne.
 *
 * Il vit ici, chez le propriétaire du contrat (`@nodefony/security`), et non dans
 * chaque backend : c'est ce qui garantit qu'une console de clés d'API offre le
 * même tri, que l'application tourne sur mémoire, SQL ou Mongo. Un store dont le
 * schéma nomme un champ autrement traduit **chez lui** — cf
 * {@link translateTokenOrderMongo}.
 *
 * - `createdAt` — date d'émission, l'axe naturel d'une console de clés ;
 * - `name` — le libellé humain, ce qu'on lit dans la colonne de gauche ;
 * - `subjectId` — regroupe les clés d'un même porteur (vue d'administration) ;
 * - `id` — identifiant public, utile surtout en départage.
 *
 * **Ce qui n'y est PAS, et pourquoi** : `lastUsedAt`, `expiresAt` et `revokedAt`
 * sont *nullables*, et le placement des valeurs absentes n'est pas le même d'un
 * moteur à l'autre — PostgreSQL range les `NULL` en tête d'un tri `DESC`, SQLite
 * et MySQL en queue, et le tri en mémoire (`compareByOrder`) les met en queue
 * dans les deux sens. Les déclarer offrirait donc un tri dont l'ordre
 * dépendrait de la base configurée, ce qui est exactement ce que ce vocabulaire
 * existe pour empêcher. Ils s'ouvriront quand la normalisation « absents en
 * queue » sera portée dans le helper de pagination, pas avant.
 */
export const TOKEN_SORTABLE_FIELDS = [
  "createdAt",
  "name",
  "subjectId",
  "id",
] as const;

/**
 * Ordre contractuel appliqué quand le client n'en demande aucun : les clés les
 * plus récentes d'abord, départagées par identifiant pour rester **déterministe**
 * à horodatage égal (sans quoi une pagination offset peut sauter ou répéter une
 * ligne entre deux pages).
 */
export const TOKEN_DEFAULT_ORDER: NonNullable<IPageQuery["order"]> = [
  ["createdAt", "DESC"],
  ["id", "DESC"],
];

/**
 * Traduit un `order` public vers le schéma d'un backend **Mongo**, où le jeton
 * est stocké avec le `jti` en clé primaire (`_id`) et où aucun champ `id` n'existe
 * au repos — `id` n'est qu'un virtuel de lecture.
 *
 * Sans cette traduction, `?order=id` partirait vers un champ absent : Mongo ne
 * lève rien, il rend simplement les documents dans un ordre arbitraire. Le tri
 * serait donc silencieusement inerte sur Mongo et correct partout ailleurs —
 * l'écart ne se verrait qu'en production, sur l'installation d'un tiers.
 *
 * @param order - l'ordre demandé, en vocabulaire public.
 * @returns le même ordre, exprimé dans le schéma du store Mongo.
 */
export function translateTokenOrderMongo(
  order: NonNullable<IPageQuery["order"]>,
): NonNullable<IPageQuery["order"]> {
  return order.map(([field, dir]) => [field === "id" ? "_id" : field, dir]);
}

/**
 * {@link TOKEN_DEFAULT_ORDER} déjà traduit pour un backend Mongo.
 */
export const TOKEN_DEFAULT_ORDER_MONGO: NonNullable<IPageQuery["order"]> =
  translateTokenOrderMongo(TOKEN_DEFAULT_ORDER);
