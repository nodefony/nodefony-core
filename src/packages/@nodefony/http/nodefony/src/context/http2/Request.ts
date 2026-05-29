import http2 from "node:http2";
import HttpContext from "../http/HttpContext";
import HttpRequest from "../http/Request";
import { HTTPMethod } from "../Context";

class Http2Request extends HttpRequest {
  //context: HttpContext;
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
    const myurl = `://${this.host}${this.headers[":path"]}`;
    // Scheme proxifié honoré seulement derrière un proxy de confiance.
    if (this.trustedProxy && this.headers?.["x-forwarded-proto"]) {
      return `${this.headers["x-forwarded-proto"]}${myurl}`;
    }
    if (this.headers[":scheme"] === "https") {
      return `https${myurl}`;
    }
    return `http${myurl}`;
  }
}

export default Http2Request;
