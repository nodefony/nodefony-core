import { Kernel, Module, services } from "nodefony";
import type { IAdminRegistry } from "nodefony";
import config from "./nodefony/config/config";
import {
  defineHttpConfig,
  httpConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";
import type {
  IHttpConfig,
  IHttpConfigInput,
} from "./nodefony/interfaces/IHttpConfig";
import { createHttpAdminApi } from "./nodefony/service/HttpAdminApi";
import { createProfilerAdminApi } from "./nodefony/service/ProfilerAdminApi";
import { Profiler } from "./nodefony/src/profiler/Profiler";
import HttpKernel from "./nodefony/service/http-kernel";
import HttpServer from "./nodefony/service/servers/server-http";
import HttpsServer from "./nodefony/service/servers/server-https";
import WebsocketServer from "./nodefony/service/servers/server-websocket";
import WebsocketSecureServer from "./nodefony/service/servers/server-websocket-secure";
import StaticServer from "./nodefony/service/servers/server-static";
import networkCommand from "./nodefony/command/networkCommand";
import certificatesCommand from "./nodefony/command/certificatesCommand";
import proxyGenerateCommand from "./nodefony/command/proxyGenerateCommand";
import assetsPublishCommand from "./nodefony/command/assetsPublishCommand";
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

// Augmente le registre de config des modules → `use("@nodefony/http", { … })`
// propose les clés typées (rateLimit, session, securityHeaders…) en complétion.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/http": IHttpConfigInput;
  }
}

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
class Http extends Module<IHttpConfig> {
  //httpKernel: HttpKernel | null = null;
  constructor(kernel: Kernel) {
    super("http", kernel, import.meta.url, config);
    this.addCommand(networkCommand);
    this.addCommand(certificatesCommand);
    this.addCommand(proxyGenerateCommand);
    this.addCommand(assetsPublishCommand);
  }

  /**
   * Expose le JSON Schema de la config http (dérivé du schéma Zod, flags `meta()`
   * inclus) au data plane admin → Studio rend la config en réglages documentés
   * (type, défaut, état, valeur effective) au lieu d'un dump brut. Override du
   * seam {@link Module.configSchema}.
   */
  override configSchema(): unknown {
    return httpConfigJsonSchema();
  }

