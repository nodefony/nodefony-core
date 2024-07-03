import { resolve } from "node:path";
//import { inject, Fetch, FileClass } from "nodefony";
import { route, controller, Controller } from "@nodefony/framework";
import { ContextType } from "@nodefony/http";

@controller("/app")
class AppController extends Controller {
  constructor(context: ContextType) {
    super("app", context);
  }

  async initialize() {
    await this.startSession("app");
    return this;
  }

  @route("route-app-twig", { path: "", method: "GET" })
  async method1() {
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "index.twig"
    );
    return this.renderTwig(view, this.context?.metaData).catch((e) => {
      throw e;
    });
  }
  @route("route-app-render-viex", { path: "/view", method: "GET" })
  async method2() {
    // const view = resolve(
    //   this.module?.path as string,
    //   "nodefony",
    //   "views",
    //   "index.twig"
    // );
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "index.ejs"
    );
    return this.renderView(view, this.context?.metaData).catch((e) => {
      throw e;
    });
  }

  @route("route-app-ejs", {
    path: "/ejs",
    requirements: { methods: ["GET"] },
  })
  async method4() {
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "index.ejs"
    );
    return this.renderEjs(view, { ...this.context?.metaData }).catch((e) => {
      throw e;
    });
  }
}

export default AppController;
