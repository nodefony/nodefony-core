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

import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import { createHttpTerminator, HttpTerminator } from "http-terminator";
//import net from "node:net";
import { AddressInfo } from "node:net";
import { TLSSocket } from "node:tls";

class ServerHttps extends Service {
  httpKernel: HttpKernel | null = null;
  httpTerminator: HttpTerminator | null = null;
  module: Module;
  server: https.Server | http2.Http2SecureServer | null = null;
  port: number;
  protocol: ProtocolType = "1.1";
  ready: boolean = false;
  type: ServerType = "https";
  domain: string;
  scheme: string = "https";
  address: string | null = null;
  family: FamilyType | null = null;
  active: boolean = false;
  infos: AddressInfo | null = null;

  constructor(module: Module, httpKernel: HttpKernel) {
    module: Module;
    super(
      "server-https",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.https
    );
    this.module = module;
    this.httpKernel = httpKernel;
    this.active = !!this.kernel?.options.servers.https;
    this.port = this.setPort();
    this.domain = this.kernel?.domain as string;
  }

  terminator(): HttpTerminator {
    if (this.server) {
      return createHttpTerminator({
        server: this.server,
      });
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
        const opt: https.ServerOptions = nodefony.extend({
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

        // LISTEN ON PORT
        this.server?.listen(this.port, this.domain, () => {
          this.ready = true;
          this.module.fire("onServersReady", this.type, this);
          this.infos = this.server?.address() as AddressInfo;
          if (this.infos) {
            this.port = this.infos.port;
            this.address = this.infos.address;
            this.family = this.infos.family as FamilyType;
          }
          resolve(this.server as https.Server);
        });

        this.server.on(
          "request",
          (request: http.IncomingMessage, response: http.ServerResponse) => {
            this.httpKernel?.onHttpRequest(request, response, this.type);
          }
        );

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
              (this.server as https.Server).closeAllConnections();
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

  createServerH2(): Promise<http2.Http2SecureServer> {
    return new Promise((resolve, reject) => {
      try {
        const opt: http2.SecureServerOptions = nodefony.extend({
          allowHTTP1: true,
          rejectUnauthorized: this.options.rejectUnauthorized,
          key: this.httpKernel?.serviceCerticats?.key,
          cert: this.httpKernel?.serviceCerticats?.cert,
          ca: this.httpKernel?.serviceCerticats?.ca
            ? this.httpKernel?.serviceCerticats?.ca
            : undefined,
        });
        this.server = http2.createSecureServer(opt);
        this.httpTerminator = this.terminator();
        // const buf = http2.getPackedSettings(this.options);
        // const defaultSetting2 = nodefony.extend(
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
            return this.httpKernel?.onHttpRequest(request, response, "http2");
          } else {
            return this.httpKernel?.onHttpRequest(request, response, "https");
          }
        });
        // LISTEN ON PORT
        this.server?.listen(this.port, this.domain, () => {
          this.ready = true;
          this.module.fire("onServersReady", this.type, this);
          this.infos = this.server?.address() as AddressInfo;
          if (this.infos) {
            this.port = this.infos.port;
            this.address = this.infos.address;
            this.family = this.infos.family as FamilyType;
          }
          return resolve(this.server as http2.Http2SecureServer);
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
              throw error;
              break;
            default:
              this.log(myError, "CRITIC");
          }
        });
        this.kernel?.once("onTerminate", () => {
          return new Promise(async (resolve, reject) => {
            if (this.server) {
              await this.httpTerminator?.terminate();
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

  showBanner(): void {
    if (this.infos) {
      this.log(
        `Server Listen on ${this.scheme}://${this.infos.address}:${this.infos.port} Family: ${this.infos.family} Protocol : ${this.protocol}`
      );
    }
  }
}

export default ServerHttps;
