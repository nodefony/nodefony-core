import type { IFilterSpec } from "nodefony";

/**
 * **Le vocabulaire de filtre des utilisateurs**, en noms PUBLICS — ceux qu'un
 * administrateur écrit dans l'URL (`?role=ROLE_ADMIN&enabled=false`).
 *
 * Frère de `USER_SORTABLE_FIELDS` (`userSort.ts`), et posé au même endroit pour
 * la même raison : le vocabulaire appartient au module propriétaire du contrat,
 * la mécanique de lecture au cœur (`parseFilters`).
 *
 * `role` reste une chaîne LIBRE : la hiérarchie de rôles est celle de
 * l'application (`ROLE_*` de tenant) autant que de la plateforme
 * (`ROLE_NODEFONY_*`), et aucune allowlist du framework ne peut la connaître.
 * `enabled` est un booléen strict — `?enabled=1` est désormais refusé plutôt que
 * lu comme `false`, ce que faisait la comparaison `enabled === "true"`.
 */
export const USER_FILTERS = {
  /** Rôle plat devant figurer dans `roles` (containment natif). */
  role: "string",
  /** `true` = actifs seulement, `false` = inactifs seulement, absent = les deux. */
  enabled: "boolean",
} as const satisfies IFilterSpec;
