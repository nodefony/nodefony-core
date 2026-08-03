import { renameOrderFields } from "nodefony";
import type { IPageQuery } from "nodefony";

/**
 * **Le vocabulaire de tri des sessions**, en noms PUBLICS — ceux qu'un client
 * écrit dans l'URL (`?order=updatedAt:DESC`), jamais des noms de colonne.
 *
 * Il vit ici, chez le propriétaire du contrat (`@nodefony/http`), et non dans
 * chaque backend : c'est ce qui garantit qu'une console offre le même tri que
 * l'application tourne sur mémoire, SQLite, PostgreSQL ou Mongo. Un store qui
 * nomme ses colonnes autrement (SQL stocke l'identifiant en `session_id`)
 * **traduit chez lui** — cf {@link SESSION_COLUMN_ALIASES}.
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
 * Table d'alias des backends dont le schéma nomme l'identifiant de session
 * `session_id` (SQL comme Mongo) — à passer à `renameOrderFields` (core).
 *
 * C'est une **donnée** du schéma, pas du code : la règle « réécrire les noms »
 * vit au core en un exemplaire, et chaque backend n'apporte que sa table. Sans
 * cette traduction, `?order=id:ASC` partirait vers une colonne `id` inexistante
 * — l'erreur ne se verrait qu'à l'exécution, sur le backend concerné seulement.
 */
export const SESSION_COLUMN_ALIASES: Readonly<Record<string, string>> = {
  id: "session_id",
};

/**
 * Ordre par défaut des backends dont le schéma nomme l'identifiant
 * `session_id` — {@link SESSION_DEFAULT_ORDER} déjà traduit.
 */
export const SESSION_DEFAULT_ORDER_SQL: NonNullable<IPageQuery["order"]> =
  renameOrderFields(SESSION_DEFAULT_ORDER, SESSION_COLUMN_ALIASES);
