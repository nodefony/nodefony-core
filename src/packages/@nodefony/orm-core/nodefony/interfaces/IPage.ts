import type { Criteria } from "./IRepository";
import type { IPageQuery } from "nodefony";

// Le contrat de page vit dans le CORE (`nodefony`) — partagé par TOUS les stores
// (ORM, sessions http, tokens/webhooks security…). orm-core le ré-expose et
// l'enrichit du `criteria` typé propre à IRepository.
export type { IPage, IPageQuery } from "nodefony";

/**
 * Requête de page pour un {@link IRepository} — le contrat de page core
 * ({@link IPageQuery}) enrichi du `criteria` typé de l'ORM. C'est la forme que
 * {@link paginate} consomme. Offset-first : `cursor`/`q` du socle restent
 * disponibles mais ne sont pas utilisés par le helper offset générique (les
 * stores à curseur ont leur propre implémentation).
 *
 * @typeParam T - type de l'entité paginée (type le `criteria`).
 */
export interface PageQuery<T = unknown> extends IPageQuery {
  /** Filtre typé optionnel appliqué avant la pagination (toutes les lignes si omis). */
  criteria?: Criteria<T>;
}
