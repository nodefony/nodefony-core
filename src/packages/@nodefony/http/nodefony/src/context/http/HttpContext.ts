import {
  ServerType,
  httpRequest,
  httpResponse,
  SchemeType,
} from "../../../service/http-kernel";
import Context, { contextRequest, contextResponse } from "../Context";
import {
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

class HttpContext extends Context {
  url: string;
  scheme: SchemeType;
  proxy: ProxyType | null = null;
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
  }
}

export default HttpContext;
