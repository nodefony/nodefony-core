// https://github.com/Worlize/WebSocket-Node/wiki/Documentation

import websocket from "websocket";
import nodefony, {
  Service,
  Kernel,
  Container,
  Event,
  Module,
  FamilyType,
  DefaultOptionsService,
} from "nodefony";
import HttpKernel, { ProtocolType, ServerType } from "../http-kernel";
import { AddressInfo } from "node:net";
import http from "node:http";

import http2 from "node:http2";

class Websocket extends Service {
  module: Module;
  httpKernel: HttpKernel;
  ready: boolean = false;
  server: websocket.server | null = null;
  port: number;
  domain: string;
  family: FamilyType | null = null;
  scheme: string = "ws";
  address: string | null = null;
  type: ServerType = "websocket";
  infos: AddressInfo | null = null;
  constructor(module: Module, httpKernel: HttpKernel) {
    super(
      "server-websocket",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.websocket
    );
    this.module = module;
    this.httpKernel = httpKernel;
    this.port = this.setPort();
    this.domain = this.kernel?.domain as string;
    this.ready = false;
  }

  setPort(): number {
    if (this.kernel?.options.servers?.https) {
      return this.kernel?.options.servers?.https?.port || 0;
    }
    return 0;
  }

  createServer(http: http.Server) {
    this.kernel?.once("onServersReady", (type) => {
      if (type === "http") {
        try {
          this.infos = http.address() as AddressInfo;
          if (this.infos) {
            this.port = this.infos.port;
            this.address = this.infos.address;
            this.family = this.infos.family as FamilyType;
          }
          //this.settings = this.getParameters("bundles.http").websocket || {};
          const conf = nodefony.extend(true, {}, this.options);
          conf.httpServer = http;
          this.server = new websocket.server(conf);
          this.server.on("request", (request) =>
            this.httpKernel.onWebsocketRequest(request, this.type)
          );

          this.kernel?.prependOnceListener(
            "onTerminate",
            () =>
              new Promise((resolve, reject) => {
                if (this.server && this.ready) {
                  this.server.broadcast(
                    JSON.stringify({
                      nodefony: {
                        state: "shutDown",
                      },
                    })
                  );
                  setTimeout(() => {
                    try {
                      if (this.server?.config?.httpServer) {
                        this.server.shutDown();
                      }
                      this.log(
                        ` SHUTDOWN WEBSOCKET Server is listening on DOMAIN : ${this.domain}    PORT : ${this.port}`,
                        "INFO"
                      );
                      return resolve(true);
                    } catch (e) {
                      return reject(e);
                    }
                  }, 500);
                  return;
                }
                return resolve(true);
              })
          );

          if (this.server) {
            this.ready = true;
          }
          this.module.fire("onServersReady", this.type, this);
          this.log(
            `Listening on DOMAIN : ws://${this.domain}:${this.port}`,
            "INFO"
          );
          return this.server;
        } catch (e) {
          this.log(e, "ERROR");
          throw e;
        }
      }
    });
  }

  removePendingRequests(url: string) {
    if (url && this.server) {
      this.server.pendingRequests.forEach((request, index) => {
        if (request.httpRequest.url === url) {
          try {
            request.emit("requestResolved", request);
            request.emit("requestRejected", request);
            this.server?.pendingRequests.splice(index, 1);
          } catch (e) {}
        }
      });
    }
  }
}

export default Websocket;
