/// <reference types="node" />
import { logColor } from "nodefony";
import type {
  IRequestLogger,
  IRequestLogEntry,
} from "../interfaces/IRequestLogger";
import type {
  IContext,
  IHttpContext,
  IWebsocketContext,
} from "../interfaces/IContext";
import { severityFromStatus } from "./audit-logger";
import { handshakeRefusalStatus } from "../src/context/websocket/WebsocketContext";

/**
 * Statut de la réponse : le contrat ne type `response` qu'en `object` ; une
 * annotation (vérifiée, pas une assertion) le lit — le reste passe par le contrat, que le
 * compilateur surveille.
 */
const statusOf = (context: IContext): number | undefined => {
  const response: { statusCode?: number } | null = context.response;
  return response?.statusCode;
};

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
    const txt =
      `${logColor.cyan("URL")} : ${context.url} ` +
      `${logColor.cyan("FROM")} : ${context.remoteAddress} ` +
      `${logColor.cyan("ORIGIN")} : ${context.originUrl?.host} ` +
      `${logColor.cyan("ID")} : ${context.requestId}`;

    const err = error ?? context.error;
    if (err) {
      const errCode =
        (err as { code?: number }).code ?? statusOf(context) ?? 500;
      const msgid = `${context.serverType} ${logColor.magenta(errCode)} ${logColor.red(context.method ?? "")}`;
      // `kernel` n'est pas au contrat : projection étroite, comme `statusOf`.
      const isProd =
        (context as { kernel?: { environment?: string } }).kernel
          ?.environment === "production";
      const text = isProd ? `${txt} ${err}` : `${txt}\n          ${err}`;
      return { text, severity: "ERROR", msgid };
    }
    const msgid = `${context.serverType} ${logColor.magenta(statusOf(context) ?? "")} ${context.method}`;
    return { text: txt, severity: "INFO", msgid };
  }

  renderWebsocket(
    context: IWebsocketContext,
    error?: Error | null,
    acceptedProtocol?: string | null,
  ): IRequestLogEntry {
    // `ID` = wsId : le requestId du contexte WS, stable sur toute la durée de
    // la socket (handshake → messages → close), corrèle les logs de la même
    // connexion. Parité avec renderHttp qui expose déjà `ID : <uuid>`.
    if (error) {
      // Handshake refusé : le statut HTTP que le client reçoit (400…), pas
      // le code WS porté par l'erreur (1002…).
      const refused = handshakeRefusalStatus(context, error);
      const errCode =
        refused ??
        (error as { code?: number }).code ??
        statusOf(context) ??
        500;
      const msgid = `${context.serverType} ${logColor.magenta(errCode)} ${logColor.red(context.method ?? "")}`;
      const text =
        `${logColor.cyan("URL")} : ${context.url}  ` +
        `${logColor.cyan("FROM")} : ${context.remoteAddress} ` +
        `${logColor.cyan("ORIGIN")} : ${context.originUrl?.host} ` +
        `${logColor.cyan("ID")} : ${context.requestId}\n        ` +
        error.toString();
      return {
        text,
        severity: refused !== null ? severityFromStatus(refused) : "ERROR",
        msgid,
      };
    }
    const msgid = `${context.serverType} ${logColor.magenta(statusOf(context) ?? "")} ${context.method}`;
    const text =
      `${logColor.cyan("URL")} : ${context.url} ` +
      `${logColor.cyan("Accept-Protocol")} : ${acceptedProtocol || "*"} ` +
      `${logColor.cyan("FROM")} : ${context.remoteAddress} ` +
      `${logColor.cyan("ORIGIN")} : ${context.originUrl?.host} ` +
      `${logColor.cyan("ID")} : ${context.requestId}`;
    return { text, severity: "INFO", msgid };
  }
}

export default DefaultRequestLogger;
