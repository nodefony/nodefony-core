import type { FacetCounts, IFacetSpec, IFilterSpec } from "nodefony";
import type { ITokenListQuery } from "../../contracts/ITokenStore";

/**
 * **Le vocabulaire de filtre des jetons**, en noms PUBLICS — ceux qu'un client
 * écrit dans l'URL (`?status=revoked`), jamais des noms de colonne.
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
  /**
   * État de vie de la clé — la liste fermée vaut allowlist.
   *
   * Remplace l'ancien `revoked: "boolean"`, qui ne distinguait pas une clé
   * ACTIVE d'une clé ARRIVÉE À ÉCHÉANCE : les deux étaient « non révoquées »,
   * alors que la première ouvre l'accès et la seconde ne l'ouvre plus. La
   * console affichait ces deux populations dans des cartes séparées sans
   * pouvoir les demander au serveur.
   */
  status: ["active", "expired", "revoked"],
} as const satisfies IFilterSpec;

/**
 * **Les facettes des jetons** — les questions fermées posées à la collection
 * ENTIÈRE pour les cartes de tête.
 *
 * Contrairement aux webhooks, les trois états **partitionnent** : un jeton est
 * dans exactement une case. On les compte tout de même une par une, sans jamais
 * soustraire — une partition est une propriété du domaine d'aujourd'hui, pas une
 * garantie du code, et un quatrième état la briserait en silence.
 */
export const TOKEN_FACETS = {
  /** Toutes les clés, quel que soit leur état. */
  total: {},
  /** Utilisables : ni révoquées, ni arrivées à échéance. */
  active: { status: "active" },
  /** Arrivées à échéance sans avoir été révoquées. */
  expired: { status: "expired" },
  /** Révoquées par un administrateur. */
  revoked: { status: "revoked" },
} as const satisfies IFacetSpec<ITokenListQuery>;

/** Les compteurs rendus par `GET /nodefony/security/api/apikeys/stats`. */
export type ITokenCounts = FacetCounts<typeof TOKEN_FACETS>;

/**
 * Ce que l'endpoint de COMPTEURS accepte de filtrer — `TOKEN_FILTERS` **moins**
 * les champs que les facettes décomposent.
 *
 * `status` en est retiré : le demander à un endpoint dont les cartes SONT les
 * états produirait une réponse qui se contredit — un total suivant le filtre, et
 * chaque facette l'écrasant par le sien. Le refuser dit au client ce qui se
 * passe ; l'accepter lui montrerait « 5 clés, dont 538 révoquées ».
 *
 * Un test verrouille l'accord entre cette liste et {@link TOKEN_FACETS}.
 */
export const TOKEN_STATS_FILTERS = {
  subjectId: "string",
} as const satisfies IFilterSpec;
