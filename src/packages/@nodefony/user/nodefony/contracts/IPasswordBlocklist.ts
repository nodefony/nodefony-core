/**
 * Contrat de **liste de blocage de mots de passe compromis** (NIST SP 800-63B
 * §5.1.1.2) — consulté à la CRÉATION et au CHANGEMENT de mot de passe, jamais
 * au login (le hash stocké ne permet plus de juger le clair, et refuser un
 * login existant verrouillerait l'utilisateur).
 *
 * Le cœur ne fournit QUE le point d'extension : la source de vérité (top-10k
 * embarqué, fichier d'exploitation, API k-anonymity type HaveIBeenPwned) est un
 * choix de déploiement, pas du ressort du framework. Brancher une implémentation
 * via `UserService.passwordBlocklist`.
 */
export interface IPasswordBlocklist {
  /**
   * Le mot de passe en clair est-il connu-compromis / interdit ?
   *
   * @param plain - mot de passe candidat (jamais journalisé par l'implémentation).
   * @returns `true` si le mot de passe doit être refusé.
   */
  isBlocked(plain: string): Promise<boolean>;
}
