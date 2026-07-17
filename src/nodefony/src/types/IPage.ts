/**
 * **LE contrat de pagination unique de Nodefony.** Tous les stores, toutes les API
 * (présents et futurs) paginent avec ce type — c'est un standard de développement,
 * jamais une pagination maison au cas par cas. Studio le consomme en pagination
 * **serveur** partout.
 *
 * Deux modes, **un seul vocabulaire** :
 * - **offset** (`offset`) — navigation par page directe, pour les backends qui la
 *   font nativement (SQL `LIMIT/OFFSET`, Mongo `skip/limit`, fichier, mémoire).
 * - **curseur** (`cursor`) — navigation « après ce jeton », pour les backends sans
 *   offset fiable (Redis `SCAN`) ou les flux ordonnés (journal d'audit). Un seul des
 *   deux est utilisé selon ce que le store sait faire ; le store le déclare.
 *
 * Les **filtres spécifiques** à un store (rôle, catégorie d'audit, critère ORM…) ne
 * vivent pas ici : chaque store **étend** ce type (`interface XQuery extends
 * IPageQuery { … }`), pour que le socle reste un contrat pur et partagé.
 */
export interface IPageQuery {
  /** Taille de page — obligatoire (jamais « tout »). */
  limit: number;

  /**
   * Décalage depuis le début de la collection filtrée (mode **offset**). Défaut `0`.
   * Mutuellement exclusif avec {@link IPageQuery.cursor} : un backend n'expose qu'un mode.
   */
  offset?: number;

  /**
   * Jeton de page (mode **curseur**) : ne renvoyer que les éléments situés « après »
   * lui dans l'ordre du store. Obtenu du {@link IPage.nextCursor} de la page précédente.
   */
  cursor?: string;

  /**
   * Tri : couples `[champ, sens]`. Format **tableau** (une clé d'objet inconnue serait
   * silencieusement ignorée). Champs autorisés = définis par le store.
   */
  order?: Array<[string, "ASC" | "DESC"]>;

  /**
   * Renvoyer le total exact ({@link IPage.total}) ou non. `true` par défaut.
   * `false` = mode « Slice » : on saute le `COUNT` coûteux, {@link IPage.hasNext} suffit.
   */
  withTotal?: boolean;

  /**
   * Recherche plein-texte best-effort — le **champ** ciblé et la sémantique (préfixe /
   * sous-chaîne / casse) sont définis par chaque store et documentés côté store.
   */
  q?: string;

  /**
   * **RÉSERVÉ multi-tenant** — slot du contrat pour le scoping par tenant, appliqué
   * **au niveau du store** le jour du chantier tenant.
   *
   * @remarks ⚠️ **Non appliqué aujourd'hui** : le passer n'a aucun effet de filtrage.
   *   Présent dès maintenant pour ne pas re-changer la signature d'un contrat public
   *   propagé à tous les stores plus tard.
   */
  tenantId?: string | null;
}

/**
 * Une **page** de résultats — la sortie unique de toute pagination Nodefony.
 *
 * `total` présent = mode **Page** (on a compté) ; absent = mode **Slice**. `hasNext`
 * est fiable dans les deux cas. `nextCursor` n'est posé que par les backends **curseur**.
 *
 * @typeParam T - type des éléments de la page.
 */
export interface IPage<T> {
  /** Les éléments de la page (au plus `limit`). */
  items: T[];

  /**
   * Total exact de la collection filtrée — présent si {@link IPageQuery.withTotal}
   * n'est pas `false` **et** que le backend sait compter à coût raisonnable.
   */
  total?: number;

  /** Taille de page demandée (écho de {@link IPageQuery.limit}). */
  limit: number;

  /** Décalage de cette page (mode offset ; absent en mode curseur). */
  offset?: number;

  /** `true` s'il existe au moins un élément au-delà de cette page. */
  hasNext: boolean;

  /**
   * Jeton de la page suivante (mode **curseur**) — à repasser en
   * {@link IPageQuery.cursor}. `null` = fin. Absent = pagination par offset.
   */
  nextCursor?: string | null;
}
