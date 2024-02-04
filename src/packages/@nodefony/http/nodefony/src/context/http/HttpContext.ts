import {
  ServerType,
  httpRequest,
  httpResponse,
  SchemeType,
} from "../../../service/http-kernel";
import Context, {
  contextRequest,
  contextResponse,
  HTTPMethod,
} from "../Context";
import {
  extend,
  Container,
  Service,
  Severity,
  Msgid,
  Message,
  Pdu,
  KernelEventsType,
} from "nodefony";
import HttpRequest from "./Request";
import HttpResponse from "./Response";
import Http2Request from "../http2/Request";
import Http2Response from "../http2/Response";
import http2 from "node:http2";
import http from "node:http";
import url, { URL } from "node:url";
import Session from "../../../src/session/session";

interface ProxyType {
  proxyServer: string;
  proxyProto: string;
  proxyScheme: string;
  proxyPort: string;
  proxyFor: string;
  proxyHost: string;
  proxyUri: string;
  proxyRealIp: string;
  proxyVia: string;
}

export type HttpRequestType = Http2Request | HttpRequest;
export type HttpRsponseType = Http2Response | HttpResponse;

class HttpContext extends Context {
  url: string;
  scheme: SchemeType;
  proxy: ProxyType | null = null;
  isRedirect: boolean = false;
  sended: boolean = false;
  timeoutid: number | null = null;
  timeoutExpired: boolean = false;
  isHtml: boolean = false;
  request: HttpRequestType;
  response: HttpRsponseType;
  session: Session | null = null;
  constructor(
    container: Container,
    request: http.IncomingMessage | http2.Http2ServerRequest,
    response: http.ServerResponse | http2.Http2ServerResponse,
    type: ServerType
  ) {
    super(container, type);
    if (this.type === "http2") {
      this.request = new Http2Request(
        request as http2.Http2ServerRequest,
        this
      );
      this.response = new Http2Response(
        response as http2.Http2ServerResponse,
        this
      );
    } else {
      this.request = new HttpRequest(request as http.IncomingMessage, this);
      this.response = new HttpResponse(response as http.ServerResponse, this);
    }
    this.url = url.format(this.request.url);
    this.scheme = this.request.url.protocol.replace(":", "") as SchemeType;
    this.method = this.request.getMethod();
    this.remoteAddress = this.request.remoteAddress;
    this.originUrl = new URL(this.request.origin || this.url);
    // case proxy
    this.proxy = null;
    if (request.headers["x-forwarded-for"]) {
      if (request.headers["x-forwarded-proto"]) {
        this.type = (
          request.headers["x-forwarded-proto"] as string
        ).toLowerCase() as ServerType;
      }
      this.proxy = {
        proxyServer: <string>request.headers["x-forwarded-server"] || "unknown",
        proxyProto: <string>request.headers["x-forwarded-proto"],
        proxyScheme: <string>request.headers["x-forwarded-scheme"],
        proxyPort: <string>request.headers["x-forwarded-port"],
        proxyFor: <string>request.headers["x-forwarded-for"],
        proxyHost: <string>request.headers["x-forwarded-host"],
        proxyUri: <string>request.headers["x-original-uri"],
        proxyRealIp: <string>request.headers["x-real-ip"],
        proxyVia: <string>request.headers.via || "unknown",
      };
      this.log(
        `PROXY REQUEST x-forwarded VIA : ${this.proxy.proxyVia}`,
        "DEBUG"
      );
    }
    this.isHtml = this.request.acceptHtml;
    this.domain = this.getHostName();
    this.validDomain = this.isValidDomain();
  }

  handle(/*data*/): Promise<this> {
    return new Promise(async (resolve, reject) => {
      try {
        if (this.isRedirect) {
          await this.send();
          return resolve(this);
        }
        this.setParameters("query.get", this.request.queryGet);
        if (this.request.queryPost) {
          this.setParameters("query.post", this.request.queryPost);
        }
        if (this.request.queryFile) {
          this.setParameters("query.files", this.request.queryFile);
        }
        this.setParameters("query.request", this.request.query);
        //this.locale = this.translation.handle();
        // if (!this.resolver) {
        //   this.resolver = this.router.resolve(this);
        // }
        // WARNING EVENT KERNEL
        this.fire("onRequest", this);
        this.kernel?.fire("onRequest", this);

        //this.response.setHeader("Content-Type", "text/plain");
        //this.response.setStatusCode(404);
        //await this.send(`${this.response.statusMessage}`);
        throw new Error(`sksksksk`);
        // if (this.resolver.resolve) {
        //   const ret = this.resolver.callController(data);
        //   // timeout response after  callController (to change timeout in action )
        //   if (this.timeoutid !== null) {
        //     this.timeoutExpired = false;
        //     clearTimeout(this.timeoutid);
        //   }
        //   if (this.response.response) {
        //     if (this.response.stream) {
        //       this.timeoutid = this.response.response.setTimeout(
        //         this.response.timeout,
        //         () => {
        //           this.timeoutExpired = true;
        //           this.fire("onTimeout", this);
        //         }
        //       );
        //     } else {
        //       this.timeoutid = this.response.response.setTimeout(
        //         this.response.timeout,
        //         () => {
        //           this.timeoutExpired = true;
        //           this.fire("onTimeout", this);
        //         }
        //       );
        //     }
        //   }
        //   return resolve(ret);
        // }
        // const error = new Error("");
        // error.code = 404;
        // return reject(error);
        return resolve(this);
      } catch (e) {
        return reject(e);
      }
    });
  }

