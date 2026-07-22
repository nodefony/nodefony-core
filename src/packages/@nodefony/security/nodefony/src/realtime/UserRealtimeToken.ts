import type { IUser } from "@nodefony/user";
import type { IRealtimeToken } from "./realtimeContracts";

/** Aucun scope — figé et partagé (0 allocation pour le cas humain, le plus courant). */
const EMPTY_SCOPES: readonly string[] = Object.freeze([]);

/**
 * Adaptateur `IUser` → `IRealtimeToken` (jeton realtime).
 *
 * Construit UNIQUEMENT pour un utilisateur **authentifié** (le
 * {@link FirewallRealtimeAuthenticator} ne l'instancie qu'après avoir vérifié
 * l'identité résolue par le firewall) → `isAuthenticated()` est toujours `true`.
 * Un visiteur non authentifié reste sur `ANONYMOUS_REALTIME_TOKEN` (posé par le
 * hub realtime), jamais ici.
 *
 * Les rôles ET les scopes sont des **copies** (pas de fuite de la structure
 * interne de l'utilisateur ni du jeton d'origine). Les deux axes voyagent :
 * les rôles disent qui l'on est, les scopes ce qu'une clé déléguée a le droit
 * de faire — et un agent qui perd ses scopes en passant sur la socket perd la
 * garantie même du mode machine.
 */
export class UserRealtimeToken implements IRealtimeToken {
  /**
   * Mode d'authentification RÉEL de l'identité (`session`, `jwt`, `apikey`…),
   * repris du jeton que le firewall a posé dans l'ALS.
   *
   * Il était jadis figé à `"session"`, ce qui faisait passer un agent authentifié
   * par JWT pour un utilisateur à cookie — un mensonge sur l'identité, et la
   * racine du bug qui révoquait les sockets machine à machine.
   */
  readonly type: string;
  readonly #user: IUser;
  /**
   * Fonction de re-validation Zero Trust, fournie par le
   * {@link FirewallRealtimeAuthenticator} qui seul connaît le mode
   * d'authentification et ce qu'il faut relire (session BFF, ou bornes et
   * denylist d'un jeton porteur) — le token reste découplé : juste une closure.
   * `null` = aucune re-validation câblée (best-effort).
   */
  readonly #revalidate: ((nowMs?: number) => Promise<boolean>) | null;

  /**
   * Scopes délégués repris du jeton du firewall (clé API / JWT / OAuth). Vide
   * pour une identité humaine, qui n'est pas downscopée.
   */
  readonly #scopes: readonly string[];

  /**
   * @param user - identité authentifiée résolue par le firewall.
   * @param revalidate - preuve de vie de l'identité, adaptée à son mode.
   * @param type - mode d'authentification réel (défaut `"session"`).
   * @param scopes - scopes délégués du jeton d'origine (défaut aucun).
   */
  constructor(
    user: IUser,
    revalidate: ((nowMs?: number) => Promise<boolean>) | null = null,
    type: string = "session",
    scopes: readonly string[] = EMPTY_SCOPES,
  ) {
    this.#user = user;
    this.#revalidate = revalidate;
    this.type = type;
    this.#scopes = scopes;
  }

  /**
   * Zero Trust : l'identité qui a ouvert cette socket est-elle TOUJOURS vivante ?
   *
   * Selon le mode : une session BFF encore ouverte et toujours celle de ce compte
   * (détecte la déconnexion et le changement de compte sur navigateur partagé),
   * ou un jeton porteur non expiré et non révoqué. `true` si aucune re-validation
   * n'a pu être câblée (best-effort, jamais un faux refus).
   *
   * @param nowMs - horloge injectable (epoch ms) ; par défaut l'heure courante.
   *   Sert aux bornes temporelles d'un jeton, et rend le comportement testable
   *   sans dépendre de l'horloge de la machine.
   */
  isValid(nowMs?: number): Promise<boolean> {
    return this.#revalidate ? this.#revalidate(nowMs) : Promise.resolve(true);
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

  /**
   * Scopes délégués — copie défensive.
   *
   * ⚠️ Ils doivent être RÉELS : `ScopeVoter` ne consulte cette liste que pour un
   * jeton machine. Une liste vide sur un jeton `jwt`/`apikey` ne veut pas dire
   * « tous les droits », elle veut dire « aucun scope » — donc refus.
   */
  getScopes(): string[] {
    return [...this.#scopes];
  }

  getAttribute<T = unknown>(key: string): T | undefined {
    // Seam neutre (`IRealtimeToken`) : expose l'`IUser` réel sous la clé `"user"`
    // — lu par le pont api.request (J8) qui le pose dans l'ALS pour `@CurrentUser`
    // côté WS. Le contrat realtime reste neutre (aucun `IUser` dans la signature).
    return key === "user" ? (this.#user as T) : undefined;
  }
}

export default UserRealtimeToken;
