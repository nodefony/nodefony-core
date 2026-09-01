import type { IRepository } from "@nodefony/orm-core";
import type { IPage, IPageQuery, ISortableSource } from "nodefony";
import type { IPasswordAuthenticatedUser } from "./IUser";

/**
 * Requête de **listing paginé** d'utilisateurs — le contrat de page standard du
 * core ({@link IPageQuery}) enrichi des filtres propres à l'utilisateur.
 *
 * Ces filtres ne sont **pas portables** au `Criteria` générique de l'ORM (d'où un
 * `listPage` natif par backend, pas un `paginate()` générique) :
 * - `role` = appartenance dans le tableau **plat JSON** `roles` (containment :
 *   `json_each`/`@>`/`JSON_CONTAINS` en SQL, élément de tableau en Mongo) ;
 * - `q` (hérité) = sous-chaîne **insensible à la casse** sur `identifier`
 *   (`LOWER(...) LIKE` en SQL, `$regex`/`i` en Mongo) — pas un `$eq`.
 *
 * `enabled`, lui, correspond à la colonne `enabled` (= `isActive()`) et serait
 * portable ; il vit ici pour garder **un seul** objet de filtres du store.
 */
export interface IUserListQuery extends IPageQuery {
  /** Rôle plat devant figurer dans `roles` (containment natif). Omis = tous rôles. */
  role?: string;
  /** Restreint à l'état actif (`isActive()`). Omis = actifs ET inactifs. */
  enabled?: boolean;
  /**
   * Restreint aux comptes **verrouillés** (`isLocked()`), ou aux non verrouillés.
   * Omis = les deux.
   *
   * Distinct d'`enabled` : un compte désactivé l'a été par décision
   * d'administration, un compte verrouillé l'est par un mécanisme de défense
   * (trop d'échecs d'authentification). Les deux peuvent coexister sur le même
   * compte — les compter séparément est le seul moyen de savoir lequel des deux
   * bloque une population.
   */
  locked?: boolean;
  /**
   * Restreint aux comptes liés à **au moins un fournisseur d'identité externe**
   * (OAuth), ou à ceux qui n'en ont aucun. Omis = les deux.
   *
   * Répond à « combien de comptes dépendent d'un fournisseur tiers ? », question
   * de gouvernance qu'aucun filtre existant ne posait — la console la calculait
   * en rapatriant l'annuaire.
   */
  hasSocial?: boolean;
}

/**
 * Repository **spécialisé utilisateur** — `IRepository<IPasswordAuthenticatedUser>`
 * enrichi de finders métier.
 *
 * Étend le contrat CRUD portable de `@nodefony/orm-core` (`find`, `create`,
 * `withTransaction`...) avec les accès propres à l'authentification. Implémenté
 * une fois par adapter (Mongoose/Drizzle, P5.8–5.9) ; l'ORM concret
 * reste invisible des consommateurs (DI : `@Inject('repository.user')`).
 *
 * ## Écrire un champ MÉTIER de l'application
 *
 * Ce contrat est typé sur {@link IPasswordAuthenticatedUser} : `create()` et
 * `updateOne()` **refusent** en TypeScript un champ que l'application a ajouté à
 * sa table (`firstName`, `department`…). Ce n'est pas un oubli — le framework ne
 * connaît que les colonnes de son contrat.
 *
 * La porte d'écriture est le **repository générique** de l'entité, obtenu depuis
 * l'ORM et déjà exercé sur cette table :
 *
 * ```typescript
 * const users = orm.getRepository<MonUtilisateur>("User");
 * await users.create({ identifier: "carol@example.com", firstName: "Carol" });
 * ```
 *
 * En LECTURE, rien à faire : les dépôts reportent sur l'utilisateur rendu toute
 * colonne hors contrat, champs métier compris. Un champ écrit se relit donc, quel
 * que soit le moteur.
 *
 * @remarks Type d'entité = {@link IPasswordAuthenticatedUser} (credential inclus),
 * pas `IUser`. Le repository **est** la frontière de persistance du mot de passe :
 * seul composant qui lit/écrit le hash (consommé par `UserService` et
 * `@nodefony/security`). Le split credential protège les consommateurs *en aval*
 * (framework/authz reçoivent `IUser` via `IUserProvider`), pas la couche de
 * stockage qui, par nature, manipule le hash.
 */
export interface IUserRepository
  extends IRepository<IPasswordAuthenticatedUser>, ISortableSource {
  // `sortableFields` vient d'`ISortableSource` (core) : la FORME de la capacité
  // s'écrit une fois pour toutes les ressources. Ici, seul le vocabulaire est
  // propre aux utilisateurs — `USER_SORTABLE_FIELDS` (`../src/userSort`).
  /**
   * Retrouve un utilisateur par son identifiant fonctionnel (email, login...).
   *
   * @param identifier - identifiant unique.
   * @returns l'utilisateur (credential inclus), ou `null` s'il n'existe pas.
   */
  findByIdentifier(
    identifier: string,
  ): Promise<IPasswordAuthenticatedUser | null>;

  /**
   * Retrouve un utilisateur lié à un compte d'un fournisseur OAuth/OIDC.
   *
   * @param provider - fournisseur (`"google"`, `"github"`...).
   * @param providerId - identifiant du compte chez le fournisseur.
   * @returns l'utilisateur lié, ou `null` si aucun lien.
   */
  findBySocialProvider(
    provider: string,
    providerId: string,
  ): Promise<IPasswordAuthenticatedUser | null>;

  /**
   * Liste **paginée NATIVEMENT** d'utilisateurs — ne matérialise **jamais** plus
   * d'une page en mémoire (règle perf/mémoire absolue de Nodefony). Applique les
   * filtres {@link IUserListQuery} au niveau du store (SQL `WHERE`/`LIMIT/OFFSET`,
   * Mongo `find/skip/limit`), pas après un chargement complet.
   *
   * Tri par défaut = `identifier ASC` (ordre **déterministe** requis par la
   * pagination offset ; surchargé par `query.order`).
   *
   * @param query - filtres + fenêtre de page ({@link IUserListQuery}).
   * @returns une {@link IPage} : au plus `limit` items, `hasNext`, et `total` si
   *   `withTotal` n'est pas `false`.
   */
  listPage(query: IUserListQuery): Promise<IPage<IPasswordAuthenticatedUser>>;

  /**
   * Compte les administrateurs **actifs** (`isActive()` **et** porteurs de
   * `adminRole`) — garde-fou anti-lockout, calculé **au store** (SQL `COUNT` avec
   * containment de rôle), jamais en chargeant tous les utilisateurs.
   *
   * @param adminRole - rôle d'administration à dénombrer (ex. `ROLE_NODEFONY_ADMIN`).
   * @returns le nombre d'admins actifs portant ce rôle.
   */
  countActiveAdmins(adminRole: string): Promise<number>;

  /**
   * Compte les comptes correspondant aux filtres, **sans les énumérer**.
   *
   * Alimente les compteurs de tête de la console d'administration, qui portent
   * sur l'annuaire entier et non sur la page affichée. `limit`/`offset` sont
   * ignorés : un comptage n'a pas de fenêtre.
   *
   * @param query - les filtres seuls ({@link IUserListQuery}).
   * @returns le nombre de comptes correspondants.
   */
  countUsers(query: IUserListQuery): Promise<number>;
}
