/**
 * Jeton realtime — surface MINIMALE de l'identité d'une connexion WebSocket.
 *
 * Sous-ensemble STRICT de `@nodefony/security`'s `IToken` (TypeScript structural
 * typing → toute classe `Token` security l'implémente gratuitement). Le module
 * `@nodefony/realtime` reste ainsi **pur** (zéro dépendance security runtime
 * ni type-only), tout en exposant un contrat partageable.
 *
 * Posé par un {@link IRealtimeAuthenticator} au handshake WS et cacheable côté
 * `RealtimeHub` via la map `peer → token` — les hot-paths (`beforeDispatch`,
 * `onFrameAudit`) le lisent en O(1) sans recalculer l'auth par frame.
 *
 * Zero Trust : un visiteur non authentifié reçoit toujours un token (Anonymous,
 * `isAuthenticated() === false`), jamais `null`.
 *
 * @see IRealtimeAuthenticator
 */
export interface IRealtimeToken {
  /** Type du token (`"anonymous"`, `"jwt"`, `"apikey"`, …) — discriminator stable. */
  readonly type: string;

  /** Identifiant logique de l'utilisateur (`"anonymous"`, `"user-42"`, …). */
  getUserIdentifier(): string;

  /** `true` si l'authentification a réussi (≠ anonyme). */
  isAuthenticated(): boolean;

  /** Rôles **plats** (sans hiérarchie résolue) — utilisés par les voters P6. */
  getRoles(): string[];

  /**
   * Scopes accordés (clés API / OAuth) — axe **distinct** des rôles RBAC.
   * Ex. `["chat:write", "presence:read"]`. `[]` si aucun.
   */
  getScopes(): string[];

  /** Lecture d'un attribut arbitraire (claims JWT, `tenantId`, providerId…). */
  getAttribute<T = unknown>(key: string): T | undefined;
}
