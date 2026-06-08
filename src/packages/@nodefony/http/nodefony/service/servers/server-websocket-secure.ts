import Ws, { WebSocketServer, ServerOptions } from "ws";
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
import https from "node:https";
import httpsServers from "./server-https";
import {
  startHeartbeat,
  trackPong,
  type IWsHeartbeatOptions,
} from "./wsHeartbeat";

class WebsocketSecure extends Service {
  module: Module;
  ready: boolean = false;
  server: WebSocketServer | null = null;
  port: number;
  domain: string;
  protocol: ProtocolType = "1.1";
  family: FamilyType | null = null;
  scheme: SchemeType = "wss";
  address: string | null = null;
  type: ServerType = "websocket-secure";
  infos: AddressInfo | null = null;
  /** Timer keep-alive (UN par serveur). `null` si désactivé ou pas démarré. */
  heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  constructor(
    module: Module,
    @inject("HttpKernel") private httpKernel: HttpKernel,
  ) {
    super(
      "server-websocket-secure",
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
    if (this.kernel?.options.servers?.https) {
      return this.kernel?.options.servers?.https?.port || 0;
    }
    return 0;
  }

  async createServer(serverHttps: httpsServers): Promise<WebSocketServer> {
    return new Promise((resolve, reject) => {
      try {
        this.infos = (
          serverHttps.server as https.Server
        ).address() as AddressInfo;
        if (this.infos) {
          this.port = this.infos.port;
          this.address = this.infos.address;
          this.family = this.infos.family as FamilyType;
          this.protocol = serverHttps.protocol;
        }
        // Options `ws` issues de la config (perMessageDeflate, skipUTF8Validation,
        // autoPong, allowSynchronousEvents, maxPayload…) transmises telles quelles ;
        // `ws` ignore les knobs Nodefony (keepalive*/closeTimeout, qui ne sont PAS des
        // options `ws`). On force ce que Nodefony gère : `server` (le serveur HTTPS) +
        // `clientTracking` (requis par broadcast() et le heartbeat).
        // RFC 6455 §7.4.1 : `maxPayload` → close 1009 « Message Too Big ».
        this.server = new WebSocketServer({
          ...((this.options ?? {}) as ServerOptions),
          server: serverHttps.server as https.Server,
          clientTracking: true,
        });
        this.server.on("connection", this.onConnection.bind(this));
        // G2 — heartbeat keep-alive : UN seul interval/serveur, détecte les zombies.
        this.heartbeatTimer = startHeartbeat(
          this.server,
          this.options as IWsHeartbeatOptions,
        );
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
    // G2 — arme le suivi keep-alive (horodatage + listener `pong`) AVANT le pipeline.
    trackPong(ws);
    this.httpKernel.onWebsocketRequest(ws, req, this.type).catch(() => {
      process.nextTick(() => {
        return;
      });
    });
  }

  terminate(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // Toujours stopper le heartbeat (même si le serveur n'a jamais été ready).
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.server && this.ready) {
        const shutdownMsg = JSON.stringify({ nodefony: { state: "shutDown" } });
        this.server.clients.forEach((client) => {
          if (client.readyState === Ws.OPEN) {
            // Message applicatif (compat client qui écoute `state:shutDown`) PUIS
            // frame Close RFC 6455 §7.4.1 code 1001 "Going Away" : sans elle, le
            // `server.close()` coupe la socket TCP sans frame Close → le client voit
            // 1006 (Abnormal Closure, réservé) et ne peut pas distinguer un arrêt
            // propre (1001 → reconnexion normale) d'une coupure réseau (1006 → backoff).
            client.send(shutdownMsg);
            client.close(1001, "Server shutting down");
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

export default WebsocketSecure;
