import type { SchemeType } from "./IContext";
import type { HTTPMethodType } from "./IRequest";

/**
 * Nature de l'opération tracée : une requête HTTP, ou le handshake d'une
 * connexion WebSocket.
 */
export type RequestTraceProtocol = "http" | "websocket";

/**
 * Message publié sur le `TracingChannel` `nodefony.http.request`, le même
 * objet de `start` à `asyncEnd` pour une requête donnée.
 *
 * Les champs d'identité (`requestId`, `protocol`, `method`, `scheme`, `url`)
 * sont posés dès `start`. Les champs de résultat (`route`, `routePath`,
 * `module`, `statusCode`, `durationMs`, `error`) valent `null` jusqu'à la fin
 * de la requête : un abonné les lit sur `asyncEnd`. Tout est en lecture seule
 * pour l'abonné — c'est Nodefony qui les remplit.
 */
export interface IRequestTrace {
  /** Identifiant de corrélation de la requête (`X-Request-Id` entrant, sinon généré). */
  readonly requestId: string;
  /** `"http"` pour une requête, `"websocket"` pour un handshake. */
  readonly protocol: RequestTraceProtocol;
  /** Méthode de la requête (`"WEBSOCKET"` pour un handshake). */
  readonly method: HTTPMethodType | null;
  /** Schéma vu par le client, proxy de confiance compris (`url.scheme` d'OpenTelemetry). */
  readonly scheme: SchemeType;
  /** URL complète de la requête, chaîne de requête comprise — l'abonné en tire `url.path` et `url.query`. */
  readonly url: string;
  /** Nom de la route qui a répondu, `null` sans route (statique, 404). */
  readonly route: string | null;
  /**
   * Gabarit de la route, préfixe compris (`/users/{id}`) : faible cardinalité,
   * c'est l'attribut `http.route` d'OpenTelemetry. La racine vaut `/`. `null`
   * sans route.
   */
  readonly routePath: string | null;
  /** Module qui a signé la réponse — le même que celui de la ligne d'accès. */
  readonly module: string | null;
  /**
   * Statut rendu au client : celui de l'amont pour une requête relayée, `101`
   * pour un handshake accepté, le statut du refus sinon. `null` si le client
   * est parti avant toute réponse.
   */
  readonly statusCode: number | null;
  /**
   * Durée de la requête en millisecondes, construction du contexte → dernier
   * octet remis (fin du handshake en WebSocket). `null` si `timing.enabled`
   * vaut `false`.
   */
  readonly durationMs: number | null;
  /**
   * Exception attrapée par le pipeline, `null` sinon. Un statut 4xx rendu
   * sans exception n'en porte pas ; c'est à l'abonné de classer un statut.
   */
  readonly error: unknown;
}
