import { anonymousUser } from "@nodefony/user";
import type { IUser } from "@nodefony/user";
import type { IToken } from "../../contracts/IToken";

/**
 * Jeton porteur d'un utilisateur réel — produit par les authenticators à
 * credential (`userpassword`, puis `session`/`jwt`...).
 *
 * Cycle en deux états, UN SEUL objet alloué par tentative (cold path login) :
 * 1. `createToken()` → non authentifié : porte le credential brut extrait de la
 *    requête, `getUser()` rend l'anonyme (jamais `null`, Zero Trust).
 * 2. `authenticate()` réussit → {@link promote} : l'utilisateur vérifié est posé
 *    et le credential est **effacé** (anti-fuite : un mot de passe ne doit
 *    survivre ni en mémoire ni dans un heap dump/log).
 *
 * Les attributs (claims, providerId...) sont lazy — `null` tant que rien n'est posé.
 */
export class UserToken implements IToken {
  readonly type: string;
  #user: IUser | null = null;
  #credentials: unknown;
  #attributes: Map<string, unknown> | null = null;

  /**
   * @param type - type du token (`"userpassword"`, `"session"`, `"jwt"`...).
   * @param credentials - credential brut extrait de la requête (vidé au succès).
   */
  constructor(type: string, credentials: unknown = null) {
    this.type = type;
    this.#credentials = credentials;
  }

  /**
   * Marque le jeton authentifié : pose l'utilisateur vérifié et EFFACE le
   * credential. Appelé uniquement par l'authenticator au succès.
   *
   * @param user - utilisateur vérifié par la source d'identité.
   * @returns le jeton lui-même (chaînage).
   */
  promote(user: IUser): this {
    this.#user = user;
    this.#credentials = null;
    return this;
  }

  getUser(): IUser {
    return this.#user ?? anonymousUser;
  }

  isAuthenticated(): boolean {
    return this.#user !== null;
  }

  getRoles(): string[] {
    return this.#user ? [...this.#user.roles] : [...anonymousUser.roles];
  }

  getCredentials(): unknown {
    return this.#credentials;
  }

  getScopes(): string[] {
    return (this.#attributes?.get("scopes") as string[] | undefined) ?? [];
  }

  getAttribute<T = unknown>(key: string): T | undefined {
    return this.#attributes?.get(key) as T | undefined;
  }

  setAttribute(key: string, value: unknown): void {
    (this.#attributes ??= new Map()).set(key, value);
  }
}

export default UserToken;
