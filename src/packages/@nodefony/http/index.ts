import { Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import HttpKernel from "./nodefony/service/http-kernel";
import HttpServer from "./nodefony/service/servers/server-http";
import HttpsServer from "./nodefony/service/servers/server-https";
import WebsocketServer from "./nodefony/service/servers/server-websocket";
import WebsocketSecureServer from "./nodefony/service/servers/server-websocket-secure";
import StaticServer from "./nodefony/service/servers/server-static";
import networkCommand from "./nodefony/command/networkCommand";
import SessionsService from "./nodefony/service/sessions/sessions-service";
import Certificate from "./nodefony/service/certificates";
import Context from "./nodefony/src/context/Context";
import Session from "./nodefony/src/session/session";
import HttpError from "./nodefony/src/errors/httpError";
import Response from "./nodefony/src/context/http/Response";
import Http2Response from "./nodefony/src/context/http2/Response";
import wsResponse from "./nodefony/src/context/websocket/Response";
import Cookie from "./nodefony/src/cookies/cookie";
import UploadService from "./nodefony/service/upload/upload-service";
import HttpContext from "./nodefony/src/context/http/HttpContext";

@services([
  HttpKernel,
  Certificate,
  SessionsService,
  StaticServer,
  HttpServer,
  HttpsServer,
  WebsocketServer,
  WebsocketSecureServer,
  UploadService,
])
class Http extends Module {
  //httpKernel: HttpKernel | null = null;
  constructor(kernel: Kernel) {
    super("http", kernel, import.meta.url, config);
    this.addCommand(networkCommand);
  }

  // async initialize(): Promise<this> {
  //   this.httpKernel = (await this.addService(
  //     HttpKernel,
  //     this.kernel
  //   )) as HttpKernel;
  //   await this.addService(Certificate, this.httpKernel);
  //   return this;
  // }

  override async onKernelReady(): Promise<this> {
    try {
      //this.log(`MODULE ${this.name} READY`, "DEBUG");
      //await this.addService(sessionService, this.httpKernel);
      //await this.addService(HttpServer, this.httpKernel);
      //await this.addService(HttpsServer, this.httpKernel);
      //await this.addService(StaticServer, this.httpKernel);
      //await this.addService(WebsocketServer, this.httpKernel);
      //await this.addService(WebsocketSecureServer, this.httpKernel);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
    return this;
  }
}

export default Http;

export {
  Context,
  Session,
  SessionsService,
  HttpError,
  HttpKernel,
  Response,
  Http2Response,
  Response as HttpResponse,
  wsResponse,
  wsResponse as WebsocketResponse,
  Cookie,
  HttpContext,
};
