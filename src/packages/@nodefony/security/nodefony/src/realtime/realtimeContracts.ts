/**
 * Miroirs STRUCTURELS des contrats `@nodefony/realtime` — **zéro import** du
 * module realtime (ni runtime ni type-only).
 *
 * POURQUOI : `@nodefony/security` et `@nodefony/realtime` **ne se dépendent pas**
 * (deux `package.json` disjoints, vérifié). Le câblage du verrou WS se fait par
 * **nom de service** (`container.get("realtimeService")`), pas par import — donc
 * security décrit localement la SURFACE qu'il consomme. Le typage structurel de
 * TypeScript fait le pont : un objet security (authenticator, token) dont la forme
 * coïncide est accepté à l'exécution par realtime (duck typing). Convention-frère :
 * `ISessionAuthFlow` (framework décrit la surface http) et le seam realtime↔security
 * côté realtime (`IRealtimeToken` y est déjà décrit comme « sous-ensemble de IToken »).
 *
 * ⚠️ Ces interfaces DOIVENT rester alignées sur celles de
 * `@nodefony/realtime/nodefony/interfaces/*` — toute dérive de forme casserait le
 * pont silencieusement (test de compat dans le banc realtime du verrou).
 */

/**
 * Jeton realtime — identité minimale d'une connexion WS (miroir de
 * `IRealtimeToken`). Posé au handshake, lu en O(1) par le verrou de frame.
 */
export interface IRealtimeToken {
  readonly type: string;
  getUserIdentifier(): string;
  isAuthenticated(): boolean;
  getRoles(): string[];
  getScopes(): string[];
  getAttribute<T = unknown>(key: string): T | undefined;
}

/**
 * Données de handshake WS (miroir de `IRealtimeHandshake`) — DTO neutre passé à
 * un authenticator. Cookies déjà parsés en `Map<name, value>`.
 */
export interface IRealtimeHandshake {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly cookies: ReadonlyMap<string, string>;
  readonly url: string;
  readonly remoteAddress: string;
  readonly origin?: string;
  readonly protocols: readonly string[];
}

/**
 * Stratégie d'auth au handshake WS (miroir de `IRealtimeAuthenticator`,
 * pattern Symfony `supports/authenticate`).
 */
export interface IRealtimeAuthenticator {
  readonly name: string;
  supports(handshake: IRealtimeHandshake): boolean;
  authenticate(handshake: IRealtimeHandshake): Promise<IRealtimeToken>;
  onSuccess?(handshake: IRealtimeHandshake, token: IRealtimeToken): void;
  onFailure?(handshake: IRealtimeHandshake, error: Error): void;
}

/**
 * Sélecteur de zone WS (miroir de `IRealtimeAuthenticatorMatcher`) — pattern
 * d'URL (string|RegExp) + vhost optionnel. Parité avec `ISecuredArea.host`.
 */
export interface IRealtimeAuthenticatorMatcher {
  readonly pattern: string | RegExp;
  readonly host?: string;
}

/**
 * Verrou de frame (miroir de `FrameAuthorizer`) — SYNC : `true` = frame
 * autorisée. Lit le token déjà résolu au handshake (0 lecture base par frame).
 */
export type FrameAuthorizer = (
  frame: unknown,
  token: IRealtimeToken,
) => boolean;

/**
 * Surface consommée du `realtimeService` (miroir partiel de `RealtimeService`) —
 * seulement les 2 seams que security câble au boot. Résolu par nom via le
 * container (`container.get<IRealtimeService>("realtimeService")`).
 */
export interface IRealtimeService {
  /** Seam #2/#3 — enregistre un authenticator pour les handshakes WS matchés. */
  useAuthenticator(
    matcher: IRealtimeAuthenticatorMatcher,
    authenticator: IRealtimeAuthenticator,
  ): void;
  /** Seam #1 — pose le verrou de frame (hot-path `beforeDispatch`). */
  setFrameAuthorizer(authorizer: FrameAuthorizer | null): void;
}
