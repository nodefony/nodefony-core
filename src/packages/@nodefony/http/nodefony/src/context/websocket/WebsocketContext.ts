import Context, { contextRequest, contextResponse } from "../Context";
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

class WebsocketContext extends Context {
  request: websocket.request;
  response: websocketResponse;
  cookies: Record<string, Cookie> = {};
  constructor(
    container: Container,
    request: websocket.request,
    type: ServerType
  ) {
    super(container, type);
    this.request = request;
    this.response = new websocketResponse();
  }

  async connect(): Promise<any> {}

  async handle(): Promise<any> {}
}

export default WebsocketContext;
