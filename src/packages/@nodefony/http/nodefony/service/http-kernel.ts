import {
  Service,
  Module,
  Container,
  Event,
  Scope,
  //Kernel,
  injectable,
  EnvironmentType,
  DebugType,
  //inject,
  nodefonyError,
  RequestContext,
} from "nodefony";
import type { Resolver, Router } from "@nodefony/framework";
import type { Controller } from "@nodefony/framework";
import HttpError from "../src/errors/httpError";
import {
  buildTrustProxy,
  type TrustProxyChecker,
  type TrustProxyConfig,
} from "../src/context/trustProxy";
import {
  compileTrustedHosts,
  compileDomainPatterns,
  isDomainAllowed,
  type TrustedHostsConfig,
} from "../src/context/domainMatcher";
import type { Profiler } from "../src/profiler/Profiler";
import http from "node:http";
//import https from "node:https";
import http2 from "node:http2";
import type { IncomingMessage } from "node:http";
import Ws from "ws";
import httpServer from "../service/servers/server-http";
import httpsServer from "../service/servers/server-https";
import websocketServer from "../service/servers/server-websocket";
import websocketSecureServer from "../service/servers/server-websocket-secure";
import Statics from "./servers/server-static";
import WebsocketContext from "../src/context/websocket/WebsocketContext";
import HttpContext from "../src/context/http/HttpContext";
import Context, { HTTPMethod, WebSocketState } from "../src/context/Context";
import { logColor } from "nodefony";
import Certicates from "./certificates";
import SessionsService from "./sessions/sessions-service";
import Session from "../src/session/session";
import { Firewall } from "@nodefony/security";
import DefaultErrorRenderer from "./error-renderer";
import type { IErrorRenderer } from "../interfaces/IErrorRenderer";
import DefaultRequestLogger from "./request-logger";
import type { IRequestLogger } from "../interfaces/IRequestLogger";
import PrettyRequestLogger from "./pretty-request-logger";
import JsonAuditLogger from "./audit-logger";
import { resolveTraceparent } from "./trace";

/**
 * Config interne (shape déclarée par `config/config.ts`). Locale au module —
 * pas exportée tant que la surface publique n'a pas vocation à être étendue.
 */
interface SecurityHeadersConfig {
  contentTypeOptions: string | null;
  frameOptions: string | null;
  strictTransportSecurity: {
    maxAge: number;
    includeSubDomains: boolean;
    preload: boolean;
  } | null;
}

export type ProtocolType = "1.1" | "2.0" | "3.0";
export type httpRequest = http.IncomingMessage | http2.Http2ServerRequest;
export type httpResponse = http.ServerResponse | http2.Http2ServerResponse;
export type ContextType = WebsocketContext | HttpContext | Context;
export type ServerType =
  | "http"
  | "https"
  | "http2"
  | "http3"
  | "websocket"
  | "websocket-secure";

export type responseTimeoutType = "http" | "https" | "http2" | "http3";
export type SchemeType = "http" | "https" | "ws" | "wss";

export interface WsMetaData {
  type?: "message" | "handshake";
  state?: WebSocketState;
  messageType?: "utf8" | "binary";
  protocol?: string | null;
  id?: string;
}

/**
 * Vue minimale d'une route exposée dans l'enveloppe `nodefony.route` (frame WS
 * + réponse JSON). Volontairement découplée de la classe `Route` de
 * `@nodefony/framework` : on ne diffuse PAS l'instance partagée (statique) —
 * seulement un snapshot per-requête. Casse aussi l'import valeur runtime
 * `http → framework` (cycle).
 */
export interface RouteMetaData {
  name: string;
  path?: string;
  variablesMap: Record<string, unknown>;
}

export interface MetaData {
  name?: string;
  version?: string;
  url?: URL;
  environment?: EnvironmentType;
  debug?: DebugType;
  token?: string;
  method?: HTTPMethod;
  scheme?: SchemeType;
  requestId?: string;
  websocket?: WsMetaData;
  route?: RouteMetaData;
}

export interface Data {
  error?: Error;
  nodefony: MetaData;
  message?: unknown;
  code?: number;
  result: unknown;
  //stack?: string;
}

const serviceName: string = "HttpKernel";
import type { IHttpKernel as IHttpKernelInterface } from "../interfaces/IHttpKernel";

