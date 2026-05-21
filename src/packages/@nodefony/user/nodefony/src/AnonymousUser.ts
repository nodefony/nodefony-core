import type { IUser } from "../contracts/IUser";

/** Rôle unique d'un utilisateur non authentifié. */
export const ROLE_ANONYMOUS = "ROLE_ANONYMOUS";

// Tableau de rôles partagé et gelé : évite une allocation par requête non
// authentifiée et empêche toute mutation accidentelle du singleton.
const ANONYMOUS_ROLES: string[] = [ROLE_ANONYMOUS];
Object.freeze(ANONYMOUS_ROLES);

/**
 * Utilisateur **non authentifié** — implémente {@link IUser} sans credential.
 *
 * Permet de typer le contexte de sécurité sans `null` (Zero Trust : un visiteur
 * est un utilisateur anonyme, pas une absence d'utilisateur). `@CurrentUser`
 * retourne `IUser | AnonymousUser`, jamais `null`. Sans état mutable : un
 * {@link anonymousUser} singleton est réutilisé pour éviter toute allocation par
 * requête.
 */
export class AnonymousUser implements IUser {
  readonly id = "anonymous";
  readonly identifier = "anon.";
  readonly roles: string[] = ANONYMOUS_ROLES;

  hasRole(role: string): boolean {
    return role === ROLE_ANONYMOUS;
  }

  /** Un anonyme est utilisable (non désactivé). @returns `true`. */
  isActive(): boolean {
    return true;
  }

  /** Un anonyme n'est jamais verrouillé. @returns `false`. */
  isLocked(): boolean {
    return false;
  }
}

/**
 * Singleton d'{@link AnonymousUser} — instance partagée et gelée à réutiliser à
 * chaque requête non authentifiée (zéro allocation dans le hot path).
 */
export const anonymousUser: AnonymousUser = Object.freeze(new AnonymousUser());
