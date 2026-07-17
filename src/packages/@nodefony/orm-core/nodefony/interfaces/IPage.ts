import type { Criteria, RepositoryReadOptions } from "./IRepository";

/**
 * Requête d'une **page** de résultats, portable cross-ORM — l'équivalent du
 * `Pageable` de Spring Data.
 *
 * Le principe fondateur : on ne matérialise **jamais** toute une collection pour
 * n'en montrer qu'une page. `limit` est donc **obligatoire** — il n'existe pas de
 * « lister tout ». La pagination est appliquée **nativement** par le backend
 * (`LIMIT/OFFSET` SQL, `skip/limit` Mongo…), pas par un `slice` en mémoire après
 * un chargement complet.
 *
 * Contrat **offset-first** : `offset` couvre la navigation par page directe, que
 * savent faire tous les backends ORM (SQL, Mongo, mémoire, fichier). Le curseur
 * n'est pas ici : il vit côté sortie ({@link Page.nextCursor}), déclaré uniquement
 * par les backends qui ne savent pas offrir d'offset fiable (Redis).
 *
 * @typeParam T - type de l'entité paginée (type le `criteria`).
 */
export interface PageQuery<T = unknown> {
  /** Taille de la page — obligatoire (jamais « tout »). */
  limit: number;

  /** Décalage depuis le début de la collection filtrée (défaut `0`). */
  offset?: number;

  /**
   * Tri : couples `[champ, sens]` — **même forme** que
   * {@link RepositoryReadOptions.order} (le format tableau, pas un objet
   * `{ champ: "asc" }` — une clé d'objet inconnue serait silencieusement ignorée).
   */
  order?: RepositoryReadOptions["order"];

  /** Filtre typé optionnel appliqué avant la pagination (toutes les lignes si omis). */
  criteria?: Criteria<T>;

  /**
   * Renvoyer le total exact ({@link Page.total}) ou non. `true` par défaut.
   *
   * @remarks `false` = mode « Slice » (cf Spring Data) : on saute le `COUNT(*)`
   *   coûteux et on se contente de {@link Page.hasNext} (dérivé sans compter). Pour
   *   un flux « charger plus » où le total est inutile.
   */
  withTotal?: boolean;

  /**
   * **RÉSERVÉ multi-tenant** — slot du contrat pour le scoping par tenant, à
   * appliquer **au niveau du store** (`WHERE tenant_id = ?`) le jour du chantier
   * `@nodefony/tenant`.
   *
   * @remarks ⚠️ **Non appliqué aujourd'hui** : le passer n'a **aucun** effet de
   *   filtrage tant que le scoping tenant n'est pas livré. Présent dès maintenant
   *   pour ne pas re-changer la signature d'un contrat public multi-module plus tard.
   */
  tenantId?: string | null;
}

/**
 * Une **page** de résultats — aligné sur `Page`/`Slice` de Spring Data.
 *
 * `total` présent = mode **Page** (on a compté) ; `total` absent = mode **Slice**
 * (on ne connaît que {@link Page.hasNext}). `hasNext` est fiable dans les deux cas.
 *
 * @typeParam T - type des entités de la page.
 */
export interface Page<T> {
  /** Les entités de la page (au plus `limit`). */
  items: T[];

  /**
   * Total exact de la collection filtrée — présent **seulement** si
   * {@link PageQuery.withTotal} n'est pas `false` **et** que le backend sait
   * compter à coût raisonnable (SQL/Mongo/fichier/mémoire).
   */
  total?: number;

  /** Taille de page demandée (écho de {@link PageQuery.limit}). */
  limit: number;

  /** Décalage de cette page (écho de {@link PageQuery.offset}, défaut `0`). */
  offset: number;

  /** `true` s'il existe au moins une entité au-delà de cette page. */
  hasNext: boolean;

  /**
   * Jeton de page suivante — présent **uniquement** pour les backends qui paginent
   * par **curseur** au lieu d'offset (Redis `SCAN`). Absent = pagination par offset.
   *
   * @remarks Capacité **déclarée par l'adapter** : un store offset ne le pose
   *   jamais. Cohérent avec « couverture adaptée à la nature du store », pas parité.
   */
  nextCursor?: string | null;
}
