import Cookie from "../../cookies/cookie";
import { Message, Msgid, Severity, Syslog } from "nodefony";
import WebsocketContext from "./WebsocketContext";
import websocket, { ICookie } from "websocket";
import http from "node:http";
const { CLOSE_DESCRIPTIONS } = websocket.connection;

class WebsocketResponse {
  statusCode: number = 1000;
  body: Buffer | null = null;
  encoding: BufferEncoding = "utf-8";
  connection: websocket.connection | null = null;
  statusMessage: string = "";
  webSocketVersion?: number;
  config?: websocket.IConfig | {};
  cookies: Record<string, Cookie> = {};
  cookiesWs: ICookie[] = [];
  constructor(
    connection: websocket.connection | null,
    private context: WebsocketContext
  ) {
    this.connection = connection;
  }

  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message) {
    const syslog: Syslog = this.context?.container?.get("syslog");
    if (!msgid) {
      msgid = "WEBSOCKET RESPONSE";
    }
    return syslog.log(pci, severity, msgid, msg);
  }

  setConnection(connection: websocket.connection) {
    this.connection = connection;
    this.statusMessage = this.connection.state;
    this.config = this.connection.config;
    this.webSocketVersion = this.connection.webSocketVersion;
    return connection;
  }

  async send(
    data?: any,
    encoding?: BufferEncoding
  ): Promise<WebsocketResponse> {
    if (data) {
      try {
        switch (encoding) {
          case "utf8":
            return new Promise((resolve, reject) => {
              try {
                return this.connection?.sendUTF(
                  data.utf8Data || data,
                  (error) => {
                    if (error) {
                      this.log(error, "ERROR");
                      throw reject(error);
                    } else {
                      return resolve(this);
                    }
                  }
                );
              } catch (e) {
                throw reject(e);
              }
            });
          case "binary":
            return new Promise((resolve, reject) => {
              try {
                return this.connection?.sendBytes(
                  data.binaryData || data,
                  (error) => {
                    if (error) {
                      this.log(error, "ERROR");
                      throw reject(error);
                    } else {
                      return resolve(this);
                    }
                  }
                );
              } catch (e) {
                throw reject(e);
              }
            });
          default:
            return new Promise((resolve, reject) => {
              this.connection?.send(data, (error) => {
                if (error) {
                  this.log(error, "ERROR");
                  throw reject(error);
                } else {
                  return resolve(this);
                }
              });
            });
        }
      } catch (error) {
        console.error("Error sending data:", error);
        throw error;
      }
    } else if (this.body) {
      return this.send(this.body);
    }
    throw new Error("no data");
  }

  broadcast(data: any, type?: BufferEncoding): void {
    if (data) {
      switch (type) {
        case "utf8":
          (<websocket.server>this.context?.server).broadcastUTF(data.utf8Data);
          break;
        case "binary":
          (<websocket.server>this.context?.server).broadcastBytes(
            data.binaryData
          );
          break;
        default:
          (<websocket.server>this.context?.server).broadcast(data);
      }
    } else if (this.body) {
      return this.broadcast(this.body);
    }
  }

  setBody(
    ele: string | NodeJS.ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    encoding?: BufferEncoding | undefined
  ) {
    if (typeof ele === "string") {
      this.body = Buffer.from(ele, encoding || this.encoding);
    } else if (ele instanceof ArrayBuffer || ele instanceof SharedArrayBuffer) {
      this.body = Buffer.from(ele);
    } else if (ele && "buffer" in ele && ele.buffer instanceof ArrayBuffer) {
      this.body = Buffer.from(ele.buffer);
    }
    return this.body;
  }

  drop(reasonCode: number, description: string) {
    if (this.connection && this.connection.state === "open") {
      try {
        return this.connection.close(
          reasonCode || this.statusCode,
          description || this.statusMessage
        );
      } catch (e) {
        throw e;
      }
    }
    throw new Error("Connection already closed");
  }
  close(reasonCode: number, description: string) {
    if (this.connection && this.connection.state === "open") {
      try {
        return this.connection.close(
          reasonCode || this.statusCode,
          description || "closed"
        );
      } catch (e) {
        throw e;
      }
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
    if (status && typeof status !== "number") {
      status = parseInt(status, 10);
      if (isNaN(status)) {
        status = 500;
      }
    }
    if (!status) {
      status = 500;
    }
    this.statusCode = status as number;
    if (!message) {
      if (CLOSE_DESCRIPTIONS[this.statusCode]) {
        message = CLOSE_DESCRIPTIONS[this.statusCode];
      } else {
        message = http.STATUS_CODES[this.statusCode];
      }
    }
    this.statusMessage = message || "";
    return {
      code: this.statusCode,
      message: this.statusMessage,
    };
  }

  clean() {
    this.connection = null;
    this.body = null;
  }

  setEncoding(encoding: BufferEncoding) {
    return (this.encoding = encoding);
  }

  // ADD INPLICIT HEADER
  setHeader(/* name, value*/) {
    // this.response.setHeader(name, value);
    return true;
  }

  setHeaders(/* obj*/) {
    // nodefony.extend(this.headers, obj);
    return true;
  }
  addCookie(cookie: Cookie) {
    if (cookie instanceof Cookie) {
      this.cookies[cookie.name] = cookie;
    } else {
      throw new Error("Response addCookies not valid cookies");
    }
  }

  setCookies() {
    for (const cook in this.cookies) {
      this.setCookie(this.cookies[cook]);
    }
  }

  setCookie(cookie: Cookie) {
    const serialize = cookie.serializeWebSocket();
    this.log(`ADD COOKIE ==> ${serialize.name}:  ${serialize.value}`, "DEBUG");
    this.cookiesWs.push(serialize);
  }
}

export default WebsocketResponse;
