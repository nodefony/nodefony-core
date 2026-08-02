import type { IPageQuery } from "nodefony";

/**
 * **Le vocabulaire de tri des sessions**, en noms PUBLICS — ceux qu'un client
 * écrit dans l'URL (`?order=updatedAt:DESC`), jamais des noms de colonne.
 *
 * Il vit ici, chez le propriétaire du contrat (`@nodefony/http`), et non dans
 * chaque backend : c'est ce qui garantit qu'une console offre le même tri que
 * l'application tourne sur mémoire, SQLite, PostgreSQL ou Mongo. Un store qui
 * nomme ses colonnes autrement (SQL stocke l'identifiant en `session_id`)
 * **traduit chez lui** — cf `translateSessionOrder`.
 *
 * - `updatedAt` — dernière activité (l'axe naturel d'une console de sessions).
 * - `id` — identifiant de session, utile surtout en départage.
 */
export const SESSION_SORTABLE_FIELDS = ["updatedAt", "id"] as const;

/**
 * Ordre contractuel appliqué quand le client n'en demande aucun : activité la
 * plus récente d'abord, départagée par identifiant pour rester **déterministe**
 * à horodatage égal (sans quoi une pagination peut sauter ou répéter une ligne
 * entre deux pages).
 */
export const SESSION_DEFAULT_ORDER: NonNullable<IPageQuery["order"]> = [
  ["updatedAt", "DESC"],
  ["id", "ASC"],
];

/**
 * Traduit un `order` public vers les noms de colonnes d'un backend SQL/Mongo,
 * où l'identifiant de session est stocké en `session_id`.
 *
 * À appeler par tout store dont le schéma nomme un champ autrement que le
 * vocabulaire public. Sans cette traduction, `?order=id:ASC` partirait vers une
 * colonne `id` inexistante — l'erreur ne se verrait qu'à l'exécution, sur le
 * backend concerné seulement.
 *
 * @param order - l'ordre demandé, en vocabulaire public.
 * @returns le même ordre, exprimé dans le schéma du store.
 */
export function translateSessionOrder(
  order: NonNullable<IPageQuery["order"]>,
): NonNullable<IPageQuery["order"]> {
  return order.map(([field, dir]) => [
    field === "id" ? "session_id" : field,
    dir,
  ]);
}

/**
 * Ordre par défaut des backends dont le schéma nomme l'identifiant
 * `session_id` — {@link SESSION_DEFAULT_ORDER} déjà traduit.
 */
export const SESSION_DEFAULT_ORDER_SQL: NonNullable<IPageQuery["order"]> =
  translateSessionOrder(SESSION_DEFAULT_ORDER);
