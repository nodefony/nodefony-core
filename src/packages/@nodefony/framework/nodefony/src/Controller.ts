import {
  Service,
  Module,
  Container,
  Event,
  //typeOf,
  //EnvironmentType,
  //DebugType,
  //inject,
  FileClass,
} from "nodefony";
import type { IController } from "../interfaces/index.js";
import Route from "./Route";
import Router from "../service/router";
import {
  contextRequest,
  //contextResponse,
  //Context,
  HTTPMethod,
  HttpRequest,
  Http2Request,
  HttpResponse,
  Session,
  ContextType,
  WebsocketContext,
  Http2Response,
  WebsocketResponse,
  //HttpKernel,
  HttpContext,
} from "@nodefony/http";

//import { runInThisContext } from "node:vm";
import {
  //IncomingMessage,
  //ServerResponse,
  OutgoingHttpHeaders,
} from "node:http";
//import { ServerHttp2Stream } from "node:http2";
import fs, { createReadStream, ReadStream } from "node:fs";
import { promisify } from "util";
import Eta from "../service/Eta";
const fsClose = promisify(fs.close);

interface ReadStreamWithFD extends ReadStream {
  fd: number;
}
// Définir les options pour le flux de lecture

type ReadStreamOptions = {
  flags?: string;
  encoding?: BufferEncoding;
  fd?: number;
  mode?: number;
  autoClose?: boolean;
  emitClose?: boolean;
  start?: number;
  end?: number;
  highWaterMark?: number;
};

class Controller extends Service implements IController {
  static prefix: string = "/";
  route?: Route | null = null;
  request: contextRequest = null;
  response: HttpResponse | Http2Response | WebsocketResponse | null = null;
  context?: ContextType;
  method?: HTTPMethod;
  queryGet: Record<string, unknown> = {};
  query: Record<string, unknown> = {};
  queryFile: unknown[] = [];
  queryPost: Record<string, unknown> = {};
  //metaData: Data;
  module?: Module;
  template?: Eta | null;

  /**
   * Session courante, ou `null`. Getter direct sur `context.session` (peuplé au
   * point d'activation unique du pipeline si la route déclare `@UseSession` /
   * `@Session`, ou si un cookie de session est repris — L1). Remplace l'ancien
   * pont via l'event `onSessionStart` : toujours à jour, zéro allocation.
   */
  get session(): Session | null {
    return this.context?.session ?? null;
  }

  constructor(
    name: string,
    context: ContextType,
    //@inject("HttpKernel") private httpKernel?: HttpKernel
  ) {
    super(
      name,
      context.container as Container,
      context.notificationsCenter as Event,
    );
    this.template = this.get<Eta>("template");
    this.setContext(context);
  }

  setContext(context: ContextType) {
    const request = context.request as HttpRequest | Http2Request;
    this.context = context;
    this.method = this.context.method as HTTPMethod;
    this.response = this.context.response;
    this.request = this.context.request;
    this.queryGet = request?.queryGet;
    this.query = request?.query;
    this.queryFile = request?.queryFile;
    this.queryPost = request?.queryPost;
    // `session` est un getter sur `context.session` (plus d'event onSessionStart) :
    // disponible dès que le point d'activation du pipeline l'a ouverte.
    this.once("onRequestEnd", () => {
      this.query = request?.query;
      this.queryFile = request?.queryFile;
      this.queryPost = request?.queryPost;
    });
  }

  setContextJson(encoding: BufferEncoding = "utf-8") {
    return this.context?.setContextJson(encoding);
  }
  setContextHtml(encoding: BufferEncoding = "utf-8") {
    return this.context?.setContextHtml(encoding);
  }

  async render(
    data: unknown,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: Record<string, string | number>,
  ) {
    try {
      return (this.context as HttpContext)
        ?.render(data, encoding, status, headers)
        .catch((e: unknown) => {
          throw e;
        });
    } catch (e) {
      throw e;
    }
  }

  renderResponse(
    data: unknown,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: OutgoingHttpHeaders,
  ): Promise<Http2Response | HttpResponse> | Promise<WebsocketResponse> {
    if (headers) {
      this.response?.setHeaders(headers);
    }
    if (status) {
      this.response?.setStatusCode(status);
    }
    return (<HttpContext | WebsocketContext>this.context)?.send(
      data as Buffer | string | null,
      encoding,
    );
  }

