// https://github.com/Worlize/WebSocket-Node/wiki/Documentation

import websocket from "websocket";
import {
  extend,
  Service,
  //Kernel,
  Container,
  Event,
  Module,
  FamilyType,
  //DefaultOptionsService,
  inject,
} from "nodefony";
import HttpKernel, {
  ProtocolType,
  ServerType,
  SchemeType,
} from "../http-kernel";
import { AddressInfo } from "node:net";
import http from "node:http";
import httpServer from "./server-http";

class Websocket extends Service {
  module: Module;
  ready: boolean = false;
  server: websocket.server | null = null;
  port: number;
  domain: string;
  protocol: ProtocolType = "1.1";
  family: FamilyType | null = null;
  scheme: SchemeType = "ws";
  address: string | null = null;
  type: ServerType = "websocket";
  infos: AddressInfo | null = null;
  constructor(
    module: Module,
    @inject("HttpKernel") private httpKernel: HttpKernel
    //@inject("server-http") private http: httpServer
  ) {
    super(
      "server-websocket",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.websocket
    );
    this.module = module;
    this.port = this.setPort();
    this.domain = this.kernel?.domain as string;
    this.ready = false;
  }

  setPort(): number {
    if (this.kernel?.options.servers?.http) {
      return this.kernel?.options.servers?.http?.port || 0;
    }
    return 0;
  }

  async createServer(serverHttp: httpServer): Promise<websocket.server> {
    return new Promise((resolve, reject) => {
      try {
        this.infos = (
          serverHttp.server as http.Server
        ).address() as AddressInfo;
        if (this.infos) {
          this.port = this.infos.port;
          this.address = this.infos.address;
          this.family = this.infos.family as FamilyType;
          this.protocol = serverHttp.protocol;
        }
        const conf: websocket.IServerConfig = extend(true, {}, this.options);
        conf.httpServer = serverHttp.server as http.Server;
        this.server = new websocket.server(conf);
        this.server.on("request", this.onRequest.bind(this));
        this.kernel?.prependOnceListener(
          "onTerminate",
          this.terminate.bind(this)
        );
        if (this.server) {
          this.ready = true;
        }
        this.module.fire("onServersReady", this.type, this);
        return resolve(this.server);
      } catch (e) {
        this.log(e, "ERROR");
        return reject(e);
      }
    });
  }

  async onRequest(request: websocket.request): Promise<void> {
    return this.httpKernel.onWebsocketRequest(request, this.type).catch(() => {
      process.nextTick(() => {
        return;
      });
    });
  }

  terminate(): Promise<boolean> {
    return new Promise((resolve, reject) => {
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
        }, 300);
      }
      return resolve(true);
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

  showBanner(): void {
    if (this.infos) {
      this.log(
        `Server Listen on ${this.scheme}://${this.infos.address}:${this.infos.port} Family: ${this.infos.family} Protocol : ${this.protocol}`
      );
    }
  }
}

export default Websocket;
