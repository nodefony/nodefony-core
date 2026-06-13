import type { IUser } from "@nodefony/user";
import type { IRealtimeToken } from "./realtimeContracts";

/**
 * Adaptateur `IUser` → `IRealtimeToken` (jeton realtime).
 *
 * Construit UNIQUEMENT pour un utilisateur **authentifié** (le
 * {@link SessionRealtimeAuthenticator} ne l'instancie qu'après avoir vérifié
 * l'identité résolue par le firewall) → `isAuthenticated()` est toujours `true`.
 * Un visiteur non authentifié reste sur `ANONYMOUS_REALTIME_TOKEN` (posé par le
 * hub realtime), jamais ici.
 *
 * Session BFF : pas de `scopes` (axe distinct réservé aux clés API / OAuth — cf
 * `IToken.getScopes`). Les rôles sont une **copie** (pas de fuite de la
 * structure interne de l'utilisateur).
 */
export class UserRealtimeToken implements IRealtimeToken {
  readonly type = "session";
  readonly #user: IUser;

  constructor(user: IUser) {
    this.#user = user;
  }

  getUserIdentifier(): string {
    return this.#user.identifier;
  }

  isAuthenticated(): boolean {
    return true;
  }

  getRoles(): string[] {
    return [...this.#user.roles];
  }

  getScopes(): string[] {
    return [];
  }

  getAttribute<T = unknown>(_key: string): T | undefined {
    return undefined;
  }
}

export default UserRealtimeToken;
