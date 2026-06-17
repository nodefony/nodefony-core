import {
  Container,
  Service,
  Severity,
  Msgid,
  Message,
  Pci,
  Pdu,
  KernelEventsType,
  nodefonyError,
  RequestContext,
  //EnvironmentType,
  //DebugType,
  Scope,
} from "nodefony";
import type { IProfilerQuery } from "nodefony";
import type { Resolver, Router } from "@nodefony/framework";
import { buildMetaData } from "./metaData.js";
import type { IMetaDataSource } from "./metaData.js";
import { WebSocketServer } from "ws";
import http2 from "node:http2";
import http from "node:http";
import https from "node:https";
import { randomUUID, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { AsyncResource } from "node:async_hooks";
import HttpKernel, {
  //ContextType,
  ServerType,
  Data,
  SchemeType,
} from "../../service/http-kernel";
import HttpResponse from "./http/Response";
import Http2Response from "./http2/Response";
import WebsocketResponse from "./websocket/Response";
import HttpRequest from "./http/Request";
import Http2Request from "./http2/Request";
import SessionsService from "../../service/sessions/sessions-service";
import { logColor } from "nodefony";
//import http from "node:http";
//import http2 from "node:http2";
import { URL } from "node:url";
import Session from "../session/session";
import Cookie, { cookiesParser } from "../cookies/cookie";
import HttpError from "../errors/httpError";
import { SecuredArea } from "@nodefony/security";
import ServerHttp from "../../service/servers/server-http";
import ServerHttps from "../../service/servers/server-https";
import Websocket from "../../service/servers/server-websocket";
import WebsocketSecure from "../../service/servers/server-websocket-secure";

// Tag d'event — couleur gatée au boot (gratuit hors TTY).
const colorLogEvent = (): string => logColor.cyanBgBlack("EVENT CONTEXT");

// Sévérité de log par **jalon notable** du cycle de vie. Les events techniques
// (tout le reste) restent DEBUG ; les jalons de session — requête entrante,
// réponse envoyée, connexion WS ouverte/fermée — montent à INFO pour être
// visibles SANS activer DEBUG (symétrie avec le bilan `req`). Table figée
// module-level → lookup O(1), 0 alloc/req.
const EVENT_SEVERITY: Record<string, Severity> = {
  onRequest: "INFO", // requête entrante (contexte) — HTTP
  onSend: "INFO", // réponse envoyée — HTTP
  onConnect: "INFO", // connexion WebSocket ouverte
  onClose: "INFO", // connexion WebSocket fermée
};

// 🚦 PERF (V2.1) : gate BOOT-TIME des logs d'events lifecycle. Hors production,
// chaque event émet 1 Pdu (jalons EVENT_SEVERITY promus INFO, le reste DEBUG) —
// la matière du Suivi de requête Studio (pduFlow, dev-only). En PROD le gate
// court-circuite AVANT toute allocation (template + couleur + Pdu + push ring) :
// ~5 Pdu/req HTTP et ~3 Pdu/frame WS supprimés, le ring Syslog ne retient que
// les logs utiles. Les EVENTS eux-mêmes (super.fire/emit) ne sont JAMAIS gatés :
// listeners, sondes realtime et teardown fonctionnent à l'identique en prod.
// Résolu 1× au 1er event (kernel présent) → coût après = 1 lecture de boolean.
let lifecycleEventLogging: boolean | null = null;

/**
 * Bascule runtime du gate des logs d'events lifecycle. Réservé HORS hot path :
 * tests et futur « Audit à chaud » (fenêtre bornée prod→verbeux, auto-revert
 * serveur) — le canal Studio `syslog:stream` retrouve alors les events sans
 * redémarrage. `null` → re-résolution depuis l'env au prochain event.
 */
export function setLifecycleEventLogging(value: boolean | null): void {
  lifecycleEventLogging = value;
}

// Shared frozen array used when timing is disabled — zero per-request alloc.
const EMPTY_PHASES: PhaseTiming[] = Object.freeze(
  [] as PhaseTiming[],
) as unknown as PhaseTiming[];

export type WebSocketState =
  | "handshake"
  | "connected"
  | "closed"
  | "error"
  | "message"
  | null;

export type contextRequest =
  | HttpRequest
  | Http2Request
  | http.IncomingMessage
  | null;
export type contextResponse =
  | HttpResponse
  | Http2Response
  | WebsocketResponse
  | null;

export type HTTPMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "DELETE"
  | "CONNECT"
  | "OPTIONS"
  | "TRACE"
  | "PATCH"
  | "WEBSOCKET";

export type Cookies = Record<string, Cookie>;

import type {
  IContext as IContextInterface,
  PhaseTiming,
  PhaseName,
  AfterResponseHandler,
} from "../../interfaces/IContext";
import type { SessionIntent } from "../../interfaces/ISession";

class Context extends Service implements IContextInterface {
  secure: boolean = false;
  security?: SecuredArea | null = null;
  cleaned: boolean = false;
  isControlledAccess: boolean = false;
  validDomain: boolean = false;
  finished: boolean = false;
  pushAllowed: boolean = false;
  requestEnded: boolean = false;
  requested: boolean = false;
  sessionStarting: boolean = false;
  domain: string = "";
  type: ServerType;
  server?:
    | WebSocketServer
    | http.Server
    | https.Server
    | http2.Http2SecureServer
    | null;
  httpKernel: HttpKernel | null;
  request: contextRequest | null = null;
  response: contextResponse | null = null;
  url: string = "";
  method: HTTPMethod | null = null;
  remoteAddress: string | undefined | null = null;
  originUrl: URL | undefined | null = null;
  cookies: Cookies = {};
  error: Error | HttpError | nodefonyError | null | undefined = null;
  sessionService?: SessionsService | null;
  session: Session | null | undefined = null;
  cookieSession: Cookie | null | undefined = null;
  user: unknown = null;
  waitAsync: boolean = false;
  isJson: boolean = false;
  isHtml: boolean = false;
  crossDomain: boolean = false;
  router: Router | null = this.get("router");
  resolver: Resolver | null = null;
  /**
   * Intent de session de la route courante (posé par le Resolver depuis
   * `@UseSession` / paramètre `@Session`). Pilote le point d'activation unique
   * (HTTP + WS). `null` = aucune session sauf cookie existant (reprise L1).
   */
  sessionIntent: SessionIntent | null = null;
  requestId: string = randomUUID();
  // Nonce CSP par-requête (P6 J5 étape B) — généré PARESSEUSEMENT à la 1ʳᵉ lecture
  // (`randomBytes(16)` = 128 bits CSPRNG, base64). Mémoïsé : le header CSP
  // (`'nonce-X'`, posé par le firewall via `applySecurityHeaders`) et le
  // `<script nonce="X">` (template Vite) lisent la MÊME valeur. Jamais lu (réponse
  // sans inline à signer) → 0 coût crypto. Aucun setter : un nonce serveur-only doit
  // rester imprévisible (jamais piloté par le client, contrairement à `requestId`).
  #cspNonce: string | null = null;
  get cspNonce(): string {
    return (this.#cspNonce ??= randomBytes(16).toString("base64"));
  }
  // P2.7 — W3C Trace Context. Set by HttpKernel at request entry to the
  // resolved traceparent (honored incoming header or freshly generated).
  // Null until resolution runs — should never be read before the kernel
  // has populated it in the standard pipeline.
  traceparent: string | null = null;
  // Dev-only ORM query buffer for the Profiler. Allocated by HttpKernel only
  // when the dev profiler is active (null in prod → 0 cost). Same array
  // reference as the RequestContext (ALS) payload's `queries`, so ORM adapters
  // push here transparently; read by `Profiler.collect()` at teardown.
  profilerQueries: IProfilerQuery[] | null = null;
  // Timing: opt-out in prod (default), opt-in elsewhere. Overridable via
  // kernel.options.timing.enabled. When disabled: `phases` is a shared frozen
  // empty array, `phaseStart`/`phaseEnd` are noops, no Map is allocated.
  private _timingEnabled: boolean = false;
  // P3.7 — trace verbose opt-in (kernel.options.timing.verbose). Résolu 1× au
  // constructeur, implique `_timingEnabled`. false par défaut → 0 stringify/alloc
  // au teardown hors debug explicite (perf-first : gratuit en prod).
  private _timingVerbose: boolean = false;
  readonly phases: PhaseTiming[] = EMPTY_PHASES;
  private _phaseIndex: Map<string, number> | null = null;
  // Lazy alloc — most requests never register an after-response hook.
  private _afterResponseFns: AfterResponseHandler[] | null = null;
  private _afterResponseFired: boolean = false;
  // Lazy abort signal — created on first access (see `get signal`).
  // Zero per-request overhead if no consumer reads `context.signal`.
  private _abortController: AbortController | null = null;
  metaData: Data = {
    nodefony: {},
    result: null,
  };
  scheme: SchemeType;
  webSocketState: WebSocketState = null;
  constructor(container: Container | Scope, type: ServerType) {
    super(`${type}`, container);
    this.type = type;
    this.set("context", this);
    this.httpKernel = this.get("HttpKernel");
    this.sessionService = this.get<SessionsService>("sessions");
    this.setMetaData();
    // Resolve timing flag once per request. Explicit kernel option wins;
    // otherwise default = enabled in dev / development, disabled in prod.
    const explicit = (
      this.kernel?.options as { timing?: { enabled?: boolean } } | undefined
    )?.timing?.enabled;
    if (typeof explicit === "boolean") {
      this._timingEnabled = explicit;
    } else {
      // `environment` est normalisé "development"/"production"/"test" — JAMAIS
      // "prod". Comparer à "prod" laissait le timing (alloc `phases`/req +
      // performance.now() par phase) ACTIF en production. Doit rester actif en
      // dev ET test → comparer à "production".
      this._timingEnabled = this.kernel?.environment !== "production";
    }
    if (this._timingEnabled) {
      // Replace shared frozen empty array with a per-context one only when needed.
      (this as { phases: PhaseTiming[] }).phases = [];
      // P3.7 — trace verbose : résolu 1× ici (n'a de sens que si le timing est
      // actif). Opt-in explicite → false en prod / par défaut.
      const verbose = (
        this.kernel?.options as { timing?: { verbose?: boolean } } | undefined
      )?.timing?.verbose;
      this._timingVerbose = verbose === true;
    }
    this.scheme = "https";
    switch (this.type) {
      case "http": {
        this.scheme = "http";
        const server = this.get<ServerHttp>("server-http");
        this.server = server?.server as http.Server;
        break;
      }
      case "http2":
      case "https": {
        this.scheme = "https";
        const server = this.get<ServerHttps>("server-https");
        this.server = server?.server as https.Server;
        break;
      }
      case "http3": {
        this.scheme = "https";
        const server = this.get<{ server?: http2.Http2SecureServer }>(
          "server-http3",
        );
        this.server = server?.server ?? null;
        break;
      }
      case "websocket": {
        this.scheme = "ws";
        const server = this.get<Websocket>("server-websocket");
        this.server = server?.server as WebSocketServer;
        break;
      }
      case "websocket-secure": {
        this.scheme = "wss";
        const server = this.get<WebsocketSecure>("server-websocket-secure");
        this.server = server?.server as WebSocketServer;
        break;
      }
    }
    // this.container?.addScope("subRequest");
    // this.once("onRequest", () => {
    //   this.requested = true;
    // });
  }

  /**
   * Assemble l'enveloppe `metaData` de la requête (`nodefony.*` + `route`
   * snapshot per-requête + overrides appelant). Délègue au builder monomorphe
   * pur {@link buildMetaData} — pas de `extend(true, …)` (deep-clone + dispatch
   * polymorphe inutiles : `this.metaData` est per-requête, jamais partagé). `this`
   * satisfait structurellement {@link IMetaDataSource} (kernel/request/scheme/
   * requestId/resolver) → zéro alloc d'objet intermédiaire.
   */
  setMetaData(obj: Record<string, unknown> = {}): Data {
    return buildMetaData(
      this.metaData,
      this as unknown as IMetaDataSource,
      obj,
    );
  }

  setScheme(): SchemeType {
    return "https";
  }

  phaseStart(name: PhaseName): void {
    if (!this._timingEnabled) return;
    if (this._phaseIndex === null) this._phaseIndex = new Map();
    const idx = this.phases.length;
    this.phases.push({ name, startMs: performance.now() });
    this._phaseIndex.set(name, idx);
  }

  phaseEnd(name: PhaseName): void {
    if (!this._timingEnabled || this._phaseIndex === null) return;
    const idx = this._phaseIndex.get(name);
    if (idx === undefined) return;
    const p = this.phases[idx];
    if (p.endMs !== undefined) return;
    p.endMs = performance.now();
    p.durationMs = p.endMs - p.startMs;
  }

  onAfterResponse(fn: AfterResponseHandler): void {
    // BUG-002 — the hook fires from response "finish"/"close" (HTTP) or
    // "onFinish" (WS) listeners attached before RequestContext.run() opens the
    // ALS bubble. The controller registering here IS inside the bubble, so
    // bind at registration time to restore requestId/user/traceparent when the
    // hook runs later, outside the bubble.
    const boundFn = AsyncResource.bind(fn);
    if (this._afterResponseFired) {
      // Late subscribe — best-effort, run on next microtask
      Promise.resolve()
        .then(() => boundFn(this))
        .catch((e) => this.log(e, "ERROR", "onAfterResponse(late)"));
      return;
    }
    if (this._afterResponseFns === null) {
      this._afterResponseFns = [];
    }
    this._afterResponseFns.push(boundFn);
  }

  async _runAfterResponse(): Promise<void> {
    if (this._afterResponseFired) return;
    this._afterResponseFired = true;
    const fns = this._afterResponseFns;
    if (fns === null || fns.length === 0) return;
    this._afterResponseFns = null;
    for (const fn of fns) {
      try {
        await fn(this);
      } catch (e) {
        this.log(e, "ERROR", "onAfterResponse");
      }
    }
  }

  get signal(): AbortSignal {
    if (this._abortController === null) {
      this._abortController = new AbortController();
      const req = this.request as unknown as {
        once?: (event: string, handler: () => void) => void;
        complete?: boolean;
        destroyed?: boolean;
      } | null;
      if (req && typeof req.once === "function") {
        // Fire abort if the request was closed by the client before completing.
        // For HTTP IncomingMessage: req.complete === false means client aborted.
        // Late-subscribe safety: if already closed when signal is read, abort now.
        const onAborted = () => {
          if (
            this._abortController &&
            !this._abortController.signal.aborted &&
            req.complete === false
          ) {
            this._abortController.abort(new Error("Request aborted by client"));
          }
        };
        if (req.destroyed && req.complete === false) {
          onAborted();
        } else {
          req.once("close", onAborted);
        }
      }
    }
    return this._abortController.signal;
  }

  // Forces signal abort — used by HttpKernel when the underlying socket
  // dies before the response is sent, even if no consumer ever read `signal`.
  // No-op if no AbortController was lazily created (nobody cares).
  _abortIfPending(reason?: string): void {
    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(new Error(reason ?? "Context aborted"));
    }
  }

  override log(
    pci: Pci,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ): Pdu {
    if (!msgid) {
      msgid = this.type;
    }
    // Les logs émis au TEARDOWN (onFinish « Requête terminée », onClose, bilan
    // `req`) sont HORS de la bulle `RequestContext.run` (déjà refermée) → un Pdu
    // créé là ne capturerait PAS le requestId (provider ALS vide) → NON corrélable
    // (trace full-stack cassée). Si l'ALS est vide mais que le context tient un
    // requestId, on rouvre une micro-bulle → le Pdu le capture À LA CRÉATION, donc
    // AVANT le dispatch (ring + écriture driver JSONL/Loki + bus) : correct pour
    // TOUS les drivers, pas seulement le ring `memory`. Cas courant (dans la
    // bulle) : ALS pleine → run direct ; surcoût = 1 lecture ALS (~ns).
    if (this.requestId && RequestContext.getRequestId() === undefined) {
      return RequestContext.run({ requestId: this.requestId }, () =>
        super.log(pci, severity, msgid, msg),
      );
    }
    return super.log(pci, severity, msgid, msg);
  }

  override clean(): void {
    this.cleaned = true;
    this.httpKernel = null;
    return super.clean();
  }

  /**
   * Log d'un event du cycle de vie — gate boot-time (V2.1) : en production le
   * Pdu n'est PAS construit (return avant toute allocation). Hors prod, jalon
   * notable → INFO (EVENT_SEVERITY), event technique → DEBUG.
   */
  private logEvent(event: KernelEventsType): void {
    if (lifecycleEventLogging === null) {
      // P8 : runtime ∈ {development, production} (resolveRuntimeEnv) —
      // le check "prod" était mort.
      lifecycleEventLogging = this.kernel?.environment !== "production";
    }
    if (!lifecycleEventLogging) return;
    this.log(
      `${colorLogEvent()} ${event as string}`,
      EVENT_SEVERITY[event as string] || "DEBUG",
    );
  }

  override fire(event: KernelEventsType, ...args: unknown[]): boolean {
    this.logEvent(event);
    return super.fire(event, ...args);
  }

  override emit(event: KernelEventsType, ...args: unknown[]): boolean {
    this.logEvent(event);
    return super.emit(event, ...args);
  }

  override emitAsync(
    event: KernelEventsType,
    ...args: unknown[]
  ): Promise<unknown> {
    this.logEvent(event);
    return super.emitAsync(event, ...args);
  }

  override fireAsync(
    event: KernelEventsType,
    ...args: unknown[]
  ): Promise<unknown> {
    this.logEvent(event);
    return super.emitAsync(event, ...args);
  }

  logRequest(httpError?: Error | HttpError | nodefonyError | null) {
    try {
      const err = httpError ?? this.error ?? undefined;
      if (err) this.error = err;
      const logger = this.httpKernel?.getRequestLogger();
      if (!logger) return;
      // Audit sampling (L3): skip BEFORE renderHttp → 0 alloc, 0 stringify.
      if (
        logger.shouldSample &&
        !logger.shouldSample(this as never, err as Error | null)
      ) {
        return;
      }
      const entry = logger.renderHttp(this as never, err as Error | null);
      // Le bilan `req` (LE point d'entrée d'une trace) est émis au teardown, hors
      // bulle ALS → la corrélation requestId est assurée par l'override `log()`
      // ci-dessus (micro-bulle si l'ALS est vide), commun à tous les logs de fin.
      return this.log(entry.text, entry.severity, entry.msgid);
    } catch {}
  }

  /**
   * P3.7 — Émet au teardown un log DEBUG détaillant la durée de chaque phase du
   * pipeline (`parse · action · firewall · …` + total). Opt-in via
   * `kernel.options.timing.verbose`. Triple gate perf-first : `_timingVerbose`
   * résolu 1× (false en prod/par défaut) → timing actif → phases non vides ;
   * hors mode verbose, early-return AVANT toute allocation/`toFixed` (coût nul).
   */
  logPhasesVerbose(): void {
    if (!this._timingVerbose) return;
    const phases = this.phases;
    const n = phases.length;
    if (n === 0) return;
    let line = "";
    let total = 0;
    for (let i = 0; i < n; i++) {
      const p = phases[i];
      const d =
        p.durationMs ??
        (p.endMs !== undefined ? p.endMs - p.startMs : undefined);
      if (i > 0) line += " · ";
      if (d !== undefined) {
        line += `${p.name}=${d.toFixed(2)}ms`;
        total += d;
      } else {
        line += `${p.name}=…`;
      }
    }
    this.log(
      `TRACE phases [Σ ${total.toFixed(2)}ms] ${line}`,
      "DEBUG",
      `${this.type} TIMING`,
    );
  }

  addRequestCookie(cookie: Cookie): Cookie {
    if (cookie instanceof Cookie) {
      return (this.cookies[cookie.name] = cookie);
    } else {
      const error = new Error("addCookie cookie not valid !!");
      this.log(cookie, "ERROR");
      throw error;
    }
  }

  getRequestCookies(name?: string): Cookies | Cookie | null {
    if (name) {
      return this.cookies[name] || null;
    }
    return this.cookies;
  }

  setCookie(cookie: Cookie) {
    if (cookie) {
      return this.response?.addCookie(cookie);
    }
  }

  getRequest(): contextRequest {
    return this.request;
  }

  getResponse(): contextResponse {
    return this.response;
  }
  isValidDomain(): boolean {
    if (!this.httpKernel) {
      throw new Error(`Http Kernel not ready`);
    }
    return this.httpKernel.isValidDomain(this);
  }

  async saveSession(): Promise<Session | null> {
    if (this.sessionService) {
      return this.sessionService.saveSession(this);
    }
    throw new Error(`sessionService not found `);
  }

  hasSession(): boolean {
    return Boolean(this.cookieSession);
  }

  getCookieSession(name: string): Cookie | null {
    if (this.cookies[name]) {
      return this.cookies[name];
    }
    return null;
  }

  /**
   * Nom effectif du cookie de session pour CE transport. Sur TLS (https/wss) on
   * applique le préfixe **`__Host-`** (RFC 6265bis §4.1.3 / OWASP : recommandé
   * pour les identifiants de session — impose Secure + Path=/ + interdit Domain,
   * anti session-fixation cross-subdomain). En clair (http/ws) le préfixe est
   * omis (le navigateur le rejetterait sans Secure) → dégradation gracieuse,
   * notamment derrière un proxy qui termine le TLS. Lecture **et** écriture du
   * cookie passent par ce nom unique → cohérence de la reprise (L1).
   */
  getSessionCookieName(): string {
    const base = this.sessionService?.defaultSessionName ?? "nodefony";
    // `cookie.hostPrefix` : "auto" (défaut, préfixe sur TLS) | true (toujours) |
    // false (jamais). `true` permet à l'opérateur qui garantit le TLS côté client
    // (proxy terminant le TLS) de forcer `__Host-` même si le transport local est http.
    const mode =
      (
        this.sessionService?.options?.cookie as
          | { hostPrefix?: boolean | "auto" }
          | undefined
      )?.hostPrefix ?? "auto";
    const tls = this.scheme === "https" || this.scheme === "wss";
    const usePrefix = mode === true || (mode === "auto" && tls);
    return usePrefix ? `__Host-${base}` : base;
  }

  parseCookies(): void {
    return cookiesParser(this);
  }
  setContextJson(_encoding: BufferEncoding = "utf-8"): void {}
  setContextHtml(_encoding: BufferEncoding = "utf-8"): void {}
}

export default Context;
