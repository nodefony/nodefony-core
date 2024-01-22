import nodefony, {
  Service,
  Kernel,
  Container,
  Event,
  Module,
  FamilyType,
} from "nodefony";
import HttpKernel, { ProtocolType, ServerType } from "./http-kernel";

import http from "node:http";
import { AddressInfo } from "node:net";
import { timingSafeEqual } from "node:crypto";

class ServerHttp extends Service {
  httpKernel: HttpKernel | null = null;
  module: Module;
  server: http.Server | null = null;
  port: number;
  protocol: ProtocolType = "1.1";
  ready: boolean = false;
  type: ServerType = "http";
  domain: string;
  scheme: string = "http";
  address: string | null = null;
  family: FamilyType | null = null;
  active: boolean = false;
  infos: AddressInfo | null = null;

  constructor(module: Module, httpKernel: HttpKernel) {
    module: Module;
    super(
      "http",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.http
    );
    this.module = module;
    this.httpKernel = httpKernel;
    this.active = !!module.kernel?.options.servers.http;
    this.port = this.setPort();
    this.domain = this.module.kernel?.domain as string;
    this.once("onReady", async () => {
      this.onReady();
    });
  }

  setPort(): number {
    if (this.module.kernel?.options.servers?.http) {
      return this.module.kernel?.options.servers?.http?.port || 0;
    }
    return 0;
  }

  onReady(): void {
    this.log("SERVICE HTTP ");
    this.createServer();
  }

  createServer(): http.Server {
    try {
      if (!this.active) {
        throw new Error(`Server http is not allowed in config file `);
      }
      this.server = http.createServer();
      this.module.fire("onCreateServer", this.type, this);
    } catch (e) {
      this.log(e, "CRITIC");
      throw e;
    }

    this.server.on("request", (request, response) =>
      this.httpKernel?.onHttpRequest(request, response, this.type)
    );

    if (this.options.timeout) {
      this.server.timeout = this.options.timeout;
    }

    if (this.options.maxHeadersCount) {
      this.server.maxHeadersCount = this.options.maxHeadersCount;
    }

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
      if (this.infos) {
        this.showBanner();
      }
    });

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

    this.once(
      "onTerminate",
      () =>
        new Promise((resolve, reject) => {
          if (this.server) {
            this.server.closeAllConnections();
            this.server.close(() => {
              this.log(
                `${this.type} SHUTDOWN Server is listening on DOMAIN : ${this.domain}    PORT : ${this.port}`,
                "INFO"
              );
              return resolve(true);
            });
            return;
          }
          return resolve(true);
        })
    );

    this.server.on("clientError", (e, socket) => {
      this.fire("onClientError", e, socket);
    });

    return this.server;
  }

  showBanner(): void {
    if (this.infos) {
      this.log(
        `Server ${this.type} Family : ${this.infos.family} Ready on ${this.scheme}://${this.infos.address}:${this.infos.port}`
      );
    }
  }
}

export default ServerHttp;