  async send(
    chunk?: any,
    encoding?: BufferEncoding
  ): Promise<
    http.ServerResponse<http.IncomingMessage> | http2.ServerHttp2Stream
  > {
    if (this.sended || this.finished) {
      return new Promise((resolve, reject) => {
        reject(new Error("Already sended"));
      });
    }
    return this.saveSession()
      .then(async (session) => {
        if (session) {
          //this.log(`SAVE SESSION ID : ${session.id}`, "DEBUG");
        }
        await this.fireAsync("onSend", this.response, this);
        this.writeHead();
        if (!this.isRedirect) {
          return this.write(chunk, encoding);
        }
        return this.response.end();
      })
      .catch(async (error) => {
        this.log(error, "ERROR");
        this.writeHead(error.code || 500);
        this.write(chunk, encoding);
        return error;
      });
  }

  writeHead(
    statusCode?: number,
    headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[]
  ) {
    // cookies
    if (this.response) {
      //this.response.setCookies();
      this.response.writeHead(statusCode, headers);
    }
  }

  async write(
    chunk: any,
    encoding?: BufferEncoding,
    flush: boolean = false
  ): Promise<
    http.ServerResponse<http.IncomingMessage> | http2.ServerHttp2Stream
  > {
    if (this.finished || this.sended) {
      throw new Error(`Already sended `);
    }
    /*
     * WRITE RESPONSE
     */
    this.sended = true;
    this.response.send(chunk, encoding);
    // END REQUEST
    return this.close();
  }

  flush(chunk: any, encoding: BufferEncoding) {
    return this.response.flush(chunk, encoding);
  }

  async close(): Promise<
    http.ServerResponse<http.IncomingMessage> | http2.ServerHttp2Stream
  > {
    await this.fireAsync("onClose", this);
    // END REQUEST
    return this.response.end();
  }

  redirect(
    Url: string,
    status?: number | string,
    headers?: Record<string, string | number>
  ) {
    if (typeof Url === "object") {
      return this.response.redirect(url.format(Url), status, headers);
    }
    return this.response.redirect(Url, status, headers);
  }

  redirectHttps(
    status?: number | string,
    headers?: Record<string, string | number>
  ) {
    if (this.session) {
      //this.session.setFlashBag("redirect", "HTTPS");
    }
    let urlExtend = null;
    if (this.proxy) {
      urlExtend = {
        protocol: "https",
        href: "",
        host: "",
      };
    } else {
      urlExtend = {
        protocol: "https",
        port: this.httpKernel?.httpsPort || 443,
        href: "",
        host: "",
      };
    }
    const urlChange = extend({}, this.request.url, urlExtend);
    const newUrl = url.format(urlChange);
    return this.redirect(newUrl, status, headers);
  }

  redirectHttp(
    status?: number | string,
    headers?: Record<string, string | number>
  ) {
    if (this.session) {
      //this.session.setFlashBag("redirect", "HTTP");
    }
    let urlExtend = null;
    if (this.proxy) {
      urlExtend = {
        protocol: "http",
        href: "",
        host: "",
      };
    } else {
      urlExtend = {
        protocol: "http",
        port: this.httpKernel?.httpPort || 80,
        href: "",
        host: "",
      };
    }
    const urlChange = extend({}, this.request.url, urlExtend);
    const newUrl = url.format(urlChange);
    return this.redirect(newUrl, status, headers);
  }

  getHostName(): string {
    return this.request?.getHostName();
  }

  getRemoteAddress(): string | null {
    return this.request?.getRemoteAddress();
  }

  getHost(): string | undefined {
    return this.request?.getHost();
  }

  getUserAgent(): string | undefined {
    return this.request?.getUserAgent();
  }

  getMethod(): HTTPMethod {
    return this.request?.getMethod();
  }
}

export default HttpContext;
