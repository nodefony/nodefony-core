import type {
  FacetCount,
  FacetCounts,
  IFacetSpec,
  IFilterSpec,
} from "nodefony";
import type { ISessionListQuery } from "../../../interfaces/ISession";

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

/**
 * **Les facettes des sessions** — les questions fermées que la console pose à la
 * collection ENTIÈRE, pour ses cartes de tête.
 *
 * Distinct de `SESSION_FILTERS`, qui dit ce qu'un client a le droit d'écrire
 * dans l'URL : une facette n'est pas saisie, elle est posée par le serveur. Les
 * deux se recoupent par construction — une facette n'existe que si le contrat de
 * liste sait déjà la filtrer, sinon elle serait un compteur approximatif de plus.
 *
 * `authenticated` suffit à couvrir les deux populations : le contrat le définit
 * comme « `user` non vide », donc `false` rend exactement les sessions anonymes.
 * Aucune facette n'est déduite d'une soustraction (cf `countFacets`).
 *
 * Le décompte d'utilisateurs **distincts** n'est PAS ici : ce n'est pas un
 * `COUNT` filtré mais une agrégation, qu'un store en curseur ne peut pas rendre.
 * Il vit en capacité déclarée du backend (`ISessionStorage.countDistinctUsers`).
 */
export const SESSION_FACETS = {
  /** Toutes les sessions persistées, sans filtre. */
  total: {},
  /** Sessions rattachées à un utilisateur authentifié. */
  authenticated: { authenticated: true },
  /** Sessions anonymes (aucun utilisateur rattaché). */
  anonymous: { authenticated: false },
} as const satisfies IFacetSpec<ISessionListQuery>;

/**
 * Les compteurs rendus par `GET /nodefony/http/api/sessions/stats`.
 *
 * **Dérivé** de {@link SESSION_FACETS} : ajouter une facette ajoute son champ
 * ici, et le front qui ne l'affiche pas ne compile plus. Écrire ce type à la
 * main aurait rendu possible une carte affichant un compteur que le serveur ne
 * calcule pas — ou l'inverse.
 *
 * `users` s'y ajoute à part parce qu'il ne vient pas d'un `COUNT` filtré mais
 * d'une agrégation, que tous les backends ne savent pas rendre.
 */
export type ISessionCounts = FacetCounts<typeof SESSION_FACETS> & {
  /** Utilisateurs **distincts** ayant au moins une session (`null` si inconnu). */
  users: FacetCount;
};