  async renderView(
    path: string | FileClass,
    param: Record<string, unknown> = {},
    status?: string | number,
    headers?: Record<string, string | number>,
  ): Promise<Http2Response | HttpResponse | WebsocketResponse> {
    let data: string | undefined;
    try {
      const file = typeof path === "string" ? await FileClass.from(path) : path;
      data = await this.template?.render(
        (await file.readAsync()).toString(),
        this.withFrontendLocals(param),
      );
      this.setContextHtml();
      return this.renderResponse(data, "utf8", status, headers);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  /**
   * Injecte les helpers frontend (`frontendTags`/`frontendDocument`) dans les
   * locals du template (passés en data, pas de registre global de fonctions).
   * Service `frontend` résolu par nom (pas d'import `@nodefony/frontend`). Les
   * valeurs fournies par l'action priment (spread `param` en dernier).
   */
  private withFrontendLocals(
    param: Record<string, unknown>,
  ): Record<string, unknown> {
    const fe = this.get<{
      renderTags?: (entry: string) => string;
      renderDocument?: (entry: string) => string;
      assetUrl?: (p: string) => string;
    }>("frontend");
    if (!fe?.renderTags) return param;
    return {
      frontendTags: (entry: string) => fe.renderTags!(entry),
      frontendDocument: (entry: string) => fe.renderDocument!(entry),
      // `asset('/x')` → URL CDN (assetBaseUrl) en prod, sinon chemin relatif.
      asset: (p: string) => (fe.assetUrl ? fe.assetUrl(p) : p),
      ...param,
    };
  }

  async renderJson(
    obj: unknown,
    status?: string | number,
    headers?: OutgoingHttpHeaders,
  ) {
    const data = JSON.stringify(obj);
    this.setContextJson();
    return this.renderResponse(data, "utf8", status, headers);
  }

  setRoute(route: Route): Route {
    return (this.route = route);
  }

  getSession(): Session | undefined | null {
    if (this.context?.session) return this.context?.session;
  }

  redirect(
    url: string,
    status?: string | number,
    headers?: Record<string, string | number>,
  ) {
    // if (!(this.context as HttpContext).redirect) {
    //   throw new Error("subRequest can't redirect request");
    // }
    if (!url) {
      throw new Error("Redirect error no url !!!");
    }
    (this.context as HttpContext).redirect(url, status, headers);
  }

  getFlashBag(key: string) {
    const session = this.getSession();
    if (session) {
      return session.getFlashBag(key);
    }
    this.log("getFlashBag session not started !", "ERROR");
    return null;
  }
  setFlashBag(key: string, value: unknown) {
    const session = this.getSession();
    if (session) {
      return session.setFlashBag(key, value);
    }
    return null;
  }

  addFlash(key: string, value: unknown) {
    return this.setFlashBag(key, value);
  }

  forward(name: string, param?: unknown[]) {
    const resolver = (this.get("router") as Router).resolveController(
      this.context as ContextType,
      name,
    );
    return resolver.callController(param, true);
  }

  /**
   * @deprecated Bloque l'event-loop (`fs.lstatSync` via `new FileClass`).
   *   Utiliser {@link getFileAsync} dans tout pipeline. Conservé pour compat.
   */
  getFile(file: FileClass | string): FileClass {
    try {
      let File: FileClass;
      if (file instanceof FileClass) {
        File = file;
      } else if (typeof file === "string") {
        // eslint-disable-next-line new-cap
        File = new FileClass(file);
      } else {
        throw new Error(`File argument bad type for getFile :${typeof file}`);
      }
      if (File.type !== "File") {
        throw new Error(`getFile bad type for  :${file}`);
      }
      return File;
    } catch (e) {
      throw e;
    }
  }

  /**
   * Variante **async** de `getFile()` — résout les stats via `FileClass.from`
   * (pas de `lstatSync` bloquant). À préférer dans le pipeline (render/stream).
   *
   * @param file - `FileClass` déjà hydraté OU chemin string.
   * @returns le `FileClass` (type `"File"` validé).
   * @throws Si le type n'est pas `"File"` ou si le chemin est invalide.
   */
  async getFileAsync(file: FileClass | string): Promise<FileClass> {
    let File: FileClass;
    if (file instanceof FileClass) {
      File = file;
    } else if (typeof file === "string") {
      File = await FileClass.from(file);
    } else {
      throw new Error(
        `File argument bad type for getFileAsync :${typeof file}`,
      );
    }
    if (File.type !== "File") {
      throw new Error(`getFileAsync bad type for  :${file}`);
    }
    return File;
  }

  async renderFileDownload(
    file: FileClass | string,
    options?: ReadStreamOptions,
    headers: OutgoingHttpHeaders = {},
  ): Promise<ReadStream> {
    const File = await this.getFileAsync(file);
    const length = File.stats.size;
    const head = {
      ...{
        "Content-Disposition": `attachment; filename="${File.name}"`,
        "Content-Length": length,
        Expires: "0",
        "Content-Description": "File Transfer",
        "Content-Type": File.mimeType || "application/octet-stream",
      },
      ...headers,
    };
    try {
      return this.streamFile(File, head, options);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async streamFile(
    file: FileClass | string,
    headers?: OutgoingHttpHeaders,
    options: ReadStreamOptions | undefined = {},
  ): Promise<ReadStream> {
    if (!this.response) {
      throw new Error(`response not found`);
    }
    const contextResponse = this.response as HttpResponse | Http2Response;
    const response = contextResponse.response;
    if (!response) {
      throw new Error(`response not found`);
    }
    (options as ReadStreamOptions).autoClose = false;
    try {
      const fileDetails = await this.getFileAsync(file);

      (this.response as HttpResponse | Http2Response).response?.removeHeader(
        "Content-Type",
      );
      (this.response as HttpResponse | Http2Response).response?.removeHeader(
        "content-type",
      );
      const contentTypeHeader =
        headers && (headers["Content-Type"] || headers["content-type"]);
      if (!contentTypeHeader) {
        (this.response as HttpResponse | Http2Response).setFileMimeType(
          fileDetails.name,
        );
      }
      const contentLength =
        headers && (headers["Content-Length"] || headers["content-length"]);
      if (!contentLength) {
        if (!headers) {
          headers = {};
        }
        (this.response as HttpResponse | Http2Response).response?.removeHeader(
          "Content-Length",
        );
        (this.response as HttpResponse | Http2Response).response?.removeHeader(
          "content-length",
        );
        headers["Content-Length"] = fileDetails.stats.size;
      }
      const streamFile = createReadStream(
        fileDetails.path as fs.PathLike,
        options,
      ) as ReadStreamWithFD;

      return new Promise((resolve, reject) => {
        let handled = false;
        streamFile.on("open", () => {
          try {
            (this.context as HttpContext)?.writeHead(
              contextResponse?.statusCode as number,
              headers,
            );
            streamFile.pipe(response, { end: false });
          } catch (e) {
            this.log(e, "ERROR");
            return reject(e);
          }
        });
        const handleStreamEnd = async () => {
          try {
            if (handled) return; // Prevent handling multiple times
            handled = true;
            if (streamFile) {
              streamFile.unpipe(response);
              if (streamFile.fd) {
                await fsClose(streamFile.fd).catch((e) => {
                  return reject(e);
                });
              }
              if (!this.context?.finished) {
                (this.context as HttpContext)?.end();
              }
              return resolve(streamFile);
            }
          } catch (e) {
            this.log(e, "ERROR");
            return reject(e);
          }
        };
        streamFile.on("end", handleStreamEnd);
        streamFile.on("close", handleStreamEnd);
        streamFile.on("error", (error) => {
          this.log(error, "ERROR");
          if (!this.context?.finished) {
            (this.context as HttpContext)?.end();
          }
          return reject(error);
        });
      });
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async renderMediaStream(
    file: FileClass | string,
    headers: OutgoingHttpHeaders = {},
    options: ReadStreamOptions | undefined = {},
  ) {
    const File = await this.getFileAsync(file);
    this.response?.setEncoding("binary");
    const { range } = (this.request as HttpRequest | Http2Request)?.headers;
    const length = File.stats.size;
    let head: OutgoingHttpHeaders;
    let value: ReadStreamOptions;
    const contextResponse = this.response as HttpResponse | Http2Response;
    const response = contextResponse.response;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const partialstart = parts[0];
      const partialend = parts[1];
      const start = parseInt(partialstart, 10);
      const end = partialend ? parseInt(partialend, 10) : length - 1;
      const chunksize = end - start + 1;
      value = {
        ...options,
        ...{
          start,
          end,
        },
      };
      head = {
        ...{
          "Content-Range": `bytes ${start}-${end}/${length}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize.toString(),
          "Content-Type": File.mimeType || "application/octet-stream",
        },
        ...headers,
      };
      response?.removeHeader("content-type");
      this.response?.setStatusCode(206);
    } else {
      value = {
        ...options,
      };
      head = {
        ...{
          "Content-Type": File.mimeType || "application/octet-stream",
          "Content-Length": length.toString(),
          "Content-Disposition": ` inline; filename="${File.name}"`,
        },
        ...headers,
      };
      response?.removeHeader("content-type");
    }
    // streamFile
    try {
      return this.streamFile(File, head, value);
    } catch (e) {
      throw e;
    }
  }
}

export default Controller;
