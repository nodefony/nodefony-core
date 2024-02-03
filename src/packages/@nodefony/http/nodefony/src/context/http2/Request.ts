import http2 from "node:http2";
import HttpContext from "../http/HttpContext";
import HttpResquest from "../http/Request";
import { HTTPMethod } from "../Context";

class Http2Resquest extends HttpResquest {
  context: HttpContext;
  override request: http2.Http2ServerRequest;
  constructor(request: http2.Http2ServerRequest, context: HttpContext) {
    super(request, context);
    this.context = context;
    this.request = request;
  }

  override getHost(): string | undefined {
    return this.headers[":authority"] as string;
  }

  override getUserAgent(): string | undefined {
    return this.headers["user-agent"] as string;
  }

  override getMethod(): HTTPMethod {
    return this.headers[":method"] as HTTPMethod;
  }

  override getFullUrl(): string {
    // proxy mode
    const myurl = `://${this.host}${this.headers[":path"]}`;
    if (this.headers && this.headers["x-forwarded-for"]) {
      return `${this.headers["x-forwarded-proto"]}${myurl}`;
    }
    if (this.headers[":scheme"] === "https") {
      return `https${myurl}`;
    }
    return `http${myurl}`;
  }
}

export default Http2Resquest;
