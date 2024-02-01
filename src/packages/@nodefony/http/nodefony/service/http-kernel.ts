import { Service, Module, Container, Event, Scope } from "nodefony";
import http from "node:http";
import https from "node:http";
import http2 from "node:http2";
import httpServer from "../service/servers/server-http";
import httpsServer from "../service/servers/server-https";
import Statics from "./servers/server-static";
import clc from "cli-color";
import Certicates from "./certificates";
import websocket from "websocket";

export type ProtocolType = "1.1" | "2.0" | "3.0";

export type ServerType =
  | "http"
  | "https"
  | "http2"
  | "http3"
  | "websocket"
  | "websocket-secure";

const serviceName: string = "httpKernel";

class HttpKernel extends Service {
  certificates: any;
  serviceCerticats: Certicates | null = null;
  key: string = "";
  cert: string = "";
  ca: string = "";
  serverStatic: Statics | null = null;
  constructor(module: Module) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    super(serviceName, container, event, module.options);
    this.container?.addScope("request");
    this.kernel?.on("onStart", () => {
      this.serviceCerticats = this.get("certificates");
      this.serverStatic = this.get("server-static");
    });
  }

  async onHttpRequest(
    request: http.IncomingMessage | http2.Http2ServerRequest,
    response: http.ServerResponse | http2.Http2ServerResponse,
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

  async handle(
    request: http.IncomingMessage | http2.Http2ServerRequest,
    response: http.ServerResponse | http2.Http2ServerResponse,
    type: ServerType
  ): Promise<any> {
    // SCOPE REQUEST ;
    let log = null;
    const scope = this.container?.enterScope("request");
    switch (type) {
      case "http":
      case "https":
      case "http2":
        log = clc.cyan.bgBlue(`${request.url}`);
        this.log(`    ${log}`, "INFO", type);
        return this.handleHttp(scope as Scope, request, response, type);
      case "websocket":
      case "websocket-secure":
        //log = clc.cyan.bgBlue(`${request.resource}`);
        //this.log(`REQUEST HANDLE ${type} : ${log}`, "DEBUG");
        return this.handleWebsocket(scope as Scope, request, type);
    }
  }

  async handleHttp(
    scope: Scope,
    request: http.IncomingMessage | http2.Http2ServerRequest,
    response: http.ServerResponse | http2.Http2ServerResponse,
    type: ServerType
  ): Promise<http.ServerResponse | http2.Http2ServerResponse> {
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/plain");
    response.end("Hello, World!\n");
    return response;
  }

  handleWebsocket(
    scope: Scope,
    request:
      | http.IncomingMessage
      | https.IncomingMessage
      | http2.Http2ServerRequest,
    type: ServerType
  ): Promise<any> {
    return Promise.resolve();
  }
}

export default HttpKernel;
