import Context from "../Context.js";
import url from "node:url";
import clc from "cli-color";
import {
  ServerType,
  SchemeType,
} from "../../../service/http-kernel.js";
import {
  Severity,
  Msgid,
  Message,
  nodefonyError,
  Scope,
} from "nodefony";
import { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import WebsocketResponse from "./Response.js";
import { Resolver, Route } from "@nodefony/framework";
import { URL } from "node:url";
import { HTTPMethod } from "../Context.js";
import HttpError from "../../errors/httpError.js";
import { ProxyType } from "../http/HttpContext.js";

export interface IWsRequestExtension {
  url: URL;
  query: Record<string, string>;
  queryGet: Record<string, string>;
  path: string;
}

export default class WebsocketContext extends Context {
  override request: IncomingMessage | null;
  override response: WebsocketResponse | null = null;
  acceptedProtocol?: string;
  port: number | string;
  rejected: boolean = false;
  connection: WebSocket | null = null;
  origin: string;
  proxy: ProxyType | null = null;
  wsUrl: URL | null = null;
  queryGet: Record<string, string> = {};
  queryRequest: Record<string, string> = {};
  wsPath: string = "";

  constructor(scope: Scope, req: IncomingMessage, ws: WebSocket, type: ServerType) {
    super(scope, type);
    this.webSocketState = "handshake";
    this.request = req;
    this.connection = ws;
    this.response = new WebsocketResponse(ws, this);
    this.method = this.getMethod();
    this.origin = (req.headers.origin as string) ?? "";
    this.remoteAddress = req.socket?.remoteAddress ?? req.headers["x-forwarded-for"] as string;
    this.acceptedProtocol = req.headers["sec-websocket-protocol"] as string | undefined;
    this.scheme = type === "websocket-secure" ? "wss" : "ws";

    // Parse URL from IncomingMessage
    const host = req.headers.host ?? "localhost";
    const rawUrl = req.url ?? "/";
    this.wsUrl = new URL(`${this.scheme}://${host}${rawUrl}`);
    this.queryGet = Object.fromEntries(this.wsUrl.searchParams.entries());
    this.queryRequest = { ...this.queryGet };
    this.wsPath = this.wsUrl.pathname + this.wsUrl.search;
    this.url = url.format(this.wsUrl);
    this.port = parseInt(this.wsUrl.port, 10) || (type === "websocket-secure" ? 443 : 80);

    try {
      this.originUrl = new URL(this.origin);
    } catch {
      this.originUrl = new URL(this.url);
    }

    this.parseCookies();
    this.cookieSession = this.getCookieSession(
      this.sessionService?.options.name
    );
    this.domain = this.getHostName() as string;
    this.validDomain = this.isValidDomain();
    this.rejected = false;

    // Proxy detection
    if (req.headers["x-forwarded-for"]) {
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
        "DEBUG"
      );
    }
  }

  override log(pci: unknown, severity?: Severity, msgid?: Msgid, msg?: Message) {
    if (!msgid) msgid = "WEBSOCKET CONTEXT";
    return super.log(pci, severity, msgid, msg);
  }

  override logRequest(
    httpError?: Error | HttpError | nodefonyError | null,
    acceptedProtocol?: string | null
  ) {
    if (httpError) {
      return this.log(
        `${clc.cyan("URL")} : ${this.url}  ${clc.cyan("FROM")} : ${this.remoteAddress} ${clc.cyan("ORIGIN")} : ${this.originUrl?.host}
        ${httpError.toString()}`,
        "ERROR",
        `${this.type} ${clc.magenta((httpError as HttpError).code || this.response?.statusCode)} ${clc.red(this.method)}`
      );
    }
    return this.log(
      `${clc.cyan("URL")} : ${this.url} ${clc.cyan("Accept-Protocol")} : ${acceptedProtocol || "*"} ${clc.cyan("FROM")} : ${this.remoteAddress} ${clc.cyan("ORIGIN")} : ${this.originUrl?.host}`,
      "INFO",
      `${this.type} ${clc.magenta(this.response?.statusCode)} ${this.method}`
    );
  }

  async connect(): Promise<WebSocket> {
    if (!this.response || !this.request || !this.connection) {
      throw new Error("Nodefony Websocket Bad request/response/connection");
    }
    if (this.rejected) {
      throw new Error("Nodefony Websocket rejected");
    }
    // ws is already connected — just wire up event handlers
    this.response.setConnection(this.connection);
    this.connection.on("close", this.onClose.bind(this));
    await this.fireAsync("onConnect", this, this.connection);
    this.requestEnded = true;
    this.connection.on("message", this.handleMessage.bind(this));
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
            this.reject((e as HttpError).code, (e as HttpError).message);
          }
          throw e;
        }
      }
      this.setParameters("query.get", this.queryGet);
      this.setParameters("query.request", this.queryRequest);
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
              .catch((e) => { throw e; });
            return this;
          })
          .catch((error) => {
            if (!this.rejected) {
              if (this.requestEnded) {
                if ((error as HttpError).code) {
                  throw this.close(
                    parseInt((error as HttpError).code as string, 10) + 3000,
                    (error as HttpError).message
                  );
                }
                throw this.close(500, (error as HttpError).message);
              }
              this.reject((error as HttpError).code, (error as HttpError).message);
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
        this.fire("onMessage", payload, this, "BROADCAST");
        this.fire("onBroadcast", payload, this);
        return this.response.broadcast(payload as string | Buffer | null, encoding);
      }
    }
    return null;
  }

  async handleMessage(data: Buffer | string, isBinary: boolean) {
    this.webSocketState = "message";
    const message = isBinary ? data : data.toString();
    if (this.response) {
      this.response.body = Buffer.isBuffer(data) ? data : Buffer.from(data.toString());
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
        return this.resolver.callController([message]).catch((e) => {
          throw e;
        });
      } else if (!this.rejected) {
        this.reject(4004, "Not Found");
        this.rejected = true;
      }
    } catch (e) {
      this.reject(4500, "Internal Error");
      throw e;
    }
  }

  onClose(code: number, reason: Buffer) {
    const description = reason.toString();
    this.log(
      `${clc.cyan("URL")} : ${this.url}  ${clc.cyan("FROM")} : ${this.remoteAddress} ${clc.cyan("ORIGIN")} : ${this.originUrl?.host} ${clc.cyan("Description")} : ${description}`,
      "INFO",
      `${this.type} ${clc.magenta(code)} CLOSE ${this.method}`
    );
    if (this.connection?.readyState !== WebSocket.CLOSED) {
      try {
        this.response?.drop(code, description);
      } catch (e) {
        this.log(
          `${clc.cyan("URL")} : ${this.url}  ${clc.cyan("FROM")} : ${this.remoteAddress} ${clc.cyan("ORIGIN")} : ${this.originUrl?.host} ${clc.cyan("error")} : ${(e as Error).message}`,
          "ERROR",
          `${this.type} CLOSE ${clc.red(this.method)}`
        );
      }
      this.fire("onClose", code, description, this.connection);
    } else {
      this.fire("onClose", code, description, this.connection);
    }
    this.fire("onFinish", this, code, description);
    this.webSocketState = "closed";
  }

  override setScheme(): SchemeType {
    return this.wsUrl?.protocol.replace(":", "") as SchemeType;
  }

  getRemoteAddress(): string | undefined {
    return this.request?.socket?.remoteAddress;
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

  close(reasonCode: number, description: string) {
    if (this.response) {
      return this.response.close(reasonCode, description);
    }
  }

  drop(reasonCode: number, description: string) {
    if (this.response) {
      return this.response.drop(reasonCode, description);
    }
  }

  reject(code: number | string | undefined, message?: string) {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      const numCode = typeof code === "string" ? parseInt(code, 10) : (code ?? 4000);
      this.connection.close(numCode, message ?? "Rejected");
    }
    this.rejected = true;
  }
}
