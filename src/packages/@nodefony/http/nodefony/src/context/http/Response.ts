import http from "node:http";
import http2 from "node:http2";
import HttpContext from "../http/HttpContext";
import nodefony, { extend, Pdu, Message, Severity, Msgid } from "nodefony";
import mime from "mime-types";
import { responseTimeoutType } from "../../../service/http-kernel";
import Cookie from "../../cookies/cookie";

const ansiRegex = function ({ onlyFirst = false } = {}) {
  const pattern = [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))",
  ].join("|");
  return new RegExp(pattern, onlyFirst ? undefined : "g");
};

const stripAinsi = function (val: any) {
  return typeof val === "string" ? val.replace(ansiRegex(), "") : val;
};

class HttpResponse {
  context: HttpContext;
  response: http.ServerResponse | http2.Http2ServerResponse | null;
  statusCode: number = 200;
  statusMessage: string = "";
  ended: boolean = false;
  flushing: boolean = false;
  encoding: BufferEncoding = "utf-8";
  body: Buffer | null = null;
  contentType: string = "application/octet-stream";
  headers: http.OutgoingHttpHeaders = {};
  timeout?: number; // miiliseconde
  cookies: Record<string, Cookie> = {};
  constructor(
    response: http.ServerResponse | http2.Http2ServerResponse,
    context: HttpContext
  ) {
    this.context = context;
    this.response = response;
    this.timeout =
      this.context?.httpKernel?.responseTimeout[
        this.context.type as responseTimeoutType
      ];
    this.setContentTypeByExtension("bin");
  }

  clean() {
    this.response = null;
    this.body = null;
    this.cookies = {};
    // this.streamFile = null;
    // delete this.streamFile;
  }

  isHtml(): boolean {
    let ct = this.getHeader("Content-Type") as string;
    return mime.extension(ct) === "html";
  }

  setTimeout(ms: number) {
    this.timeout = ms;
  }

  addCookie(cookie: Cookie) {
    if (cookie instanceof Cookie) {
      return (this.cookies[cookie.name] = cookie);
    }
    throw new Error("Response addCookies not valid cookies");
  }

  deleteCookie(cookie: Cookie) {
    if (cookie instanceof Cookie) {
      if (this.cookies[cookie.name]) {
        delete this.cookies[cookie.name];
        return true;
      }
      return false;
    }
    throw new Error("Response delCookie not valid cookies");
  }

  deleteCookieByName(name: string) {
    if (this.cookies[name]) {
      delete this.cookies[name];
      return true;
    }
    return false;
  }

  setCookies() {
    for (const cook in this.cookies) {
      this.setCookie(this.cookies[cook]);
    }
  }

  setCookie(cookie: Cookie) {
    const serialize = cookie.serialize();
    this.log(`ADD COOKIE ==> ${serialize}`, "DEBUG");
    return this.setHeader("Set-Cookie", serialize);
  }

  // ADD INPLICIT HEADER
  setHeader(name: string, value: string | number) {
    if (this.response) {
      if (this.flushing) {
        const obj: http.OutgoingHttpHeaders = {};
        obj[name] = value;
        return this.addTrailers(obj);
      }
      if (!this.response.headersSent) {
        return this.response.setHeader(name, value);
      }
    }
  }

  setHeaders(obj: Record<string, string | number>) {
    if (!this.response?.headersSent) {
      if (obj instanceof Object) {
        for (const head in obj) {
          let value = obj[head];
          this.setHeader(head, value);
        }
      }
      return (this.headers =
        this.response?.getHeaders() as http.OutgoingHttpHeaders);
    }
    this.log("headers already sended ", "WARNING");
    return (this.headers = this.response.getHeaders());
  }

  setContentType(type?: string, encoding?: BufferEncoding) {
    if (type && encoding) {
      const mytype = mime.contentType(type);
      if (!mytype) {
        this.log(`setContentType: ${type}  not found`, "WARNING");
      }
      return this.setHeader("Content-Type", `${type}; charset=${encoding}`);
    }
    if (type && !encoding) {
      const mytype = mime.contentType(type);
      if (mytype) {
        this.contentType = mytype;
        let charset = mime.charset(this.contentType);
        if (charset) {
          this.encoding = charset as BufferEncoding;
        }
        return this.setHeader("Content-Type", mytype);
      }
    }
    return this.setHeader(
      "Content-Type",
      `${this.contentType}; charset=${this.encoding}`
    );
  }

  setFileMimeType(type: string, encoding?: BufferEncoding) {
    let myType = this.getMimeType(type);
    if (!myType) {
      this.log(`Content-Type not valid !!! : ${type}`, "WARNING");
      myType = "application/octet-stream";
    }
    this.contentType = myType;
    return this.setHeader(
      "Content-Type",
      `${myType} ; charset=${encoding || this.encoding}`
    );
  }

  setContentTypeByExtension(extention: string) {
    const ismime = mime.contentType(extention);
    if (ismime) {
      this.contentType = ismime;
      let charset = mime.charset(this.contentType);
      if (charset) {
        this.encoding = charset as BufferEncoding;
      }
      return this.setHeader("Content-Type", ismime);
    }
    this.log(`setContentTypeByExtension: ${extention}  not found`, "WARNING");
  }

  getMimeType(filenameOrExt: string): string | false {
    return mime.lookup(filenameOrExt);
  }

  setEncoding(encoding: BufferEncoding) {
    return (this.encoding = encoding);
  }

