import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";

/**
 * Token realtime ANONYME — fallback Zero Trust quand aucun matcher
 * `IRealtimeAuthenticatorMatcher` ne capture le handshake.
 *
 * Singleton gelé (`Object.freeze`) — 0 alloc par connexion non authentifiée.
 * Aligné sur le pattern `AnonymousToken` de `@nodefony/security` S1 (même
 * surface logique, type `"anonymous"`, `roles = ["ROLE_ANONYMOUS"]`).
 *
 * Stocké par le hub sur la map `peer → token` au handshake si aucun
 * authenticator ne capture la connexion. Les voters P6 (futur) verront un
 * token avec `isAuthenticated() === false` et appliqueront leur politique
 * (Zero Trust : zone protégée → frame refusée par `beforeDispatch`).
 */
const anonymousAttributes = Object.freeze<Record<string, unknown>>({});

export const ANONYMOUS_REALTIME_TOKEN: IRealtimeToken = Object.freeze({
  type: "anonymous",
  getUserIdentifier(): string {
    return "anonymous";
  },
  isAuthenticated(): boolean {
    return false;
  },
  getRoles(): string[] {
    return ["ROLE_ANONYMOUS"];
  },
  getScopes(): string[] {
    return [];
  },
  getAttribute<T = unknown>(key: string): T | undefined {
    return anonymousAttributes[key] as T | undefined;
  },
});

export default ANONYMOUS_REALTIME_TOKEN;
