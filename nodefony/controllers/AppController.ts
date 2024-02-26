//import { Service, Container, Module } from "nodefony";
import { inject, Fetch } from "nodefony";
import { DefineRoute, DefineController, Controller } from "@nodefony/framework";
import { ContextType } from "@nodefony/http";

class AppController extends Controller {
  static override basepath: string = "/app";
  constructor(
    context: ContextType,
    @inject("Fetch") private fetch: Fetch
  ) {
    super("app", context);
  }

  async initialize() {
    //console.log("passs initialize");
    //await this.startSession();
    return this;
  }

  @DefineRoute("route1", { path: "/", method: "GET" })
  async method1() {
    console.log("call method", this.fetch.library);
    //await this.startSession();
    return this.renderJson({ foo: "bar" });
  }

  @DefineRoute("route3", { method: "DELETE" })
  method3() {
    console.log("call method3", this.route);
  }

  @DefineRoute("route2", { path: "/add", requirements: { methods: "POST" } })
  method2() {
    console.log("call method2");
    return this.renderJson({ foo: "bar" });
  }

  @DefineRoute("route4", {
    path: "/add/{name}",
    requirements: { methods: ["GET", "POST"] },
    defaults: { name: "cci" },
  })
  method4(name: string) {
    console.log("call method4", name, this.route);
    return this.renderJson({ name });
  }

  @DefineRoute("route6", {
    path: "/ele/{metier}/{format}/add",
    defaults: { format: "cci" },
  })
  method6() {
    console.log("other route for app");
    return this.renderJson({ foo: "bar" });
  }
  @DefineRoute("route7", {
    path: "/ele/{metier}/{format}/{method}/add",
  })
  method7(metier: string, format: string, method: string) {
    return this.renderJson({ metier, format, method });
  }

  @DefineRoute("route5", {
    path: "*",
  })
  method5() {
    console.log("other route for app");
  }
}

export default AppController;
