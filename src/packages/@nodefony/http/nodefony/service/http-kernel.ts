import nodefony, {
  Service,
  Module,
  Container,
  Event,
  Scope,
  typeOf,
} from "nodefony";
import http from "node:http";
import https from "node:http";
import http2 from "node:http2";
import httpServer from "../service/servers/server-http";
import httpsServer from "../service/servers/server-https";
import Statics from "./servers/server-static";
import WebsocketContext from "../src/context/websocket/WebsocketContext";
import HttpContext from "../src/context/http/HttpContext";
import clc from "cli-color";
import Certicates from "./certificates";
import websocket from "websocket";

export type ProtocolType = "1.1" | "2.0" | "3.0";
export type httpRequest = http.IncomingMessage | http2.Http2ServerRequest;
export type httpResponse = http.ServerResponse | http2.Http2ServerResponse;
export type ContextType = WebsocketContext | HttpContext;
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

export type SchemeType = "http" | "https" | "ws" | "wss";

const serviceName: string = "httpKernel";

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
  constructor(module: Module) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    super(serviceName, container, event, module.options);
    this.module = module;
    this.container?.addScope("request");
    this.kernel?.on("onStart", () => {
      this.serviceCerticats = this.get("certificates");
      this.serverStatic = this.get("server-static");
      this.domain = this.kernel?.domain as string;
      this.domainAlias = this.kernel?.options?.domainAlias;
      this.regAlias = this.compileAlias();
    });
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
        this.log(`    ${log}`, "INFO", type);
        return this.handleHttp(
          scope as Scope,
          request as httpRequest,
          response as httpResponse,
          type
        );
      case "websocket":
      case "websocket-secure":
        //log = clc.cyan.bgBlue(`${request.resource}`);
        //this.log(`REQUEST HANDLE ${type} : ${log}`, "DEBUG");
        return this.handleWebsocket(
          scope as Scope,
          request as websocket.request,
          type
        );
    }
  }

  async handleFrontController(context: ContextType): Promise<any> {}

  async onError(
    container: Container = this.container as Container,
    error: any
  ): Promise<nodefony.Error> {
    return error as nodefony.Error;
  }

  compileAlias(): RegExp[] {
    const alias: RegExp[] = [];
    if (!this.domainAlias || this.domainAlias.length === 0) {
      alias.push(new RegExp(`^${this.domain}$`, "u"));
      return alias;
    }
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
        .then((res) => {
          if (res) {
            this.fire("onServerRequest", request, response, type);
            return this.handle(request, response, type);
          }
          throw new Error("Bad request");
        })
        .catch((e) => {
          if (e) {
            this.log(e, "ERROR", "STATICS SERVER");
          }
          return e;
        });
    }
    this.fire("onServerRequest", request, response, type);
    return this.handle(request, response, type);
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
    return servers;
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
      this.log(e, "ERROR");
      throw e;
    }
  }

  async handleHttp(
    scope: Scope,
    request: httpRequest,
    response: httpResponse,
    type: ServerType
  ): Promise<httpResponse> {
    let context: HttpContext | null = null;
    let error;
    try {
      context = this.createHttpContext(scope, request, response, type);
    } catch (e) {
      error = e;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/plain");
    response.end("Hello, World!\n");
    return response;
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
        return this.onError(container as Container, e)
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
    throw new nodefony.Error(error, 401);
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
