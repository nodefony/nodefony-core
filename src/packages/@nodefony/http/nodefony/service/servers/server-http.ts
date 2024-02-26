import nodefony, {
  Service,
  Kernel,
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

class ServerHttp extends Service {
  module: Module;
  server: http.Server | http2.Http2Server | null = null;
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
    @inject("HttpKernel") private httpKernel: HttpKernel
  ) {
    module: Module;
    super(
      "server-http",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.http
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
        const opt: http.ServerOptions = nodefony.extend({
          requestTimeout: this.options.requestTimeout,
        });
        this.server = http.createServer(opt);
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
          this.httpKernel?.onHttpRequest(request, response, this.type)
        );
        // LISTEN ON PORT
        this.server.listen(this.port, this.domain, () => {
          this.ready = true;
          this.module.fire("onServersReady", this.type, this);
          this.infos = this.server?.address() as AddressInfo;
          if (this.infos) {
            this.port = this.infos.port;
            this.address = this.infos.address;
            this.family = this.infos.family as FamilyType;
          }
          resolve(this.server as http.Server);
        });
        this.module.fire("onCreateServer", this.type, this);
        this.server.on("error", (error) => {
          const myError = new nodefony.Error(error);
          const txtError =
            typeof error.code === "string" ? error.code : error.errno;
          switch (txtError) {
            case "ENOTFOUND":
              this.log(
                `CHECK DOMAIN IN /etc/hosts or config unable to connect to : ${this.domain}`,
                "ERROR"
              );
              this.log(myError, "CRITIC");
              break;
            case "EADDRINUSE":
              this.log(
                `Domain : ${this.domain} Port : ${this.port} ==> ALREADY USE `,
                "ERROR"
              );
              this.log(myError, "CRITIC");
              this.server?.close();
              setTimeout(() => this.kernel?.terminate(1), 1000);
              break;
            default:
              this.log(myError, "CRITIC");
          }
        });
        this.kernel?.once("onTerminate", () => {
          return new Promise((resolve, reject) => {
            if (this.server) {
              (this.server as http.Server).closeAllConnections();
              return this.server.close(() => {
                this.log(
                  `${this.type} SHUTDOWN Server is listening on DOMAIN : ${this.domain}    PORT : ${this.port}`,
                  "INFO"
                );
                return resolve(true);
              });
            }
            return resolve(true);
          });
        });

        this.server.on("clientError", (e, socket) => {
          this.fire("onClientError", e, socket);
        });
      } catch (e) {
        this.log(e, "CRITIC");
        return reject(e);
      }
    });
  }

  showBanner(): void {
    if (this.infos) {
      this.log(
        `Server Listen on ${this.scheme}://${this.infos.address}:${this.infos.port} Family: ${this.infos.family} Protocol : ${this.protocol}`
      );
    }
  }
}

export default ServerHttp;
