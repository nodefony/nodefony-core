import type { URL } from "node:url";
import type { ICookie } from "./ICookie";
import type { ISession } from "./ISession";
import type { HTTPMethodType } from "./IRequest";

export type ServerType =
  "http" | "https" | "http2" | "http3" | "websocket" | "websocket-secure";

export type SchemeType = "http" | "https" | "ws" | "wss";

export type WebSocketStateType =
  "handshake" | "connected" | "closed" | "error" | "message" | null;

export type CookiesMap = Record<string, ICookie>;

export type PhaseName =
  | "parse"
  | "resolve"
  | "firewall"
  | "initialize"
  | "action"
  | "render"
  | "send"
  | (string & {});

export interface PhaseTiming {
  name: PhaseName;
  startMs: number;
  endMs?: number;
  durationMs?: number;
}

/** Issue de la traversée d'une zone firewall. */
export type SecurityOutcome =
  /** Identité authentifiée (un authenticator a résolu un token). */
  | "granted"
  /** Anonyme EXPLICITE (authenticator `anonymous` listé par la zone). */
  | "anonymous"
  /** Refus par POLITIQUE (aucune preuve présentée en zone fermée → 401). */
  | "denied"
  /** Preuve PRÉSENTÉE mais invalide (l'acteur a échoué une preuve → 401). */
  | "failure"
  /** Backoff NIST actif (429). */
  | "throttled"
  /** Route exemptée (`bypassFirewall`) — la zone est traversée sans auth. */
  | "bypass";

/**
 * Décision du firewall sur CETTE requête — matière de la « radiographie »
 * (Studio / debug bar) : la zone dit ce qui était POSSIBLE (via
 * `context.security`), cette trace dit ce qui s'est RÉELLEMENT passé.
 *
 * Le contrat vit ici (et non dans `@nodefony/security`) parce que
 * `@nodefony/http` ne peut pas importer le module de sécurité (cycle) : http
 * porte le champ, security le REMPLIT — exactement le pattern de
 * `profilerQueries` (buffer porté par http, rempli par les adapters ORM).
 *
 * **Dev-only** : alloué par le firewall UNIQUEMENT si `context.profiling` est
 * vrai (profiler actif → jamais en production). Le chemin nominal de succès
 * n'émet aucun événement d'audit (le volume n'est pas un signal) : sans cette
 * trace, une requête qui PASSE ne laisse aucune empreinte de sa zone.
 */
export interface ISecurityTrace {
  /** Authenticator qui a résolu le token — `null` si aucun n'a abouti. */
  authenticator: string | null;
  /** Ce qui s'est passé. */
  outcome: SecurityOutcome;
  /** Motif du refus (`no_credentials`, `invalid_credentials`…), `null` si succès. */
  reason: string | null;
  /**
   * Identité résolue par le firewall. Le token vit dans l'ALS (pas sur
   * `context.user`) : sans ce champ, une requête authentifiée s'affiche
   * « anonyme » alors qu'elle porte des rôles.
   */
  user: string | null;
  /** Rôles portés par le token résolu, `null` hors succès. */
  roles: string[] | null;
}

export type AfterResponseHandler = (ctx: IContext) => void | Promise<void>;

export interface IContext {
  // Identity
  requestId: string;
  // Nonce CSP par-requête (P6 J5 étape B) — lazy ; lu par le firewall (header CSP)
  // et le template Vite (`<script nonce>`). Lecture seule : jamais piloté par le client.
  readonly cspNonce: string;
  // Directives CSP additionnelles de la route (`@Csp`, P6) — posées par le Resolver
  // au match, lues par le firewall APRÈS le resolve. `null` si la route n'en déclare pas.
  cspDirectives: Record<string, readonly string[]> | null;
  // CSRF per-route (`@CsrfProtect`/`@CsrfExempt`, P6) — posés par le Resolver au match.
  // `csrfToken` = synchronizer token émis par le firewall (à surfacer côté vue/SPA).
  csrfProtect: boolean;
  csrfExempt: boolean;
  csrfToken: string | null;
  type: ServerType;
  scheme: SchemeType;
  method: HTTPMethodType | null;
  url: string;
  domain: string;

