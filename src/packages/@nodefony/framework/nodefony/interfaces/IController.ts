import type {
  contextRequest,
  HTTPMethod,
  HttpResponse,
  Http2Response,
  WebsocketResponse,
  Session,
  ContextType,
} from "@nodefony/http";
import type { Module, FileClass } from "nodefony";
import type { OutgoingHttpHeaders } from "node:http";
import type { ReadStream } from "node:fs";
import type { IRoute } from "./IRoute.js";

export interface IController {
  readonly route?: IRoute | null;
  request: contextRequest;
  response: HttpResponse | Http2Response | WebsocketResponse | null;
  context?: ContextType;
  session?: Session | null;
  method?: HTTPMethod;
  queryGet: Record<string, unknown>;
  query: Record<string, unknown>;
  queryFile: unknown[];
  queryPost: Record<string, unknown>;
  module?: Module;

  setContext(context: ContextType): void;
  setContextJson(encoding?: BufferEncoding): unknown;
  setContextHtml(encoding?: BufferEncoding): unknown;
  render(
    data: unknown,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: Record<string, string | number>,
  ): Promise<unknown>;
  renderResponse(
    data: unknown,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: OutgoingHttpHeaders,
  ): Promise<HttpResponse | Http2Response | WebsocketResponse>;
  renderView(
    path: string,
    param?: Record<string, unknown>,
    status?: string | number,
    headers?: Record<string, string | number>,
  ): Promise<HttpResponse | Http2Response | WebsocketResponse>;
  renderJson(
    obj: unknown,
    status?: string | number,
    headers?: OutgoingHttpHeaders,
  ): Promise<unknown>;
  setRoute(route: IRoute): IRoute;
  getSession(): Session | undefined | null;
  redirect(
    url: string,
    status?: string | number,
    headers?: Record<string, string | number>,
  ): void;
  getFlashBag(key: string): unknown;
  setFlashBag(key: string, value: unknown): unknown;
  addFlash(key: string, value: unknown): unknown;
  forward(name: string, param?: unknown): unknown;
  /** @deprecated Bloque l'event-loop (`lstatSync`). Préférer `getFileAsync`. */
  getFile(file: FileClass | string): FileClass;
  /** Variante async de `getFile` (stat non bloquant via `FileClass.from`). */
  getFileAsync(file: FileClass | string): Promise<FileClass>;
  renderFileDownload(
    file: unknown,
    options?: unknown,
    headers?: OutgoingHttpHeaders,
  ): Promise<ReadStream>;
  streamFile(
    file: FileClass | string,
    headers?: OutgoingHttpHeaders,
    options?: Record<string, unknown>,
  ): Promise<ReadStream>;
}
