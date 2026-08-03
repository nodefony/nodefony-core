import type { IPageQuery } from "nodefony";

/**
 * **Le vocabulaire de tri des endpoints webhook**, en noms PUBLICS — ceux qu'un
 * client écrit dans l'URL (`?order=failureCount:DESC`), jamais des noms de
 * colonne.
 *
 * Il vit ici, chez le propriétaire du contrat (`@nodefony/security`), et non dans
 * chaque backend : c'est ce qui garantit qu'une console offre le même tri, que
 * l'application tourne sur mémoire, SQL ou Mongo. Un store dont le schéma nomme
 * un champ autrement traduit **chez lui** — cf {@link translateWebhookOrderMongo}.
 *
 * - `createdAt` / `updatedAt` — quand l'abonnement a été posé, quand il a bougé ;
 * - `url` — la destination, colonne principale de la console ;
 * - `enabled` — regroupe les abonnements coupés ;
 * - `failureCount` — « qui échoue le plus », l'axe d'exploitation d'un webhook ;
 * - `id` — utile surtout en départage.
 *
 * **Ce qui n'y est PAS, et pourquoi** : `lastDeliveryAt`, `lastDeliveryStatus` et
 * `lastDeliveryError` sont *nullables* — un endpoint qui n'a jamais livré n'a pas
 * de dernière livraison — et le placement des valeurs absentes n'est pas le même
 * d'un moteur à l'autre (PostgreSQL les met en tête d'un tri `DESC`, SQLite,
 * MySQL et le tri en mémoire en queue). Les déclarer offrirait un tri dont
 * l'ordre dépendrait de la base configurée.
 *
 * ⚠️ Cette liste est aussi une **garde de sécurité**, pas seulement une capacité :
 * un nom de champ ne se lie pas en paramètre SQL, il se **concatène** dans le
 * `ORDER BY`. Tout backend qui construit sa requête à la main filtre donc avec
 * elle, en défense en profondeur — sans compter sur le fait que le data plane
 * ait déjà refusé.
 */
export const WEBHOOK_SORTABLE_FIELDS = [
  "createdAt",
  "updatedAt",
  "url",
  "enabled",
  "failureCount",
  "id",
] as const;

/**
 * Ordre contractuel appliqué quand le client n'en demande aucun : les
 * abonnements les plus récents d'abord, départagés par identifiant pour rester
 * **déterministe** à horodatage égal — sans ce tiebreaker, deux endpoints créés
 * dans la même milliseconde peuvent changer de page entre deux appels, et l'un
 * des deux ne jamais apparaître.
 */
export const WEBHOOK_DEFAULT_ORDER: NonNullable<IPageQuery["order"]> = [
  ["createdAt", "DESC"],
  ["id", "ASC"],
];
