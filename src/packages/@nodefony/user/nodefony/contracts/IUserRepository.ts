import type { IRepository } from "@nodefony/orm-core";
import type { IUser } from "./IUser";

/**
 * Repository **spécialisé utilisateur** — `IRepository<IUser>` enrichi de finders métier.
 *
 * Étend le contrat CRUD portable de `@nodefony/orm-core` (`find`, `create`,
 * `withTransaction`...) avec les accès propres à l'authentification. Implémenté
 * une fois par adapter (Sequelize/Mongoose/Drizzle, P5.7–5.9) ; l'ORM concret
 * reste invisible des consommateurs (DI : `@Inject('repository.user')`).
 */
export interface IUserRepository extends IRepository<IUser> {
  /**
   * Retrouve un utilisateur par son identifiant fonctionnel (email, login...).
   *
   * @param identifier - identifiant unique.
   * @returns l'utilisateur, ou `null` s'il n'existe pas.
   */
  findByIdentifier(identifier: string): Promise<IUser | null>;

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
  ): Promise<IUser | null>;
}
