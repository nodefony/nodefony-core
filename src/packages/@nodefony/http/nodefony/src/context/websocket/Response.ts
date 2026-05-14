import Cookie from "../../cookies/cookie.js";
import { Message, Msgid, Pci, Severity, Syslog } from "nodefony";
import WebsocketContext from "./WebsocketContext.js";
import { WebSocket, WebSocketServer } from "ws";
import http from "node:http";

export interface IWsCookie {
  name: string;
  value: string;
  maxage?: number;
  domain?: string;
  path?: string;
  expires?: Date;
  httponly?: boolean;
  secure?: boolean;
}

const WS_CLOSE_DESCRIPTIONS: Record<number, string> = {
  1000: "Normal Closure",
  1001: "Going Away",
  1002: "Protocol Error",
  1003: "Unsupported Data",
  1005: "No Status Received",
  1006: "Abnormal Closure",
  1007: "Invalid frame payload data",
  1008: "Policy Violation",
  1009: "Message too big",
  1010: "Missing Extension",
  1011: "Internal Error",
  1012: "Service Restart",
  1013: "Try Again Later",
  1015: "TLS Handshake",
};

class WebsocketResponse {
  statusCode: number = 1000;
  body: Buffer | null = null;
  encoding: BufferEncoding = "utf-8";
  connection: WebSocket | null = null;
  statusMessage: string = "";
  webSocketVersion?: number;
  cookies: Record<string, Cookie> = {};

  constructor(
    connection: WebSocket | null,
    private context: WebsocketContext
  ) {
    this.connection = connection;
  }

  log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message) {
    const syslog: Syslog | null | undefined =
      this.context?.container?.get<Syslog>("syslog");
    if (!msgid) {
      msgid = "WEBSOCKET RESPONSE";
    }
    return syslog?.log(pci, severity, msgid, msg);
  }

  setConnection(connection: WebSocket) {
    this.connection = connection;
    return connection;
  }

  async send(
    data?: Buffer | string | null,
    encoding?: BufferEncoding
  ): Promise<WebsocketResponse> {
    const payload = data ?? this.body;
    if (!payload) throw new Error("no data");

    return new Promise((resolve, reject) => {
      if (!this.connection || this.connection.readyState !== WebSocket.OPEN) {
        return reject(new Error("WebSocket not open"));
      }
      // ws.send handles both text and binary transparently
      const sendData =
        encoding === "binary" && Buffer.isBuffer(payload)
          ? payload
          : payload instanceof Buffer
            ? payload.toString(encoding ?? this.encoding)
            : payload;

      this.connection.send(sendData, (error) => {
        if (error) {
          this.log(error, "ERROR");
          return reject(error);
        }
        return resolve(this);
      });
    });
  }

  broadcast(data?: Buffer | string | null, _type?: BufferEncoding): void {
    const payload = data ?? this.body;
    if (!payload) return;

    const wss = this.context?.server as WebSocketServer | null;
    if (!wss) return;

    const sendData =
      payload instanceof Buffer ? payload.toString(this.encoding) : payload;

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(sendData);
      }
    });
  }

  setBody(
    ele: string | NodeJS.ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    encoding?: BufferEncoding
  ) {
    if (typeof ele === "string") {
      this.body = Buffer.from(ele, encoding ?? this.encoding);
    } else if (ele instanceof ArrayBuffer || ele instanceof SharedArrayBuffer) {
      this.body = Buffer.from(ele);
    } else if ("buffer" in ele && ele.buffer instanceof ArrayBuffer) {
      this.body = Buffer.from(ele.buffer);
    }
    return this.body;
  }

  drop(reasonCode: number, description: string) {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      return this.connection.close(reasonCode ?? this.statusCode, description);
    }
    throw new Error("Connection already closed");
  }

  close(reasonCode: number, description: string) {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      return this.connection.close(reasonCode ?? this.statusCode, description ?? "closed");
    }
    throw new Error("Connection already closed");
  }

  getStatus() {
    return {
      code: this.getStatusCode(),
      message: this.getStatusMessage(),
    };
  }

  getStatusCode() {
    return this.statusCode;
  }

  getStatusMessage() {
    return this.statusMessage;
  }

  setStatusCode(status: number | string, message?: string) {
    if (typeof status !== "number") {
      status = parseInt(status as string, 10);
      if (isNaN(status)) status = 500;
    }
    if (!status) status = 500;
    this.statusCode = status;
    if (!message) {
      message =
        WS_CLOSE_DESCRIPTIONS[this.statusCode] ??
        http.STATUS_CODES[this.statusCode];
    }
    this.statusMessage = message ?? "";
    return { code: this.statusCode, message: this.statusMessage };
  }

  clean() {
    this.connection = null;
    this.body = null;
  }

  setEncoding(encoding: BufferEncoding) {
    return (this.encoding = encoding);
  }

  setHeader(/* name, value*/) {
    return true;
  }

  setHeaders(/* obj*/) {
    return true;
  }

  addCookie(cookie: Cookie) {
    if (cookie instanceof Cookie) {
      this.cookies[cookie.name] = cookie;
    } else {
      throw new Error("Response addCookies not valid cookies");
    }
  }

  // WS handshake response cookies are not supported by ws library —
  // session cookies are set during the HTTP phase before upgrade.
  setCookies() {
    // no-op for ws: cookies cannot be set in WebSocket handshake response
  }

  setCookie(_cookie: Cookie) {
    // no-op for ws
  }
}

export default WebsocketResponse;
