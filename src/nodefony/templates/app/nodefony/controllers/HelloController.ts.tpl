import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

@controller("/api")
class HelloController extends Controller {
  constructor(context: ContextType) {
    super("hello", context);
  }

  @route("route-hello", { path: "/hello", method: "GET" })
  async hello() {
    return this.renderJson({ hello: "{{appName}}", pid: process.pid });
  }
}

export default HelloController;
