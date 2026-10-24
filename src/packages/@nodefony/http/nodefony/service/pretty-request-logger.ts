/// <reference types="node" />
import { accessStatusFamily, logColor } from "nodefony";
import type {
  IRequestLogger,
  IRequestLogEntry,
} from "../interfaces/IRequestLogger";
import type {
  IHttpContext,
  IWebsocketContext,
  PhaseTiming,
} from "../interfaces/IContext";
import { computeDurationMs, severityFromStatus } from "./audit-logger";
import { handshakeRefusalStatus } from "../src/context/websocket/WebsocketContext";

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
      `${logColor.cyan(method.padEnd(4))} ` +
      `${colorizeStatus(status)} ` +
      `${ctx.url} ` +
      `${logColor.blackBright(formatDuration(duration))} ` +
      `${logColor.blackBright(ctx.remoteAddress ?? "-")} ` +
      logColor.magenta(`[${shortId(ctx.requestId)}]`) +
      (err ? ` ${logColor.red(err.message)}` : "");

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
    // Handshake refusé : le statut HTTP que le client reçoit, pas le code de
    // fermeture par défaut. Une connexion saine ne paie que ce test.
    const refused = error ? handshakeRefusalStatus(context, error) : null;
    const status = refused ?? ctx.response?.statusCode ?? (error ? 500 : null);
    const duration = computeDurationMs(ctx.phases);
    const proto = acceptedProtocol ? `[${acceptedProtocol}]` : "";

    const text =
      `${logColor.cyan("WS  ")} ` +
      `${colorizeStatus(status)} ` +
      `${ctx.url} ${logColor.blackBright(proto)} ` +
      `${logColor.blackBright(formatDuration(duration))} ` +
      `${logColor.blackBright(ctx.remoteAddress ?? "-")} ` +
      logColor.magenta(`[${shortId(ctx.requestId)}]`) +
      (error ? ` ${logColor.red(error.message)}` : "");

    return {
      text,
      // Refus : la règle du HTTP (4xx → WARNING, faute du client).
      severity:
        refused !== null
          ? severityFromStatus(refused)
          : error
            ? "ERROR"
            : "INFO",
      msgid: "req",
    };
  }
}

// Famille par la règle du cœur : le `1000` d'une connexion WS saine est vert.
function colorizeStatus(status: number | null): string {
  const family = accessStatusFamily(status);
  if (status === null || family === null) return logColor.blackBright("---");
  const s = String(status);
  if (family >= 5) return logColor.red(s);
  if (family === 4) return logColor.yellowBold(s);
  if (family === 3) return logColor.yellow(s);
  return logColor.green(s);
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

export default PrettyRequestLogger;
