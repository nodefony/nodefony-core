/**
 * Interfaces publiques de @nodefony/realtime.
 *
 * Contrats partagés du module realtime — toutes ces interfaces sont aussi
 * exportées depuis le barrel racine `@nodefony/realtime` pour DX.
 *
 * Sécurité : `IRealtimeToken` / `IRealtimeHandshake` / `IRealtimeAuthenticator`
 * (+ matcher) sont les 3 contrats du **seam sécurité #2** (P13 Bloc A étape 6) —
 * `@nodefony/security` (P6) les implémente sans coupler ce module au security.
 */

export type {
  IBackplane,
  IBackplaneMessage,
  BackplaneHandler,
} from "./IBackplane";

export type {
  IRealtimeController,
  RealtimePublish,
  RealtimeInboundHandler,
} from "./IRealtimeController";

export type {
  IRealtimeProbe,
  IRealtimeHealth,
  IRealtimeClusterHealth,
  IRealtimeChannelStat,
  IRealtimeConnProbe,
} from "./IRealtimeProbe";

// Seam sécurité #2 — handshake authenticators (P13 Bloc A étape 6).
export type { IRealtimeToken } from "./IRealtimeToken";
export type { IRealtimeHandshake } from "./IRealtimeHandshake";
export type { IRealtimeAuthenticator } from "./IRealtimeAuthenticator";
export type {
  IRealtimeAuthenticatorMatcher,
  ICompiledRealtimeMatcher,
} from "./IRealtimeAuthenticatorMatcher";
