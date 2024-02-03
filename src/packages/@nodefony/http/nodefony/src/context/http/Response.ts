import http from "node:http";
import HttpContext from "../http/HttpContext";

class HttpResponse {
  context: HttpContext;
  response: http.ServerResponse;
  statusCode: number = 200;
  constructor(response: http.ServerResponse, context: HttpContext) {
    this.context = context;
    this.response = response;
  }
}

export default HttpResponse;
