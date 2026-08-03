import type { IFilterSpec } from "nodefony";

/**
 * **Le vocabulaire de filtre des jetons**, en noms PUBLICS — ceux qu'un client
 * écrit dans l'URL (`?revoked=true`), jamais des noms de colonne.
 *
 * Frère de `TOKEN_SORTABLE_FIELDS`, et posé pour la même raison : le vocabulaire
 * appartient au propriétaire du contrat (`@nodefony/security`), la mécanique de
 * lecture au cœur (`parseFilters`).
 *
 * **La différence avec le tri est structurelle.** Un tri est une CAPACITÉ de
 * backend — Redis ne sait pas trier, donc `sortableFields` se déclare par store.
 * Un filtre listé ici est une OBLIGATION de tous les backends de jetons : il est
 * inscrit dans {@link ITokenListQuery}, et le store mémoire, SQL, Mongo comme
 * Redis l'honorent chacun à sa façon (`WHERE` indexé, prédicat, filtre inline de
 * batch `SCAN`). Le déclarer par store laisserait croire qu'il est facultatif.
 *
 * **Ce qui n'y est PAS, et pourquoi** : `kind`. Il existe bien au contrat, mais
 * l'endpoint d'administration des clés d'API passe par `listPagePat`, qui impose
 * `kind: "pat"` (`service/apiKeys.ts:210`). L'exposer donnerait un filtre que le
 * service écrase en silence — la faute même que ce chantier corrige.
 */
export const TOKEN_FILTERS = {
  /** Restreint à un porteur (colonne indexée dans tous les backends SQL). */
  subjectId: "string",
  /** `true` = révoquées seulement, `false` = actives, absent = les deux. */
  revoked: "boolean",
} as const satisfies IFilterSpec;
