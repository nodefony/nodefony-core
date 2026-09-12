/**
 * Contrat de **liste de blocage de mots de passe compromis** (NIST SP 800-63B
 * §5.1.1.2) — consulté à la CRÉATION et au CHANGEMENT de mot de passe, jamais
 * au login (le hash stocké ne permet plus de juger le clair, et refuser un
 * login existant verrouillerait l'utilisateur).
 *
 * Le framework en pose une PAR DÉFAUT (`PasswordPolicy` : longueur, identifiant
 * répété, suites de touches, mots de passe les plus courants) — une application
 * la remplace pour durcir ou pour brancher sa propre source (fichier
 * d'exploitation, API k-anonymity type HaveIBeenPwned), jamais pour la
 * désactiver par oubli. Le point de branchement est `UserService.passwordBlocklist`.
 */
export interface IPasswordBlocklist {
  /**
   * Le mot de passe en clair est-il connu-compromis / interdit ?
   *
   * @param plain - mot de passe candidat (jamais journalisé par l'implémentation).
   * @param subject - ce qu'on sait du compte visé, quand l'appelant le sait : un
   *   mot de passe ne doit pas répéter l'identifiant. Optionnel — une
   *   implémentation qui n'en a pas besoin l'ignore.
   * @returns `true` si le mot de passe doit être refusé.
   */
  isBlocked(plain: string, subject?: IPasswordSubjectHint): Promise<boolean>;

  /**
   * La règle enfreinte, en français, ou `null` si le mot de passe est accepté.
   *
   * Optionnel, et c'est voulu : le contrat minimal reste un booléen. Quand une
   * implémentation le fournit, le refus peut NOMMER sa cause — un « mot de passe
   * refusé » sans motif envoie l'utilisateur deviner.
   *
   * @param plain - mot de passe candidat.
   * @param subject - ce qu'on sait du compte visé.
   */
  violation?(
    plain: string,
    subject?: IPasswordSubjectHint,
  ): Promise<string | null>;
}

/** Ce qu'un appelant peut dire du compte visé — tout est optionnel. */
export interface IPasswordSubjectHint {
  /** Identifiant du compte (courriel, login). */
  identifier?: string;
}
