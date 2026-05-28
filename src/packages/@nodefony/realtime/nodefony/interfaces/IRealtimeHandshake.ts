/**
 * Données de handshake WebSocket — DTO minimal passé à un
 * {@link IRealtimeAuthenticator} pour qu'il extraie un credential et valide
 * l'identité, SANS coupler ce module à `@nodefony/http` runtime.
 *
 * Construit par `RealtimeController.onHandshake()` depuis le `WebsocketContext`
 * (request upgrade HTTP) puis consommé une seule fois par connexion (cold path).
 *
 * Cookies : déjà PARSÉS en `Map<string, string>` (et non l'en-tête `Cookie` brut)
 * — la plupart des authenticators stateless WS lisent un cookie JWT.
 *
 * @see IRealtimeAuthenticator
 */
export interface IRealtimeHandshake {
  /** En-têtes de la requête upgrade (clés en lowercase RFC 7230 §3.2). */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;

  /** Cookies parsés depuis `Cookie:` (vide si en-tête absent ou mal formé). */
  readonly cookies: ReadonlyMap<string, string>;

  /** URL de l'upgrade (pathname + query string), ex. `/realtime?token=...`. */
  readonly url: string;

  /** IP du client (déjà extraite — derrière proxy : voir `trust proxy`). */
  readonly remoteAddress: string;

  /** Origin RFC 6455 §10.2 — `undefined` si en-tête absent (clients non-browser). */
  readonly origin?: string;

  /** Sous-protocoles annoncés (`Sec-WebSocket-Protocol`). `[]` si aucun. */
  readonly protocols: readonly string[];
}
