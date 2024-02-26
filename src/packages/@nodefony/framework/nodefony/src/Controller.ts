import { Service, Module, Container, Event, typeOf } from "nodefony";
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
} from "@nodefony/http";
import { HttpContext } from "@nodefony/http";

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
  constructor(name: string, context: ContextType) {
    super(
      name,
      context.container as Container,
      context.notificationsCenter as Event
    );
    this.setContext(context);
  }
  setContextJson(encoding: BufferEncoding = "utf-8") {
    return this.context?.setContextJson(encoding);
  }

  async render(
    view: string | Object,
    param: Record<string, any> | BufferEncoding = {}
  ) {
    if (!this.response) {
      throw new Error(
        "WARNING ASYNC !!  RESPONSE ALREADY SENT BY EXPCEPTION FRAMEWORK"
      );
    }
    try {
      switch (typeOf(view)) {
        case "string":
          return await this.renderView(
            view as string,
            param as Record<string, any>
          );
        default:
          return this.renderJson(view as Object, param as BufferEncoding);
      }
    } catch (e) {
      throw e;
    }
  }

  async renderView(view: string, param: Record<string, any> = {}) {
    return view;
  }

  async renderJson(
    obj: Record<string, any>,
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
