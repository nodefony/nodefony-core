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

  @route("route-test-1", {
    path: "",
  })
  async method1() {
    return this.renderJson(this.route);
  }
  @route("route-test-2", {
    path: "*",
  })
  async method2() {
    return this.renderJson(this.route);
  }

  @route("route-test-3", {
    path: "/ejs/{name}",
    requirements: { methods: ["GET", "POST", "DELETE"] },
    defaults: { name: "cci" },
  })
  async method3(name: string) {
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

  @route("route-test-4", {
    path: "/{name}/move",
    requirements: { methods: ["PUT", "DELETE"] },
  })
  async method4(name: string) {
    return this.renderJson({ name, ...this.context?.metaData });
  }

  @route("route-test-5", { path: "/add", requirements: { methods: "POST" } })
  async method5() {
    return this.renderJson({ foo: "bar" });
  }

  @route("route-test-6", {
    path: "/ele/{metier}/{format}/add",
    defaults: { format: "cci" },
  })
  async method6(metier: string, format: string) {
    return this.renderJson({ metier, format });
  }
  @route("route-test-7", {
    path: "/ele/{metier}/{format}/{method}/add",
  })
  method7(metier: string, format: string, method: string) {
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "index.twig"
    );
    return this.renderTwig(view, {
      routing: {
        metier,
        format,
        method,
      },
      ...this.context?.metaData,
    });
  }
}

export default RouteController;
