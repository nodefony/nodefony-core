import { resolve } from "node:path";
import { inject, Fetch, FileClass } from "nodefony";
import { DefineRoute, DefineController, Controller } from "@nodefony/framework";
import { ContextType } from "@nodefony/http";

class AppController extends Controller {
  static override basepath: string = "/app";
  constructor(context: ContextType) {
    super("app", context);
  }

  async initialize() {
    await this.startSession("app");
    return this;
  }

  @DefineRoute("route1", { path: "", method: "GET" })
  async method1() {
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "index.twig"
    );
    return this.renderTwigView(view, this.context?.metaData).catch((e) => {
      throw e;
    });
  }

  @DefineRoute("route4", {
    path: "/add/{name}",
    requirements: { methods: ["GET", "POST"] },
    defaults: { name: "cci" },
  })
  async method4(name: string) {
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "index.ejs"
    );
    return this.renderEjsView(view, { name, ...this.context?.metaData }).catch(
      (e) => {
        throw e;
      }
    );
  }

  @DefineRoute("route3", { method: "DELETE" })
  async method3() {
    return this.renderJson(this.context?.metaData);
  }

  @DefineRoute("route2", { path: "/add", requirements: { methods: "POST" } })
  async method2() {
    console.log("call method2");
    return this.renderJson({ foo: "bar" });
  }

  @DefineRoute("route6", {
    path: "/ele/{metier}/{format}/add",
    defaults: { format: "cci" },
  })
  async method6() {
    console.log("other route for app");
    return this.renderJson({ foo: "bar" });
  }
  @DefineRoute("route7", {
    path: "/ele/{metier}/{format}/{method}/add",
  })
  method7(metier: string, format: string, method: string) {
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "index.twig"
    );
    return this.renderTwigView(view, { metier, format, method });
  }

  @DefineRoute("route5", {
    path: "*",
  })
  async method5() {
    console.log("other route for app");
    return this.renderJson(this.route);
  }
}

export default AppController;
