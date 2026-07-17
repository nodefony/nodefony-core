import type { IRepository } from "@nodefony/orm-core";
import type { IPage, IPageQuery } from "nodefony";
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
 * @remarks Type d'entité = {@link IPasswordAuthenticatedUser} (credential inclus),
 * pas `IUser`. Le repository **est** la frontière de persistance du mot de passe :
 * seul composant qui lit/écrit le hash (consommé par `UserService` et
 * `@nodefony/security`). Le split credential protège les consommateurs *en aval*
 * (framework/authz reçoivent `IUser` via `IUserProvider`), pas la couche de
 * stockage qui, par nature, manipule le hash.
 */
export interface IUserRepository extends IRepository<IPasswordAuthenticatedUser> {
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
}