  setStatusCode(
    status: number | string,
    message?: string
  ): { code: number; message: string } {
    if (status && typeof status !== "number") {
      status = parseInt(status, 10);
      if (isNaN(status)) {
        status = 500;
      }
    }

    this.statusCode = (status as number) || this.statusCode;
    if (message) {
      this.statusMessage = stripAinsi(message);
    } else if (!this.statusMessage) {
      if (http.STATUS_CODES[this.statusCode]) {
        this.statusMessage = http.STATUS_CODES[this.statusCode] as string;
      } else {
        this.statusMessage = http.STATUS_CODES[500] as string;
      }
    }
    return {
      code: this.statusCode,
      message: this.statusMessage,
    };
  }

  getStatus(): { code: number; message: string } {
    return {
      code: this.getStatusCode(),
      message: this.getStatusMessage(),
    };
  }

  getStatusCode(): number {
    return this.statusCode;
  }

  getStatusMessage(code?: number | string): string {
    if (code) {
      if (this.response) {
        return (
          (http.STATUS_CODES[code] as string) ||
          this.statusMessage ||
          this.response.statusMessage
        );
      }
    }
    if (this.response) {
      return (
        this.statusMessage ||
        this.response.statusMessage ||
        (http.STATUS_CODES[this.statusCode] as string)
      );
    }
    return this.statusMessage || (http.STATUS_CODES[this.statusCode] as string);
  }

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

  getLength(
    ele?: string | NodeJS.ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
    encoding?: BufferEncoding | undefined
  ): number {
    if (ele) {
      return Buffer.byteLength(ele);
    }
    if (this.body) {
      return Buffer.byteLength(this.body);
    }
    return 0;
  }

  writeHead(
    statusCode?: number,
    headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[]
  ): void {
    if (statusCode) {
      this.setStatusCode(statusCode);
    }
    if (!this.response?.headersSent) {
      // this.response.statusMessage = this.statusMessage;
      try {
        if (this.context.method === "HEAD" || this.context.contentLength) {
          this.setHeader("Content-Length", this.getLength());
        }
        if (this.statusCode) {
          if (typeof this.statusCode === "string") {
            this.statusCode = parseInt(this.statusCode as string, 10);
          }
          if (this.statusCode > 599) {
            this.statusCode = 500;
          }
        }
        if (this.response) {
          this.response?.writeHead(
            this.statusCode,
            this.statusMessage,
            headers as http.OutgoingHttpHeaders
          );
        }
        throw new Error(`response not found`);
      } catch (e) {
        throw e;
      }
    } else {
      this.log("Headers already sent !!", "WARNING");
      throw new Error(`Headers already sent !!`);
    }
  }

  // flushHeaders(): void {
  //   try {
  //     return this.response?.flushHeaders();
  //   } catch (e) {
  //     throw e;
  //   }
  // }

  addTrailers(headers: http.OutgoingHttpHeaders): void {
    try {
      return this.response?.addTrailers(headers);
    } catch (e) {
      throw e;
    }
  }

  flush(chunk: any, encoding: BufferEncoding) {
    this.flushing = true;
    this.setHeader("Transfer-Encoding", "chunked");
    return this.send(chunk, encoding, true);
  }

  async send(
    chunk: any,
    encoding?: BufferEncoding,
    flush: boolean = false
  ): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      try {
        if (this.context.isRedirect) {
          // if (!this.stream.headersSent) {
          //   this.writeHead();
          //   await this.end();
          //   return true;
          // }
          await this.end();
          return resolve(true);
        }
        if (chunk) {
          this.setBody(chunk);
        }
        if (!flush) {
          //this.context.displayDebugBar();
        }
        if (this.response) {
          return (this.response as http.ServerResponse).write(
            this.body,
            encoding || this.encoding,
            (error: Error | null | undefined) => {
              if (error) {
                this.log(error, "ERROR");
                resolve(false);
              }
              resolve(true);
            }
          );
        }
        return reject(new Error(`Http Response not found`));
      } catch (e) {
        return reject(e);
      }
    });
  }

  async write(chunk?: any, encoding?: BufferEncoding): Promise<boolean> {
    return await this.send(chunk, encoding || this.encoding);
  }

  writeContinue() {
    return this.response?.writeContinue();
  }

  async end(
    chunk?: any,
    encoding?: BufferEncoding
  ): Promise<http.ServerResponse | http2.ServerHttp2Stream> {
    return new Promise((resolve, reject) => {
      if (this.response) {
        this.ended = true;
        return resolve(
          (this.response as http.ServerResponse).end(
            chunk,
            encoding || this.encoding
          )
        );
      }
      return reject(new Error(`response not found`));
    });
  }

  getHeader(name: string): string | number | string[] | undefined {
    return this.response?.getHeader(name);
  }

  getHeaders(): http.OutgoingHttpHeaders {
    return this.response?.getHeaders() as http.OutgoingHttpHeaders;
  }

  redirect(
    url: string,
    status?: number | string,
    headers?: Record<string, string | number>
  ) {
    this.context.isRedirect = true;
    if (typeof status === "string") status = parseInt(status, 10);
    if (status === 302) {
      this.setStatusCode(status);
    } else {
      status = 301;
      this.setStatusCode(301);
    }
    if (headers) {
      switch (nodefony.typeOf(headers)) {
        case "object":
          this.setHeaders(headers);
          break;
        case "boolean":
          this.setHeaders({
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Expires: "Thu, 01 Jan 1970 00:00:00 GMT",
          });
          break;
      }
    }
    this.setHeader("Location", url);
    this.log(`REDIRECT ${status} : ${url} `, "DEBUG");
    return this;
  }

  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu {
    if (!msgid) {
      msgid = `${this.context.type} RESPONSE `;
    }
    return this.context.log(pci, severity, msgid, msg);
  }
}

export default HttpResponse;
