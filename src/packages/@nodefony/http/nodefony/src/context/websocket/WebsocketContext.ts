import Context from "../Context.js";
import url from "node:url";
import { AsyncResource } from "node:async_hooks";
import { logColor } from "nodefony";
import { ServerType, SchemeType } from "../../../service/http-kernel.js";
import { Severity, Msgid, Message, nodefonyError, Scope } from "nodefony";
import Ws from "ws";
import type { IncomingMessage } from "node:http";
import WebsocketResponse from "./Response.js";
import type { Resolver, Route } from "@nodefony/framework";
import { URL } from "node:url";
import { HTTPMethod } from "../Context.js";
import HttpError from "../../errors/httpError.js";
import { sanitizeRequestId } from "../requestId.js";
import { ProxyType } from "../http/HttpContext.js";
import { formatWsLogContent } from "./wsLogContent.js";
import { extractClientIp } from "../trustProxy";

export interface IWsRequestExtension {
  url: URL;
  query: Record<string, string>;
  queryGet: Record<string, string>;
  path: string;
}

export type WsIncomingMessage = IncomingMessage & IWsRequestExtension;

import type { IWebsocketContext as IWebsocketContextInterface } from "../../../interfaces/IContext";

/**
 * Coerce un code (applicatif / HTTP / WS) en code de fermeture WebSocket VALIDE
 * et conforme RFC 6455 §7.4, en PRÉFÉRANT les codes standard §7.4.1 quand le
 * sens existe :
 *  - code déjà valide émissible (1000-1003, 1007-1011, 3000-4999) → conservé ;
 *  - HTTP 5xx / interne / code absent → **1011** (Internal Error) ;
 *  - HTTP 401 / 403 → **1008** (Policy Violation) ;
 *  - autre `< 1000` (ex. 404, sans équivalent RFC) → **4004**, plage privée
 *    4000-4999 (§7.4.2, « undefined by this protocol » → convention applicative).
 *
 * Évite d'émettre un code de la plage 0-999 (« not used », rejeté par `ws`) ou
 * un code réservé non émissible (1004/1005/1006/1015).
 *
 * @param code - code source (number, undefined…).
 * @returns un code de fermeture WS valide.
 */
export function toWsCloseCode(code: number | undefined | null): number {
  if (typeof code !== "number" || !Number.isInteger(code)) return 1011;
  // Codes valides émissibles tels quels : 1000, 1001-1003, 1007-1011 (RFC
  // standard), 3000-4999 (framework/privé). Exclut 1004/1005/1006/1015 et 1012+
  // (réservés non émissibles) + tout hors plage.
  if (
    code === 1000 ||
    (code >= 1001 && code <= 1003) ||
    (code >= 1007 && code <= 1011) ||
    (code >= 3000 && code <= 4999)
  ) {
    return code;
  }
  if (code >= 500 && code < 600) return 1011; // HTTP 5xx → internal error (§7.4.1)
  if (code === 401 || code === 403) return 1008; // auth/forbidden → policy violation
  if (code >= 400 && code < 500) return 4004; // autre 4xx (404…) → privé app unique
  return 1011; // inconnu / hors plage / invalide → internal error
}

/**
 * Drapeau « logger le CONTENU des messages WS » — résolu **une seule fois** au
 * premier message (kernel présent). `true` hors production : le Suivi de requête
 * (Studio) affiche alors les frames RECEIVE/SEND/BROADCAST. En prod → `false` →
 * le gate court-circuite AVANT toute allocation/concat (0 surcoût hot path).
 */
let wsContentLogging: boolean | null = null;

