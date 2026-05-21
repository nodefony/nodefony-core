import type { IUser } from "./IUser";

/**
 * Contrat de **fourniture** d'utilisateurs — la source d'identité (DB, LDAP, SSO...).
 *
 * Consommé par les authenticators de `@nodefony/security` : il découple la
 * stratégie d'authentification du stockage. Une implémentation typique s'appuie
 * sur un {@link IUserRepository} ; un plugin externe (`@nodefony/auth-ldap`)
 * implémente ce contrat sans dépendre du firewall.
 *
 * @remarks Les méthodes **lèvent** une erreur si l'utilisateur est introuvable
 * (jamais `null`) — l'absence d'identité est un échec d'authentification explicite.
 */
export interface IUserProvider {
  /**
   * Charge un utilisateur par son identifiant fonctionnel (email, login...).
   *
   * @param identifier - identifiant unique recherché.
   * @returns l'utilisateur correspondant.
   * @throws Si aucun utilisateur ne correspond.
   */
  loadUserByIdentifier(identifier: string): Promise<IUser>;

  /**
   * Charge un utilisateur lié à un compte d'un fournisseur OAuth/OIDC.
   *
   * Support du pattern *Shadow User* : l'implémentation peut créer une ligne
   * locale au premier login externe.
   *
   * @param provider - fournisseur (`"google"`, `"github"`...).
   * @param providerId - identifiant du compte chez le fournisseur.
   * @returns l'utilisateur (existant ou nouvellement provisionné).
   * @throws Si le lien est introuvable et qu'aucun provisionnement n'est possible.
   */
  loadUserByOAuth(provider: string, providerId: string): Promise<IUser>;

  /**
   * Recharge un utilisateur depuis la source (rôles/état à jour) à chaque requête.
   *
   * Indispensable pour révoquer un accès sans attendre l'expiration du token.
   *
   * @param user - utilisateur (potentiellement périmé) à rafraîchir.
   * @returns la version fraîche de l'utilisateur.
   * @throws Si l'utilisateur n'existe plus (compte supprimé).
   */
  refreshUser(user: IUser): Promise<IUser>;
}
