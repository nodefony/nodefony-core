import { resolve } from "node:path";
import { Controller, route, controller, UseSession } from "@nodefony/framework";
import { Context, HttpError } from "@nodefony/http";
import type { WebsocketContext } from "@nodefony/http";
import { Cookie } from "@nodefony/http";
//import { inject, Fetch, Error } from "nodefony";

@controller("/nodefony/test/ws")
class WebsocketController extends Controller {
  constructor(context: Context) {
    super("WebsocketController", context);
  }

  /** Contexte courant typé WebSocket — toutes les routes ici sont `methods: ["WEBSOCKET"]`. */
  private get ws(): WebsocketContext | undefined {
    return this.context as WebsocketContext | undefined;
  }

  async initialize(): Promise<this> {
    // PAS de startSession() global ici : il s'appliquait à TOUTES les routes WS
    // (echo/broadcast/binary/index…) qui n'ont aucun besoin de session. Sous
    // charge (ex broadcast flood), chaque connexion persistait une session SQLite
    // au onFinish → tempête d'INSERT + collisions `session_id must be unique`
    // (write() = findOne+create non atomique). La session n'est démarrée que sur
    // la route qui la teste réellement (`/cookie`).
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
  async index(message: string | Buffer | null) {
    if (message) {
      return this.render(message.toString());
    }

    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "websocket.json.eta",
    );
    return this.renderView(view, {
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
  async echo(message: string | Buffer | null) {
    if (!message) {
      return this.renderJson({ handshake: true });
    }
    try {
      return this.renderJson(JSON.parse(message.toString()));
    } catch {
      return this.render(message.toString());
    }
  }

  @route("route-websocket-echo-proto", {
    path: "/echo/proto",
    requirements: { methods: ["WEBSOCKET"], protocol: "echo-protocol" },
  })
  async proto(message: string | Buffer | null) {
    if (message) {
      try {
        return this.renderJson(JSON.parse(message.toString()));
      } catch {
        return this.render(message.toString());
      }
    } else {
      return this.renderJson({ handshake: true, ...this.context?.metaData });
    }
  }

  @route("route-websocket-route-var", {
    path: "/routes/{ele}",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async routage(ele: string, message: string | Buffer | null) {
    if (message) {
      try {
        return this.renderJson(JSON.parse(message.toString()));
      } catch {
        return this.render(message.toString());
      }
    } else {
      return this.renderJson({ variables: ele, ...this.context?.metaData });
    }
  }

  @route("route-websocket-route-var2", {
    path: "/routes/{var1}/route2/{var2}",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async routage2(var1: string, var2: string, message: string | Buffer | null) {
    if (message) {
      return this.renderJson({
        ...this.context?.metaData,
        result: message.toString(),
      });
    } else {
      return this.renderJson({
        ...this.context?.metaData,
        variables: { var1, var2 },
      });
    }
  }

  @route("route-websocket-proto-reflect", {
    path: "/proto/reflect",
    requirements: { methods: ["WEBSOCKET"], protocol: "" },
  })
  async protoReflect(message: string | Buffer | null) {
    const protocol = this.ws?.acceptedProtocol ?? null;
    if (!message) {
      return this.renderJson({ handshake: true, acceptedProtocol: protocol });
    }
    return this.renderJson({
      echo: message.toString(),
      acceptedProtocol: protocol,
    });
  }

  @route("route-websocket-proto-json", {
    path: "/proto/json",
    requirements: { methods: ["WEBSOCKET"], protocol: "json-protocol" },
  })
  async protoJson(message: string | Buffer | null) {
    if (!message) {
      return this.renderJson({ handshake: true, protocol: "json-protocol" });
    }
    try {
      return this.renderJson(JSON.parse(message.toString()));
    } catch {
      return this.renderJson({
        error: "invalid json",
        raw: message.toString(),
      });
    }
  }

  @route("route-websocket-binary", {
    path: "/binary",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async binary(message: string | Buffer | null) {
    if (!message) {
      return this.renderJson({ handshake: true, binary: true });
    }
    const buf = Buffer.isBuffer(message)
      ? message
      : Buffer.from(message as string);
    return this.ws?.send(buf, "binary");
  }

  @route("route-websocket-broadcast", {
    path: "/broadcast",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async broadcastMsg(message: string | Buffer | null) {
    if (!message) {
      return this.renderJson({ handshake: true });
    }
    this.ws?.broadcast(message.toString());
  }

  @route("route-websocket-cookie", {
    path: "/cookie",
    requirements: { methods: ["WEBSOCKET"] },
  })
  @UseSession() // seule route WS qui exerce la session
  async cookie(message: string | Buffer | null) {
    switch (this.ws?.webSocketState) {
      case "connected":
        return this.renderJson({
          ...this.context?.metaData,
        });
      default:
        return this.renderJson({
          ...this.context?.metaData,
          result: message?.toString(),
        });
    }
  }
}

export default WebsocketController;
