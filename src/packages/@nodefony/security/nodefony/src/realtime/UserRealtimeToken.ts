import type { ISubscriberIdentity, TokenStatus } from "nodefony";
import type { IUser } from "@nodefony/user";
import type { IRealtimeToken } from "./realtimeContracts";

/** Aucun scope — figé et partagé (0 allocation pour le cas humain, le plus courant). */
const EMPTY_SCOPES: readonly string[] = Object.freeze([]);

/**
 * Ce que l'identité d'admission tient du jeton d'ORIGINE et que l'utilisateur ne dit pas : son émetteur, et l'existence d'un compte local relisible.
 */
export interface IRealtimeAdmissionSource {
  /** `iss` du jeton vérifié ; `null` sans jeton (session, clé d'API). */
  readonly issuer: string | null;
  /** `false` pour un appelant machine sans compte local (`<émetteur>#<sujet>`). */
  readonly account: boolean;
}

/** Une session ou une clé d'API : aucun émetteur, un compte local — figé et partagé. */
export const LOCAL_ACCOUNT: IRealtimeAdmissionSource = Object.freeze({
  issuer: null,
  account: true,
});

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
  /** Cause de l'état d'un jeton porteur ; `null` pour une session. */
  readonly #status: ((nowMs?: number) => Promise<TokenStatus>) | null;

  /**
   * Scopes délégués repris du jeton du firewall (clé API / JWT / OAuth). Vide
   * pour une identité humaine, qui n'est pas downscopée.
   */
  readonly #scopes: readonly string[];

  /**
   * Confirmation du COMPTE (annuaire relu), fournie par le
   * {@link FirewallRealtimeAuthenticator} pour les modes dont l'application
   * émet elle-même l'artefact. `null` = rien à confirmer.
   */
  readonly #confirmAccount: (() => Promise<boolean>) | null;

  /** Émetteur et compte, repris du jeton d'origine pour l'identité d'admission. */
  readonly #admission: IRealtimeAdmissionSource;

  /**
   * Identité d'admission, construite au PREMIER appel puis rendue telle quelle :
   * `null` tant que personne ne l'a demandée (un jeton construit pour un test ou
   * un pont qui ne la lit jamais ne la paie pas).
   */
  #identity: ISubscriberIdentity | null = null;

  /**
   * @param user - identité authentifiée résolue par le firewall.
   * @param revalidate - preuve de vie de l'identité, adaptée à son mode.
   * @param type - mode d'authentification réel (défaut `"session"`).
   * @param scopes - scopes délégués du jeton d'origine (défaut aucun).
   * @param confirmAccount - relecture du compte, payée sur `api.request` seul.
   * @param status - la CAUSE de l'état, pour un jeton porteur (expiré ou révoqué) ;
   *   `null` pour une session, qui n'a qu'un verdict.
   * @param admission - émetteur et compte local du jeton d'origine (défaut :
   *   aucun émetteur, compte local — une session).
   */
  constructor(
    user: IUser,
    revalidate: ((nowMs?: number) => Promise<boolean>) | null = null,
    type: string = "session",
    scopes: readonly string[] = EMPTY_SCOPES,
    confirmAccount: (() => Promise<boolean>) | null = null,
    status: ((nowMs?: number) => Promise<TokenStatus>) | null = null,
    admission: IRealtimeAdmissionSource = LOCAL_ACCOUNT,
  ) {
    this.#admission = admission;
    this.#confirmAccount = confirmAccount;
    this.#status = status;
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

  /**
   * La cause de l'état de l'identité — `expired` ferme la socket en 4006, `revoked`
   * en 4001 (ADR-0021 §S11). Sans cause câblée (session), dérivée de
   * {@link isValid} : `false` vaut `revoked`.
   *
   * @param nowMs - horloge injectable (epoch ms) ; par défaut l'heure courante.
   */
  async status(nowMs?: number): Promise<TokenStatus> {
    if (this.#status !== null) return this.#status(nowMs);
    return (await this.isValid(nowMs)) ? "active" : "revoked";
  }

  /**
   * Le compte qui a ouvert la socket existe-t-il toujours, actif, et sous le
   * même `id` immuable ? `true` si aucune confirmation n'est câblée.
   */
  confirmAccount(): Promise<boolean> {
    return this.#confirmAccount
      ? this.#confirmAccount()
      : Promise.resolve(true);
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

  /**
   * Identité d'admission gelée de la connexion — la donnée plate que reçoit la règle `allow` d'un canal (ADR-0021 §S10).
   *
   * Construite une fois, au premier appel, puis rendue par RÉFÉRENCE : les rôles
   * y sont copiés et gelés une seule fois (là où {@link getRoles} recopie à
   * chaque appel), si bien que ni le `welcome` ni l'admission ne recopient
   * plus rien. Gelée : une règle `allow` ne peut pas s'ajouter un rôle.
   * `id` est l'identifiant immuable du compte, jamais son login.
   */
  getIdentity(): ISubscriberIdentity {
    if (this.#identity !== null) return this.#identity;
    const user = this.#user;
    const scopes = this.#scopes;
    this.#identity = Object.freeze({
      type: this.type,
      authenticated: true,
      id: user.id,
      userIdentifier: user.identifier,
      roles: Object.freeze([...user.roles]),
      scopes: Object.isFrozen(scopes) ? scopes : Object.freeze([...scopes]),
      issuer: this.#admission.issuer,
      account: this.#admission.account,
    });
    return this.#identity;
  }

  // Accesseur typé par l'appelant, par construction : retirer `T` casserait
  // `getAttribute<…>()` chez chaque consommateur (rupture d'API publique).
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  getAttribute<T = unknown>(key: string): T | undefined {
    // Seam neutre (`IRealtimeToken`) : expose l'`IUser` réel sous la clé `"user"`
    // — lu par le pont api.request (J8) qui le pose dans l'ALS pour `@CurrentUser`
    // côté WS. Le contrat realtime reste neutre (aucun `IUser` dans la signature).
    return key === "user" ? (this.#user as T) : undefined;
  }
}

export default UserRealtimeToken;
