import Ws, { WebSocketServer } from "ws";
import {
  Service,
  Container,
  Event,
  Module,
  FamilyType,
  inject,
} from "nodefony";
import HttpKernel, {
  ProtocolType,
  ServerType,
  SchemeType,
} from "../http-kernel";
import { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import http from "node:http";
import httpServer from "./server-http";

class Websocket extends Service {
  module: Module;
  ready: boolean = false;
  server: WebSocketServer | null = null;
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
    @inject("HttpKernel") private httpKernel: HttpKernel,
  ) {
    super(
      "server-websocket",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.websocket,
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

  async createServer(serverHttp: httpServer): Promise<WebSocketServer> {
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
        // RFC 6455 §7.4.1 — `maxPayload` borne la taille des messages entrants ;
        // au-delà `ws` ferme avec le code 1009 « Message Too Big ». Défaut sûr
        // (1 MiB) défini en config (anti-DoS mémoire), surchargeable par l'app.
        const maxPayload = (this.options as { maxPayload?: number }).maxPayload;
        this.server = new WebSocketServer({
          server: serverHttp.server as http.Server,
          maxPayload,
        });
        this.server.on("connection", this.onConnection.bind(this));
        this.kernel?.prependOnceListener(
          "onTerminate",
          this.terminate.bind(this),
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

  onConnection(ws: Ws, req: IncomingMessage): void {
    this.httpKernel.onWebsocketRequest(ws, req, this.type).catch(() => {
      process.nextTick(() => {
        return;
      });
    });
  }

  terminate(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.server && this.ready) {
        const shutdownMsg = JSON.stringify({ nodefony: { state: "shutDown" } });
        this.server.clients.forEach((client) => {
          if (client.readyState === Ws.OPEN) {
            client.send(shutdownMsg);
          }
        });
        setTimeout(() => {
          try {
            this.server?.close();
            this.log(
              ` SHUTDOWN WEBSOCKET Server is listening on DOMAIN : ${this.domain}    PORT : ${this.port}`,
              "INFO",
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

  showBanner(): void {
    if (this.infos) {
      this.log(
        `Server Listen on ${this.scheme}://${this.infos.address}:${this.infos.port} Family: ${this.infos.family} Protocol : ${this.protocol}`,
      );
    }
  }
}

export default Websocket;