export default class WebsocketContext
  extends Context
  implements IWebsocketContextInterface
{
  override request: WsIncomingMessage | null;
  override response: WebsocketResponse | null = null;
  acceptedProtocol?: string;
  port: number | string;
  rejected: boolean = false;
  // BUG-003 — set once connect() has wired the close→onFinish→teardown path.
  // While false, an error aborts the request before any listener can release
  // the DI scope, so HttpKernel must clean up explicitly.
  teardownWired: boolean = false;
  connection: Ws | null = null;
  origin: string;
  proxy: ProxyType | null = null;
  wsUrl: URL | null = null;
  queryGet: Record<string, string> = {};
  queryRequest: Record<string, string> = {};
  wsPath: string = "";

  constructor(scope: Scope, req: IncomingMessage, ws: Ws, type: ServerType) {
    super(scope, type);
    this.webSocketState = "handshake";
    this.request = req as WsIncomingMessage;
    this.connection = ws;
    this.response = new WebsocketResponse(ws as Ws, this);
    this.method = this.getMethod();
    this.origin = (req.headers.origin as string) ?? "";
    // IP cliente réelle (anti-spoof) : même résolution from-right que HTTP — on
    // dépouille X-Forwarded-For derrière les proxies de confiance. Avant : socket
    // d'abord (jamais l'IP réelle derrière proxy), XFF BRUT en fallback.
    this.remoteAddress = this.getRemoteAddress();
    this.acceptedProtocol = req.headers["sec-websocket-protocol"] as
      | string
      | undefined;
    this.scheme = type === "websocket-secure" ? "wss" : "ws";

    // Zero Trust : même validation que HttpContext (réflexion + logs + ALS).
    const incomingId = sanitizeRequestId(
      req.headers["x-request-id"] as string | undefined,
    );
    if (incomingId) {
      this.requestId = incomingId;
    }
    // Parse URL from IncomingMessage
    const host = req.headers.host ?? "localhost";
    const rawUrl = req.url ?? "/";
    this.wsUrl = new URL(`${this.scheme}://${host}${rawUrl}`);
    this.queryGet = Object.fromEntries(this.wsUrl.searchParams.entries());
    this.queryRequest = { ...this.queryGet };
    this.wsPath = this.wsUrl.pathname + this.wsUrl.search;
    this.url = url.format(this.wsUrl);
    this.port =
      parseInt(this.wsUrl.port, 10) || (type === "websocket-secure" ? 443 : 80);

    // Extend request with URL object so the router can use request.url.pathname
    // Cast needed: IncomingMessage.url is string, IWsRequestExtension.url is URL → intersection string & URL
    (this.request as WsIncomingMessage).url = this.wsUrl as unknown as string &
      URL;
    (this.request as WsIncomingMessage).queryGet = this.queryGet;
    (this.request as WsIncomingMessage).query = this.queryRequest;
    (this.request as WsIncomingMessage).path = this.wsPath;

    try {
      this.originUrl = new URL(this.origin);
    } catch {
      this.originUrl = new URL(this.url);
    }

    this.parseCookies();
    // Nom effectif selon le transport (`__Host-` sur wss) — cohérent avec l'écriture.
    this.cookieSession = this.getCookieSession(this.getSessionCookieName());
    this.domain = this.getHostName() as string;
    this.validDomain = this.isValidDomain();
    this.rejected = false;

    // Métadonnées proxy (X-Forwarded-*) — UNIQUEMENT derrière un proxy de
    // confiance, symétrique au HTTP (avant : non gardé → on peuplait/loggait des
    // métadonnées forgeables depuis un client direct).
    // ⚠️ RFC 7239 §8.2 : topologie interne, JAMAIS recopiée en réponse (cf ProxyType).
    const trustedProxy = !!this.httpKernel
      ?.getTrustProxyChecker()
      .isTrusted(req.socket?.remoteAddress);
    if (trustedProxy && req.headers["x-forwarded-for"]) {
      this.proxy = {
        proxyServer: (req.headers["x-forwarded-server"] as string) ?? "unknown",
        proxyProto: req.headers["x-forwarded-proto"] as string,
        proxyPort: req.headers["x-forwarded-port"] as string,
        proxyFor: req.headers["x-forwarded-for"] as string,
        proxyHost: req.headers["x-forwarded-host"] as string,
        proxyVia: req.headers.via as string,
      };
      this.log(
        `PROXY WEBSOCKET REQUEST x-forwarded VIA : ${this.proxy?.proxyVia}`,
        "DEBUG",
      );
    }
  }

  override log(
    pci: unknown,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ) {
    if (!msgid) msgid = "WEBSOCKET CONTEXT";
    return super.log(pci, severity, msgid, msg);
  }

  override logRequest(
    httpError?: Error | HttpError | nodefonyError | null,
    acceptedProtocol?: string | null,
  ) {
    try {
      const logger = this.httpKernel?.getRequestLogger();
      if (!logger) return;
      const entry = logger.renderWebsocket(
        this as never,
        (httpError ?? null) as Error | null,
        acceptedProtocol ?? null,
      );
      const pdu = this.log(entry.text, entry.severity, entry.msgid);
      // Idem HTTP (cf Context.logRequest) : log de fin émis hors bulle ALS →
      // on attache le requestId du contexte WS (stable handshake→messages→close)
      // pour corréler la ligne récapitulative avec les logs de la connexion.
      if (pdu && pdu.requestId === undefined) pdu.requestId = this.requestId;
      return pdu;
    } catch {}
  }

  async connect(): Promise<Ws> {
    if (!this.response || !this.request || !this.connection) {
      throw new Error("Nodefony Websocket Bad request/response/connection");
    }
    if (this.rejected) {
      throw new Error("Nodefony Websocket rejected");
    }
    // ws is already connected — just wire up event handlers
    this.response.setConnection(this.connection);
    // BUG-001 — `close`/`message` fire on later event-loop ticks, outside the
    // ALS bubble opened for the handshake. AsyncResource.bind captures the
    // store at bind time (in-bubble) and restores it on every callback, so
    // RequestContext.getRequestId()/getUser() stay valid across messages.
    this.connection.on("close", AsyncResource.bind(this.onClose.bind(this)));
    // OBLIGATOIRE : un 'error' sur une socket ws SANS listener = `Unhandled
    // 'error' event` → crash process (EventEmitter Node). `ws` émet 'error' PUIS
    // 'close' → onClose fait le teardown ; ici on se contente de LOGGER (pas de
    // double-close). AsyncResource.bind : l'event fire hors bulle ALS.
    this.connection.on(
      "error",
      AsyncResource.bind(this.onConnectionError.bind(this)),
    );
    // Teardown is now wired: onClose → fire("onFinish") → leaveScope + clean.
    this.teardownWired = true;
    await this.fireAsync("onConnect", this, this.connection);
    this.requestEnded = true;
    this.connection.on(
      "message",
      AsyncResource.bind(this.handleMessage.bind(this)),
    );
    this.logRequest(null, this.acceptedProtocol ?? null);
    this.webSocketState = "connected";
    return this.connection;
  }

  async handle(data?: unknown[]): Promise<this> {
    if (this.rejected) {
      this.webSocketState = "error";
      throw new Error("Nodefony Websocket rejected");
    }
    try {
      if (!this.resolver) {
        this.resolver = this.router?.resolve(this) as Resolver;
      } else {
        try {
          this.resolver.match(this.resolver.route as Route, this);
        } catch (e) {
          if (!this.rejected) {
            this.reject(
              (e as HttpError).code ?? undefined,
              (e as HttpError).message,
            );
          }
          throw e;
        }
      }
      // Pas de `setParameters("query.*")` : les décorateurs lisent
      // `request.queryGet/query` directement (cf HttpContext) — scope DI jamais lu.
      await this.fireAsync("onRequest", this, this.resolver);
      await this.kernel?.fireAsync("onRequest", this, this.resolver);
      if (this.resolver && this.resolver.resolve) {
        this.setMetaData({
          nodefony: {
            websocket: {
              state: this.webSocketState,
              protocol: this.acceptedProtocol,
            },
          },
        });
        await this.resolver
          .callController(data)
          .then(async () => {
            await this.saveSession()
              .then((session) => {
                if (session) {
                  this.log(`SAVE SESSION ID : ${session.id}`, "DEBUG");
                }
              })
              .catch((e) => {
                throw e;
              });
            return this;
          })
          .catch((error: unknown) => {
            if (!this.rejected) {
              if (this.requestEnded) {
                // close() coerce le code via `toWsCloseCode` (RFC 6455 §7.4) :
                // 5xx/absent → 1011, 401/403 → 1008, 404/autre → 4004.
                throw this.close(
                  (error as HttpError).code,
                  (error as HttpError).message,
                );
              }
              this.reject(
                (error as HttpError).code ?? undefined,
                (error as HttpError).message,
              );
              this.rejected = true;
              this.webSocketState = "error";
              throw error;
            }
          });
      } else if (!this.rejected) {
        this.reject(4004, "Not Found");
        this.rejected = true;
        this.webSocketState = "error";
      }
    } catch (e) {
      throw e;
    }
    return this;
  }

  async render(chunk: unknown, encoding?: BufferEncoding) {
    let data = chunk;
    if (this.isJson) {
      data = JSON.stringify(chunk);
    }
    return this.send(data as string | Buffer, encoding);
  }

  async send(data?: string | Buffer | null, encoding?: BufferEncoding) {
    if (this.response) {
      const payload = data ?? this.response.body;
      this.logMessageContent("SEND", payload);
      this.fire("onMessage", payload, this, "SEND");
      this.fire("onSend", payload, this);
      return this.response.send(payload as string | Buffer | null, encoding);
    }
    throw new Error("No response found");
  }

  broadcast(data?: string | Buffer | null, encoding?: BufferEncoding) {
    if (this.response) {
      const payload = data ?? this.response.body;
      if (payload) {
        this.logMessageContent("BROADCAST", payload);
        this.fire("onMessage", payload, this, "BROADCAST");
        this.fire("onBroadcast", payload, this);
        return this.response.broadcast(
          payload as string | Buffer | null,
          encoding,
        );
      }
    }
    return null;
  }

  /**
   * Logge le CONTENU d'un message WS (corrélé `requestId` via l'override `log`),
   * gaté hors prod et borné — le Suivi de requête (Studio) le surface alors par
   * direction. Hot path : le gate booléen court-circuite en prod AVANT toute
   * construction de chaîne (0 allocation / 0 concat).
   *
   * @param dir - sens du message du point de vue serveur.
   * @param data - charge utile (string, Buffer binaire, objet, ou null).
   */
  private logMessageContent(
    dir: "RECEIVE" | "SEND" | "BROADCAST",
    data: unknown,
  ): void {
    if (wsContentLogging === null) {
      const env = this.kernel?.environment;
      wsContentLogging = env !== "production" && env !== "prod";
    }
    if (!wsContentLogging) return;
    this.log(formatWsLogContent(data), "DEBUG", `WS ${dir}`);
  }

  async handleMessage(data: Buffer | string, isBinary: boolean) {
    this.webSocketState = "message";
    const message = isBinary ? data : data.toString();
    this.logMessageContent("RECEIVE", message);
    if (this.response) {
      this.response.body = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data.toString());
    }
    try {
      if (!this.resolver) {
        this.resolver = this.router?.resolve(this) as Resolver;
      } else {
        try {
          this.resolver.match(this.resolver?.route as Route, this);
        } catch (e) {
          throw e;
        }
      }
      await this.fireAsync("onMessage", message, this, "RECEIVE");
      if (this.resolver.resolve) {
        this.setMetaData({
          nodefony: {
            websocket: {
              state: this.webSocketState,
              protocol: this.acceptedProtocol,
            },
          },
        });
        return this.resolver.callController([message]).catch((e: unknown) => {
          throw e;
        });
      } else if (!this.rejected) {
        this.reject(4004, "Not Found");
        this.rejected = true;
      }
    } catch (e) {
      // 1011 "Internal Error" = code RFC 6455 §7.4.1 dédié (serveur, condition
      // inattendue) — préféré à un code privé 4xxx pour un échec interne.
      this.reject(1011, "Internal Error");
      throw e;
    }
  }

  onClose(code: number, reason: Buffer) {
    const description = reason.toString();
    this.log(
      `${logColor.cyan("URL")} : ${this.url}  ${logColor.cyan("FROM")} : ${this.remoteAddress} ${logColor.cyan("ORIGIN")} : ${this.originUrl?.host} ${logColor.cyan("ID")} : ${this.requestId} ${logColor.cyan("Description")} : ${description}`,
      "INFO",
      `${this.type} ${logColor.magenta(code)} CLOSE ${this.method}`,
    );
    if (this.connection?.readyState !== Ws.CLOSED) {
      try {
        this.response?.drop(code, description);
      } catch (e) {
        this.log(
          `${logColor.cyan("URL")} : ${this.url}  ${logColor.cyan("FROM")} : ${this.remoteAddress} ${logColor.cyan("ORIGIN")} : ${this.originUrl?.host} ${logColor.cyan("ID")} : ${this.requestId} ${logColor.cyan("error")} : ${(e as Error).message}`,
          "ERROR",
          `${this.type} CLOSE ${logColor.red(this.method ?? "")}`,
        );
      }
      this.fire("onClose", code, description, this.connection);
    } else {
      this.fire("onClose", code, description, this.connection);
    }
    this.fire("onFinish", this, code, description);
    this.webSocketState = "closed";
  }

  /**
   * Listener `error` de la socket ws (OBLIGATOIRE — sans lui, un 'error' émis
   * sans listener crashe le process via EventEmitter). `ws` émet 'error' PUIS
   * 'close' → le teardown se fait dans {@link onClose} ; ici on logge seulement
   * (pas de double-close). Erreur transport (reset TCP, frame corrompue…).
   *
   * @param error - erreur émise par la socket.
   */
  onConnectionError(error: Error): void {
    this.webSocketState = "error";
    this.log(
      `${logColor.cyan("URL")} : ${this.url}  ${logColor.cyan("FROM")} : ${this.remoteAddress} ${logColor.cyan("ID")} : ${this.requestId} ${logColor.cyan("error")} : ${error?.message}`,
      "ERROR",
      `${this.type} ${logColor.red("SOCKET ERROR")} ${this.method}`,
    );
    this.fire("onError", error, this);
  }

  override setScheme(): SchemeType {
    return this.wsUrl?.protocol.replace(":", "") as SchemeType;
  }

  getRemoteAddress(): string | null {
    // Cf extractClientIp : derrière un proxy de confiance, l'IP réelle est
    // résolue from-right depuis X-Forwarded-For ; sinon = socket.
    const checker = this.httpKernel?.getTrustProxyChecker();
    const socketAddr = this.request?.socket?.remoteAddress;
    if (!checker) {
      return socketAddr ?? null;
    }
    return extractClientIp(
      this.request?.headers["x-forwarded-for"],
      socketAddr,
      checker,
    );
  }

  getHost(): string | undefined {
    return this.request?.headers.host;
  }

  getHostName() {
    return this.wsUrl?.hostname;
  }

  getUserAgent(): string {
    return this.request?.headers["user-agent"] as string;
  }

  getMethod(): HTTPMethod {
    return "WEBSOCKET";
  }

  override setContextJson(): void {
    this.isJson = true;
  }

  override clean() {
    this.request = null;
    if (this.response) {
      this.response.clean();
    }
    this.response = null;
    this.connection = null;
    this.container?.clean();
    super.clean();
  }

  close(reasonCode: number | undefined | null, description: string) {
    if (this.response) {
      // Coercition RFC 6455 §7.4 — protège contre un code invalide (0-999) ou
      // réservé non émissible. Un code déjà valide (1002, 4004…) est conservé.
      return this.response.close(toWsCloseCode(reasonCode), description);
    }
  }

  drop(reasonCode: number, description: string) {
    if (this.response) {
      return this.response.drop(reasonCode, description);
    }
  }

  reject(code: number | string | undefined, message?: string) {
    if (this.connection && (this.connection as Ws).readyState === Ws.OPEN) {
      const raw = typeof code === "string" ? parseInt(code, 10) : code;
      // Coercition RFC 6455 §7.4 (cf `toWsCloseCode`) : codes standard préférés,
      // jamais de code 0-999 ni de 4xxx inventé.
      this.connection.close(toWsCloseCode(raw), message ?? "Rejected");
    }
    this.rejected = true;
  }
}
