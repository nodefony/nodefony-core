import type { IRepository } from "@nodefony/orm-core";
import type { IPasswordAuthenticatedUser } from "./IUser";

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
 * `@nodefony/security`). Le split credential (façon Symfony) protège les
 * consommateurs *en aval* (framework/authz reçoivent `IUser` via `IUserProvider`),
 * pas la couche de stockage qui, par nature, manipule le hash.
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
}
