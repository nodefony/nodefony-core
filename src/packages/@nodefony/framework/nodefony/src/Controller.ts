import {
  Service,
  Module,
  Container,
  Event,
  typeOf,
  EnvironmentType,
  DebugType,
  inject,
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
  HttpKernel,
} from "@nodefony/http";
import { HttpContext } from "@nodefony/http";
import { runInThisContext } from "node:vm";
import ejs from "../service/Ejs";
import twig from "../service/Twig";
import { IncomingMessage, ServerResponse } from "node:http";
import { ServerHttp2Stream } from "node:http2";

export interface MetaData {
  name?: string;
  version?: string;
  url?: URL;
  environment?: EnvironmentType;
  debug?: DebugType;
}

export interface Data {
  nodefony: MetaData;
}

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
  metaData: Data;
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
    this.metaData = {
      nodefony: {
        name: this.kernel?.projectName,
        version: this.kernel?.version,
        url: this.context?.request?.url,
        environment: this.kernel?.environment,
        debug: this.kernel?.debug,
        //projectVersion: this.kernel?.projectVersion,
        //local: context.translation.defaultLocale.substr(0, 2),
        //core: this.kernel?.isCore,
        //route: context?.resolver.getRoute(),
        //getContext: () => this.context,
      },
    };
  }
  setContextJson(encoding: BufferEncoding = "utf-8") {
    return this.context?.setContextJson(encoding);
  }
  setContextHtml(encoding: BufferEncoding = "utf-8") {
    return this.context?.setContextHtml(encoding);
  }

  async render(
    view: string | Object,
    param: Record<string, any> | BufferEncoding = {},
    status?: string | number,
    headers?: Record<string, string | number>
  ) {
    if (!this.response) {
      throw new Error(
        "WARNING ASYNC !!  RESPONSE ALREADY SENT BY EXPCEPTION FRAMEWORK"
      );
    }
    try {
      switch (typeOf(view)) {
        case "string":
          return await this.renderTwigView(
            view as string,
            param as Record<string, any>,
            status,
            headers
          );
        default:
          return this.renderJson(view as Object, param as BufferEncoding);
      }
    } catch (e) {
      throw e;
    }
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
      if (!this.response) {
        throw new Error(
          "WARNING ASYNC !!  RESPONSE ALREADY SENT BY EXPCEPTION FRAMEWORK"
        );
      }
      this.response.setBody(data as string);
      this.setContextHtml();
      if (headers) {
        this.response.setHeaders(headers);
      }
      if (status) {
        this.response.setStatusCode(status);
      }
      return (this.context as HttpContext)?.send(data);
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
      if (!this.response) {
        throw new Error(
          "WARNING ASYNC !!  RESPONSE ALREADY SENT BY EXPCEPTION FRAMEWORK"
        );
      }
      this.response.setBody(data as string);
      this.setContextHtml();
      if (headers) {
        this.response.setHeaders(headers);
      }
      if (status) {
        this.response.setStatusCode(status);
      }
      return (this.context as HttpContext)?.send(data);
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
      if (!this.response) {
        throw new Error(
          "WARNING ASYNC !!  RESPONSE ALREADY SENT BY EXPCEPTION FRAMEWORK"
        );
      }
      this.response.setBody(data);
      this.setContextJson();
      if (headers) {
        this.response.setHeaders(headers);
      }
      if (status) {
        this.response.setStatusCode(status);
      }
      return (this.context as HttpContext)?.send(data);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  setRoute(route: Route): Route {
    return (this.route = route);
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
    this.once("onRequestEnd", () => {
      this.query = request?.query;
      this.queryFile = request?.queryFile;
      this.queryPost = request?.queryPost;
    });
    this.session = this.getSession();
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
    return this.context?.session;
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
