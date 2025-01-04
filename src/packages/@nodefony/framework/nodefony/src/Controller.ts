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
  SessionsService,
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
import Twig from "../service/Twig";
import Ejs from "../service/Ejs";
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

class Controller extends Service {
  static prefix: string = "/";
  route?: Route | null = null;
  request: contextRequest = null;
  response: HttpResponse | Http2Response | WebsocketResponse | null = null;
  context?: ContextType;
  session?: Session | null;
  sessionAutoStart: string | false = false;
  method?: HTTPMethod;
  queryGet: Record<string, any> = {};
  query: Record<string, any> = {};
  queryFile: any[] = [];
  queryPost: Record<string, any> = {};
  //metaData: Data;
  module?: Module;
  twig?: Twig | null;
  ejs?: Ejs | null;
  constructor(
    name: string,
    context: ContextType
    //@inject("HttpKernel") private httpKernel?: HttpKernel
  ) {
    super(
      name,
      context.container as Container,
      context.notificationsCenter as Event
    );
    this.twig = this.get<Twig>("twig");
    this.ejs = this.get<Ejs>("ejs");
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
    this.session = this.getSession();
    this.once("onRequestEnd", () => {
      this.query = request?.query;
      this.queryFile = request?.queryFile;
      this.queryPost = request?.queryPost;
    });
    this.once("onSessionStart", (session) => {
      this.session = session;
    });
  }

  setContextJson(encoding: BufferEncoding = "utf-8") {
    return this.context?.setContextJson(encoding);
  }
  setContextHtml(encoding: BufferEncoding = "utf-8") {
    return this.context?.setContextHtml(encoding);
  }

  async render(
    data: any,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: Record<string, string | number>
  ) {
    try {
      return (this.context as HttpContext)
        ?.render(data, encoding, status, headers)
        .catch((e) => {
          throw e;
        });
    } catch (e) {
      throw e;
    }
  }

  renderResponse(
    data: any,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: OutgoingHttpHeaders
  ): Promise<Http2Response | HttpResponse> | Promise<WebsocketResponse> {
    if (headers) {
      this.response?.setHeaders(headers);
    }
    if (status) {
      this.response?.setStatusCode(status);
    }
    return (<HttpContext | WebsocketContext>this.context)?.send(data, encoding);
  }

  async renderView(
    path: string,
    param: Record<string, any> = {},
    status?: string | number,
    headers?: Record<string, string | number>
  ): Promise<Http2Response | HttpResponse | WebsocketResponse> {
    const file = new FileClass(path);
    //console.log("renderView", file);
    const extension = file.extention || file.ext.slice(1);
    switch (extension) {
      case "twig":
        return this.renderTwig(file, param, status, headers);
      case "ejs":
        return this.renderEjs(file, param, status, headers);
      default:
        throw new Error(`Bad template `);
    }
  }

