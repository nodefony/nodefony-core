import {
  BootConfigurationError,
  nodefonyError,
  Service,
  type Module,
  FamilyType,
  Inject,
} from "nodefony";
import HttpKernel, {
  ProtocolType,
  ServerType,
  SchemeType,
} from "../http-kernel";

import http2 from "node:http2";
import { AddressInfo } from "node:net";
import { createDrainTerminator, type IDrainTerminator } from "./serverShutdown";
import { http2ServerLimits } from "../../src/servers/http2Limits";
import {
  bindWithFallback,
  buildBindPlan,
  h2cPortConflict,
} from "../../src/servers/portBinder";
import {
  asServersConfig,
  configuredServerPort,
  isH2cEnabled,
} from "../../src/servers/kernelServers";
import type { IHttpConfig } from "../../config/config";
import type { DefaultOptionsService } from "nodefony";

/**
 * Serveur HTTP/2 en clair (h2c, connaissance préalable — RFC 9113 §3.3), sur un
 * port DÉDIÉ (`servers.h2c`, 5153 par défaut), pour un proxy inverse qui parle
 * HTTP/2 à ses amonts.
 *
 * Il partage le chemin HTTP/2 du 5152 — même `onHttpRequest`, mêmes limites
 * anti-DoS (`http2ServerLimits`), même drain par GOAWAY — sans TLS : `serverType`
 * vaut `"http"`, le schéma vient du transport ou d'un proxy de confiance, jamais
 * du pseudo-en-tête `:scheme`. Le protocole du saut (`"h2c"`) se constate sur la
 * requête (`transport.ts#alpnProtocolOf`).
 *
 * Hors de son périmètre, délibérément : HTTP/1.1 (refusé par la préface HTTP/2 —
 * sondes et clients HTTP/1.1 restent sur le port HTTP), WebSocket (aucun CONNECT
 * étendu, RFC 8441 : un proxy route `Upgrade: websocket` vers le port HTTP) et la
 * bascule `Upgrade: h2c` (retirée par RFC 9113 §3.1).
 */
class ServerH2c extends Service {
  // Section `http` de la config du module : délais et drain communs aux serveurs en clair.
  declare public options: IHttpConfig["http"] & DefaultOptionsService;
  module: Module<IHttpConfig>;
  server: http2.Http2Server | null = null;
  httpTerminator: IDrainTerminator | null = null;
  port: number;
  protocol: ProtocolType = "2.0";
  ready: boolean = false;
  // Pas de TLS local : HSTS et schéma se décident comme pour le port HTTP.
  type: ServerType = "http";
  domain: string | null;
  scheme: SchemeType = "http";
  address: string | null = null;
  family: FamilyType | null = null;
  active: boolean = false;
  infos: AddressInfo | null = null;

  constructor(
    module: Module<IHttpConfig>,
    @Inject("HttpKernel") private readonly httpKernel: HttpKernel,
  ) {
    super(
      "server-h2c",
      module.container ?? undefined,
      module.notificationsCenter,
      module.config.http,
    );
    this.module = module;
    this.active = isH2cEnabled(
      asServersConfig(module.kernel?.options.servers)?.h2c,
    );
    this.port =
      configuredServerPort(
        asServersConfig(module.kernel?.options.servers),
        "h2c",
      ) ?? 0;
    this.domain = this.module.kernel?.domain ?? null;
  }

