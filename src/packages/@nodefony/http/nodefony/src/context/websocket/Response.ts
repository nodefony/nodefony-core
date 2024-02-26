import Cookie from "../../cookies/cookie";
class WebsocketResponse {
  statusCode: number = 1000;
  body: Buffer | null = null;
  encoding: BufferEncoding = "utf-8";
  constructor() {}

  addCookie(cookie: Cookie) {}

  setCookie(cookie: Cookie) {}

  setBody(
    ele: string | NodeJS.ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    encoding?: BufferEncoding | undefined
  ) {
    if (typeof ele === "string") {
      this.body = Buffer.from(ele, encoding || this.encoding);
    } else if (ele instanceof ArrayBuffer || ele instanceof SharedArrayBuffer) {
      this.body = Buffer.from(ele);
    } else if ("buffer" in ele && ele.buffer instanceof ArrayBuffer) {
      this.body = Buffer.from(ele.buffer);
    }
    return this.body;
  }
  setHeaders() {}
  setStatusCode() {}
}

export default WebsocketResponse;
