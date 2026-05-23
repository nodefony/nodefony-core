import type { IUser } from "@nodefony/user";

/**
 * Jeton de sécurité — porte l'identité (authentifiée ou non) d'une requête.
 *
 * Produit par un {@link IAuthenticator}, propagé via ALS (`RequestContext`) pour
 * tout le pipeline. Ne contient JAMAIS de credential brut après authentification :
 * `getCredentials()` est vidé par l'authenticator au succès (anti-fuite mémoire).
 *
 * Zero Trust : un visiteur non authentifié reçoit quand même un token (porteur de
 * l'`AnonymousUser`, `isAuthenticated() === false`) — `getUser()` ne renvoie jamais `null`.
 */
export interface IToken {
  /** Type du token (`"anonymous"`, `"userpassword"`, `"jwt"`, `"oauth2"`, `"mtls"`). */
  readonly type: string;

  /** Utilisateur porté — jamais `null` (AnonymousUser si non authentifié). */
  getUser(): IUser;

  /** `true` si l'authentification a réussi (≠ anonyme). */
  isAuthenticated(): boolean;

  /** Rôles **plats** de l'utilisateur (sans hiérarchie résolue). */
  getRoles(): string[];

  /** Credential brut avant validation (vidé au succès). */
  getCredentials(): unknown;

  /**
   * Scopes accordés (clé API / OAuth) — axe **distinct** des rôles RBAC.
   * Ex. `["repo:read", "user:email"]`. `[]` si aucun. Permet `@RequireScope(...)`
   * sans confondre avec `@IsGranted('ROLE_*')` (cf GitHub PAT / OAuth scopes).
   */
  getScopes(): string[];

  /** Lecture d'un attribut arbitraire posé par l'authenticator (claims JWT, scopes…). */
  getAttribute<T = unknown>(key: string): T | undefined;

  /** Pose un attribut arbitraire (claims, scopes, providerId…). */
  setAttribute(key: string, value: unknown): void;
}
