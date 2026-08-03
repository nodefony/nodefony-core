import type { IFilterSpec } from "nodefony";

/**
 * **Le vocabulaire de filtre des sessions**, en noms PUBLICS — celui que la
 * console d'administration écrit dans l'URL (`?user=alice`).
 *
 * Frère de `SESSION_SORTABLE_FIELDS` (`sessionSort.ts`), posé au même endroit
 * pour la même raison : le vocabulaire appartient au module propriétaire du
 * contrat, la mécanique de lecture au cœur (`parseFilters`).
 *
 * `user` est un filtre **portable par construction** (égalité stricte) : il
 * s'exprime dans tous les backends — `WHERE` indexé en SQL et Mongo, prédicat en
 * mémoire, filtre de batch en Redis — donc aucun store n'a besoin de matérialiser
 * la collection pour l'honorer. C'est la propriété qui justifie qu'il soit au
 * contrat plutôt que dans une couche de filtrage applicative.
 *
 * `tenantId` n'y figure pas parce qu'il appartient au **contrat de page**
 * (`PAGE_QUERY_KEYS`, réserve multi-tenant) : le déclarer ici en ferait un
 * second lecteur du même paramètre.
 */
export const SESSION_FILTERS = {
  /** Sessions d'un utilisateur donné (égalité stricte sur l'identifiant). */
  user: "string",
} as const satisfies IFilterSpec;
