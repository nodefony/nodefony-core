import http2 from "node:http2";
import HttpContext from "../http/HttpContext";
import HttpRequest from "../http/Request";
import { HTTPMethod } from "../Context";
import { requestAuthority } from "../transport";

class Http2Request extends HttpRequest {
  //context: HttpContext;
  override request: http2.Http2ServerRequest;
  constructor(request: http2.Http2ServerRequest, context: HttpContext) {
    super(request, context);
    this.context = context;
    this.request = request;
  }

  /** `:authority`, sinon `Host` — cf `requestAuthority` (RFC 9113 §8.3.1). */
  override getHost(): string | undefined {
    return requestAuthority(this.request.headers);
  }

  override getUserAgent(): string | undefined {
    return this.headers["user-agent"];
  }

  override getMethod(): HTTPMethod {
    return this.headers[":method"] as HTTPMethod;
  }

  override getRawTarget(): string | undefined {
    return this.headers[":path"] as string | undefined;
  }

  // PAS d'override de `resolveScheme` : le pseudo-en-tête `:scheme` est écrit
  // par le CLIENT, et Node le transmet tel quel, h2c compris. Le schéma vient du
  // transport (`socket.encrypted`, que le socket d'un flux HTTP/2 expose) ou d'un
  // proxy de confiance (`this.forwarded`) — la règle héritée, seule source.
}

export default Http2Request;
