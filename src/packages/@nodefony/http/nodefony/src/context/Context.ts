import {
  Container,
  Service,
  Severity,
  Msgid,
  Message,
  Pdu,
  KernelEventsType,
  nodefonyError,
  //EnvironmentType,
  //DebugType,
  extend,
  Scope,
} from "nodefony";
import type { IProfilerQuery } from "nodefony";
import { Resolver, Router } from "@nodefony/framework";
import { WebSocketServer } from "ws";
import http2 from "node:http2";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
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
import clc from "cli-color";
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

const colorLogEvent = clc.cyan.bgBlack("EVENT CONTEXT");

// Shared frozen array used when timing is disabled — zero per-request alloc.
const EMPTY_PHASES: PhaseTiming[] = Object.freeze([] as PhaseTiming[]) as unknown as PhaseTiming[];

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

class Context extends Service implements IContextInterface {
  secure: boolean = false;
  security?: SecuredArea | null = null;
  cleaned: boolean = false;
  isControlledAccess: boolean = false;
  validDomain: boolean = false;
  finished: boolean = false;
  contentLength: boolean = false;
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
  user: any = null;
  waitAsync: boolean = false;
  isJson: boolean = false;
  isHtml: boolean = false;
  crossDomain: boolean = false;
  router: Router | null = this.get("router");
  resolver: Resolver | null = null;
  sessionAutoStart: string | null = null;
  requestId: string = randomUUID();
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
    const explicit = (this.kernel as any)?.options?.timing?.enabled;
    if (typeof explicit === "boolean") {
      this._timingEnabled = explicit;
    } else {
      this._timingEnabled = this.kernel?.environment !== "prod";
    }
    if (this._timingEnabled) {
      // Replace shared frozen empty array with a per-context one only when needed.
      (this as { phases: PhaseTiming[] }).phases = [];
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
        this.server = this.get<any>("server-http3").server;
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

  setMetaData(obj: Record<string, any> = {}): Data {
    let ele = {
      nodefony: {
        name: this.kernel?.projectName,
        version: this.kernel?.version,
        url: this.request?.url,
        environment: this.kernel?.environment,
        debug: this.kernel?.debug,
        scheme: this.scheme,
        requestId: this.requestId,
        route: this.resolver?.route,
      },
    };
    return (this.metaData = extend(true, this.metaData, ele, obj));
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
    pci: any,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message
  ): Pdu {
    if (!msgid) {
      msgid = this.type;
    }
    return super.log(pci, severity, msgid, msg);
  }

  override clean(): void {
    this.cleaned = true;
    this.httpKernel = null;
    return super.clean();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fire(event: KernelEventsType, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.fire(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: KernelEventsType, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emit(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emitAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fireAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  logRequest(httpError?: Error | HttpError | nodefonyError | null) {
    try {
      const err = httpError ?? this.error ?? undefined;
      if (err) this.error = err;
      const logger = this.httpKernel?.getRequestLogger();
      if (!logger) return;
      const entry = logger.renderHttp(this as never, err as Error | null);
      return this.log(entry.text, entry.severity, entry.msgid);
    } catch {}
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

  parseCookies(): void {
    return cookiesParser(this);
  }
  setContextJson(_encoding: BufferEncoding = "utf-8"): void {}
  setContextHtml(_encoding: BufferEncoding = "utf-8"): void {}
}

export default Context;
