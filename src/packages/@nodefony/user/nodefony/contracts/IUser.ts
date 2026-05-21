/**
 * Référence à un compte d'un fournisseur d'identité externe (OAuth / OIDC).
 *
 * Stocké en **JSON** sur l'utilisateur (`BaseUser.socialProviders`) plutôt qu'en
 * colonnes dédiées (`googleId`, `githubId`...) : ajouter un provider ne demande
 * aucune migration de schéma. Support du pattern *Shadow User* (une ligne locale
 * est créée même pour une authentification 100 % externe).
 */
export interface ISocialProvider {
  /** Identifiant du fournisseur (`"google"`, `"github"`, `"microsoft"`...). */
  readonly provider: string;
  /** Identifiant du compte chez le fournisseur. */
  readonly providerId: string;
  /** Date de liaison du compte. */
  readonly createdAt: Date;
}

/**
 * Contrat **strict** d'un utilisateur Nodefony — surface minimale garantie au framework.
 *
 * C'est le type manipulé par la grande majorité des consommateurs (framework,
 * adapters ORM, agent, llm, rag, realtime, studio) : il ne porte que l'identité
 * et les rôles, jamais de credential ni de champ persistant. Les implémentations
 * concrètes ({@link BaseUser}, entités ORM) l'enrichissent.
 *
 * Les rôles sont **plats** (`string[]`) : la résolution de hiérarchie
 * (`roleHierarchy`) est du ressort de `@nodefony/security`, pas du modèle. Garder
 * la liste plate sert la perf (lecture via ALS à chaque requête) et des logs
 * structurés non ambigus.
 */
export interface IUser {
  /** Identifiant interne — UUID (jamais `string | number`). */
  readonly id: string;

  /** Identifiant fonctionnel d'authentification (email, login...). Unique. */
  readonly identifier: string;

  /** Rôles **plats** accordés (sans hiérarchie résolue). */
  readonly roles: string[];

  /**
   * Indique si l'utilisateur possède le rôle exact donné (sans hiérarchie).
   *
   * @param role - rôle recherché (ex. `"ROLE_ADMIN"`).
   * @returns `true` si présent dans {@link roles}.
   */
  hasRole(role: string): boolean;

  /**
   * Indique si le compte est actif (activé et non expiré).
   *
   * @returns `false` désactive l'authentification, indépendamment des credentials.
   */
  isActive(): boolean;

  /**
   * Indique si le compte est verrouillé (ex. trop d'échecs de connexion).
   *
   * @returns `true` empêche l'authentification même avec des credentials valides.
   */
  isLocked(): boolean;
}

/**
 * Utilisateur **porteur d'un credential mot de passe local** — extension de {@link IUser}.
 *
 * Séparé de `IUser` (façon `PasswordAuthenticatedUserInterface` de Symfony) pour
 * garder le contrat de base pur : seuls `@nodefony/security`
 * (`UserPasswordAuthenticator`) et un {@link IPasswordEncoder} ont besoin du hash.
 * Un compte 100 % OAuth a `password === null`.
 */
export interface IPasswordAuthenticatedUser extends IUser {
  /** Hash du mot de passe stocké, ou `null` pour un compte sans mot de passe local. */
  readonly password: string | null;
}