  /**
   * Phase `onRegister` : valide la config (défauts + override `module-http` +
   * défauts kernel) via `defineHttpConfig`, puis la ré-assigne à `this.options`
   * AVANT l'instanciation des `@services` (phase `onBoot`). Plante propre avec
   * messages clairs si la config est invalide (convention Zod figée 2026-05-28).
   *
   * Config NON gelée : les services mutent `module.options` (upload `uploadDir`,
   * certificats `serialNumber`) — cf `defineHttpConfig`.
   */
  override async onKernelRegister(): Promise<this> {
    try {
      this.options = defineHttpConfig(
        (this.options as IHttpConfigInput) ?? {},
        this.kernel,
      );
    } catch (e) {
      const issues =
        e instanceof Error && "issues" in e && Array.isArray(e.issues)
          ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join(" · ")
          : (e as Error).message;
      throw new Error(`[@nodefony/http] Invalid config: ${issues}`, {
        cause: e,
      });
    }
    return this;
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
      IAdminRegistry | undefined;
    if (registry && !registry.has("http")) {
      registry.register(createHttpAdminApi(this));
    }
    // Profiler par requête — dev-only (perf + fuite d'info en prod). Instancié
    // ici, partagé via le container (`http-kernel` le résout à onReady) et
    // exposé en data plane sous `/nodefony/profiler/api/*`.
    // ⚠️ `environment` est normalisé en "development"/"production"/"test" — JAMAIS
    // "prod" : comparer à "prod" laissait le profiler actif en prod (gros overhead).
    if (this.kernel?.environment !== "production") {
      const profiler = new Profiler();
      this.container?.set("profiler", profiler);
      if (registry && !registry.has("profiler")) {
        registry.register(createProfilerAdminApi(profiler));
      }
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

// Config — schéma Zod (source de vérité), builder, introspection JSON Schema.
// Flags de champ : `.meta()` natif zod, typé par `IConfigFieldMeta` (core).
export {
  defineHttpConfig,
  httpConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";
export {
  httpConfigSchema,
  type HttpConfig,
  type HttpConfigInput,
} from "./nodefony/config/config";
export type {
  IHttpConfig,
  IHttpConfigInput,
} from "./nodefony/interfaces/IHttpConfig";

// Contre-pression WS SORTANTE — règle UNIQUE, partagée. `@nodefony/realtime`
// l'applique sur le transport de chaque connexion realtime ; `Response` sur
// `send`/`broadcast`. Deux implémentations auraient divergé en silence (elles
// avaient déjà des seuils différents : 4 MiB ici, 1 MiB là-bas).
export {
  decideSend,
  readBackpressureOptions,
  type WsBackpressurePolicy,
  type WsSendDecision,
  type IWsBackpressureOptions,
  type IBackpressureSocket,
  type IBackpressureTarget,
} from "./nodefony/src/context/websocket/wsBackpressure";

// Matching de domaine (Host) — fonctions pures réutilisées par @nodefony/framework
// (Route.matchHostname / @Domain) pour la cohérence kernel ↔ route.
export {
  compileDomainPattern,
  compileDomainPatterns,
  compileTrustedHosts,
  isDomainAllowed,
} from "./nodefony/src/context/domainMatcher";
export type {
  DomainPattern,
  TrustedHostsConfig,
} from "./nodefony/src/context/domainMatcher";

// Rate-limit général par IP (P0.3) — store mémoire (fixed window) + contrat
// pluggable (un store distribué Redis pourra l'implémenter sans cycle).
export { MemoryRateLimitStore } from "./nodefony/src/rateLimit/MemoryRateLimitStore";
export type {
  IRateLimitStore,
  IRateLimitOptions,
  RateLimitVerdict,
} from "./nodefony/src/rateLimit/IRateLimitStore";

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
  Profiler,
};

export type {
  ProfileEntry,
  ProfileSummary,
  ProfilePhase,
  ProfileQuery,
  ProfileSecurity,
} from "./nodefony/src/profiler/Profiler";

// Profil d'UNE invocation du pont RPC (une frame WebSocket) — le contexte WS
// vit pour la connexion, la frame a donc son propre porteur de phases/SQL.
export { FrameProfile } from "./nodefony/src/profiler/FrameProfile";
export type {
  FrameProfileInit,
  ProfiledArea,
  ProfiledResolver,
} from "./nodefony/src/profiler/FrameProfile";

// Livraison d'UI embarquée d'un module (pattern « module tiers avec UI ») :
// résolution de la molette `ui: auto|static|vite` + service statique des
// assets pré-buildés shippés npm. Consommé par @nodefony/studio et tout
// module distribuant un front pré-compilé.
export {
  resolveUiDelivery,
  PrebuiltUi,
} from "./nodefony/src/assets/prebuiltUi";
export type {
  UiDeliveryMode,
  UiDeliveryResolved,
  IUiDeliveryResolution,
  IUiDeliveryOptions,
  IPrebuiltUiOptions,
} from "./nodefony/src/assets/prebuiltUi";

// Public interfaces — consommables par les autres modules
export type {
  IContext,
  IHttpContext,
  IWebsocketContext,
  ServerType,
  SchemeType,
  WebSocketStateType,
  CookiesMap,
  ISecurityTrace,
  SecurityOutcome,
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
  ISerializedSession,
  ISessionSummary,
  ISessionRecord,
  ISessionListFilter,
  ISessionListQuery,
  SessionIntent,
  SessionStatusType,
  SessionStrategyType,
  FlashBagType,
  MetaBagType,
} from "./nodefony/interfaces/ISession";
// Vocabulaire de tri des sessions — partagé par TOUS les backends (mémoire,
// drizzle, mongoose, redis), pour qu'un `?order=` ait le même sens partout.
export {
  SESSION_SORTABLE_FIELDS,
  SESSION_DEFAULT_ORDER,
  SESSION_DEFAULT_ORDER_SQL,
  translateSessionOrder,
} from "./nodefony/src/session/storage/sessionSort";
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
export type {
  IUploadedFile,
  IUploadService,
  IParsedUploadFile,
  IUploadOptions,
} from "./nodefony/interfaces/IUpload";
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
