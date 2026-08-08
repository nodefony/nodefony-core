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

  override getRawTarget(): string | undefined {
    return this.headers[":path"] as string | undefined;
  }

  // Scheme effectif côté client : `Forwarded`/`X-Forwarded-*` résolu de façon
  // canonique (this.forwarded, gated proxy de confiance) ; sinon le pseudo-header.
  protected override resolveScheme(): string {
    if (this.forwarded?.proto) {
      return this.forwarded.proto;
    }
    if (this.headers[":scheme"] === "https") {
      return "https";
    }
    return "http";
  }
}

export default Http2Request;
