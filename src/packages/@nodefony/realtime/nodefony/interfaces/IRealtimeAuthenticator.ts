import type { IRealtimeHandshake } from "./IRealtimeHandshake";
import type { IRealtimeToken } from "./IRealtimeToken";

/**
 * Stratégie d'authentification au handshake WebSocket — équivalent realtime du
 * pattern `IAuthenticator` côté HTTP de `@nodefony/security`.
 *
 * Plusieurs authenticators sont enregistrés sur le hub via
 * `RealtimeService.useAuthenticator(matcher, authenticator)`. Au handshake, le
 * hub itère les matchers ordonnés ; le **1ʳᵉ** qui matche capture la connexion,
 * son authenticator est exécuté (`supports` puis `authenticate`).
 *
 * Implémentations futures (P6) : `AnonymousRealtimeAuthenticator`,
 * `JwtRealtimeAuthenticator` (cookie HTTP-only), `ApiKeyRealtimeAuthenticator`.
 *
 * **SYNC vs ASYNC** — l'authentification PEUT être asynchrone (handshake = 1×
 * par connexion, cold path). Le RÉSULTAT (`IRealtimeToken`) est ensuite caché
 * par le hub sur le peer ; les hooks hot-path (`beforeDispatch`, `onFrameAudit`)
 * le lisent en O(1) sans recalculer l'auth par frame (cf
 * `JsonRpcPeerOptions.beforeDispatch` — doctrine sync stricte du dispatch).
 *
 * @see IRealtimeAuthenticatorMatcher
 */
export interface IRealtimeAuthenticator {
  /** Nom logique (référencé dans les matchers, ex. `"realtime_jwt"`). */
  readonly name: string;

  /**
   * Peut-on extraire un credential de cette requête upgrade ? (sinon le hub
   * pose un token anonyme par défaut).
   */
  supports(handshake: IRealtimeHandshake): boolean;

  /**
   * Valide le credential et renvoie un token AUTHENTIFIÉ.
   *
   * `throw` une erreur (typiquement `AuthenticationError`) → le hub ferme la
   * connexion WebSocket avec un code 4001 (`unauthorized`, plage applicative
   * RFC 6455 §7.4.2) et n'instancie pas de peer.
   *
   * En cas de succès, le token est POSÉ par le hub sur la map `peer → token`.
   */
  authenticate(handshake: IRealtimeHandshake): Promise<IRealtimeToken>;

  /**
   * Hook succès — appelé APRÈS pose du token sur le peer, AVANT le welcome
   * JSON-RPC. Sert à journaliser (audit S1), poser un cookie de session si
   * besoin (rare en WS), etc. `void` (pas de back-pressure handshake).
   */
  onSuccess?(handshake: IRealtimeHandshake, token: IRealtimeToken): void;

  /**
   * Hook échec — appelé APRÈS qu'`authenticate` a throw, AVANT la fermeture
   * de la socket (code 4001). Permet de tracer l'échec sans interrompre la
   * fermeture. Throw d'ici est ignoré (catch défensif côté hub).
   */
  onFailure?(handshake: IRealtimeHandshake, error: Error): void;
}
