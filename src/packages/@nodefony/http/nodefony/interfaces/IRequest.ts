import type { URL } from "node:url";
import type { ICookie } from "./ICookie";

export type HTTPMethodType =
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

export interface IRequest {
  url: URL | string;
  method: HTTPMethodType | null | undefined;

  getMethod(): HTTPMethodType | null | undefined;
  getHeader(name: string): string | string[] | undefined;
  getHeaders(): Record<string, string | string[] | undefined>;
}

export interface IHttpRequest extends IRequest {
  url: URL;
  query: Record<string, unknown>;
  queryGet: Record<string, unknown>;
  queryPost: Record<string, unknown>;
  queryFile: unknown[];
  remoteAddress: string | null | undefined;
  acceptHtml: boolean;

  getRemoteAddress(): string | null | undefined;
  getHost(): string | undefined;
  getHostName(): string | undefined;
  getUserAgent(): string | undefined;
  getOrigin(): string | undefined;
  getCookies(): Record<string, ICookie>;
}

export interface IHttp2Request extends IHttpRequest {
  // HTTP/2 specific: same contract as IHttpRequest,
  // backed by node:http2 Http2ServerRequest
  stream: unknown;
}

export interface IWsRequest extends IRequest {
  url: URL;
  query: Record<string, string>;
  queryGet: Record<string, string>;
  path: string;
  cookies?: Record<string, ICookie>;
}
