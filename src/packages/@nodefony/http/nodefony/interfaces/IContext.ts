import type { URL } from "node:url";
import type { ICookie } from "./ICookie";
import type { ISession } from "./ISession";
import type { HTTPMethodType } from "./IRequest";

export type ServerType =
  | "http"
  | "https"
  | "http2"
  | "http3"
  | "websocket"
  | "websocket-secure";

export type SchemeType = "http" | "https" | "ws" | "wss";

export type WebSocketStateType =
  | "handshake"
  | "connected"
  | "closed"
  | "error"
  | "message"
  | null;

export type CookiesMap = Record<string, ICookie>;

export interface IContext {
  // Identity
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

  // Methods — Metadata
  setMetaData(obj?: Record<string, unknown>): object;
}

export interface IHttpContext extends IContext {
  // proxy: object | null to accommodate ProxyType (specific keys, no index signature)
  proxy: object | null;
  isRedirect: boolean;

  handle(): Promise<object>;
  render(chunk: unknown, encoding?: BufferEncoding, status?: string | number, headers?: Record<string, string | number>): Promise<object>;
  send(chunk?: unknown, encoding?: BufferEncoding): Promise<object>;
  end(): Promise<object>;
  redirect(url: string, status?: number | string, headers?: Record<string, string | number>): unknown;
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
  send(data?: Buffer | string | null, encoding?: BufferEncoding): Promise<object>;
  broadcast(data: Buffer | string): void;
  getRemoteAddress(): string | null | undefined;
  getHost(): string | undefined;
  getUserAgent(): string | undefined;
}
