import Cookie from "../../cookies/cookie";
class WebsocketResponse {
  statusCode: number = 1000;
  constructor() {}

  addCookie(cookie: Cookie) {}

  setCookie(cookie: Cookie) {}
}

export default WebsocketResponse;
