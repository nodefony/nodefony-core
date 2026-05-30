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
  error?: AuditErrorEntry;
  // WS-specific
  protocol?: string | null;
}

/**
 * Enriched error description for audit logs (P3.5).
 * Includes optional cause chain (Error.cause) and stack (dev only).
 */
export interface AuditErrorEntry {
  name: string;
  message: string;
  code?: number;
  /** nodefonyError's domain classifier when available (P1.5 / Phase 1). */
  errorType?: string;
  /** Multi-line stack — dev/development only, omitted in prod for safety. */
  stack?: string;
  /** Recursive — capped to depth 5 to avoid pathological cycles. */
  cause?: AuditErrorEntry;
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

export interface JsonAuditLoggerOptions {
  /**
   * Whether to include `error.stack` and recursive `error.cause.stack`.
   * Default `process.env.NODE_ENV !== "production"` — auto-hidden in prod.
   * Override explicitly for stricter security or to enable in staging.
   */
  includeStack?: boolean;
  /**
   * Max depth for `Error.cause` chain serialisation.
   * Default `5`. Prevents pathological cycles and oversized log entries.
   */
  maxCauseDepth?: number;
  /**
   * Sampling rate for nominal (2xx/3xx) audit logs — perf lever on the hot
   * path (L3). `1` (default) logs every request. `N > 1` logs only 1 in N of
   * the 2xx/3xx requests, **but always logs `status >= 400` and errored
   * requests** (you never lose a failure). Counted with a deterministic
   * counter — no RNG (consistent with the L2 entropy amortisation).
   *
   * Skipped requests never reach `renderHttp`, so they cost **zero** object
   * allocation and zero `JSON.stringify`. Configure via
   * `kernel.options.log.requestLogger.sampleRate`.
   */
  sampleRate?: number;
}

/**
 * JSON audit logger — implements IRequestLogger so it slots into
 * `httpKernel.setRequestLogger(new JsonAuditLogger())`.
 *
 * Stateless singleton. Allocates one plain object + one JSON.stringify per
 * request — acceptable since this is the terminal log path (1 per req).
 */
class JsonAuditLogger implements IRequestLogger {
  private readonly includeStack: boolean;
  private readonly maxCauseDepth: number;
  /** Sampling divisor for 2xx/3xx logs (`1` = log all). Always ≥ 1. */
  private readonly sampleRate: number;
  /** Deterministic 0-based counter for `1/sampleRate` selection (no RNG). */
  private sampleCounter = 0;

  constructor(opts: JsonAuditLoggerOptions = {}) {
    this.includeStack =
      opts.includeStack ?? process.env.NODE_ENV !== "production";
    this.maxCauseDepth = opts.maxCauseDepth ?? 5;
    const rate = opts.sampleRate ?? 1;
    // Guard: a rate < 1 (or NaN) would disable logging — clamp to 1 (log all).
    this.sampleRate = Number.isFinite(rate) && rate >= 1 ? Math.floor(rate) : 1;
  }

  /**
   * Decide whether the current HTTP request must be logged (audit sampling).
   *
   * Always `true` when `sampleRate <= 1`, on errors, and for `status >= 400`
   * (failures are never sampled out). Otherwise selects 1 in `sampleRate` of
   * the 2xx/3xx requests with a deterministic counter.
   *
   * Called by `Context.logRequest()` **before** `renderHttp`, so a sampled-out
   * request allocates nothing and runs no `JSON.stringify`.
   *
   * @param context - the HTTP context being finalised
   * @param error - error captured for this request, if any
   * @returns `true` to render+log the entry, `false` to skip it
   */
  shouldSample(context: IHttpContext, error?: Error | null): boolean {
    if (this.sampleRate <= 1) return true;
    const ctx = context as unknown as {
      response: { statusCode?: number } | null;
      error?: Error | null;
    };
    if (error ?? ctx.error) return true;
    const status = ctx.response?.statusCode ?? null;
    if (status !== null && status >= 400) return true;
    // 2xx/3xx nominal path → keep 1 every `sampleRate` (deterministic).
    this.sampleCounter = (this.sampleCounter + 1) % this.sampleRate;
    return this.sampleCounter === 0;
  }

  renderHttp(context: IHttpContext, error?: Error | null): IRequestLogEntry {
    const ctx = context as unknown as {
      url: string;
      remoteAddress: string | null;
      requestId: string;
      method: string | null;
      type: string;
      scheme: string;
      response: { statusCode?: number } | null;
      request: {
        headers?: Record<string, string | string[] | undefined>;
      } | null;
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
      error: err ? this.serializeError(err, 0) : undefined,
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
      request: {
        headers?: Record<string, string | string[] | undefined>;
      } | null;
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
      error: error ? this.serializeError(error, 0) : undefined,
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

  /**
   * Serialise an Error (recursively for `cause` chain) into an AuditErrorEntry.
   * Stack is included only when `includeStack === true` (dev default).
   * Cause chain is capped at `maxCauseDepth`.
   */
  private serializeError(err: unknown, depth: number): AuditErrorEntry {
    const e = err as {
      name?: string;
      message?: string;
      code?: number;
      errorType?: string;
      stack?: string;
      cause?: unknown;
    };
    const entry: AuditErrorEntry = {
      name: e.name ?? "Error",
      message: e.message ?? String(err),
    };
    if (typeof e.code === "number") entry.code = e.code;
    if (typeof e.errorType === "string") entry.errorType = e.errorType;
    if (this.includeStack && typeof e.stack === "string") entry.stack = e.stack;
    if (e.cause && depth + 1 < this.maxCauseDepth) {
      entry.cause = this.serializeError(e.cause, depth + 1);
    }
    return entry;
  }
}

export default JsonAuditLogger;
export { severityFromStatus };
