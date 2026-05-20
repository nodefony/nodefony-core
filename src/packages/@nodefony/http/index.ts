import { Kernel, Module, services } from "nodefony";
import type { IAdminRegistry } from "nodefony";
import config from "./nodefony/config/config";
import { createHttpAdminApi } from "./nodefony/service/HttpAdminApi";
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
import DefaultErrorRenderer from "./nodefony/service/error-renderer";
import DefaultRequestLogger from "./nodefony/service/request-logger";
import JsonAuditLogger from "./nodefony/service/audit-logger";
import PrettyRequestLogger from "./nodefony/service/pretty-request-logger";
import HttpContext from "./nodefony/src/context/http/HttpContext";
import WebsocketContext from "./nodefony/src/context/websocket/WebsocketContext";
import HttpRequest from "./nodefony/src/context/http/Request";
import Http2Request from "./nodefony/src/context/http2/Request";

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

  /**
   * Phase `onBoot` : s'enregistre comme producteur admin (`/nodefony/http/api/*`)
   * auprès du broker, AVANT que framework ne monte le data plane à `onReady`.
   *
   * Importe seulement `IAdminRegistry` (core) — jamais `@nodefony/framework`
   * (dépendance circulaire). Le broker est résolu du container partagé.
   */
  override async onKernelBoot(): Promise<this> {
    const registry = this.kernel?.container?.get("adminBroker") as
      | IAdminRegistry
      | undefined;
    if (registry && !registry.has("http")) {
      registry.register(createHttpAdminApi(this));
    }
    return this;
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
  WebsocketContext,
  HttpRequest,
  Http2Request,
  DefaultErrorRenderer,
  DefaultRequestLogger,
  JsonAuditLogger,
  PrettyRequestLogger,
};

// Public interfaces — consommables par les autres modules
export type {
  IContext,
  IHttpContext,
  IWebsocketContext,
  ServerType,
  SchemeType,
  WebSocketStateType,
  CookiesMap,
} from "./nodefony/interfaces/IContext";
export type {
  ICookie,
  ICookieOptions,
  IWsCookie,
  SameSiteType,
  PriorityType,
} from "./nodefony/interfaces/ICookie";
export type {
  ISession,
  ISessionStorage,
  SessionStatusType,
  SessionStrategyType,
  FlashBagType,
  MetaBagType,
} from "./nodefony/interfaces/ISession";
export type {
  IHttpRequest,
  IHttp2Request,
  IWsRequest,
  HTTPMethodType,
} from "./nodefony/interfaces/IRequest";
export type {
  IHttpResponse,
  IWebsocketResponse,
} from "./nodefony/interfaces/IResponse";
export type { IHttpKernel } from "./nodefony/interfaces/IHttpKernel";
export type { IUploadedFile, IUploadService } from "./nodefony/interfaces/IUpload";
export type {
  IErrorRenderer,
  IErrorHttpResult,
  IErrorWebsocketResult,
} from "./nodefony/interfaces/IErrorRenderer";
export type {
  IRequestLogger,
  IRequestLogEntry,
} from "./nodefony/interfaces/IRequestLogger";
export type {
  AuditLogEntry,
  AuditErrorEntry,
  JsonAuditLoggerOptions,
} from "./nodefony/service/audit-logger";

// Types internes réexportés pour les modules dépendants (framework, security)
export type {
  ContextType,
  httpRequest,
  httpResponse,
  ProtocolType,
} from "./nodefony/service/http-kernel";
export type {
  contextRequest,
  contextResponse,
  HTTPMethod,
  WebSocketState,
  Cookies,
} from "./nodefony/src/context/Context";
