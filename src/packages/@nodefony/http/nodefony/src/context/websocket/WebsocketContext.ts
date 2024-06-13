import Context, { contextRequest, contextResponse, Cookies } from "../Context";
import url from "node:url";
import clc from "cli-color";
import QueryString from "qs";
import {
  ServerType,
  httpRequest,
  httpResponse,
  SchemeType,
} from "../../../service/http-kernel";
import {
  Syslog,
  Container,
  Service,
  Severity,
  Msgid,
  Message,
  Pdu,
  KernelEventsType,
  nodefonyError,
  Scope,
  Kernel,
} from "nodefony";
import websocket from "websocket";
//import { IncomingHttpHeaders } from "node:http";
import websocketResponse from "./Response";
import { Resolver, Route, Router } from "@nodefony/framework";
import Cookie from "../../cookies/cookie";
import { URL } from "node:url";
import { HTTPMethod } from "../Context";
import HttpError from "../../errors/httpError";
import { ProxyType } from "../http/HttpContext";

declare module "websocket" {
  interface request {
    //cookies: Cookies;
    url: URL;
    query: Record<string, any>;
    queryGet: Record<string, any>;
    path: string;
  }
}

export default class WebsocketContext extends Context {
  request: websocket.request | null;
  response: websocketResponse | null = null;
  cookies: Cookies = {};
  acceptedProtocol?: string;
  isJson: boolean = true;
  port: number | string;
  rejected: boolean = false;
  connection: websocket.connection | null = null;
  origin: string;
  method: HTTPMethod;
  proxy: ProxyType | null = null;
  constructor(scope: Scope, request: websocket.request, type: ServerType) {
    super(scope, type);
    this.webSocketState = "handshake";
    this.request = request;
    this.response = new websocketResponse(null, this);
    this.method = this.getMethod();
    this.origin = this.request.origin;
    this.remoteAddress = this.getRemoteAddress();
    this.acceptedProtocol =
      request.httpRequest.headers["sec-websocket-protocol"] || undefined;
    this.scheme = type === "websocket-secure" ? "wss" : "ws";
    this.request.url = new URL(`${this.scheme}://${this.request.host}`);
    if (this.request.resourceURL.search) {
      this.request.url.search = this.request.resourceURL.search as string;
    }
    if (this.request.resourceURL.pathname) {
      this.request.url.pathname = this.request.resourceURL.pathname as string;
    }

    this.request.query = Object.fromEntries(
      this.request.url.searchParams.entries()
    );
    this.request.queryGet = Object.fromEntries(
      this.request.url.searchParams.entries()
    );
    this.request.path = this.request.url.pathname + this.request.url.search;
    this.url = url.format(this.request.url);
    this.port = parseInt(this.request.url.port, 10);

    try {
      this.originUrl = new URL(this.request.origin);
    } catch (e) {
      this.originUrl = new URL(this.url);
    }
    this.parseCookies();
    this.cookieSession = this.getCookieSession(
      this.sessionService?.options.name
    );
    // domain
    this.domain = this.getHostName() as string;
    this.validDomain = this.isValidDomain();
    // LISTEN EVENTS
    this.rejected = false;
    this.request.on("requestRejected", () => {
      this.rejected = true;
    });

    // case proxy
    if (this.request.httpRequest.headers["x-forwarded-for"]) {
      this.proxy = {
        proxyServer: <string>(
          (this.request.httpRequest.headers["x-forwarded-server"] || "unknown")
        ),
        proxyProto: <string>(
          this.request.httpRequest.headers["x-forwarded-proto"]
        ),
        proxyPort: <string>this.request.httpRequest.headers["x-forwarded-port"],
        proxyFor: <string>this.request.httpRequest.headers["x-forwarded-for"],
        proxyHost: <string>this.request.httpRequest.headers["x-forwarded-host"],
        proxyVia: <string>this.request.httpRequest.headers.via,
      };
      this.log(
        `PROXY WEBSOCKET REQUEST x-forwarded VIA : ${this.proxy?.proxyVia}`,
        "DEBUG"
      );
    }
  }