  async renderEjs(
    path: string | FileClass,
    param: Record<string, any> = {},
    status?: string | number,
    headers?: Record<string, string | number>
  ): Promise<Http2Response | HttpResponse | WebsocketResponse> {
    let data: string | undefined;
    try {
      let file = null;
      if (path instanceof FileClass) {
        file = path;
      } else {
        file = new FileClass(path);
      }
      data = await this.ejs?.render((await file.readAsync()).toString(), param);
      this.setContextHtml();
      return this.renderResponse(data, "utf8", status, headers);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async renderTwig(
    path: string | FileClass,
    param: Record<string, any> = {},
    status?: string | number,
    headers?: Record<string, string | number>
  ): Promise<Http2Response | HttpResponse | WebsocketResponse> {
    // "app:ejs:index"
    let data: string | undefined;
    try {
      let file = null;
      if (path instanceof FileClass) {
        file = path;
      } else {
        file = new FileClass(path);
      }
      data = await this.twig?.render(file, param).catch((e) => {
        throw e;
      });
      this.setContextHtml();
      return this.renderResponse(data, "utf8", status, headers);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async renderJson(
    obj: any,
    status?: string | number,
    headers?: OutgoingHttpHeaders
  ) {
    let data = null;
    try {
      data = JSON.stringify(obj);
      this.setContextJson();
      return this.renderResponse(data, "utf8", status, headers);
    } catch (e) {
      //this.log(e, "ERROR");
      throw e;
    }
  }

  setRoute(route: Route): Route {
    return (this.route = route);
  }

  startSession(sessionContext?: string) {
    const sessionService = this.get<SessionsService>("sessions");
    if (!sessionService) {
      throw new Error(`Servcei session not defined`);
    }
    // is subRequest
    // if (this.context.parent) {
    //   return this.getSession();
    // }
    if (!this.context?.requestEnded || this.context?.security) {
      return (this.sessionAutoStart =
        sessionService.setAutoStart(sessionContext));
    }
    return sessionService.start(this.context, sessionContext);
  }

  getSession(): Session | undefined | null {
    if (this.context?.session) return this.context?.session;
  }

  redirect(
    url: string,
    status?: string | number,
    headers?: Record<string, string | number>
  ) {
    // if (!(this.context as HttpContext).redirect) {
    //   throw new Error("subRequest can't redirect request");
    // }
    if (!url) {
      throw new Error("Redirect error no url !!!");
    }
    try {
      (this.context as HttpContext).redirect(url, status, headers);
    } catch (e) {
      throw e;
    }
  }

  getFlashBag(key: string) {
    const session = this.getSession();
    if (session) {
      return session.getFlashBag(key);
    }
    this.log("getFlashBag session not started !", "ERROR");
    return null;
  }
  setFlashBag(key: string, value: any) {
    const session = this.getSession();
    if (session) {
      return session.setFlashBag(key, value);
    }
    return null;
  }

  addFlash(key: string, value: any) {
    return this.setFlashBag(key, value);
  }

  forward(name: string, param?: any) {
    const resolver = (this.get("router") as Router).resolveController(
      this.context as ContextType,
      name
    );
    return resolver.callController(param, true);
  }

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

  renderFileDownload(
    file: any,
    options?: any,
    headers: OutgoingHttpHeaders = {}
  ): Promise<ReadStream> {
    const File = this.getFile(file);
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

  streamFile(
    file: FileClass | string,
    headers?: OutgoingHttpHeaders,
    options: ReadStreamOptions | undefined = {}
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
      const fileDetails = this.getFile(file);

      (this.response as HttpResponse | Http2Response).response?.removeHeader(
        "Content-Type"
      );
      (this.response as HttpResponse | Http2Response).response?.removeHeader(
        "content-type"
      );
      const contentTypeHeader =
        headers && (headers["Content-Type"] || headers["content-type"]);
      if (!contentTypeHeader) {
        (this.response as HttpResponse | Http2Response).setFileMimeType(
          fileDetails.name
        );
      }
      const contentLength =
        headers && (headers["Content-Length"] || headers["content-length"]);
      if (!contentLength) {
        if (!headers) {
          headers = {};
        }
        (this.response as HttpResponse | Http2Response).response?.removeHeader(
          "Content-Length"
        );
        (this.response as HttpResponse | Http2Response).response?.removeHeader(
          "content-length"
        );
        headers["Content-Length"] = fileDetails.stats.size;
      }
      const streamFile = createReadStream(
        fileDetails.path as fs.PathLike,
        options
      ) as ReadStreamWithFD;

      return new Promise((resolve, reject) => {
        let handled = false;
        streamFile.on("open", () => {
          try {
            (this.context as HttpContext)?.writeHead(
              contextResponse?.statusCode as number,
              headers
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

  renderMediaStream(
    file: FileClass | string,
    headers: OutgoingHttpHeaders = {},
    options: ReadStreamOptions | undefined = {}
  ) {
    const File = this.getFile(file);
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
