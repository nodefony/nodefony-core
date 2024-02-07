import nodefony, {
  Container,
  Service,
  Severity,
  Msgid,
  Message,
  Pdu,
  KernelEventsType,
  Error as nodefonyError,
} from "nodefony";
import websocket from "websocket";
import HttpKernel, { ContextType, ServerType } from "../../service/http-kernel";
import HttpResponse from "./http/Response";
import Http2Response from "./http2/Response";
import WebsocketResponse from "./websocket/Response";
import HttpResquest from "./http/Request";
import Http2Resquest from "./http2/Request";
import SessionsService from "../../service/sessions/sessions-service";
import clc from "cli-color";
import http from "node:http";
import http2 from "node:http2";
import { URL } from "node:url";
import Session from "../session/session";
import Cookie, { cookiesParser } from "../cookies/cookie";
import HttpError from "../errors/httpError";
const colorLogEvent = clc.cyan.bgBlue("EVENT CONTEXT");

export type contextRequest =
  | HttpResquest
  | Http2Resquest
  | websocket.request
  | null;
export type contextResponse =
  | HttpResponse
  | Http2Response
  | WebsocketResponse
  | null;

export type HTTPMethod =
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

class Context extends Service {
  secure: boolean = false;
  cleaned: boolean = false;
  isControlledAccess: boolean = false;
  validDomain: boolean = false;
  finished: boolean = false;
  contentLength: boolean = false;
  pushAllowed: boolean = false;
  requestEnded: boolean = false;
  requested: boolean = false;
  sessionStarting: boolean = false;
  domain: string = "";
  type: ServerType;
  httpKernel: HttpKernel | null;
  request: contextRequest | null = null;
  response: contextResponse | null = null;
  url: string = "";
  method: HTTPMethod | null = null;
  remoteAddress: string | undefined | null = null;
  originUrl: URL | undefined | null = null;
  cookies: Record<string, Cookie> = {};
  error: Error | HttpError | nodefonyError | null | undefined = null;
  sessionService?: SessionsService;
  session: Session | null | undefined = null;
  cookieSession: Cookie | null | undefined = null;
  user: any = null;
  constructor(container: Container, type: ServerType) {
    super(`${type} CONTEXT`, container);
    this.type = type;
    this.set("context", this);
    this.httpKernel = this.get("httpKernel");
    this.sessionService = this.get("sessions");
    // this.container?.addScope("subRequest");
    // this.once("onRequest", () => {
    //   this.requested = true;
    // });
  }

  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu {
    if (!msgid) {
      msgid = this.type;
    }
    return super.log(pci, severity, msgid, msg);
  }

  clean(): void {
    this.cleaned = true;
    this.httpKernel = null;
    return super.clean();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fire(event: KernelEventsType, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.fire(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: KernelEventsType, ...args: any[]): boolean {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emit(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emitAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fireAsync(event: KernelEventsType, ...args: any[]): Promise<any> {
    this.log(`${colorLogEvent} ${event as string}`, "DEBUG");
    return super.emitAsync(event, ...args);
  }

  logRequest(httpError?: Error | HttpError | nodefonyError) {
    try {
      const txt = `${clc.cyan("URL")} : ${this.url} ${clc.cyan("FROM")} : ${this.remoteAddress} ${clc.cyan("ORIGIN")} : ${this.originUrl?.host}`;
      let mgid = "";
      if (!httpError && this.error) {
        httpError = this.error;
      }
      if (httpError) {
        this.error = httpError;
        mgid = `${this.type} ${clc.magenta(this.response?.statusCode)} ${clc.red(this.method)}`;
        if (this.kernel && this.kernel.environment === "prod") {
          return this.log(`${txt} ${httpError.toString()}`, "ERROR", mgid);
        }
        return this.log(
          `${txt}
          ${httpError.toString()}`,
          "ERROR",
          mgid
        );
      }
      if (!this.error) {
        mgid = `${this.type} ${clc.magenta(this.response?.statusCode)} ${this.method}`;
        return this.log(txt, "INFO", mgid);
      }
    } catch (e) {}
  }

  addCookie(cookie: Cookie) {
    if (cookie instanceof Cookie) {
      this.cookies[cookie.name] = cookie;
    } else {
      const error = new Error("addCookie cookie not valid !!");
      this.log(cookie, "ERROR");
      throw error;
    }
  }

  setCookie(cookie: Cookie) {
    if (cookie) {
      return this.response?.addCookie(cookie);
    }
  }

  getRequest(): contextRequest {
    return this.request;
  }

  getResponse(): contextResponse {
    return this.response;
  }
  isValidDomain(): boolean {
    if (!this.httpKernel) {
      throw new Error(`Http Kernel not ready`);
    }
    return this.httpKernel.isValidDomain(this);
  }

  async saveSession(): Promise<Session | null> {
    if (this.sessionService) {
      return this.sessionService.saveSession(this);
    }
    throw new Error(`sessionService not found `);
  }

  hasSession(): boolean {
    return Boolean(this.cookieSession);
  }

  getCookieSession(name: string): Cookie | null {
    if (this.cookies[name]) {
      return this.cookies[name];
    }
    return null;
  }

  parseCookies(): void {
    return cookiesParser(this);
  }
}

export default Context;
