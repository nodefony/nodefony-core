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

  /**
   * Re-valide l'identité À L'USAGE (Zero Trust) : `true` si le token est encore
   * légitime, `false` s'il est PÉRIMÉ (session détruite, ou un AUTRE compte s'est
   * connecté depuis sur la même socket partagée). Optionnel — un token qui porte
   * sa propre validité (Anonyme, JWT à `exp`) n'en a pas besoin (**absent =
   * considéré valide**).
   *
   * Appelé par le pont `api.request` AVANT toute action data plane : une
   * WebSocket survit à sa session (le token est figé au handshake), donc une
   * identité périmée ne doit JAMAIS servir une requête data plane sensible.
   * Async (peut relire un store de session) ; gardé HORS du hot-path temps réel
   * (publish/subscribe), payé seulement sur `api.request`.
   */
  isValid?(nowMs?: number): boolean | Promise<boolean>;
}
