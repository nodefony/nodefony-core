import type { IUser } from "./IUser";

/**
 * Contrat de **vérification d'un credential mot de passe** — le guichet auquel
 * `@nodefony/security` présente un couple identifiant/mot de passe et qui répond
 * par un verdict, jamais par un hash.
 *
 * Complète {@link IUserProvider} (fourniture d'identité, lecture seule) : ici on
 * VALIDE un credential. Le hash ne traverse jamais cette frontière — la
 * comparaison (encoder, leurre anti-timing, re-hash transparent) reste du côté
 * de l'implémentation ({@link UserService.authenticate} en est la référence).
 * Une source custom (LDAP, SSO maison) s'authentifie par mot de passe en
 * implémentant ce seul contrat, sans rien connaître du firewall.
 */
export interface IPasswordVerifier {
  /**
   * Vérifie un couple identifiant/mot de passe.
   *
   * @param identifier - identifiant fonctionnel saisi (email, login...).
   * @param plain - mot de passe en clair saisi.
   * @returns l'utilisateur authentifié, ou `null` si le credential est invalide
   *   (identifiant inconnu, compte inactif/verrouillé, mot de passe faux) — la
   *   raison fine n'est PAS exposée ici (anti-énumération) ; elle part dans les
   *   events d'audit de l'implémentation.
   */
  authenticate(identifier: string, plain: string): Promise<IUser | null>;
}
