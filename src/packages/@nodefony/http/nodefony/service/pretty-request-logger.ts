/// <reference types="node" />
import type { Severity } from "nodefony";
import clc from "cli-color";
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
import { severityFromStatus } from "./audit-logger";

/**
 * Pretty single-line logger for dev (P3.2) — the biggest gain for humans.
 *
 * Format (no padding, ANSI-colored):
 *   `GET 200 /api/test 12.3ms 127.0.0.1 [a1b2c3d4]`
 *
 * - method     : cyan
 * - status     : green (2xx) / yellow (3xx) / yellow-bold (4xx) / red (5xx)
 * - url        : default
 * - duration   : dim
 * - remote     : dim
 * - requestId  : magenta-dim, truncated to first 8 chars
 *
 * Activate with `httpKernel.setRequestLogger(new PrettyRequestLogger())`.
 *
 * Stateless singleton. Allocates a few strings per request (terminal log
 * path) — zero overhead when not activated.
 */
class PrettyRequestLogger implements IRequestLogger {
  renderHttp(context: IHttpContext, error?: Error | null): IRequestLogEntry {
    const ctx = context as unknown as {
      url: string;
      remoteAddress: string | null;
      requestId: string;
      method: string | null;
      response: { statusCode?: number } | null;
      phases: PhaseTiming[];
      error?: Error | null;
    };
    const err = error ?? ctx.error ?? null;
    const status = ctx.response?.statusCode ?? (err ? 500 : null);
    const method = ctx.method ?? "?";
    const duration = computeDurationMs(ctx.phases);

    const text =
      `${clc.cyan(method.padEnd(4))} ` +
      `${colorizeStatus(status)} ` +
      `${ctx.url} ` +
      `${clc.blackBright(formatDuration(duration))} ` +
      `${clc.blackBright(ctx.remoteAddress ?? "-")} ` +
      `${clc.magenta(`[${shortId(ctx.requestId)}]`)}` +
      (err ? ` ${clc.red(err.message)}` : "");

    return {
      text,
      severity: severityFromStatus(status),
      msgid: "req",
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
      response: { statusCode?: number } | null;
      phases: PhaseTiming[];
    };
    const status = ctx.response?.statusCode ?? (error ? 500 : null);
    const duration = computeDurationMs(ctx.phases);
    const proto = acceptedProtocol ? `[${acceptedProtocol}]` : "";

    const text =
      `${clc.cyan("WS  ")} ` +
      `${colorizeStatus(status)} ` +
      `${ctx.url} ${clc.blackBright(proto)} ` +
      `${clc.blackBright(formatDuration(duration))} ` +
      `${clc.blackBright(ctx.remoteAddress ?? "-")} ` +
      `${clc.magenta(`[${shortId(ctx.requestId)}]`)}` +
      (error ? ` ${clc.red(error.message)}` : "");

    return {
      text,
      severity: error ? ("ERROR" as Severity) : ("INFO" as Severity),
      msgid: "req",
    };
  }
}

function colorizeStatus(status: number | null): string {
  if (status === null) return clc.blackBright("---");
  const s = String(status);
  if (status >= 500) return clc.red(s);
  if (status >= 400) return clc.yellow.bold(s);
  if (status >= 300) return clc.yellow(s);
  return clc.green(s);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "---";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function shortId(id: string): string {
  // First UUID block (8 chars) is enough to disambiguate visually.
  return id.length > 8 ? id.slice(0, 8) : id;
}

function computeDurationMs(phases: PhaseTiming[]): number | null {
  if (!phases.length) return null;
  const first = phases[0];
  if (typeof first.startMs !== "number") return null;
  return performance.now() - first.startMs;
}

export default PrettyRequestLogger;
