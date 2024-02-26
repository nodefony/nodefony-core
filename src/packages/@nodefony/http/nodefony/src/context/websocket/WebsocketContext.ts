import Context, { contextRequest, contextResponse, Cookies } from "../Context";
import {
  ServerType,
  httpRequest,
  httpResponse,
} from "../../../service/http-kernel";
import {
  Container,
  Service,
  Severity,
  Msgid,
  Message,
  Pdu,
  KernelEventsType,
} from "nodefony";
import websocket from "websocket";
import websocketResponse from "./Response";
import Cookie from "../../cookies/cookie";
import { URL } from "node:url";

declare module "websocket" {
  interface request {
    //cookies: Cookies;
    url: URL;
  }
}

class WebsocketContext extends Context {
  request: websocket.request;
  response: websocketResponse;
  cookies: Cookies = {};
  acceptedProtocol?: string;
  isJson: boolean = true;
  constructor(
    container: Container,
    request: websocket.request,
    type: ServerType
  ) {
    super(container, type);
    this.request = request;
    this.response = new websocketResponse();
    this.acceptedProtocol =
      request.httpRequest.headers["sec-websocket-protocol"];
  }

  async connect(): Promise<any> {}

  async handle(): Promise<any> {}

  //override async send(chunk?: any, encoding?: BufferEncoding) {}

  getRemoteAddress(): string | null {
    return this.request?.remoteAddress;
  }

  getHost(): string | undefined {
    return this.request.httpRequest.headers.host;
  }

  getUserAgent(): string {
    return "";
  }

  override setContextJson(encoding: BufferEncoding = "utf-8"): void {
    this.isJson = true;
  }
}

export default WebsocketContext;
