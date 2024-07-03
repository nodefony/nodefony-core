import { resolve } from "node:path";
import { Controller, route, controller } from "@nodefony/framework";
import { Context, HttpError } from "@nodefony/http";
import { inject, Fetch, Error } from "nodefony";

@controller("/nodefony/test/route")
class RouteController extends Controller {
  constructor(context: Context) {
    super("RouteController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    return this;
  }

  @route("route-app-ejs", {
    path: "/ejs/{name}",
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
    return this.renderEjs(view, { name, ...this.context?.metaData }).catch(
      (e) => {
        throw e;
      }
    );
  }

  @route("route3", { method: "DELETE" })
  async method3() {
    return this.renderJson(this.context?.metaData);
  }

  @route("route2", { path: "/add", requirements: { methods: "POST" } })
  async method2() {
    console.log("call method2");
    return this.renderJson({ foo: "bar" });
  }

  @route("route6", {
    path: "/ele/{metier}/{format}/add",
    defaults: { format: "cci" },
  })
  async method6() {
    console.log("other route for app");
    return this.renderJson({ foo: "bar" });
  }
  @route("route7", {
    path: "/ele/{metier}/{format}/{method}/add",
  })
  method7(metier: string, format: string, method: string) {
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "index.twig"
    );
    return this.renderTwig(view, { metier, format, method });
  }

  @route("route5", {
    path: "*",
  })
  async method5() {
    return this.renderJson(this.route);
  }
}

export default RouteController;
