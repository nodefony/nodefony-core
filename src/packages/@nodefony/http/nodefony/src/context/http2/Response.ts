import http2 from "node:http2";
import HttpContext from "../http/HttpContext";

class Http2Response {
  context: HttpContext;
  response: http2.Http2ServerResponse;
  statusCode: number = 200;
  constructor(response: http2.Http2ServerResponse, context: HttpContext) {
    this.context = context;
    this.response = response;
  }
}

export default Http2Response;
