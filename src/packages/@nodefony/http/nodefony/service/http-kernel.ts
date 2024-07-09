import nodefony, {
  Service,
  Module,
  Container,
  Event,
  Scope,
  //Kernel,
  typeOf,
  injectable,
  EnvironmentType,
  DebugType,
  Error as nodefonyError,
  //inject,
} from "nodefony";
import { Resolver, Router } from "@nodefony/framework";
import { Controller } from "@nodefony/framework";
import HttpError from "../src/errors/httpError";
import http from "node:http";
//import https from "node:https";
import http2 from "node:http2";
import httpServer from "../service/servers/server-http";
import httpsServer from "../service/servers/server-https";
import websocketServer from "../service/servers/server-websocket";
import websocketSecureServer from "../service/servers/server-websocket-secure";
import Statics from "./servers/server-static";
import WebsocketContext from "../src/context/websocket/WebsocketContext";
import HttpContext from "../src/context/http/HttpContext";
import Context, { HTTPMethod } from "../src/context/Context";
import clc from "cli-color";
import Certicates from "./certificates";
import websocket from "websocket";
import SessionsService from "./sessions/sessions-service";
import Session from "../src/session/session";
import { Route } from "@nodefony/framework";

export type ProtocolType = "1.1" | "2.0" | "3.0";
export type httpRequest = http.IncomingMessage | http2.Http2ServerRequest;
export type httpResponse = http.ServerResponse | http2.Http2ServerResponse;
export type ContextType = WebsocketContext | HttpContext | Context;
export type ServerType =
  | "http"
  | "https"
  | "http2"
  | "http3"
  | "websocket"
  | "websocket-secure";

type AliasObject = Record<string, string | RegExp>;
type AliasArray = (string | RegExp)[];
type DomainAliasType = AliasObject | AliasArray | string;
export type responseTimeoutType = "http" | "https" | "http2" | "http3";
export type SchemeType = "http" | "https" | "ws" | "wss";

export interface WsMetaData {
  type: "message" | "handshake";
  messageType?: websocket.IUtf8Message | websocket.IBinaryMessage;
  protocol?: string;
  id?: string;
}

export interface MetaData {
  name?: string;
  version?: string;
  url?: URL;
  environment?: EnvironmentType;
  debug?: DebugType;
  token?: string;
  method?: HTTPMethod;
  scheme?: SchemeType;
  websocket?: WsMetaData;
  route?: Route;
}

export interface Data {
  error?: Error;
  nodefony: MetaData;
  message?: any;
  code?: number;
  result: any;
  //stack?: string;
}

