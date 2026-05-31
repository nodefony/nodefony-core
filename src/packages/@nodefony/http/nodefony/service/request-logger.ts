/// <reference types="node" />
import type { Severity } from "nodefony";
import { logColor } from "nodefony";
import type {
  IRequestLogger,
  IRequestLogEntry,
} from "../interfaces/IRequestLogger";
import type { IHttpContext, IWebsocketContext } from "../interfaces/IContext";

/**
 * Default Nodefony per-request logger — preserves the legacy colored format.
 *
 * HTTP success: `URL : <url> FROM : <remote> ORIGIN : <host> ID : <uuid>`
 * HTTP error:   adds the error toString (in dev), single-line in prod
 * WebSocket:    adds `Accept-Protocol : <proto>` on success
 *
 * Stateless singleton — zero per-request allocation. Override via
 * `httpKernel.setRequestLogger(custom)` for JSON access logs (P3.1),
 * pretty formatter (P3.2), or NCSA combined format (P3.10).
 */
class DefaultRequestLogger implements IRequestLogger {
  renderHttp(context: IHttpContext, error?: Error | null): IRequestLogEntry {
    const ctx = context as unknown as {
      url: string;
      remoteAddress: string | null;
      originUrl: { host?: string } | null | undefined;
      requestId: string;
      method: string | null;
      type: string;
      response: { statusCode?: number } | null;
      kernel?: { environment?: string };
      error?: unknown;
    };
    const txt =
      `${logColor.cyan("URL")} : ${ctx.url} ` +
      `${logColor.cyan("FROM")} : ${ctx.remoteAddress} ` +
      `${logColor.cyan("ORIGIN")} : ${ctx.originUrl?.host} ` +
      `${logColor.cyan("ID")} : ${ctx.requestId}`;

    const err = error ?? (ctx.error as Error | null | undefined);
    if (err) {
      const errCode =
        (err as { code?: number }).code ?? ctx.response?.statusCode ?? 500;
      const msgid = `${ctx.type} ${logColor.magenta(errCode)} ${logColor.red(ctx.method ?? "")}`;
      const isProd = ctx.kernel?.environment === "prod";
      const text = isProd ? `${txt} ${err}` : `${txt}\n          ${err}`;
      return { text, severity: "ERROR" as Severity, msgid };
    }
    const msgid = `${ctx.type} ${logColor.magenta(ctx.response?.statusCode ?? "")} ${ctx.method}`;
    return { text: txt, severity: "INFO" as Severity, msgid };
  }

  renderWebsocket(
    context: IWebsocketContext,
    error?: Error | null,
    acceptedProtocol?: string | null,
  ): IRequestLogEntry {
    const ctx = context as unknown as {
      url: string;
      remoteAddress: string | null;
      originUrl: { host?: string } | null | undefined;
      requestId: string;
      method: string | null;
      type: string;
      response: { statusCode?: number } | null;
    };
    // `ID` = wsId : le requestId du contexte WS, stable sur toute la durée de
    // la socket (handshake → messages → close), corrèle les logs de la même
    // connexion. Parité avec renderHttp qui expose déjà `ID : <uuid>`.
    if (error) {
      const errCode =
        (error as { code?: number }).code ?? ctx.response?.statusCode ?? 500;
      const msgid = `${ctx.type} ${logColor.magenta(errCode)} ${logColor.red(ctx.method ?? "")}`;
      const text =
        `${logColor.cyan("URL")} : ${ctx.url}  ` +
        `${logColor.cyan("FROM")} : ${ctx.remoteAddress} ` +
        `${logColor.cyan("ORIGIN")} : ${ctx.originUrl?.host} ` +
        `${logColor.cyan("ID")} : ${ctx.requestId}\n        ` +
        error.toString();
      return { text, severity: "ERROR" as Severity, msgid };
    }
    const msgid = `${ctx.type} ${logColor.magenta(ctx.response?.statusCode ?? "")} ${ctx.method}`;
    const text =
      `${logColor.cyan("URL")} : ${ctx.url} ` +
      `${logColor.cyan("Accept-Protocol")} : ${acceptedProtocol || "*"} ` +
      `${logColor.cyan("FROM")} : ${ctx.remoteAddress} ` +
      `${logColor.cyan("ORIGIN")} : ${ctx.originUrl?.host} ` +
      `${logColor.cyan("ID")} : ${ctx.requestId}`;
    return { text, severity: "INFO" as Severity, msgid };
  }
}

export default DefaultRequestLogger;
