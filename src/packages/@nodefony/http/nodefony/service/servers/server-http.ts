import {
  extend,
  nodefonyError,
  Service,
  //Kernel,
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

import http from "node:http";
import http2 from "node:http2";
import { AddressInfo } from "node:net";
import { handleClientError } from "./clientError";
import { createDrainTerminator, HttpTerminator } from "./serverShutdown";
import {
  bindWithFallback,
  buildBindPlan,
  type Listenable,
} from "../../src/servers/portBinder";

class ServerHttp extends Service {
  module: Module;
  server: http.Server | http2.Http2Server | null = null;
  httpTerminator: HttpTerminator | null = null;
  port: number;
  protocol: ProtocolType = "1.1";
  ready: boolean = false;
  type: ServerType = "http";
  domain: string;
  scheme: SchemeType = "http";
  address: string | null = null;
  family: FamilyType | null = null;
  active: boolean = false;
  infos: AddressInfo | null = null;

  constructor(
    module: Module,
    @inject("HttpKernel") private httpKernel: HttpKernel,
  ) {
    module: Module;
    super(
      "server-http",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.http,
    );
    this.module = module;
    this.active = !!module.kernel?.options.servers.http;
    this.port = this.setPort();
    this.domain = this.module.kernel?.domain as string;
  }

  setPort(): number {
    if (this.module.kernel?.options.servers?.http) {
      return this.module.kernel?.options.servers?.http?.port || 0;
    }
    return 0;
  }

  createServer(): Promise<http.Server | http2.Http2Server> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.active) {
          const e = new Error(`Server http is not allowed in config file `);
          return reject(e);
        }
        const opt: http.ServerOptions = extend({
          requestTimeout: this.options.requestTimeout,
        });
        this.server = http.createServer(opt);
        this.httpTerminator = createDrainTerminator(
          this.server as http.Server,
          this.options.shutdownTimeout,
        );
        if (this.options.maxHeadersCount) {
          if (this.server) {
            this.server.maxHeadersCount = this.options.maxHeadersCount;
          }
        }
        if (this.options.timeout) {
          if (this.server) {
            this.server.setTimeout(this.options.timeout, () => {
              this.fire("onTimeout", this);
            });
            this.server.timeout = this.options.timeout;
          }
        }
        if (this.options.keepAliveTimeout) {
          if (this.server) {
            this.server.keepAliveTimeout = this.options.keepAliveTimeout;
          }
        }
        this.server.on("request", (request, response) =>
          this.httpKernel
            ?.onHttpRequest(request, response, this.type)
            .catch(() => {
              return;
            }),
        );
        this.module.fire("onCreateServer", this.type, this);
        // LISTEN — en `portPolicy: "auto"` (défaut dev), un port occupé fait
        // glisser l'écoute au prochain port libre au lieu de tuer le boot. Le
        // handler d'erreur DURABLE n'est posé qu'APRÈS : sinon il verrait passer
        // les EADDRINUSE de repli et terminerait le kernel en croyant à une panne.
        bindWithFallback(
          this.server as unknown as Listenable,
          this.domain,
          buildBindPlan(
            "http",
            this.module.kernel?.options.servers,
            this.module.kernel?.environment,
          ),
        )
          .then(({ address, shiftedFrom }) => {
            this.infos = address;
            this.port = address.port;
            this.address = address.address;
            this.family = address.family as FamilyType;
            if (shiftedFrom !== null) {
              // Fail-loud : une app qui écoute ailleurs que là où on l'attend
              // DOIT le dire (cf resilience — jamais de dégradation silencieuse).
              this.log(
                `Port ${shiftedFrom} déjà occupé → HTTP écoute sur ${this.port}. ` +
                  `Figer le port : servers.http.port ; échouer au lieu de glisser : ` +
                  `servers.portPolicy = "strict".`,
                "WARNING",
              );
            }
            this.ready = true;
            this.module.fire("onServersReady", this.type, this);
            this.attachErrorHandler();
            resolve(this.server as http.Server);
          })
          .catch((error: NodeJS.ErrnoException) => {
            this.reportBindError(error);
            reject(error);
          });
        // Drain graceful (SIGTERM/docker stop) : les requêtes in-flight se
        // terminent, destruction forcée après `shutdownTimeout` ms. Remplace
        // `closeAllConnections()` qui coupait les requêtes en cours. Le
        // terminator appelle `server.close()` lui-même. Les WS upgradées sont
        // fermées AVANT (listeners prepend) — cf serverShutdown.ts.
        this.kernel?.once("onTerminate", async () => {
          if (!this.server) {
            return;
          }
          try {
            await this.httpTerminator?.terminate();
            this.log(
              `${this.type} SHUTDOWN Server is listening on DOMAIN : ${this.domain}    PORT : ${this.port}`,
              "INFO",
            );
          } catch (e) {
            // Shutdown best-effort : logger, ne jamais casser la terminaison.
            this.log(e, "ERROR", "TERMINATE");
          }
        });

        this.server.on("clientError", (e, socket) => {
          this.fire("onClientError", e, socket);
          // Node désactive la fermeture auto dès qu'un listener existe → on
          // répond + ferme nous-mêmes (sinon fuite de socket/FD = DoS).
          handleClientError(e as NodeJS.ErrnoException, socket);
        });
      } catch (e) {
        this.log(e, "CRITIC");
        return reject(e);
      }
    });
  }

  /**
   * Handler d'erreur DURABLE — posé une fois le serveur en écoute.
   *
   * Il ne traite donc plus `EADDRINUSE` au bind (le binder s'en charge, avec ou
   * sans repli) : il couvre les erreurs de la VIE du serveur.
   */
  private attachErrorHandler(): void {
    this.server?.on("error", (error: NodeJS.ErrnoException) => {
      this.log(new nodefonyError(error), "CRITIC");
    });
  }

  /**
   * Le bind a échoué pour de bon — soit `portPolicy: "strict"`, soit tous les
   * ports de repli étaient pris, soit une erreur qui n'est pas un conflit de port.
   *
   * Reste FATAL (contrat inchangé) : un serveur qui n'écoute pas ne doit jamais
   * laisser le process traîner en se croyant démarré.
   */
  private reportBindError(error: NodeJS.ErrnoException): void {
    const myError = new nodefonyError(error);
    switch (error.code) {
      case "ENOTFOUND":
        this.log(
          `CHECK DOMAIN IN /etc/hosts or config unable to connect to : ${this.domain}`,
          "ERROR",
        );
        this.log(myError, "CRITIC");
        break;
      case "EADDRINUSE":
        this.log(
          `Port ${this.port} déjà occupé (domaine ${this.domain}) — le serveur HTTP ` +
            `ne peut pas écouter. Libérer le port, en choisir un autre ` +
            `(servers.http.port), ou autoriser le repli automatique ` +
            `(servers.portPolicy = "auto", défaut en développement).`,
          "ERROR",
        );
        this.log(myError, "CRITIC");
        break;
      default:
        this.log(myError, "CRITIC");
    }
    this.server?.close();
    setTimeout(() => this.kernel?.terminate(1), 1000);
  }

  showBanner(): void {
    if (this.infos) {
      this.log(
        `Server Listen on ${this.scheme}://${this.infos.address}:${this.infos.port} Family: ${this.infos.family} Protocol : ${this.protocol}`,
      );
    }
  }
}

export default ServerHttp;
