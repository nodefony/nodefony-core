/**
 * Contrat d'un encodeur de mot de passe — abstraction de l'algorithme de hachage.
 *
 * Implémenté par `BcryptEncoder` (P5.6, rounds: 12 par défaut), interchangeable
 * (argon2, scrypt...) sans toucher au reste de la chaîne d'authentification.
 * Consommé par `@nodefony/security` (`UserPasswordAuthenticator`) et `UserService`.
 *
 * Toutes les opérations sont asynchrones : le hachage est volontairement coûteux
 * en CPU et ne doit jamais bloquer la boucle d'événements.
 */
export interface IPasswordEncoder {
  /**
   * Indique si un hash stocké est au format de CET encodeur (parsing pur, sync).
   *
   * Permet à un composite ({@link MigratingEncoder}) de router la vérification
   * vers le bon algorithme sans connaître les formats — chaque encodeur
   * reconnaît son propre préfixe PHC (`$2b$…` bcrypt, `$argon2id$…` argon2).
   *
   * @param hash - hash stocké à inspecter.
   * @returns `true` si ce hash a été produit par cet algorithme.
   */
  supports(hash: string): boolean;

  /**
   * Hache un mot de passe en clair (sel inclus dans la sortie).
   *
   * @param plain - mot de passe en clair.
   * @returns le hash à persister.
   */
  hash(plain: string): Promise<string>;

  /**
   * Vérifie qu'un mot de passe en clair correspond à un hash stocké.
   *
   * Comparaison en temps constant déléguée à l'implémentation (anti-timing).
   *
   * @param plain - mot de passe en clair fourni à la connexion.
   * @param hash - hash stocké pour l'utilisateur.
   * @returns `true` si la correspondance est valide.
   */
  verify(plain: string, hash: string): Promise<boolean>;

  /**
   * Indique si un hash devrait être recalculé (paramètres de coût obsolètes).
   *
   * Permet la migration transparente du coût (ex. rounds augmentés) au prochain login.
   *
   * @param hash - hash stocké à inspecter.
   * @returns `true` si un re-hash est recommandé.
   */
  needsRehash(hash: string): boolean;
}
