/// <reference types="node" />
import type { Severity } from "nodefony";
import type { IHttpContext, IWebsocketContext } from "./IContext";

/**
 * Result of rendering a request log entry. Returned by IRequestLogger and
 * passed verbatim to `context.log(text, severity, msgid)`.
 */
export interface IRequestLogEntry {
  text: string;
  severity: Severity;
  msgid: string;
}

/**
 * Unified per-request logger contract — HTTP + WebSocket.
 *
 * The default implementation preserves the legacy Nodefony "URL : ... FROM : ...
 * ORIGIN : ... ID : <uuid>" colored format. Swap via
 * `httpKernel.setRequestLogger(custom)` to:
 *   - emit JSON access logs (audit / P3.1)
 *   - render NCSA Common Log Format
 *   - pretty-format with one colored line per request (P3.2)
 */
export interface IRequestLogger {
  renderHttp(context: IHttpContext, error?: Error | null): IRequestLogEntry;
  renderWebsocket(
    context: IWebsocketContext,
    error?: Error | null,
    acceptedProtocol?: string | null,
  ): IRequestLogEntry;
}