  // Request / Response (base: any object, refined in sub-interfaces)
  request: object | null;
  response: object | null;

  // Flags
  secure: boolean;
  finished: boolean;
  cleaned: boolean;
  webSocketState: WebSocketStateType;
  isJson: boolean;
  isHtml: boolean;

  // Remote
  remoteAddress: string | null | undefined;
  originUrl: URL | null | undefined;

  // Session & Cookies
  session: ISession | null | undefined;
  cookieSession: ICookie | null | undefined;
  cookies: CookiesMap;

  // User
  user: unknown;

  // Error
  error: Error | null | undefined;

  // Metadata — typed as object (implementation uses Data from http-kernel)
  metaData: object;

  // Lifecycle timing — pipeline phases (filled by HttpKernel)
  readonly phases: PhaseTiming[];
  phaseStart(name: PhaseName): void;
  phaseEnd(name: PhaseName): void;

  // Radiographie dev-only. `profiling` = témoin « le Profiler est actif » posé
  // par le HttpKernel (false en prod) : les producteurs de trace (firewall) le
  // lisent AVANT d'allouer quoi que ce soit → zéro coût hors dev.
  profiling: boolean;
  securityTrace: ISecurityTrace | null;

  // Lifecycle hook — after response is sent (HTTP finish/close, WS close).
  // Fires exactly once per context, deduplicated across finish/close.
  // Handlers called after the response is on the wire but before scope teardown.
  onAfterResponse(fn: AfterResponseHandler): void;

  // Aborted when the client disconnects before completion (HTTP request "close"
  // with request.complete === false, or WS "close"). Lazily allocated:
  // accessing this getter creates the AbortController + attaches the listener.
  // If never accessed: zero per-request overhead.
  readonly signal: AbortSignal;

  // Methods — Cookies
  addRequestCookie(cookie: ICookie): ICookie;
  getRequestCookies(name?: string): CookiesMap | ICookie | null;
  setCookie(cookie: ICookie): void;
  parseCookies(): void;

  // Methods — Accessors
  getRequest(): object | null;
  getResponse(): object | null;
  isValidDomain(): boolean;

  // Methods — Session
  saveSession(): Promise<ISession | null>;
  hasSession(): boolean;
  getCookieSession(name: string): ICookie | null;
  getSessionCookieName(): string;

  // Methods — Metadata
  setMetaData(obj?: Record<string, unknown>): object;
}

export interface IHttpContext extends IContext {
  // proxy: object | null to accommodate ProxyType (specific keys, no index signature).
  // ⚠️ RFC 7239 §8.2 : topologie interne — JAMAIS recopiée en réponse / metaData (cf ProxyType).
  proxy: object | null;
  isRedirect: boolean;

  handle(): Promise<object>;
  render(
    chunk: unknown,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: Record<string, string | number>,
  ): Promise<object>;
  send(chunk?: unknown, encoding?: BufferEncoding): Promise<object>;
  end(): Promise<object>;
  redirect(
    url: string,
    status?: number | string,
    headers?: Record<string, string | number>,
  ): unknown;
  getHostName(): string | undefined;
  getRemoteAddress(): string | null | undefined;
  getHost(): string | undefined;
  getUserAgent(): string | undefined;
}

export interface IWebsocketContext extends IContext {
  acceptedProtocol?: string;
  connection: unknown | null;
  rejected: boolean;
  port: number | string;
  wsUrl: URL | null;
  queryGet: Record<string, string>;

  connect(): Promise<unknown>;
  handle(data?: unknown[]): Promise<object>;
  close(reasonCode: number, description: string): unknown;
  send(
    data?: Buffer | string | null,
    encoding?: BufferEncoding,
  ): Promise<object>;
  broadcast(data: Buffer | string): void;
  getRemoteAddress(): string | null | undefined;
  getHost(): string | undefined;
  getUserAgent(): string | undefined;
}
