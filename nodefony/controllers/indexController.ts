import { route, controller, Controller, UseSession } from "@nodefony/framework";
import { ContextType } from "@nodefony/http";

@controller("")
@UseSession({ context: "app" })
class IndexController extends Controller {
  constructor(context: ContextType) {
    super("index", context);
  }

  @route("route-index-default", { path: "", method: "GET" })
  async index() {
    return this.forward("app:AppController:method1");
  }
  @route("route-index-default2", { path: "/", method: "GET" })
  async index2() {
    return this.forward("app:AppController:method1");
  }
}

export default IndexController;