const serviceName: string = "HttpKernel";
@injectable()
class HttpKernel extends Service {
  certificates: any;
  serviceCerticats: Certicates | null = null;
  key: string = "";
  cert: string = "";
  ca: string = "";
  serverStatic: Statics | null = null;
  domain: string = "";
  domainAlias: DomainAliasType = [];
  domainCheck: boolean = false;
  regAlias: RegExp[] = [];
  module: Module;
  httpsPort?: number;
  httpPort?: number;
  responseTimeout: {
    http: number;
    https: number;
    http2: number;
    http3: number;
  };
  closeTimeOutWs: {
    ws: number;
    wss: number;
  };
  sessionService?: SessionsService;
  sessionAutoStart: boolean | string = false;
  router?: Router;
  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options
    );
    this.module = module;
    this.container?.addScope("request");
    this.responseTimeout = {
      http: this.options.http.responseTimeout,
      https: this.options.https.responseTimeout,
      http2: this.options.https.responseTimeout,
      http3: this.options.https.responseTimeout,
    };
    this.closeTimeOutWs = {
      ws: this.options.websocket.closeTimeout,
      wss: this.options.websocketSecure.closeTimeout,
    };
  }

  async initialize(): Promise<this> {
    this.kernel?.prependOnceListener("onReady", () => {
      this.serviceCerticats = this.get("certificates");
      this.serverStatic = this.get("server-static");
      this.domain = this.kernel?.domain as string;
      this.domainAlias = this.kernel?.options?.domainAlias;
      this.regAlias = this.compileAlias();
      this.sessionService = this.get("sessions");
      this.sessionAutoStart = this.sessionService?.sessionAutoStart as boolean;
    });
    this.kernel?.prependOnceListener("onBoot", () => {
      this.router = this.get("router");
    });
    return this;
  }

  async handle(
    request: httpRequest | websocket.request,
    response: httpResponse | null,
    type: ServerType
  ): Promise<any> {
    // SCOPE REQUEST ;
    let log = null;
    const scope = this.container?.enterScope("request");
    switch (type) {
      case "http":
      case "https":
      case "http2":
        log = clc.cyan.bgBlue(`${(request as httpRequest).url}`);
        this.log(`${log}`, "DEBUG", `${type}`);
        return this.handleHttp(
          scope as Scope,
          request as httpRequest,
          response as httpResponse,
          type
        ).catch(async (e) => {
          throw e;
        });
      case "websocket":
      case "websocket-secure":
        //log = clc.cyan.bgBlue(`${request.resource}`);
        //this.log(`REQUEST HANDLE ${type} : ${log}`, "DEBUG");
        return this.handleWebsocket(
          scope as Scope,
          request as websocket.request,
          type
        ).catch((e) => {
          throw e;
        });
    }
  }

  async handleFrontController(
    context: ContextType
    //checkFirewall: boolean = true
  ): Promise<Controller | number> {
    return new Promise(async (resolve, reject) => {
      // if (this.firewall && checkFirewall) {
      //   context.secure = this.firewall.isSecure(context);
      // }
      if (!this.router) {
        return reject(new Error("kernel HTTP not ready"));
      }
      if (context.security) {
        //const res = this.firewall.handleCrossDomain(context);
        const res = null;
        if (context.crossDomain && context.method === "OPTIONS") {
          if (res === 204) {
            return resolve(res);
          }
        }
      }
      // FRONT ROUTER
      let controller: Controller;
      let resolver: Resolver | undefined = undefined;
      try {
        resolver = this.router.resolve(context);
        if (resolver.resolve && !resolver.exception) {
          context.resolver = resolver;
          controller = await resolver.newController(context);
          if (controller.sessionAutoStart) {
            context.sessionAutoStart = controller.sessionAutoStart;
          }
          context.once("onSessionStart", (session) => {
            controller.session = session;
          });
          return resolve(controller);
        }
        if (resolver.exception) {
          return reject(resolver.exception);
        }
        const error = new HttpError("Not Found", 404, context);
        return reject(error);
      } catch (e) {
        // if (e instanceof Resolver && e.exception) {
        //   return reject(e.exception);
        // }
        return reject(e);
      }
    });

    return 0;
  }

  /**
   * Handles errors by setting appropriate response codes and messages.
   *
   * @param error - The error object, which can be of type Error, HttpError, or nodefonyError.
   * @param context - Optional context parameter, which can be of type ContextType.
   * @param extraHeaders - Optional additional headers to be included in the response.
   * @returns A promise that resolves to either HttpContext or WebsocketContext.
   *
   * WebSocket error codes and their meanings:
   *  - code >= 1000 && code <= 2999:
   *    - 1000: Normal connection closure
   *    - 1001: Remote peer is going away
   *    - 1002: Protocol error
   *    - 1003: Unprocessable input
   *    - 1004: Reserved
   *    - 1005: Reason not provided
   *    - 1006: Abnormal closure, no further detail available
   *    - 1007: Invalid data received
   *    - 1008: Policy violation
   *    - 1009: Message too big
   *    - 1010: Extension requested by client is required
   *    - 1011: Internal Server Error
   *    - 1015: TLS Handshake Failed
   *  - code >= 3000 && code <= 3999:
   *    Reserved for use by libraries, frameworks, and applications.
   *    Should be registered with IANA. Interpretation of these codes is
   *    undefined by the WebSocket protocol.
   *  - code >= 4000 && code <= 4999:
   *    Reserved for private use. Interpretation of these codes is
   *    undefined by the WebSocket protocol.
   */
  async onError(
    error: Error | HttpError | nodefonyError,
    context?: ContextType,
    extraHeaders?: Record<string, any> | object
  ): Promise<HttpContext | WebsocketContext> {
    try {
      const code = error.code === 200 ? 500 : !error.code ? 500 : error.code;
      if (!(error instanceof HttpError)) {
        error = new HttpError(error as Error, error.code as number, context);
      }
      error.code = code;
      if (context) {
        context.error = error;
      }
      switch (true) {
        case context instanceof HttpContext: {
          context.response.setStatusCode(code, error.message);
          if (this.kernel?.debug) {
            this.log(error.toString(), "ERROR");
          }
          //let message: string = error.message;
          const obj = context.metaData;
          obj.error = error.toJSON() as Error;
          obj.code = error.code;
          obj.message = error.message;
          if (!context.response.isHeaderSent()) {
            return context
              .render(obj)
              .then(() => {
                return context;
              })
              .catch((e) => {
                this.log(e, "CRITIC");
                throw e;
              });
          }
          if (!context.sended) {
            return context.close().then(() => {
              return context;
            });
          }
          throw error;
        }
        case context instanceof WebsocketContext: {
          try {
            if (context.response && context.response.connection) {
              // reject only websocket code
              if (error.code && error.code < 1000) {
                error.code = 1011;
              }
              context.close(error.code, error.message);
              return context;
            }
            if (context.request && !context.rejected) {
              // reject only http code
              if (error.code && error.code > 500) {
                error.code = 500;
              }
              context.request?.reject(error.code, error.message, extraHeaders);
              return context;
            }
          } catch (e) {
            throw error;
          }
        }
        default:
          throw error;
      }
    } catch (e) {
      throw e;
    }
  }

  compileAlias(): RegExp[] {
    const alias: RegExp[] = [];
    alias.push(new RegExp(`^${this.domain}$`, "u"));
    switch (typeOf(this.domainAlias)) {
      case "string": {
        if (this.domainAlias) {
          const tab = (this.domainAlias as string).split(/ |,/u);
          for (const myAlias in tab) {
            alias.push(new RegExp(tab[myAlias], "u"));
          }
        }
        break;
      }
      case "object": {
        const obj = this.domainAlias as AliasObject;
        for (const myAlias in obj) {
          const ele: string | RegExp = obj[myAlias];
          if (ele instanceof String) {
            alias.push(new RegExp(obj[myAlias], "u"));
          }
          if (ele instanceof RegExp) {
            alias.push(obj[myAlias] as RegExp);
          }
        }
        break;
      }
      case "array": {
        const tab = this.domainAlias as AliasArray;
        for (let i = 0; i < tab.length; i++) {
          const ele: string | RegExp | any = tab[i];
          if (typeof ele === "string") {
            alias.push(new RegExp(tab[i], "u"));
          }
          if (ele instanceof RegExp) {
            alias.push(tab[i] as RegExp);
          }
        }
        break;
      }
    }
    return alias;
  }

  async onHttpRequest(
    request: httpRequest,
    response: httpResponse,
    type: ServerType
  ): Promise<http.ServerResponse | http2.Http2ServerResponse> {
    response.setHeader("Server", this.options.headerServer);
    if (
      (this.kernel?.options.servers.statics || this.kernel?.options.statics) &&
      this.serverStatic
    ) {
      return this.serverStatic
        .handle(request, response)
        .then(async (res) => {
          if (res) {
            await this.fireAsync(
              "onServerRequest",
              request,
              response,
              type
            ).catch((e) => {
              throw e;
            });
            return await this.handle(request, response, type).catch((e) => {
              throw e;
            });
          }
          throw new Error("Bad request");
        })
        .catch((e) => {
          // if (e) {
          //   this.log(e, "ERROR", "STATICS SERVER");
          // }
          return e;
        });
    }
    await this.fireAsync("onServerRequest", request, response, type).catch(
      (e) => {
        throw e;
      }
    );
    return await this.handle(request, response, type).catch((e) => {
      throw e;
    });
  }

  async initServers(): Promise<any[]> {
    let servers = [];
    const serverHttp: httpServer = this.get("server-http");
    if (serverHttp) {
      await serverHttp.createServer();
      servers.push(serverHttp);
    }
    const serverHttps: httpsServer = this.get("server-https");
    if (serverHttps) {
      await serverHttps.createServer();
      servers.push(serverHttps);
    }
    const serverWebsocket: websocketServer = this.get("server-websocket");
    if (serverWebsocket && serverHttp) {
      await serverWebsocket.createServer(serverHttp);
      servers.push(serverWebsocket);
    }
    const serverWebsocketSecure: websocketSecureServer = this.get(
      "server-websocket-secure"
    );
    if (serverWebsocketSecure && serverHttps) {
      await serverWebsocketSecure.createServer(serverHttps);
      servers.push(serverWebsocketSecure);
    }
    return servers;
  }

  async startSession(
    context: WebsocketContext | HttpContext
  ): Promise<Session | null> {
    if (
      this.sessionService &&
      this.sessionAutoStart /*|| context.hasSession()*/
    ) {
      return this.sessionService
        .start(context, this.sessionAutoStart as string)
        .then((session: Session | null) => {
          // if (this.firewall) {
          //   this.firewall.getSessionToken(context, session);
          // }
          //console.log(session);
          return session;
        })
        .catch((e) => {
          throw e;
        });
    }
    return Promise.resolve(null);
  }

  createHttpContext(
    scope: Scope,
    request: httpRequest,
    response: httpResponse,
    type: ServerType
  ): HttpContext {
    try {
      const context = new HttpContext(scope, request, response, type);
      // response events
      response.once("finish", async () => {
        if (!context) {
          return;
        }
        if (context.finished) {
          return;
        }
        context.logRequest();
        await context.fireAsync("onFinish", context).catch((e) => {
          throw e;
        });
        context.finished = true;
        this.container?.leaveScope(scope);
        context.clean();
      });

      return context;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async handleHttp(
    scope: Scope,
    request: httpRequest,
    response: httpResponse,
    type: ServerType
  ): Promise<HttpContext> {
    return new Promise(async (resolve, reject) => {
      let context: HttpContext | null = null;
      try {
        context = this.createHttpContext(scope, request, response, type);
        await this.fireAsync("onCreateContext", context).catch((e) => {
          throw e;
        });
        await context.request.initialize();
        const ctx = await this.onRequestEnd(context).catch((e) => {
          throw e;
        });

        if (ctx instanceof Context) {
          if (ctx.secure || ctx.isControlledAccess) {
            return resolve(context);
          }
          const result = await ctx.handle().catch((e) => {
            throw e;
          });
          return resolve(result);
        }
        return resolve(context);
      } catch (e) {
        return this.onError(e as Error, context as ContextType).catch((e) => {
          return reject(e);
        });
      }
    });
  }

  async onRequestEnd(
    context: HttpContext,
    error?: Error | null | undefined
  ): Promise<HttpContext | number> {
    return new Promise(async (resolve, reject) => {
      // EVENT
      if (!context) {
        return reject(new nodefony.Error("Bad context", 500));
      }
      if (error) {
        throw error;
      }
      try {
        // ADD HEADERS CONFIG
        if (this.options[context.scheme].headers) {
          context.response.setHeaders(this.options[context.scheme].headers);
        }
        // DOMAIN VALID
        if (this.kernel?.options.domainCheck) {
          this.checkValidDomain(context);
        }
        // FRONT CONTROLLER
        const ret = await this.handleFrontController(context).catch((e) => {
          throw e;
        });
        if (ret === 204) {
          return resolve(ret);
        }
        // // FIREWALL
        // if (context.secure || context.isControlledAccess) {
        //   const res = await this.firewall.handleSecurity(context);
        //   // CSRF TOKEN
        //   if (context.csrf) {
        //     const token = await this.csrfService.handle(context);
        //     if (token) {
        //       this.log("CSRF TOKEN OK", "DEBUG");
        //     }
        //   }
        //   return resolve(res);
        // }

        // SESSIONS
        await this.startSession(context).catch((e) => {
          throw e;
        });
        // CSRF TOKEN
        // if (context.csrf) {
        //   const token = await this.csrfService.handle(context);
        //   if (token) {
        //     this.log("CSRF TOKEN OK", "DEBUG");
        //   }
        // }
        return resolve(context);
      } catch (e) {
        return reject(e);
      }
    });
  }

  // WEBSOCKET
  createWebsocketContext(
    scope: Scope,
    request: websocket.request,
    type: ServerType
  ): WebsocketContext {
    const context = new WebsocketContext(scope, request, type);
    context.once("onFinish", (wscontext) => {
      if (!context) {
        return;
      }
      if (context.finished) {
        return;
      }
      if (context.session) {
        if (context.session.saved) {
          this.container?.leaveScope(wscontext.container);
          context.clean();
          context.finished = true;
        } else {
          context.once("onSaveSession", () => {
            this.container?.leaveScope(wscontext.container);
            context.clean();
            context.finished = true;
          });
        }
      } else {
        this.container?.leaveScope(wscontext.container);
        context.clean();
        context.finished = true;
      }
    });
    return context;
  }

  // WEBSOCKET ENTRY POINT
  async onWebsocketRequest(request: websocket.request, type: ServerType) {
    await this.fireAsync("onServerRequest", request, null, type).catch((e) => {
      throw e;
    });
    return await this.handle(request, null, type);
  }
  async handleWebsocket(
    scope: Scope,
    request: websocket.request,
    type: ServerType
  ): Promise<any> {
    let context: WebsocketContext | null = null;
    let error: Error | null | unknown = null;
    try {
      context = this.createWebsocketContext(scope, request, type);
    } catch (e) {
      error = e;
    }
    try {
      /*const connection =*/ await this.onConnect(
        context as WebsocketContext,
        error
      );
      // FIREWALL
      // if (context?.secure || context?.isControlledAccess) {
      //   return await this.firewall.handleSecurity(context, connection);
      // }
      return await context?.handle();
    } catch (e) {
      try {
        await this.onError(e as Error, context as WebsocketContext);
      } catch (errorHandlingError) {
        throw errorHandlingError;
      }
      throw e;
    }
  }

  async onConnect(
    context: WebsocketContext,
    error: null | undefined | unknown = null
  ): Promise<websocket.connection | number> {
    try {
      if (error) {
        throw error;
      }
      if (!context) {
        throw new nodefony.Error("Bad context", 500);
      }
      // DOMAIN VALID
      if (this.domainCheck) {
        this.checkValidDomain(context);
      }
      // FRONT CONTROLLER
      try {
        const ret = await this.handleFrontController(context);
        if (ret === 204) {
          return ret;
        }
      } catch (e: any) {
        context.logRequest(e);
        throw e;
      }
      if (context.secure || context.isControlledAccess) {
        return await context.connect();
      }
      // SESSIONS
      if (
        this.sessionService &&
        !context.sessionStarting &&
        (context.sessionAutoStart || context.hasSession())
      ) {
        try {
          const session = await this.sessionService.start(
            context,
            context.sessionAutoStart as string
          );
          if (!(session instanceof Session)) {
            this.log(
              new Error("SESSION START session storage ERROR"),
              "WARNING"
            );
          }
          // if (this.firewall) {
          //   this.firewall.getSessionToken(context, session);
          // }
        } catch (e) {
          throw e;
        }
      }
      return await context.connect();
    } catch (e) {
      throw e;
    }
  }

  checkValidDomain(context: ContextType): number {
    if (context.validDomain) {
      return 200;
    }
    const error = `DOMAIN Unauthorized : ${context.domain}`;
    throw new HttpError(error, 401);
  }

  isValidDomain(context: ContextType): boolean {
    let result: boolean = false;
    for (const reg of this.regAlias) {
      result = reg.test(context.domain);
      if (result) {
        break;
      }
    }
    return result;
  }
}

export default HttpKernel;
