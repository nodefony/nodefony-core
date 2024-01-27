import { Service, Module, Container, Event, Scope } from "nodefony";
import http from "node:http";

import httpServer from "../service/server-http";
import clc from "cli-color";

export type ProtocolType = "1.1" | "2.0";

export type ServerType =
  | "http"
  | "https"
  | "http2"
  | "websocket"
  | "websocket-secure";

const serviceName: string = "httpKernel";

class HttpKernel extends Service {
  constructor(module: Module) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    super(serviceName, container, event, module.options);
    this.container?.addScope("request");
  }

  onHttpRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    type: ServerType
  ) {
    response.setHeader("Server", this.options.headerServer);
    this.fire("onServerRequest", request, response, type);
    return this.handle(request, response, type);
  }

  async initServers(): Promise<any[]> {
    let servers = [];
    const serverHttp: httpServer = this.get("server-http");
    if (serverHttp) {
      servers.push(serverHttp);
      await serverHttp.createServer();
    }
    return servers;
  }

  handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    type: ServerType
  ) {
    // SCOPE REQUEST ;
    let log = null;
    const scope = this.container?.enterScope("request");
    switch (type) {
      case "http":
      case "https":
      case "http2":
        log = clc.cyan.bgBlue(`${request.url}`);
        this.log(`REQUEST HANDLE ${type} : ${log}`, "DEBUG");
        return this.handleHttp(scope as Scope, request, response, type);
      case "websocket":
      case "websocket-secure":
        //log = clc.cyan.bgBlue(`${request.resource}`);
        //this.log(`REQUEST HANDLE ${type} : ${log}`, "DEBUG");
        return this.handleWebsocket(scope as Scope, request, type);
    }
  }

  handleHttp(
    scope: Scope,
    request: http.IncomingMessage,
    response: http.ServerResponse,
    type: ServerType
  ) {
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/plain");
    response.end("Hello, World!\n");
  }

  handleWebsocket(
    scope: Scope,
    request: http.IncomingMessage,
    type: ServerType
  ) {}
}

export default HttpKernel;