  /**
   * Crée et met en écoute le serveur h2c.
   *
   * @returns le serveur à l'écoute
   * @throws BootConfigurationError si `servers.h2c.port` est celui du serveur
   *   HTTP ou HTTPS — un port partagé n'est pas un conflit à contourner
   */
  createServer(): Promise<http2.Http2Server> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.active) {
          return reject(new Error(`Server h2c is not allowed in config file`));
        }
        const domain = this.domain;
        if (domain === null) {
          return reject(
            new Error(`Server h2c : aucun domaine d'écoute (kernel absent)`),
          );
        }
        const servers = asServersConfig(this.module.kernel?.options.servers);
        const conflict = h2cPortConflict(servers);
        if (conflict !== null) {
          return reject(
            new BootConfigurationError(
              `servers.h2c.port (${this.port}) est aussi celui de ` +
                `servers.${conflict}.port : HTTP/1.1 et h2c ne partagent pas ` +
                `un port. Choisir un port distinct pour servers.h2c.port.`,
            ),
          );
        }
        if (!servers?.http) {
          // Les sondes de santé et les WebSocket parlent HTTP/1.1 : sans port
          // HTTP, ils n'ont plus de porte (le port h2c refuse HTTP/1.1).
          this.log(
            `servers.h2c actif sans servers.http : les sondes de santé et les ` +
              `WebSocket (HTTP/1.1) n'ont plus de port où arriver.`,
            "WARNING",
          );
        }
        const server = http2.createServer(
          http2ServerLimits(this.module.config.http2),
        );
        this.server = server;
        this.httpTerminator = createDrainTerminator(
          server,
          this.options.shutdownTimeout,
        );
        // HTTP/2 n'a pas de délai d'inactivité par défaut : sans lui, une
        // session muette du proxy reste ouverte indéfiniment.
        if (this.options.timeout) {
          server.setTimeout(this.options.timeout, () => {
            this.fire("onTimeout", this);
          });
        }
        // `onHttpRequest` ne lève ni ne rejette jamais : rien à rattraper ici.
        server.on("request", (request, response) => {
          void this.httpKernel.onHttpRequest(request, response, this.type);
        });
        // Un client HTTP/1.1 (sonde mal routée) échoue sur la préface : session
        // détruite par Node. Bruit attendu, pas une panne → DEBUG.
        server.on("sessionError", (error) => {
          this.log(error, "DEBUG", "H2C sessionError");
        });
        server.on("streamError", (error) => {
          this.log(error, "ERROR", "H2C streamError");
        });
        this.module.fire("onCreateServer", this.type, this);
        bindWithFallback(
          server,
          domain,
          buildBindPlan("h2c", servers, this.module.kernel?.environment),
        )
          .then(({ address, shiftedFrom }) => {
            this.infos = address;
            this.port = address.port;
            this.address = address.address;
            this.family = familyOf(address);
            if (shiftedFrom !== null) {
              this.log(
                `Port ${shiftedFrom} déjà occupé → h2c écoute sur ${this.port}. ` +
                  `Figer le port : servers.h2c.port ; échouer au lieu de glisser : ` +
                  `servers.portPolicy = "strict".`,
                "WARNING",
              );
            }
            this.ready = true;
            this.module.fire("onServersReady", this.type, this);
            server.on("error", (error: NodeJS.ErrnoException) => {
              this.log(new nodefonyError(error), "CRITIC");
            });
            resolve(server);
          })
          .catch((e: unknown) => {
            const error = e instanceof Error ? e : new Error(String(e));
            this.log(new nodefonyError(error), "CRITIC");
            server.close();
            reject(error);
          });
        // Drain par GOAWAY (cf serverShutdown.ts) ; les WS n'existent pas ici.
        this.kernel?.once("onTerminate", async () => {
          if (!this.server) return;
          try {
            await this.httpTerminator?.terminate();
            this.log(`h2c SHUTDOWN PORT : ${this.port}`, "INFO");
          } catch (e) {
            // Shutdown best-effort : logger, ne jamais casser la terminaison.
            this.log(e, "ERROR", "TERMINATE");
          }
        });
      } catch (e) {
        this.log(e, "CRITIC");
        return reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  showBanner(): void {
    if (this.infos) {
      this.log(
        `Server Listen on h2c://${this.infos.address}:${this.infos.port} Family: ${this.infos.family} Protocol : ${this.protocol}`,
      );
    }
  }
}

/** Famille d'une adresse d'écoute, lue sans conversion (`AddressInfo.family` est une chaîne). */
function familyOf(address: AddressInfo): FamilyType {
  return address.family === "IPv6" ? "IPv6" : "IPv4";
}

export default ServerH2c;
