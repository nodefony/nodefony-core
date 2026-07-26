import {
  extend,
  nodefonyError,
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

import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import { createDrainTerminator, HttpTerminator } from "./serverShutdown";
//import net from "node:net";
import { AddressInfo } from "node:net";
import { TLSSocket } from "node:tls";
import { handleClientError } from "./clientError";
import {
  bindWithFallback,
  buildBindPlan,
  type Listenable,
} from "../../src/servers/portBinder";

class ServerHttps extends Service {
  //httpKernel: HttpKernel | null = null;
  httpTerminator: HttpTerminator | null = null;
  module: Module;
  server: https.Server | http2.Http2SecureServer | null = null;
  port: number;
  protocol: ProtocolType = "1.1";
  ready: boolean = false;
  type: ServerType = "https";
  domain: string;
  scheme: SchemeType = "https";
  address: string | null = null;
  family: FamilyType | null = null;
  active: boolean = false;
  infos: AddressInfo | null = null;

  constructor(
    module: Module,
    @inject("HttpKernel") private httpKernel: HttpKernel,
  ) {
    Module;
    super(
      "server-https",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.https,
    );
    this.module = module;
    this.active = !!this.kernel?.options.servers.https;
    this.port = this.setPort();
    this.domain = this.kernel?.domain as string;
  }

  terminator(): HttpTerminator {
    if (this.server) {
      return createDrainTerminator(this.server, this.options.shutdownTimeout);
    }
    throw new Error(`Server not found`);
  }

  setPort(): number {
    if (this.kernel?.options.servers?.https) {
      return this.kernel?.options.servers?.https?.port || 0;
    }
    return 0;
  }

  createServer(): Promise<https.Server | http2.Http2SecureServer> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.active) {
          const e = new Error(`Server https is not allowed in config file `);
          return reject(e);
        }
        this.protocol = this.kernel?.options.servers.https.protocol;
        if (this.protocol === "2.0") {
          return resolve(this.createServerH2());
        }
        const opt: https.ServerOptions = extend({
          requestTimeout: this.options.requestTimeout,
          rejectUnauthorized: this.options.rejectUnauthorized,
          key: this.httpKernel?.serviceCerticats?.key,
          cert: this.httpKernel?.serviceCerticats?.cert,
          ca: this.httpKernel?.serviceCerticats?.ca
            ? this.httpKernel?.serviceCerticats?.ca
            : undefined,
        });

        this.server = https.createServer(opt);
        this.httpTerminator = this.terminator();
        if (this.options.timeout) {
          if (this.server) {
            this.server.setTimeout(this.options.timeout, () => {
              this.fire("onTimeout", this);
            });
            this.server.timeout = this.options.timeout;
          }
        }
        if (this.options.maxHeadersCount) {
          if (this.server) {
            this.server.maxHeadersCount = this.options.maxHeadersCount;
          }
        }
        if (this.options.keepAliveTimeout) {
          if (this.server) {
            this.server.keepAliveTimeout = this.options.keepAliveTimeout;
          }
        }
        this.module.fire("onCreateServer", this.type, this);

        // LISTEN — repli de port en `auto` (défaut dev). Le handler d'erreur
        // durable n'est posé qu'APRÈS le bind (cf server-http.ts).
        this.listenWithPolicy()
          .then(() => resolve(this.server as https.Server))
          .catch((error: NodeJS.ErrnoException) => {
            this.reportBindError(error);
            reject(error);
          });

        this.server.on(
          "request",
          (request: http.IncomingMessage, response: http.ServerResponse) => {
            this.httpKernel
              ?.onHttpRequest(request, response, this.type)
              .catch(() => {
                return;
              });
          },
        );

        // Drain graceful (SIGTERM/docker stop) : in-flight terminées, destroy
        // forcé après `shutdownTimeout` ms. Remplace `closeAllConnections()`
        // qui coupait les requêtes en cours. Le terminator close() le serveur.
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

  createServerH2(): Promise<http2.Http2SecureServer> {
    return new Promise((resolve, reject) => {
      try {
        const h2Cfg =
          (
            this.module?.options as {
              http2?: {
                maxConcurrentStreams?: number;
                maxSessionMemory?: number;
              };
            }
          )?.http2 ?? {};
        const opt: http2.SecureServerOptions = extend({
          allowHTTP1: true,
          rejectUnauthorized: this.options.rejectUnauthorized,
          key: this.httpKernel?.serviceCerticats?.key,
          cert: this.httpKernel?.serviceCerticats?.cert,
          ca: this.httpKernel?.serviceCerticats?.ca
            ? this.httpKernel?.serviceCerticats?.ca
            : undefined,
        });
        // Limites anti-DoS HTTP/2 (cf config http2). Appliquées seulement si
        // définies → sinon défauts Node conservés (pas de régression).
        if (h2Cfg.maxSessionMemory) {
          opt.maxSessionMemory = h2Cfg.maxSessionMemory;
        }
        if (h2Cfg.maxConcurrentStreams) {
          opt.settings = {
            ...opt.settings,
            maxConcurrentStreams: h2Cfg.maxConcurrentStreams,
          };
        }
        this.server = http2.createSecureServer(opt);
        this.httpTerminator = this.terminator();
        // Timeout HTTP/2 — sur Http2Server le timeout d'inactivité par défaut
        // est 0 (désactivé) → sessions lentes/idle non bornées. setTimeout()
        // borne l'inactivité de session (keepAliveTimeout est un concept HTTP/1).
        if (this.options.timeout) {
          this.server.setTimeout(this.options.timeout, () => {
            this.fire("onTimeout", this);
          });
        }
        // const buf = http2.getPackedSettings(this.options);
        // const defaultSetting2 = extend(
        //   {},
        //   http2.getDefaultSettings(),
        //   http2.getUnpackedSettings(buf) || {}
        // );
        this.server.on("request", (request, response) => {
          let alpnProtocol: string | false | null = false;
          if (request && request.stream && request.stream.session?.socket) {
            if (request.stream.session.socket instanceof TLSSocket) {
              alpnProtocol = request.stream.session.socket.alpnProtocol;
            }
          }
          if (request.socket) {
            if (request.socket instanceof TLSSocket) {
              alpnProtocol = request.socket.alpnProtocol;
            }
          }
          if (alpnProtocol === "h2") {
            return this.httpKernel
              ?.onHttpRequest(request, response, "http2")
              .catch(() => {});
          } else {
            return this.httpKernel
              ?.onHttpRequest(request, response, "https")
              .catch(() => {});
          }
        });
        // LISTEN — repli de port en `auto` (défaut dev), même politique que la
        // branche HTTP/1.1 ci-dessus. Le `throw` qui vivait ICI dans le handler
        // `error` était une bombe : lancé depuis un écouteur d'EventEmitter, il
        // ne remontait à personne (exception non capturée), et le `break` qui le
        // suivait était mort.
        this.listenWithPolicy()
          .then(() => resolve(this.server as http2.Http2SecureServer))
          .catch((error: NodeJS.ErrnoException) => {
            this.reportBindError(error);
            reject(error);
          });
        // P7 — handler async direct (plus de `new Promise(async …)`) : un rejet
        // de `terminate()` remontait en unhandledRejection au shutdown.
        // Le terminator draine puis close() le serveur lui-même.
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

        this.server.on("sessionError", (error) => {
          this.log(error, "ERROR", "HTTP2 Server sessionError");
        });
        this.server.on("streamError", (error) => {
          this.log(error, "ERROR", "HTTP2 Server streamError");
        });
      } catch (e) {
        return reject(e);
      }
    });
  }

  /**
   * Écoute selon `servers.portPolicy`, commune aux deux branches TLS (HTTP/1.1 et
   * HTTP/2) — leur seule différence est le type du serveur, pas la politique.
   *
   * Pose le handler d'erreur durable une fois en écoute (donc APRÈS les éventuels
   * `EADDRINUSE` de repli, qui ne sont pas des pannes).
   */
  private async listenWithPolicy(): Promise<void> {
    const { address, shiftedFrom } = await bindWithFallback(
      this.server as unknown as Listenable,
      this.domain,
      buildBindPlan(
        "https",
        this.module.kernel?.options.servers,
        this.module.kernel?.environment,
      ),
    );
    this.infos = address;
    this.port = address.port;
    this.address = address.address;
    this.family = address.family as FamilyType;
    if (shiftedFrom !== null) {
      // Fail-loud : le décalage est ANNONCÉ, jamais subi en silence.
      this.log(
        `Port ${shiftedFrom} déjà occupé → HTTPS écoute sur ${this.port}. ` +
          `Figer le port : servers.https.port ; échouer au lieu de glisser : ` +
          `servers.portPolicy = "strict".`,
        "WARNING",
      );
    }
    this.ready = true;
    this.module.fire("onServersReady", this.type, this);
    this.attachErrorHandler();
  }

  /** Erreurs de la VIE du serveur (le bind est déjà passé — cf server-http.ts). */
  private attachErrorHandler(): void {
    this.server?.on("error", (error: NodeJS.ErrnoException) => {
      this.log(new nodefonyError(error), "CRITIC");
    });
  }

  /** Bind définitivement impossible → FATAL (contrat inchangé). */
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
          `Port ${this.port} déjà occupé (domaine ${this.domain}) — le serveur HTTPS ` +
            `ne peut pas écouter. Libérer le port, en choisir un autre ` +
            `(servers.https.port), ou autoriser le repli automatique ` +
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

export default ServerHttps;
