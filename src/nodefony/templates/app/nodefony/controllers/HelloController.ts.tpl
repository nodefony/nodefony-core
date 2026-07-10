import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * UN controller, DEUX protocoles — le différenciateur Nodefony : HTTP et
 * WebSocket sont co-citoyens du même contexte controller, pas deux mondes.
 */
@controller("/api")
class HelloController extends Controller {
  constructor(context: ContextType) {
    super("hello", context);
  }

  @route("route-hello", { path: "/hello", method: "GET" })
  async hello() {
    return this.renderJson({ hello: "{{appName}}", pid: process.pid });
  }

  /**
   * WebSocket natif : `wscat -c ws://127.0.0.1:5151/api/echo` puis tape un
   * message — la réponse repasse par le MÊME pipeline (firewall, audit, logs).
   */
  @route("route-echo", {
    path: "/echo",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async echo(message: string | Buffer | null) {
    if (!message) {
      return this.renderJson({ handshake: true });
    }
    return this.renderJson({ echo: message.toString() });
  }
}

export default HelloController;