  override log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message) {
    //const syslog: Syslog = this?.container?.get("syslog");
    if (!msgid) {
      msgid = "WEBSOCKET CONTEXT";
    }
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
        `${this.type} ${clc.magenta(httpError.code || this.response?.statusCode)} ${clc.red(this.method)}`
      );
    }
    return this.log(
      `${clc.cyan("URL")} : ${this.url} ${clc.cyan("Accept-Protocol")} : ${acceptedProtocol || "*"} ${clc.cyan("FROM")} : ${this.remoteAddress} ${clc.cyan("ORIGIN")} : ${this.originUrl?.host}`,
      "INFO",
      `${this.type} ${clc.magenta(this.response?.statusCode)} ${this.method}`
    );
  }

  async connect(): Promise<websocket.connection> {
    try {
      if (!this.response) {
        throw new Error(`Nodefony Websocket Bad response already clean`);
      }
      if (!this.request) {
        throw new Error(`Nodefony Websocket Bad request already clean`);
      }
      if (this.rejected) {
        throw new Error(`Nodefony Websocket rejected`);
      }
      let acceptedProtocol = null;
      if (this.resolver) {
        acceptedProtocol = this.resolver.acceptedProtocol;
      }
      this.response.setCookies();
      this.connection = this.request.accept(
        acceptedProtocol,
        this.origin,
        this.response.cookiesWs
      );
      this.response.setConnection(this.connection);
      this.connection.on("close", this.onClose.bind(this));
      await this.fireAsync("onConnect", this, this.connection);
      this.requestEnded = true;
      // LISTEN EVENTS SOCKET
      this.connection.on("message", this.handleMessage.bind(this));
      this.logRequest(null, acceptedProtocol);
      this.webSocketState = "connected";
      return this.connection;
    } catch (e) {
      this.webSocketState = "error";
      throw e;
    }
  }

  async handle(data?: any[]): Promise<this> {
    if (this.rejected) {
      this.webSocketState = "error";
      throw new Error(`Nodefony Websocket rejected`);
    }
    try {
      //this.locale = this.translation.handle();
      if (!this.resolver) {
        this.resolver = this.router?.resolve(this) as Resolver;
      } else {
        try {
          this.resolver.match(this.resolver.route as Route, this);
        } catch (e: any | HttpError) {
          if (!this.rejected) {
            this.request?.reject(e.code, e.message);
            this.rejected = true;
          }
          throw e;
        }
      }
      this.setParameters("query.get", this.request?.queryGet || {});
      this.setParameters("query.request", this.request?.query || {});
      // WARNING EVENT KERNEL
      await this.fireAsync("onRequest", this, this.resolver);
      await this.kernel?.fireAsync("onRequest", this, this.resolver);
      if (this.resolver && this.resolver.resolve) {
        this.setMetaData({
          nodefony: {
            websocket: {
              state: this.webSocketState,
              protocol: this.connection?.protocol,
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
          .catch((error) => {
            //console.log("catch", error);
            if (!this.rejected) {
              if (this.request) {
                if (this.request._resolved) {
                  if (error.code) {
                    throw this.close(
                      parseInt(error.code, 10) + 3000,
                      error.message
                    );
                  }
                  throw this.close(500, error.message);
                }
                this.request.reject(error.code, error.message);
              }
              this.rejected = true;
              this.webSocketState = "error";
              throw error;
            }
          });
      } else if (!this.rejected) {
        this.request?.reject();
        this.rejected = true;
        this.webSocketState = "error";
      }
    } catch (e) {
      throw e;
    }
    if (data) {
      return this;
    }
    return this;
  }

  async render(chunk: any, encoding?: BufferEncoding) {
    let data = chunk;
    switch (true) {
      case this.isJson:
        data = JSON.stringify(chunk);
        break;
      default:
    }
    return this.send(data, encoding);
  }

  async send(data: any, encoding?: BufferEncoding) {
    if (this.response) {
      if (!data) {
        data = this.response.body;
      }
      this.fire("onMessage", data, this, "SEND");
      this.fire("onSend", data, this);
      return this.response.send(data, encoding);
    }
  }

  broadcast(data: any, encoding?: BufferEncoding) {
    if (this.response) {
      if (!data) {
        data = this.response.body;
      }
      if (data) {
        this.fire("onMessage", data, this, "BROADCAST");
        this.fire("onBroadcast", data, this);
        return this.response.broadcast(data, encoding);
      }
    }
    return null;
  }

  async handleMessage(message: any) {
    this.webSocketState = "message";
    if (this.response) {
      this.response.body = message;
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
              protocol: this.connection?.protocol,
            },
          },
        });
        return this.resolver.callController([message]);
      } else if (!this.rejected) {
        this.request?.reject();
        this.rejected = true;
      }
    } catch (e) {
      this.request?.reject();
      throw e;
    }
  }

  onClose(reasonCode: number, description: string) {
    this.log(
      `${clc.cyan("URL")} : ${this.url}  ${clc.cyan("FROM")} : ${this.remoteAddress} ${clc.cyan("ORIGIN")} : ${this.originUrl?.host} ${clc.cyan("Description")} : ${description} `,
      "INFO",
      `${this.type} ${clc.magenta(reasonCode)} CLOSE ${this.method}`
    );
    if (this.connection?.state !== "closed") {
      try {
        this.response?.drop(reasonCode, description);
      } catch (e: any) {
        this.log(
          `${clc.cyan("URL")} : ${this.url}  ${clc.cyan("FROM")} : ${this.remoteAddress} ${clc.cyan("ORIGIN")} : ${this.originUrl?.host} ${clc.cyan("error")} : ${e.message} `,
          "ERROR",
          `${this.type} CLOSE ${clc.red(this.method)}`
        );
      }
      this.fire("onClose", reasonCode, description, this.connection);
    } else {
      this.fire("onClose", reasonCode, description, this.connection);
    }
    this.fire("onFinish", this, reasonCode, description);
    this.webSocketState = "closed";
  }

  override setScheme(): SchemeType {
    return this.request?.url.protocol.replace(":", "") as SchemeType;
  }

  getRemoteAddress(): string | undefined {
    return this.request?.remoteAddress;
  }

  getHost(): string | undefined {
    return this.request?.httpRequest.headers.host;
  }

  getHostName() {
    return this.request?.url.hostname;
  }

  getUserAgent(): string {
    return this.request?.httpRequest.headers["user-agent"] as string;
  }

  getMethod(): HTTPMethod {
    return "WEBSOCKET";
  }

  override setContextJson(encoding: BufferEncoding = "utf-8"): void {
    this.isJson = true;
  }

  clean() {
    this.request = null;
    if (this.response) {
      this.response.clean();
    }
    this.response = null;
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
}
