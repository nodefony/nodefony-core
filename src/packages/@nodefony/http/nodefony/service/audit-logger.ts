/// <reference types="node" />
import type { Severity } from "nodefony";
import { RequestContext } from "nodefony";
import { performance } from "node:perf_hooks";
import type {
  IRequestLogger,
  IRequestLogEntry,
} from "../interfaces/IRequestLogger";
import type {
  IHttpContext,
  IWebsocketContext,
  PhaseTiming,
} from "../interfaces/IContext";

/**
 * Canonical audit log entry — 1 JSON PDU per request (P3.1).
 *
 * Fed to `context.log()` as a stringified JSON payload. Ingest pipelines
 * (Vision, Loki, ELK, OpenTelemetry...) can parse it directly without
 * regex on a colored line.
 *
 * Includes P3.3 (severity per HTTP status) for free and exposes phase
 * timings (P1.1) for downstream trace tools (P3.7).
 *
 * Header redaction (P3.4) — Authorization / Cookie / Set-Cookie are
 * never serialised here. We log presence-only flags instead.
 */
export interface AuditLogEntry {
  ts: string;
  requestId: string;
  userId: string | null;
  type: "http" | "ws";
  scheme: string;
  method: string | null;
  url: string;
  status: number | null;
  durationMs: number | null;
  remoteAddress: string | null;
  host: string | null;
  userAgent: string | null;
  // Presence-only flags (no values) to honor P3.4 redaction.
  hasAuthorization: boolean;
  hasCookie: boolean;
  phases?: { name: string; durationMs: number | null }[];
  error?: { name: string; message: string; code?: number };
  // WS-specific
  protocol?: string | null;
}

/**
 * Severity derived from HTTP status code — RFC 9110 categories.
 * 1xx/2xx/3xx → INFO ; 4xx → WARNING ; 5xx → ERROR.
 * Unknown/missing status → INFO.
 */
function severityFromStatus(status: number | null | undefined): Severity {
  if (!status) return "INFO" as Severity;
  if (status >= 500) return "ERROR" as Severity;
  if (status >= 400) return "WARNING" as Severity;
  return "INFO" as Severity;
}

/**
 * JSON audit logger — implements IRequestLogger so it slots into
 * `httpKernel.setRequestLogger(new JsonAuditLogger())`.
 *
 * Stateless singleton. Allocates one plain object + one JSON.stringify per
 * request — acceptable since this is the terminal log path (1 per req).
 */
class JsonAuditLogger implements IRequestLogger {
  renderHttp(context: IHttpContext, error?: Error | null): IRequestLogEntry {
    const ctx = context as unknown as {
      url: string;
      remoteAddress: string | null;
      requestId: string;
      method: string | null;
      type: string;
      scheme: string;
      response: { statusCode?: number } | null;
      request: { headers?: Record<string, string | string[] | undefined> } | null;
      error?: Error | null;
      phases: PhaseTiming[];
      getHost?: () => string | undefined;
      getUserAgent?: () => string | undefined;
    };
    const status = ctx.response?.statusCode ?? null;
    const headers = ctx.request?.headers ?? {};
    const err = error ?? ctx.error ?? null;
    const entry: AuditLogEntry = {
      ts: new Date().toISOString(),
      requestId: ctx.requestId,
      userId: RequestContext.getUserId() ?? null,
      type: "http",
      scheme: ctx.scheme,
      method: ctx.method,
      url: ctx.url,
      status,
      durationMs: this.computeDurationMs(ctx.phases),
      remoteAddress: ctx.remoteAddress ?? null,
      host: ctx.getHost?.() ?? null,
      userAgent: ctx.getUserAgent?.() ?? null,
      hasAuthorization: Boolean(headers["authorization"]),
      hasCookie: Boolean(headers["cookie"]),
      phases: ctx.phases.length
        ? ctx.phases.map((p) => ({
            name: p.name,
            durationMs: p.durationMs ?? null,
          }))
        : undefined,
      error: err
        ? {
            name: err.name,
            message: err.message,
            code: (err as { code?: number }).code,
          }
        : undefined,
    };
    return {
      text: JSON.stringify(entry),
      severity: severityFromStatus(status ?? (err ? 500 : null)),
      msgid: "audit",
    };
  }

  renderWebsocket(
    context: IWebsocketContext,
    error?: Error | null,
    acceptedProtocol?: string | null,
  ): IRequestLogEntry {
    const ctx = context as unknown as {
      url: string;
      remoteAddress: string | null;
      requestId: string;
      method: string | null;
      scheme: string;
      response: { statusCode?: number } | null;
      request: { headers?: Record<string, string | string[] | undefined> } | null;
      phases: PhaseTiming[];
      getHost?: () => string | undefined;
      getUserAgent?: () => string | undefined;
    };
    const status = ctx.response?.statusCode ?? null;
    const headers = ctx.request?.headers ?? {};
    const entry: AuditLogEntry = {
      ts: new Date().toISOString(),
      requestId: ctx.requestId,
      userId: RequestContext.getUserId() ?? null,
      type: "ws",
      scheme: ctx.scheme,
      method: ctx.method,
      url: ctx.url,
      status,
      durationMs: this.computeDurationMs(ctx.phases),
      remoteAddress: ctx.remoteAddress ?? null,
      host: ctx.getHost?.() ?? null,
      userAgent: ctx.getUserAgent?.() ?? null,
      hasAuthorization: Boolean(headers["authorization"]),
      hasCookie: Boolean(headers["cookie"]),
      phases: ctx.phases.length
        ? ctx.phases.map((p) => ({
            name: p.name,
            durationMs: p.durationMs ?? null,
          }))
        : undefined,
      protocol: acceptedProtocol ?? null,
      error: error
        ? {
            name: error.name,
            message: error.message,
            code: (error as { code?: number }).code,
          }
        : undefined,
    };
    return {
      text: JSON.stringify(entry),
      severity: error ? ("ERROR" as Severity) : ("INFO" as Severity),
      msgid: "audit",
    };
  }

  /**
   * Total request duration computed from the first phase startMs to now.
   * Returns null if timing is disabled (no phases recorded).
   */
  private computeDurationMs(phases: PhaseTiming[]): number | null {
    if (!phases.length) return null;
    const first = phases[0];
    if (typeof first.startMs !== "number") return null;
    return performance.now() - first.startMs;
  }
}

export default JsonAuditLogger;
export { severityFromStatus };
