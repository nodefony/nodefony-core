import { route, controller, Controller } from "@nodefony/framework";
import { ContextType } from "@nodefony/http";

@controller("/api")
class HelloController extends Controller {
  constructor(context: ContextType) {
    super("hello", context);
  }

  @route("route-hello", { path: "/hello", method: "GET" })
  async hello() {
    return this.renderJson({ hello: "world", pid: process.pid });
  }

  /**
   * Route volontairement lente (2 s) — sert à PROUVER le graceful shutdown :
   * un `docker stop` pendant cette requête doit la laisser finir (200 complet)
   * avant que le process sorte (drain SIGTERM du framework).
   */
  @route("route-slow", { path: "/slow", method: "GET" })
  async slow() {
    await new Promise<void>((r) => setTimeout(r, 2000));
    return this.renderJson({ slow: "done" });
  }
}

export default HelloController;
