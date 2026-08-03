import type {
  FacetCount,
  FacetCounts,
  IFacetSpec,
  IFilterSpec,
} from "nodefony";
import type { IUserListQuery } from "../contracts/IUserRepository";

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
  /** `true` = verrouillés seulement (défense anti-force brute), absent = les deux. */
  locked: "boolean",
  /** `true` = liés à au moins un fournisseur externe (OAuth), absent = les deux. */
  hasSocial: "boolean",
} as const satisfies IFilterSpec;

/**
 * **Les facettes des utilisateurs** — les questions fermées posées à l'annuaire
 * ENTIER pour les cartes de tête.
 *
 * Les populations se **recoupent** délibérément : un compte peut être désactivé
 * ET verrouillé, un administrateur peut avoir un lien social. Aucune facette
 * n'est donc déduite d'une autre — « désactivés » et « verrouillés » sont deux
 * questions distinctes, et les confondre en un seul « inactifs » masquait
 * lequel des deux mécanismes bloque réellement un compte.
 *
 * `admins` n'y figure pas : le rôle d'administration est une valeur de
 * configuration (`ROLE_NODEFONY_ADMIN` par défaut, surchargeable), pas une
 * constante du vocabulaire. Le service la lit et compose la facette lui-même.
 */
export const USER_FACETS = {
  /** Tous les comptes de l'annuaire. */
  total: {},
  /** Comptes utilisables : activés et non verrouillés. */
  active: { enabled: true, locked: false },
  /** Comptes désactivés par décision d'administration. */
  disabled: { enabled: false },
  /** Comptes verrouillés par la défense anti-force brute. */
  locked: { locked: true },
  /** Comptes liés à au moins un fournisseur d'identité externe. */
  social: { hasSocial: true },
} as const satisfies IFacetSpec<IUserListQuery>;

/**
 * Les compteurs rendus par `GET /nodefony/user/api/users/stats` — les facettes
 * déclarées, plus `admins` que le service compose depuis le rôle configuré.
 */
export type IUserCounts = FacetCounts<typeof USER_FACETS> & {
  /** Comptes portant le rôle d'administration de la plateforme. */
  admins: FacetCount;
};

/**
 * Ce que l'endpoint de COMPTEURS accepte de filtrer — `USER_FILTERS` **moins**
 * les champs que les facettes décomposent (`enabled`, `locked`, `hasSocial`).
 *
 * Les demander ici rendrait une réponse contradictoire : le total suivrait le
 * filtre pendant que chaque facette l'écraserait par le sien. `role` reste :
 * il découpe une AUTRE dimension, et « combien de `ROLE_SUPPORT`, et dans quel
 * état ? » est une question cohérente.
 */
export const USER_STATS_FILTERS = {
  role: "string",
} as const satisfies IFilterSpec;
