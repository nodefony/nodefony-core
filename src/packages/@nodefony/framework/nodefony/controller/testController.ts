//import { Service, Container, Module } from "nodefony";
import { inject, Fetch } from "nodefony";
import { route, controller } from "../decorators/routerDecorators";
import Controller from "../src/Controller";
import { Context } from "@nodefony/http";

class ExampleController extends Controller {
  static override basepath: string = "/base";
  constructor(
    context: Context,
    @inject("Fetch") private fetch: Fetch
  ) {
    super("test", context);
  }

  @route("route1", { path: "/", method: "GET" })
  method() {
    console.log("call method", this.fetch.library);
  }

  @route("route2", { path: "/add", method: "POST" })
  method2() {
    console.log("call method2");
  }

  @route("route3", { method: "DELETE" })
  method3() {
    console.log("call method3");
  }

  @route("route4", {
    path: "/add/{name}",
    method: ["GET", "POST"],
    defaults: { name: "cci" },
  })
  method4() {
    console.log("call method4");
  }

  @route("route6", {
    path: "/ele/{metier}/{format}/add",
    defaults: { format: "cci" },
  })
  method6() {
    console.log("other route for base");
  }
  @route("route7", {
    path: "/ele/{metier}/{format}/{method}/add",
  })
  method7() {
    console.log("other route for base");
  }

  @route("route5", {
    path: "*",
  })
  method5() {
    console.log("other route for base");
  }
}

export default ExampleController;
