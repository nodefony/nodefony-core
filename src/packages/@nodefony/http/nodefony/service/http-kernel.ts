import nodefony, {
  Service,
  Module,
  Container,
  Event,
  Scope,
  Kernel,
  typeOf,
  injectable,
} from "nodefony";
import HttpError from "../src/errors/httpError";
import http from "node:http";
import https from "node:http";
import http2 from "node:http2";
import httpServer from "../service/servers/server-http";
import httpsServer from "../service/servers/server-https";
import websocketServer from "../service/servers/server-websocket";
import websocketSecureServer from "../service/servers/server-websocket-secure";
import Statics from "./servers/server-static";
import WebsocketContext from "../src/context/websocket/WebsocketContext";
import HttpContext from "../src/context/http/HttpContext";
import Context from "../src/context/Context";
import clc from "cli-color";

import Certicates from "./certificates";
import websocket from "websocket";
import SessionsService from "./sessions/sessions-service";
import Session from "../src/session/session";
import { cp } from "node:fs";

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
        ).catch(async (e) => {
          throw e;
        });
    }
  }

  async handleFrontController(context: ContextType): Promise<any> {}

  async onError(error: Error | HttpError, context?: ContextType): Promise<any> {
    try {
      const code = error.code === 200 ? 500 : !error.code ? 500 : error.code;
      if (!(error instanceof HttpError)) {
        error = new HttpError(error as Error, error.code, context);
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
          } else {
            //if (error.message) this.log(error.message, "ERROR");
          }
          context.response.setContentType("text");
          return context.send(error.message).catch((e) => {
            throw e;
          });
        }
        case context instanceof WebsocketContext: {
          if (this.kernel?.debug) {
            this.log(error.toString(), "ERROR");
          } else {
            this.log(error.message, "ERROR");
          }
          return;
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
            this.fire("onServerRequest", request, response, type);
            return this.handle(request, response, type).catch((e) => {
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
    this.fire("onServerRequest", request, response, type);
    return this.handle(request, response, type).catch((e) => {
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
      if (context.response) {
        response.once("finish", () => {
          if (!context) {
            return;
          }
          if (context.finished) {
            return;
          }
          context.logRequest();
          context.fire("onFinish", context);
          context.finished = true;
          this.container?.leaveScope(scope);
          context.clean();
        });
      }
      return context;
    } catch (e) {
      console.trace(e);
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
        await this.fireAsync("onCreateContext", context);
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
          this.log(e, "CRITIC");
          return reject(e);
        });
      }
    });
  }

  async onRequestEnd(
    context: HttpContext,
    error?: Error | null | undefined
  ): Promise<HttpContext> {
    return new Promise((resolve, reject) => {
      // EVENT
      if (!context) {
        return reject(new nodefony.Error("Bad context", 500));
      }
      context.once("onRequestEnd", async () => {
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
          // SESSIONS
          await this.startSession(context);
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
        // // FRONT CONTROLLER
        // const ret = await this.handleFrontController(context).catch((e) => {
        //   throw e;
        // });
        // if (ret === 204) {
        //   return resolve(ret);
        // }
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
      });
    });
  }

  // WEBSOCKET

  createWebsocketContext(
    container: Container,
    request: websocket.request,
    type: ServerType
  ): WebsocketContext {
    return new WebsocketContext(container, request, type);
  }

  onWebsocketRequest(request: websocket.request, type: ServerType) {
    this.fire("onServerRequest", request, null, type);
    return this.handle(request, null, type);
  }

  // WEBSOCKET ENTRY POINT
  handleWebsocket(
    container: Container,
    request: websocket.request,
    type: ServerType
  ): Promise<any> {
    return new Promise(async (resolve, reject) => {
      let context: WebsocketContext | null = null;
      let error: Error | null | unknown = null;
      try {
        context = this.createWebsocketContext(container, request, type);
      } catch (e) {
        error = e;
      }
      try {
        const connection = await this.onConnect(
          context as WebsocketContext,
          error
        );
        // FIREWALL
        // if (context?.secure || context?.isControlledAccess) {
        //   return resolve(
        //     await this.firewall.handleSecurity(context, connection)
        //   );
        // }
        return resolve(await context?.handle());
      } catch (e) {
        return this.onError(e as Error, context as WebsocketContext)
          .then((res) => resolve(res))
          .catch((e) => reject(e));
      }
    });
  }

  onConnect(
    context: WebsocketContext,
    error: null | undefined | unknown = null
  ) {
    // EVENT
    return new Promise(async (resolve, reject) => {
      if (!context) {
        return reject(new nodefony.Error("Bad context", 500));
      }
      try {
        if (error) {
          return reject(error);
        }
        // DOMAIN VALID
        if (this.domainCheck) {
          this.checkValidDomain(context);
        }
        // FRONT CONTROLLER
        try {
          const ret = await this.handleFrontController(context).catch((e) => {
            throw e;
          });
          if (ret === 204) {
            return resolve(ret);
          }
        } catch (e) {
          // if ((e.code && e.code === 404) || context.resolver) {
          //   return reject(e);
          // }
          this.log(e, "ERROR");
          // continue
        }

        if (context.secure || context.isControlledAccess) {
          return resolve(await context.connect());
        }
        // SESSIONS
        // if (
        //   !context.sessionStarting &&
        //   (context.sessionAutoStart || context.hasSession())
        // ) {
        //   try {
        //     const session = await this.sessionService
        //       .start(context, context.sessionAutoStart)
        //       .catch((error) => reject(error));
        //     if (!(session instanceof nodefony.Session)) {
        //       this.log(
        //         new Error("SESSION START session storage ERROR"),
        //         "WARNING"
        //       );
        //     }
        //     if (this.firewall) {
        //       this.firewall.getSessionToken(context, session);
        //     }
        //   } catch (e) {
        //     throw e;
        //   }
        // }
        return resolve(await context.connect());
      } catch (e) {
        return reject(e);
      }
    });
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