// B4 — hôtes loopback tolérés comme `Origin` WS en development (Studio Vite
// cross-port ; IPv4 / IPv6 / hostname). Module-level → 0 alloc par handshake.
const WS_DEV_LOOPBACK = new Set<string>([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

@injectable()
class HttpKernel extends Service implements IHttpKernelInterface {
  certificates: unknown;
  serviceCerticats: Certicates | null = null;
  key: string = "";
  cert: string = "";
  ca: string = "";
  serverStatic: Statics | null = null;
  domain: string = "";
  trustedHosts?: TrustedHostsConfig;
  domainCheck: boolean = false;
  regAlias: RegExp[] = [];
  module: Module;
  httpsPort?: number;
  httpPort?: number;
  responseTimeout: {
    http: number;
    https: number;
    http2: number;
    http3: number;
  };
  closeTimeOutWs: {
    ws: number;
    wss: number;
  };
  // Pré-calculés au boot (constants) : 0 alloc, 0 concat par requête sur le hot path.
  // null = header désactivé en config → skip setHeader.
  private secContentTypeOptions: string | null = null;
  private secFrameOptions: string | null = null;
  private secHsts: string | null = null;
  sessionService?: SessionsService | null;
  router?: Router | null;
  firewall?: Firewall | null;
  // Singleton — zero per-request alloc. Swap via setErrorRenderer().
  private errorRenderer: IErrorRenderer = new DefaultErrorRenderer();
  // Singleton — zero per-request alloc. Swap via setRequestLogger().
  private requestLogger: IRequestLogger = new DefaultRequestLogger();
  // Dev-only request profiler — null in prod (module ne l'enregistre qu'hors
  // prod). Résolu une fois à onReady → 1 simple null-check per-request.
  private profiler: Profiler | null = null;
  // Checker de confiance reverse-proxy, compilé une seule fois (lazy) depuis
  // options.trustProxy — pas de BlockList par requête.
  private _trustProxyChecker: TrustProxyChecker | null = null;
  // B4 — politique d'Origin WS (anti-CSWSH) compilée paresseusement par type de
  // serveur. Object.create(null) : petite map à accès ponctuel (règle perf).
  private _wsOriginPolicy: Record<
    string,
    { disabled: boolean; extra: RegExp[] }
  > = Object.create(null);
  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.module = module;
    this.container?.addScope("request");
    this.responseTimeout = {
      http: this.options.http.responseTimeout,
      https: this.options.https.responseTimeout,
      http2: this.options.https.responseTimeout,
      http3: this.options.https.responseTimeout,
    };
    this.closeTimeOutWs = {
      ws: this.options.websocket.closeTimeout,
      wss: this.options.websocketSecure.closeTimeout,
    };
    // Pré-calcul des security headers une fois au boot — defaults dans
    // `config/config.ts` (`securityHeaders`). Évite alloc + concat par requête.
    const sec = (this.options as { securityHeaders?: SecurityHeadersConfig })
      .securityHeaders;
    if (sec) {
      this.secContentTypeOptions = sec.contentTypeOptions ?? null;
      this.secFrameOptions = sec.frameOptions ?? null;
      if (sec.strictTransportSecurity) {
        const hsts = sec.strictTransportSecurity;
        let v = `max-age=${hsts.maxAge}`;
        if (hsts.includeSubDomains) v += "; includeSubDomains";
        if (hsts.preload) v += "; preload";
        this.secHsts = v;
      }
    }
  }

  async init(): Promise<this> {
    // Apply config-driven request logger (P3.x). Done synchronously here so
    // logger is set before the first request — env override stays simple.
    this.applyRequestLoggerFromConfig();
    this.kernel?.prependOnceListener("onReady", () => {
      this.serviceCerticats = this.get("certificates");
      this.serverStatic = this.get("server-static");
      this.domain = this.kernel?.domain as string;
      this.trustedHosts = (
        this.options as { trustedHosts?: TrustedHostsConfig }
      )?.trustedHosts;
      this.regAlias = this.compileAlias();
      this.sessionService = this.get<SessionsService>("sessions");
      // Profiler dev-only — null si non enregistré (prod). Container.get
      // renvoie null pour un service absent (pas de throw).
      this.profiler = this.get<Profiler>("profiler");
    });
    this.kernel?.prependOnceListener("onBoot", () => {
      this.router = this.get<Router>("router");
      this.firewall = this.get<Firewall>("firewall");
    });
    return this;
  }

  /**
   * Checker de confiance reverse-proxy, compilé une seule fois depuis
   * `options.trustProxy` (lazy — pas de `BlockList` allouée par requête).
   * Consommé par `HttpRequest`/`HttpContext` pour décider de l'adoption des
   * en-têtes `X-Forwarded-*`.
   *
   * @returns le {@link TrustProxyChecker} partagé.
   */
  getTrustProxyChecker(): TrustProxyChecker {
    if (this._trustProxyChecker === null) {
      this._trustProxyChecker = buildTrustProxy(
        (this.options as { trustProxy?: TrustProxyConfig })?.trustProxy,
      );
    }
    return this._trustProxyChecker;
  }

  /**
   * Politique d'Origin WS (B4) compilée paresseusement pour un type de serveur
   * (`websocket` / `websocketSecure`), depuis `options.<type>.allowedOrigins` :
   *  - `true` → contrôle désactivé (`disabled`) ;
   *  - `false` (défaut) → same-origin seul (`extra` vide) ;
   *  - string/liste → Origins cross-origin additionnelles (compilées en RegExp).
   *
   * @param cfgKey - `"websocket"` ou `"websocketSecure"`.
   * @returns la politique mémoïsée (0 alloc après le 1er handshake).
   */
  private getWsOriginPolicy(cfgKey: "websocket" | "websocketSecure"): {
    disabled: boolean;
    extra: RegExp[];
  } {
    let policy = this._wsOriginPolicy[cfgKey];
    if (!policy) {
      const raw = (
        this.options[cfgKey] as { allowedOrigins?: TrustedHostsConfig }
      )?.allowedOrigins;
      if (raw === true) {
        policy = { disabled: true, extra: [] };
      } else {
        // `raw` ici ∈ { false, undefined, string, RegExp, (string|RegExp)[] }.
        // Truthy ⇒ patterns explicites ; false/undefined ⇒ same-origin seul.
        const patterns = raw ? raw : [];
        policy = {
          disabled: false,
          extra: compileDomainPatterns(
            patterns as Parameters<typeof compileDomainPatterns>[0],
          ),
        };
      }
      this._wsOriginPolicy[cfgKey] = policy;
    }
    return policy;
  }

  /**
   * B4 — Validation d'`Origin` au handshake WebSocket (anti-CSWSH, OWASP
   * WSTG-CLNT-10). Les navigateurs n'appliquent PAS CORS aux WebSockets : sans
   * ce contrôle, une page tierce peut ouvrir un WS **authentifié par le cookie de
   * session de la victime** (reprise L1). On exige donc, par défaut, que
   * l'`Origin` du handshake corresponde au `Host` servi (same-origin), avec
   * tolérance loopback en development (Studio Vite cross-port) et allowlist
   * explicite pour les SPA cross-origin (`allowedOrigins`).
   *
   * Une requête SANS `Origin` (client non-navigateur) est acceptée : un attaquant
   * non-navigateur n'a pas besoin de CSWSH, il se connecte directement.
   *
   * @param context - contexte WebSocket au handshake (avant `connect()`).
   * @throws {HttpError} code WS 1008 (Policy Violation) si l'Origin est refusée.
   */
  checkWebsocketOrigin(context: WebsocketContext): void {
    const cfgKey =
      context.type === "websocket-secure" ? "websocketSecure" : "websocket";
    const policy = this.getWsOriginPolicy(cfgKey);
    if (policy.disabled) {
      return;
    }
    const raw = context.origin;
    // Pas d'Origin (client non-navigateur) → autorisé (cf doctrine ci-dessus).
    if (!raw) {
      return;
    }
    let originHost: string | null = null;
    try {
      originHost = new URL(raw).hostname;
    } catch {
      originHost = null;
    }
    if (originHost) {
      // Same-origin : l'Origin doit correspondre au Host servi (port ignoré).
      if (originHost === context.domain) {
        return;
      }
      // Development : loopback toléré (page Vite 5173 → serveur 5151, IP mixtes).
      if (
        this.kernel?.environment === "development" &&
        WS_DEV_LOOPBACK.has(originHost)
      ) {
        return;
      }
      // Allowlist explicite (SPA cross-origin en production).
      if (policy.extra.length && isDomainAllowed(policy.extra, originHost)) {
        return;
      }
    }
    // Code WS 1008 « Policy Violation » directement : le renderWebsocket laisse
    // passer 1000-4999 ; un 403 HTTP serait écrasé en 1011 au handshake.
    const error = new HttpError(
      `WebSocket Origin "${raw}" not allowed (CSWSH protection)`,
      1008,
      context,
    );
    (error as HttpError & { type?: string }).type = "origin";
    throw error;
  }

  /**
   * Reads the **kernel-level** syslog config (`kernel.options.log`) and swaps
   * the request logger accordingly. The decision belongs to syslog (not to
   * the http module) because EVERY request log flows through syslog, and
   * the format choice is an operator concern shared across all transports.
   *
   * Config lue : `kernel.options.log.requestFormat`
   *   "auto"    → dev=pretty, production=json, autre=default (DEFAULT)
   *   "default" → DefaultRequestLogger (legacy verbeux)
   *   "pretty"  → PrettyRequestLogger (1 ligne colorée, P3.2)
   *   "json"    → JsonAuditLogger (PDU canonique, P3.1)
   *
   * Programmatic override via `setRequestLogger(custom)` reste possible et
   * gagne toujours sur la config (idempotent — last setter wins).
   */
  private applyRequestLoggerFromConfig(): void {
    const kernelLog = (this.kernel?.options?.log ?? {}) as {
      driver?: string;
      requestFormat?: "auto" | "default" | "pretty" | "json";
      requestLogger?: {
        includeStack?: boolean | null;
        maxCauseDepth?: number;
        sampleRate?: number;
        nominal?: "auto" | "always" | "never";
      };
    };
    let format = kernelLog.requestFormat ?? "auto";
    // Resolve "auto" lazily at boot — by now kernel.environment is set.
    if (format === "auto") {
      const env = this.kernel?.environment;
      format =
        env === "production"
          ? "json"
          : env === "development"
            ? "pretty"
            : "default";
    }
    if (format === "pretty") {
      this.requestLogger = new PrettyRequestLogger();
    } else if (format === "json") {
      const advanced = kernelLog.requestLogger ?? {};
      const opts: {
        includeStack?: boolean;
        maxCauseDepth?: number;
        sampleRate?: number;
        nominal?: boolean;
      } = {};
      if (
        advanced.includeStack !== null &&
        advanced.includeStack !== undefined
      ) {
        opts.includeStack = advanced.includeStack;
      }
      if (typeof advanced.maxCauseDepth === "number") {
        opts.maxCauseDepth = advanced.maxCauseDepth;
      }
      if (typeof advanced.sampleRate === "number") {
        opts.sampleRate = advanced.sampleRate;
      }
      // T1 — audit nominal (2xx/3xx) : "auto" (défaut) = coupé SSI le sink
      // texte est "null" (l'entrée d'audit n'atteindrait AUCUNE destination :
      // objet+toISOString+stringify+Pdu ring pour rien, ~5,9 % du profil CPU).
      // "always"/"never" = forçage explicite. Erreurs/4xx/5xx : JAMAIS gâtées
      // (côté JsonAuditLogger). Override env NF_BENCH_AUDIT_NOMINAL lu 1× au
      // boot — banc A/B paires alternées sans rebuild, jamais en hot path.
      const envNominal = process.env.NF_BENCH_AUDIT_NOMINAL as
        | "auto"
        | "always"
        | "never"
        | undefined;
      const nominalMode = envNominal ?? advanced.nominal ?? "auto";
      opts.nominal =
        nominalMode === "always" ||
        (nominalMode === "auto" && kernelLog.driver !== "null");
      this.requestLogger = new JsonAuditLogger(opts);
    }
    // "default" → keep DefaultRequestLogger already set as field default.
  }

  async handle(
    request: httpRequest,
    response: httpResponse | null,
    type: ServerType,
  ): Promise<HttpContext> {
    const scope = this.container?.enterScope("request");
    // Perf (L1) — debug off (prod / dev sans -d) : ne RIEN allouer par requête.
    // `this.log(...)` construit TOUJOURS un Pdu et `logColor.cyanBgBlue(url)` une
    // string + 2 templates — tous jetés si DEBUG n'est pas affiché. Guard sur
    // `kernel.debug` (même flag que http-kernel.ts:456) → 0 alloc en prod.
    if (this.kernel?.debug) {
      this.log(logColor.cyanBgBlue(`${request.url}`), "DEBUG", `${type}`);
    }
    return this.handleHttp(
      scope as Scope,
      request,
      response as httpResponse,
      type,
    );
  }

  async handleFrontController(
    context: ContextType,
    checkFirewall: boolean = true,
  ): Promise<Controller | number> {
    if (!this.router) {
      throw new Error("kernel HTTP not ready");
    }
    if (this.firewall && checkFirewall) {
      context.secure = this.firewall.isSecure(context);
    }
    // SEAM P6 — CORS / preflight. Quand `@nodefony/security` portera la politique
    // cross-origin, le preflight `OPTIONS` cross-origin court-circuitera ici en
    // `204 No Content` + en-têtes `Access-Control-*` (via le firewall, hook
    // beforeResolve). Aucune politique CORS centralisée n'existe encore (B3) — ne
    // PAS réintroduire de `handleCrossDomain` mort : le `204` remonte déjà aux
    // appelants (`onRequestEnd` / `onConnect`) via le type de retour `number`.
    // FRONT ROUTER — P2.9 : réutilise le résolveur si déjà matché EN AMONT
    // (handleHttp hisse le match avant le parse pour décider du skip). Sinon
    // (WebSocket, ou pas de pré-match), match ici comme avant. Pas de double match.
    let resolver: Resolver;
    if (context.resolver) {
      resolver = context.resolver as Resolver;
    } else {
      context.phaseStart("resolve");
      try {
        resolver = this.router.resolve(context);
      } finally {
        context.phaseEnd("resolve");
      }
    }
    if (resolver.resolve && !resolver.exception) {
      context.resolver = resolver;
      // Le Resolver a déjà posé `context.sessionIntent` (depuis `@UseSession` /
      // paramètre `@Session`) au match — c'est lui qui pilote l'activation au
      // point session unique. `controller.session` est un getter sur
      // `context.session` (plus de pont via l'event `onSessionStart`).
      const controller = await resolver.newController(context);
      return controller;
    }
    if (resolver.exception) {
      throw resolver.exception;
    }
    throw new HttpError("Not Found", 404, context);
  }

  /**
   * Handles errors by setting appropriate response codes and messages.
   *
   * @param error - The error object, which can be of type Error, HttpError, or nodefonyError.
   * @param context - Optional context parameter, which can be of type ContextType.
   * @param extraHeaders - Optional additional headers to be included in the response.
   * @returns A promise that resolves to either HttpContext or WebsocketContext.
   *
   * WebSocket error codes and their meanings:
   *  - code >= 1000 && code <= 2999:
   *    - 1000: Normal connection closure
   *    - 1001: Remote peer is going away
   *    - 1002: Protocol error
   *    - 1003: Unprocessable input
   *    - 1004: Reserved
   *    - 1005: Reason not provided
   *    - 1006: Abnormal closure, no further detail available
   *    - 1007: Invalid data received
   *    - 1008: Policy violation
   *    - 1009: Message too big
   *    - 1010: Extension requested by client is required
   *    - 1011: Internal Server Error
   *    - 1015: TLS Handshake Failed
   *  - code >= 3000 && code <= 3999:
   *    Reserved for use by libraries, frameworks, and applications.
   *    Should be registered with IANA. Interpretation of these codes is
   *    undefined by the WebSocket protocol.
   *  - code >= 4000 && code <= 4999:
   *    Reserved for private use. Interpretation of these codes is
   *    undefined by the WebSocket protocol.
   */
  /**
   * Override the default error renderer — e.g. to hide stack traces in prod
   * or emit RFC 7807 problem+json. Stateless singleton expected.
   */
  setErrorRenderer(renderer: IErrorRenderer): void {
    this.errorRenderer = renderer;
  }

  getErrorRenderer(): IErrorRenderer {
    return this.errorRenderer;
  }

  /**
   * Override the default per-request logger — JSON access log, NCSA combined,
   * pretty single-line formatter, etc. Stateless singleton expected.
   */
  setRequestLogger(logger: IRequestLogger): void {
    this.requestLogger = logger;
  }

  getRequestLogger(): IRequestLogger {
    return this.requestLogger;
  }

  async onError(
    error: Error | HttpError | nodefonyError,
    context?: ContextType,
    _extraHeaders?: Record<string, unknown> | object,
  ): Promise<HttpContext | WebsocketContext> {
    try {
      if (context) {
        context.error = error;
      }
      switch (true) {
        case context instanceof HttpContext: {
          const result = this.errorRenderer.renderHttp(error, context);
          // Mirror result back onto error so callers / logs see normalised code.
          if (error instanceof HttpError || error instanceof nodefonyError) {
            error.code = result.status;
          }
          context.response.setStatusCode(result.status, result.message);
          if (result.headers) {
            context.response.setHeaders(result.headers);
          }
          if (this.kernel?.debug) {
            this.log(error.toString(), "ERROR");
          }
          // Race: client closed the socket before the controller produced a
          // response → teardown ran (`finished=true`) or write already
          // happened. Don't try to render — that path explodes into a CRITIC
          // "Response Already sended" for a case the framework expects.
          if (context.finished || context.sended) {
            this.log(error.toString(), "DEBUG", "onError on closed context");
            return context;
          }
          if (!context.response.isHeaderSent()) {
            return context
              .render(result.body)
              .then(() => context)
              .catch((e) => {
                this.log(e, "CRITIC");
                throw e;
              });
          }
          return context.close().then(() => context);
        }
        case context instanceof WebsocketContext: {
          try {
            const wsResult = this.errorRenderer.renderWebsocket(error, context);
            if (context.response && context.response.connection) {
              context.close(wsResult.code, wsResult.reason);
              return context;
            }
            if (context.request && !context.rejected) {
              context.reject(wsResult.code, wsResult.reason);
              return context;
            }
          } catch (e) {
            throw error;
          }
        }
        default:
          throw error;
      }
    } catch (e) {
      throw e;
    }
  }

  compileAlias(): RegExp[] {
    return compileTrustedHosts(
      this.domain,
      this.trustedHosts,
      this.kernel?.environment === "development",
    );
  }

  async onHttpRequest(
    request: httpRequest,
    response: httpResponse,
    type: ServerType,
  ): Promise<unknown> {
    response.setHeader("Server", this.options.headerServer);
    // Security headers OWASP — defaults secure-by-default (cf config.securityHeaders).
    // HSTS gated TLS-only : poser sur HTTP plain n'a aucun effet RFC 6797 et pollue.
    if (this.secContentTypeOptions !== null) {
      response.setHeader("X-Content-Type-Options", this.secContentTypeOptions);
    }
    if (this.secFrameOptions !== null) {
      response.setHeader("X-Frame-Options", this.secFrameOptions);
    }
    if (this.secHsts !== null && (type === "https" || type === "http2")) {
      response.setHeader("Strict-Transport-Security", this.secHsts);
    }
    // ROUTER-FIRST (façon Express) : le static n'est PLUS tenté en amont — il est
    // devenu un FALLBACK du 404 dans `handleHttp` (après le route-match). Le point
    // d'entrée se limite au hook `onServerRequest` (guardé 0-listener) puis délègue
    // au pipeline. Une requête qui matche une route ne touche plus le disque.
    if (this.listenerCount("onServerRequest"))
      await this.fireAsync("onServerRequest", request, response, type).catch(
        (e) => {
          throw e;
        },
      );
    return this.handle(request, response, type).catch((e) => {
      throw e;
    });
  }

  async initServers(): Promise<
    (httpServer | httpsServer | websocketServer | websocketSecureServer)[]
  > {
    const servers: (
      | httpServer
      | httpsServer
      | websocketServer
      | websocketSecureServer
    )[] = [];
    const serverHttp = this.get<httpServer>("server-http");
    if (serverHttp) {
      await serverHttp.createServer();
      servers.push(serverHttp);
    }
    const serverHttps = this.get<httpsServer>("server-https");
    if (serverHttps) {
      await serverHttps.createServer();
      servers.push(serverHttps);
    }
    const serverWebsocket = this.get<websocketServer>("server-websocket");
    if (serverWebsocket && serverHttp) {
      await serverWebsocket.createServer(serverHttp);
      servers.push(serverWebsocket);
    }
    const serverWebsocketSecure = this.get<websocketSecureServer>(
      "server-websocket-secure",
    );
    if (serverWebsocketSecure && serverHttps) {
      await serverWebsocketSecure.createServer(serverHttps);
      servers.push(serverWebsocketSecure);
    }
    return servers;
  }

  /**
   * Point d'activation UNIQUE de session — symétrique HTTP **et** WS. Ouvre une
   * session si, et seulement si, la route la déclare (`context.sessionIntent`,
   * posé par le Resolver depuis `@UseSession` / un paramètre `@Session`) **ou**
   * si un cookie de session entrant existe déjà (reprise — L1). Sinon : aucune
   * session (lazy). Remplace l'ancien `sessionAutoStart` global « démarre sur
   * toutes les routes » (le moteur du ×23).
   *
   * @param context - contexte HTTP/HTTP2/WS courant.
   * @returns la session active, ou `null` si la requête n'en requiert aucune.
   */
  async startSession(
    context: WebsocketContext | HttpContext,
  ): Promise<Session | null> {
    if (!this.sessionService) {
      return null;
    }
    const intent = context.sessionIntent;
    // Lazy : ni intent de route, ni cookie de session entrant → 0 session, 0 write.
    if (!intent && !context.hasSession()) {
      return null;
    }
    const session = await this.sessionService.start(
      context,
      intent?.context,
      intent?.readOnly,
    );
    // SEAM P6 — lien identité↔session : la régénération d'ID post-authentification
    // (anti session-fixation, OWASP) se branchera ici via
    // `firewall.getSessionToken(context, session)` / `session.regenerateId()`.
    return session;
  }

  /**
   * Teardown post-réponse — fire-and-forget depuis le `once("close")` posé par
   * `createHttpContext` (un seul fire possible : once auto-détaché). Loggue la
   * requête, draine les hooks afterResponse/onFinish, libère le scope DI.
   */
  private async teardownHttp(
    context: HttpContext,
    scope: Scope,
  ): Promise<void> {
    if (context.finished) return;
    try {
      // Dev-only : l'action a retourné une valeur non rendable (number/boolean/
      // void) → `waitAsync` posé mais AUCUN envoi → la requête a pendu (timeout
      // / disconnect). Pister tôt pour éviter le hang silencieux. Gratuit en
      // prod (gardé par l'env + n'alloue rien sauf si le warn fire).
      if (
        context.waitAsync &&
        !context.sended &&
        this.kernel?.environment === "development"
      ) {
        this.log(
          `Action "${context.resolver?.route?.name ?? context.url}" returned a non-renderable value (void/null/class instance) and never sent a response. Use 'return <object|string|number|boolean|Buffer>' (auto-JSON) or send/stream manually.`,
          "WARNING",
        );
      }
      context.logRequest();
      // P3.7 — détail phase-par-phase (opt-in timing.verbose ; no-op sinon).
      context.logPhasesVerbose();
      // Snapshot dev-only AVANT clean() (la donnée disparaît après).
      this.profiler?.collect(
        context as unknown as Parameters<Profiler["collect"]>[0],
      );
      await context._runAfterResponse();
      // Guard 0-listener (cf onCreateContext) : `onFinish` du contexte n'a de
      // listener que si un controller a posé un hook → 0 microtask sinon.
      if (context.listenerCount("onFinish"))
        await context.fireAsync("onFinish", context);
      context.finished = true;
      this.container?.leaveScope(scope);
      context.clean();
    } catch (e) {
      // R2 — teardown est fire-and-forget (`void this.teardownHttp(...)`) : un
      // throw ici (hook onFinish / afterResponse) serait un unhandledRejection
      // process-wide. On loggue, et on GARANTIT la libération du scope DI
      // (sinon le scope `request` fuit à chaque hook qui throw).
      this.log(e, "ERROR", "TEARDOWN");
      if (!context.finished) {
        context.finished = true;
        this.container?.leaveScope(scope);
        context.clean();
      }
    }
  }

  createHttpContext(
    scope: Scope,
    request: httpRequest,
    response: httpResponse,
    type: ServerType,
  ): HttpContext {
    try {
      const context = new HttpContext(scope, request, response, type);
      // T4 — UN SEUL listener post-réponse par requête. Node garantit `close`
      // sur TOUTE réponse (h1 + compat h2) : après `finish` quand elle aboutit
      // (nextTick), seul quand le client part avant la fin. L'ancien pair
      // finish/close + flag didFinish + 2 removeListener (~2 % du profil
      // CPU/req) se replie en 1 `once` auto-détaché, 0 removeListener.
      // `writableEnded` (posé par end(), AVANT l'émission de finish) rejoue le
      // distinguo ex-didFinish au moment du close.
      response.once("close", () => {
        if (!response.writableEnded) {
          // Close sans end() préalable = client parti avant la réponse complète.
          context._abortIfPending("Connection closed before response finished");
          // P2.3 — record an internal 499 ("client closed request", nginx-style)
          // when the client vanished before ANY response byte was produced.
          // NEVER written to the wire (socket already dead) — observability only
          // (request log + profiler). If the controller already started sending
          // (`sended`) or an error set a code, the logger prefers those, so 499
          // surfaces solely on a genuine pre-response client abort.
          if (!context.sended) {
            context.response.statusCode = 499;
          }
        }
        void this.teardownHttp(context, scope);
      });

      return context;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async handleHttp(
    scope: Scope,
    request: httpRequest,
    response: httpResponse,
    type: ServerType,
  ): Promise<HttpContext> {
    let context: HttpContext | null = null;
    try {
      context = this.createHttpContext(scope, request, response, type);
      // Hot path : `fireAsync` est une fonction async → `await` crée 1 Promise +
      // 1 microtask MÊME à 0 listener (emitAsync court-circuite l'alloc des
      // listeners mais pas le wrapper async). En prod sans @nodefony/security ces
      // seams (onCreateContext/beforeResolve/afterAuth) n'ont aucun listener →
      // guard `listenerCount` (O(1), 0 alloc) pour ne RIEN scheduler.
      if (this.listenerCount("onCreateContext"))
        await this.fireAsync("onCreateContext", context);
      // P2.7 — W3C traceparent: honor incoming valid header, generate a
      // fresh one otherwise. Resolved BEFORE entering the ALS scope so
      // it propagates with `requestId` to every downstream hop.
      context.traceparent = resolveTraceparent(
        (request.headers as Record<string, string | string[] | undefined>)
          ?.traceparent as string | undefined,
      );
      // Dev-only — allocate the ORM query buffer when the profiler is active
      // (null in prod → 0 alloc). Threaded into the ALS payload so ORM
      // adapters push transparently, and onto the context so `collect()`
      // reads the same array at teardown (outside the ALS bubble).
      const profilerQueries = this.profiler ? [] : null;
      context.profilerQueries = profilerQueries;
      // P1.4 — enter ALS scope so requestId is propagated to every
      // downstream async hop (logs, ORM, security decorators, etc.).
      return await RequestContext.run(
        {
          requestId: context.requestId,
          scheme: context.scheme,
          traceparent: context.traceparent,
          queries: profilerQueries ?? undefined,
          // V4.1 — le contexte transport voyage dans l'ALS : les controllers
          // singleton (stateless) le retrouvent sans le porter sur `this`.
          context,
        },
        async (): Promise<HttpContext> => {
          // P2.9 — Route-match HISSÉ avant le parse (match = method + URL, pur :
          // n'utilise pas le body). Permet de SAUTER le parse busboy/JSON quand
          // l'action attend le flux brut (`@Body({ stream:true })` → le controller
          // pipe le Readable lui-même, sans pic mémoire). Le résolveur est RÉUTILISÉ
          // par handleFrontController (pas de double match → net ~0 perf). resolve()
          // ne throw jamais (pose `resolver.exception`) ; route non matchée → parse
          // normal (comportement 404 inchangé). Isolé HTTP : handleWebsocket ne
          // parse aucun body. Ordre des hooks P6 (beforeResolve/firewall) inchangé.
          context!.phaseStart("resolve");
          context!.resolver = this.router
            ? this.router.resolve(context! as ContextType)
            : null;
          context!.phaseEnd("resolve");
          // ROUTER-FIRST (façon Express) : aucune route matchée → FALLBACK static.
          // `serverStatic.handle` reste PENDING si un fichier est servi (court-circuit
          // total — response.end → `onFinish` → teardown déjà wired par
          // createHttpContext) ; il RESOLVE si aucun fichier → on poursuit le pipeline
          // jusqu'au 404. Bénéfice : une requête qui matche une route ne paie plus le
          // fs.stat/path.normalize de serve-static (≈ +26 % RPS sur les routes API).
          if (
            this.serverStatic &&
            context!.resolver?.resolve !== true &&
            !context!.resolver?.exception &&
            (this.kernel?.options.servers.statics ||
              this.kernel?.options.statics ||
              this.serverStatic.hasMounts())
          ) {
            // Le Context a déjà posé le Content-Type par défaut
            // (application/octet-stream) ; `serve-static` ne l'écrase PAS s'il
            // existe → on le retire pour qu'il pose le vrai type du fichier
            // (image/x-icon, video/webm…). En static-first aucun CT n'était
            // pré-posé : on restaure ce comportement.
            response.removeHeader("Content-Type");
            await this.serverStatic
              .handle(request, response)
              .catch(() => undefined);
          }
          const streamBody =
            context!.resolver?.resolve === true &&
            context!.resolver.route?.bodyStream === true;
          context!.phaseStart("parse");
          try {
            if (!streamBody) {
              await context!.request.initialize();
            }
            // streamBody : body laissé en flux brut (Readable) pour @Body({stream})
          } finally {
            context!.phaseEnd("parse");
          }
          const ctx = await this.onRequestEnd(context!);
          if (ctx instanceof Context) {
            ctx.phaseStart("action");
            try {
              return await ctx.handle();
            } finally {
              ctx.phaseEnd("action");
            }
          }
          return context!;
        },
      );
    } catch (e) {
      return (await this.onError(
        e as Error,
        context as ContextType,
      )) as HttpContext;
    }
  }

  async onRequestEnd(
    context: HttpContext,
    error?: Error | null | undefined,
  ): Promise<HttpContext | number> {
    // EVENT
    if (!context) {
      throw new nodefonyError("Bad context", 500);
    }
    if (error) {
      throw error;
    }
    // ADD HEADERS CONFIG
    if (this.options[context.scheme].headers) {
      context.response.setHeaders(this.options[context.scheme].headers);
    }
    // DOMAIN VALID
    if (this.kernel?.options.domainCheck) {
      this.checkValidDomain(context);
    }
    // SECURITY HOOK — beforeResolve (P1.7)
    // Fires before route is resolved. Security can pre-load session/token here.
    // Guard 0-listener (cf onCreateContext) : 0 microtask sans security.
    if (this.listenerCount("beforeResolve"))
      await this.fireAsync("beforeResolve", context);
    // FRONT CONTROLLER
    const ret = await this.handleFrontController(context);
    if (ret === 204) {
      return ret;
    }
    // CSRF (P6 J5) — défense globale : toute mutation cross-site (POST/PUT/PATCH/
    // DELETE) est rejetée (403), zone ou non, AVANT de charger session/auth (rejet
    // précoce). No-op sur les méthodes sûres. Le resolver est posé par
    // handleFrontController → l'exemption `bypassFirewall` (OAuth) est lisible ici.
    this.firewall?.enforceCsrf(context);
    // SESSIONS — AVANT le firewall (P6 J3) : le SessionAuthenticator lit la
    // session REPRISE (cookie L1) pour ré-authentifier sans credential. Lazy
    // inchangé (ni intent de route ni cookie entrant → 0 session, 0 coût) ;
    // le point d'activation reste unique (`startSession`).
    await this.startSession(context);
    // FIREWALL
    if (context.secure || context.isControlledAccess) {
      context.phaseStart("firewall");
      try {
        try {
          await this.firewall?.handleSecurity(context);
          // SECURITY HOOK — afterAuth (P1.7) — only on success
          // Guard 0-listener (cf onCreateContext) : 0 microtask sans security.
          if (this.listenerCount("afterAuth"))
            await this.fireAsync("afterAuth", context);
        } catch (authError) {
          // SECURITY HOOK — onAuthFailure (P1.7)
          await this.fireAsync("onAuthFailure", context, authError).catch((e) =>
            this.log(e, "ERROR", "onAuthFailure"),
          );
          throw authError;
        }
      } finally {
        context.phaseEnd("firewall");
      }
      return context;
    }
    return context;
  }

  // WEBSOCKET
  createWebsocketContext(
    scope: Scope,
    req: IncomingMessage,
    ws: Ws,
    type: ServerType,
  ): WebsocketContext {
    const context = new WebsocketContext(scope, req, ws, type);
    context.once("onFinish", async (wscontext) => {
      if (!context) {
        return;
      }
      if (context.finished) {
        return;
      }
      // WS closed — abort signal (no-op if nobody read context.signal).
      context._abortIfPending("WebSocket closed");
      await context._runAfterResponse();
      // BUG-004 — persist the session if needed, then ALWAYS release the scope.
      // The previous code waited on a one-shot `onSaveSession` event, but for a
      // connection closing around the handshake that event is emitted (or lost)
      // before this handler subscribes → the listener never fires → the scope
      // leaks. Awaiting saveSession() is deterministic and preserves the
      // "persist before teardown" intent without depending on event ordering.
      if (context.session && !context.session.saved) {
        try {
          await context.saveSession();
        } catch (e) {
          this.log(e, "ERROR", "WS onFinish saveSession");
        }
      }
      this.container?.leaveScope(wscontext.container);
      context.clean();
      context.finished = true;
    });
    return context;
  }

  // WEBSOCKET ENTRY POINT
  async onWebsocketRequest(
    ws: Ws,
    req: IncomingMessage,
    type: ServerType,
  ): Promise<unknown> {
    await this.fireAsync("onServerRequest", req, null, type).catch((e) => {
      throw e;
    });
    const scope = this.container?.enterScope("request");
    return this.handleWebsocket(scope as Scope, ws, req, type).catch((e) => {
      throw e;
    });
  }

  async handleWebsocket(
    scope: Scope,
    ws: Ws,
    req: IncomingMessage,
    type: ServerType,
  ): Promise<unknown> {
    let context: WebsocketContext | null = null;
    let error: Error | null | unknown = null;
    try {
      context = this.createWebsocketContext(scope, req, ws, type);
    } catch (e) {
      error = e;
    }
    try {
      // P2.7 — W3C traceparent on the WS upgrade request. The header is not
      // echoed back in the handshake response (the `ws` library doesn't
      // expose that path cleanly), but it is propagated through
      // RequestContext so server-side logs and downstream tools see it.
      if (context) {
        context.traceparent = resolveTraceparent(
          (req.headers as Record<string, string | string[] | undefined>)
            ?.traceparent as string | undefined,
        );
      }
      // P1.4 — enter ALS scope for WS pipeline (handshake + messages).
      // context.requestId is always defined (set in WebsocketContext ctor).
      const wsRunId = context?.requestId ?? "ws-no-ctx";
      const wsScheme = context?.scheme ?? "ws";
      const wsTrace = context?.traceparent ?? null;
      return await RequestContext.run(
        {
          requestId: wsRunId,
          scheme: wsScheme,
          ...(wsTrace ? { traceparent: wsTrace } : {}),
          // V4.1 — même seam que HTTP : contexte WS accessible via l'ALS
          // (messages inclus — AsyncResource.bind propage la bulle, BUG-001).
          context,
        },
        async () => {
          await this.onConnect(context as WebsocketContext, error);
          // FIREWALL
          if (
            this.firewall &&
            (context?.secure || context?.isControlledAccess)
          ) {
            context.phaseStart("firewall");
            try {
              try {
                await this.firewall.handleSecurity(context);
                await this.fireAsync("afterAuth", context);
              } catch (authError) {
                await this.fireAsync("onAuthFailure", context, authError).catch(
                  (e) => this.log(e, "ERROR", "onAuthFailure"),
                );
                throw authError;
              }
            } finally {
              context.phaseEnd("firewall");
            }
          }
          if (context) {
            context.phaseStart("action");
            try {
              return await context.handle();
            } finally {
              context.phaseEnd("action");
            }
          }
          return;
        },
      );
    } catch (e) {
      try {
        await this.onError(e as Error, context as WebsocketContext);
      } catch (errorHandlingError) {
        this.releaseOrphanWsScope(scope, context);
        throw errorHandlingError;
      }
      this.releaseOrphanWsScope(scope, context);
      throw e;
    }
  }

  // BUG-003 — release a WebSocket request scope when the pipeline aborts
  // BEFORE context.connect() wired the close→onFinish→teardown path (404
  // route, 1002 protocol, domain/auth/session errors at handshake). Without
  // this, the scope stays in container.scopes["request"] forever and pins the
  // context. No-op when teardown is wired (onFinish will clean) or already
  // finished. Handles the orphan case where the context failed to construct.
  private releaseOrphanWsScope(
    scope: Scope,
    context: WebsocketContext | null,
  ): void {
    if (!context) {
      // Context construction failed — the scope is orphaned, free it.
      this.container?.leaveScope(scope);
      return;
    }
    if (context.teardownWired || context.finished) {
      return;
    }
    context.finished = true;
    this.container?.leaveScope(scope);
    context.clean();
  }

  async onConnect(
    context: WebsocketContext,
    error: null | undefined | unknown = null,
  ): Promise<Ws | number> {
    try {
      if (error) {
        throw error;
      }
      if (!context) {
        throw new nodefonyError("Bad context", 500);
      }
      // DOMAIN VALID
      if (this.domainCheck) {
        this.checkValidDomain(context);
      }
      // B4 — anti-CSWSH : valide l'Origin du handshake (same-origin par défaut,
      // loopback dev toléré, allowlist `allowedOrigins`). Refus → close WS 1008.
      this.checkWebsocketOrigin(context);
      // SECURITY HOOK — beforeResolve (P1.7) — WS
      await this.fireAsync("beforeResolve", context);
      // FRONT CONTROLLER
      try {
        const ret = await this.handleFrontController(context);
        if (ret === 204) {
          return ret;
        }
      } catch (e: unknown) {
        context.logRequest(e as Error);
        throw e;
      }
      // SESSIONS — même point d'activation unique que le HTTP (co-citoyenneté
      // HTTP/WS) : `startSession` décide via l'intent de route ou le cookie (L1).
      // AVANT le firewall WS (P6 J3) — y compris en zone sécurisée : le
      // SessionAuthenticator lit la session reprise au handshake.
      if (!context.sessionStarting) {
        await this.startSession(context);
      }
      return await context.connect();
    } catch (e) {
      throw e;
    }
  }

  checkValidDomain(context: ContextType): number {
    if (context.validDomain) {
      return 200;
    }
    // RFC 9110 §15.5.20 — Host hors `trustedHosts` : le serveur n'est pas
    // autoritaire pour cette cible → 421 Misdirected Request. (401 impliquerait
    // un défi d'authentification + header `WWW-Authenticate`, hors sujet ici.)
    const error = `DOMAIN Misdirected Request : ${context.domain}`;
    throw new HttpError(error, 421);
  }

  isValidDomain(context: ContextType): boolean {
    return isDomainAllowed(this.regAlias, context.domain);
  }
}

export default HttpKernel;
