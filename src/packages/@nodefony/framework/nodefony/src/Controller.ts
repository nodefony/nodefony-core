import {
  Service,
  Module,
  Container,
  Event,
  typeOf,
  //EnvironmentType,
  //DebugType,
  //inject,
  FileClass,
} from "nodefony";
import Route from "./Route";
import {
  contextRequest,
  contextResponse,
  Context,
  HTTPMethod,
  HttpRequest,
  Http2Request,
  Session,
  ContextType,
  //HttpKernel,
} from "@nodefony/http";
import { HttpContext } from "@nodefony/http";
//import { runInThisContext } from "node:vm";
import ejs from "../service/Ejs";
import twig from "../service/Twig";
import { IncomingMessage, ServerResponse } from "node:http";
import { ServerHttp2Stream } from "node:http2";

class Controller extends Service {
  static basepath: string = "/";
  route?: Route | null = null;
  request: contextRequest = null;
  response: contextResponse = null;
  context?: ContextType;
  session?: Session | null;
  sessionAutoStart: string | null = null;
  method?: HTTPMethod;
  queryGet: Record<string, any> = {};
  query: Record<string, any> = {};
  queryFile: any[] = [];
  queryPost: Record<string, any> = {};
  //metaData: Data;
  module?: Module;
  twig: twig;
  ejs: ejs;
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
    this.twig = this.get("twig");
    this.ejs = this.get("ejs");
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

  async renderResponse(
    data: any,
    encoding?: BufferEncoding,
    status?: string | number,
    headers?: Record<string, string | number>
  ): Promise<ServerResponse<IncomingMessage> | ServerHttp2Stream> {
    this.response?.setBody(data);
    if (headers) {
      this.response?.setHeaders(headers);
    }
    if (status) {
      this.response?.setStatusCode(status);
    }
    return (this.context as HttpContext)?.send(data, encoding);
  }

  async renderView(
    view: string,
    param: Record<string, any> = {},
    status?: string | number,
    headers?: Record<string, string | number>
  ): Promise<ServerResponse<IncomingMessage> | ServerHttp2Stream> {
    return this.renderTwigView(view, param, status, headers);
  }

  async renderEjsView(
    view: string,
    param: Record<string, any> = {},
    status?: string | number,
    headers?: Record<string, string | number>
  ): Promise<ServerResponse<IncomingMessage> | ServerHttp2Stream> {
    let data: string;
    try {
      const file = new FileClass(view);
      data = await this.ejs.render((await file.readAsync()).toString(), param);
      this.setContextHtml();
      return this.renderResponse(data, "utf8", status, headers);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async renderTwigView(
    view: string,
    param: Record<string, any> = {},
    status?: string | number,
    headers?: Record<string, string | number>
  ): Promise<ServerResponse<IncomingMessage> | ServerHttp2Stream> {
    // "app:ejs:index"
    let data: string;
    try {
      const file = new FileClass(view);
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
    headers?: Record<string, string | number>
  ) {
    let data = null;
    try {
      data = JSON.stringify(obj);
      return this.renderResponse(data, "utf8", status, headers);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  setRoute(route: Route): Route {
    return (this.route = route);
  }

  startSession(sessionContext?: string) {
    const sessionService = this.get("sessions");
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
}

export default Controller;
