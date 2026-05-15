import type { ICookie } from "./ICookie";

export interface IResponse {
  statusCode: number;
  statusMessage: string;
  encoding: BufferEncoding;
  body: Buffer | null;
  cookies: Record<string, ICookie>;

  addCookie(cookie: ICookie): ICookie;
  send(data?: Buffer | string | null, encoding?: BufferEncoding): Promise<unknown>;
  clean(): void;
}

export interface IHttpResponse extends IResponse {
  ended: boolean;
  headers: Record<string, unknown>;
  contentType: string;

  setStatusCode(code: number | string, message?: string): { code: number; message: string };
  getStatusCode(): number;
  getStatusMessage(): string;
  isHeaderSent(): boolean;
  setHeader(name: string, value: string | number | string[]): void;
  getHeader(name: string): string | number | string[] | undefined;
  setHeaders(headers: Record<string, string | number>): void;
  setContentType(type: string): void;
  setBody(data: unknown): void;
  redirect(url: string, code?: number): Promise<IHttpResponse>;
  isHtml(): boolean;
  setTimeout(ms: number): void;
  deleteCookie(cookie: ICookie): void;
  setCookie(cookie: ICookie): void;
}

export interface IWebsocketResponse extends IResponse {
  connection: unknown | null;
  webSocketVersion?: number;

  setConnection(connection: unknown): unknown;
  broadcast(data: Buffer | string): void;
  close(code?: number, message?: string): Promise<void>;
}
