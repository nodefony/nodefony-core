import { anonymousUser } from "@nodefony/user";
import type { IUser } from "@nodefony/user";
import type { IToken } from "../../contracts/IToken";

/**
 * Token du visiteur non authentifié — Zero Trust : un visiteur EST un utilisateur
 * anonyme (jamais `null`).
 *
 * Porte le singleton gelé `anonymousUser` → **zéro allocation d'utilisateur** par
 * requête non authentifiée (hot path). Les attributs sont lazy (`null` tant qu'on
 * n'en pose pas).
 */
export class AnonymousToken implements IToken {
  readonly type = "anonymous";
  #attributes: Map<string, unknown> | null = null;

  getUser(): IUser {
    return anonymousUser;
  }

  getUserIdentifier(): string {
    return anonymousUser.identifier;
  }

  isAuthenticated(): boolean {
    return false;
  }

  getRoles(): string[] {
    return [...anonymousUser.roles];
  }

  getCredentials(): unknown {
    return null;
  }

  getScopes(): string[] {
    return [];
  }

  getAttribute<T = unknown>(key: string): T | undefined {
    return this.#attributes?.get(key) as T | undefined;
  }

  setAttribute(key: string, value: unknown): void {
    (this.#attributes ??= new Map()).set(key, value);
  }
}

export default AnonymousToken;
