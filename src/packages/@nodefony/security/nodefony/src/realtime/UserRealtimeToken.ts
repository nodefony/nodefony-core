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
  /**
   * Fonction de re-validation Zero Trust (re-lit la session BFF du handshake),
   * fournie par le {@link SessionRealtimeAuthenticator} qui seul connaît la
   * session/le store — le token reste découplé (juste une closure). `null` si la
   * session n'était pas accessible au handshake → pas de re-validation (best-effort).
   */
  readonly #revalidate: (() => Promise<boolean>) | null;

  constructor(user: IUser, revalidate: (() => Promise<boolean>) | null = null) {
    this.#user = user;
    this.#revalidate = revalidate;
  }

  /**
   * Zero Trust : la session BFF qui a ouvert cette socket est-elle TOUJOURS
   * vivante et toujours CELLE de cet utilisateur ? Détecte la déconnexion et le
   * changement de compte sur navigateur partagé (socket figée au handshake).
   * `true` si aucune re-validation n'a pu être câblée (best-effort, jamais un
   * faux refus).
   */
  isValid(): Promise<boolean> {
    return this.#revalidate ? this.#revalidate() : Promise.resolve(true);
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

  getAttribute<T = unknown>(key: string): T | undefined {
    // Seam neutre (`IRealtimeToken`) : expose l'`IUser` réel sous la clé `"user"`
    // — lu par le pont api.request (J8) qui le pose dans l'ALS pour `@CurrentUser`
    // côté WS. Le contrat realtime reste neutre (aucun `IUser` dans la signature).
    return key === "user" ? (this.#user as T) : undefined;
  }
}

export default UserRealtimeToken;
