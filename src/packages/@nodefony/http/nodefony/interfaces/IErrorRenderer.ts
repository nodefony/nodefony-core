/// <reference types="node" />
import type { IHttpContext, IWebsocketContext } from "./IContext";

/**
 * Result of rendering an error for an HTTP response.
 * `body` will be passed verbatim to `context.render()` (which JSON-stringifies).
 * `status` and `message` go into ServerResponse.writeHead().
 * `headers` are optional extra headers (e.g. Allow for 405, WWW-Authenticate for 401).
 */
export interface IErrorHttpResult {
  status: number;
  message: string;
  body: unknown;
  headers?: Record<string, string | number>;
}

/**
 * Result of rendering an error for a WebSocket close frame.
 * `code` MUST be a valid WS close code (1000-4999). RFC 6455 §7.4.
 * `reason` is a UTF-8 string sent in the close frame (max 123 bytes).
 */
export interface IErrorWebsocketResult {
  code: number;
  reason: string;
}

/**
 * Unified error rendering contract — HTTP + WebSocket.
 * The default implementation preserves the legacy Nodefony JSON error shape:
 *   { code, message, error: HttpError.toJSON(), nodefony: { requestId, scheme, ... }, result }
 *
 * Override via `httpKernel.setErrorRenderer(custom)` to customise:
 *   - hide stack traces in prod
 *   - emit RFC 7807 problem+json
 *   - inject auth challenge headers
 */
export interface IErrorRenderer {
  renderHttp(error: Error, context: IHttpContext): IErrorHttpResult;
  renderWebsocket(error: Error, context: IWebsocketContext): IErrorWebsocketResult;
}
