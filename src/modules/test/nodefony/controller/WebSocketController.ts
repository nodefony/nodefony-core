import { resolve } from "node:path";
import { Controller, route, controller } from "@nodefony/framework";
import { Context, HttpError } from "@nodefony/http";
import { Cookie } from "@nodefony/http";
//import { inject, Fetch, Error } from "nodefony";

@controller("/nodefony/test/ws")
class WebsocketController extends Controller {
  constructor(context: Context) {
    super("WebsocketController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    if (!this.context?.getRequestCookies("websocket")) {
      let mycookis = new Cookie("websocket", "test");
      this.context?.setCookie(mycookis);
    }
    return this;
  }

  @route("route-websocket-index", {
    path: "",
    requirements: { methods: ["WEBSOCKET"], protocol: "" },
  })
  async index(message: any) {
    if (message) {
      return this.render(message.utf8Data);
    }

    // handshake

    //const app = this.kernel?.getModule("app");
    //const view = resolve(app?.path as string, "nodefony", "views", "index.ejs");
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "websocket.json.ejs"
    );
    return this.renderEjsView(view, {
      name: this.kernel?.name,
      query: this.query,
      ...this.context?.metaData,
    }).catch((e) => {
      return this.renderJson({
        error: e,
        ...this.context?.metaData,
      });
    });
  }

  @route("route-websocket-echo", {
    path: "/echo",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async echo(message: any) {
    if (!message) {
      return this.renderJson({ handshake: true });
    }
    return this.renderJson(message.utf8);
  }

  @route("route-websocket-echo-proto", {
    path: "/echo/proto",
    requirements: { methods: ["WEBSOCKET"], protocol: "echo-protocol" },
  })
  async proto(message: any) {
    if (message) {
      return this.renderJson(message.utf8);
    } else {
      return this.renderJson({ handshake: true, ...this.context?.metaData });
    }
  }

  @route("route-websocket-route-var", {
    path: "/routes/{ele}",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async routage(ele: string, message: any) {
    if (message) {
      return this.renderJson(message.utf8);
    } else {
      return this.renderJson({ variables: ele, ...this.context?.metaData });
    }
  }

  @route("route-websocket-route-var2", {
    path: "/routes/{var1}/route2/{var2}",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async routage2(var1: string, var2: string, message: any) {
    if (message) {
      return this.renderJson({
        ...this.context?.metaData,
        result: message.utf8Data,
      });
    } else {
      return this.renderJson({
        ...this.context?.metaData,
        variables: { var1, var2 },
      });
    }
  }

  @route("route-websocket-cookie", {
    path: "/cookie",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async cookie(message: any) {
    switch (this.context?.webSocketState) {
      case "connected":
        console.log(this.context.cookies);
        return this.renderJson({
          ...this.context?.metaData,
        });
      default:
        return this.renderJson({
          ...this.context?.metaData,
          result: message.utf8Data,
        });
    }
  }
}

export default WebsocketController;
