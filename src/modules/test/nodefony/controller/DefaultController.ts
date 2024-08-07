import { Controller, route, controller } from "@nodefony/framework";
import { Context, HttpError } from "@nodefony/http";
import { inject, Fetch, Error } from "nodefony";
import https from "node:https";

@controller("/nodefony/test")
class DefaultController extends Controller {
  constructor(
    context: Context,
    @inject("Fetch") private fetchService: Fetch
  ) {
    super("DefaultController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession("test");
    //let response = await this.fetchService.fetch("https://google.fr");
    //TODO add certificat client in service for unit test
    // console.log(response.headers, response.status, response.statusText);
    // const agent = new https.Agent({
    //   rejectUnauthorized: false,
    // });
    // response = await this.fetchService.fetch("https://localhost:5152/app", {
    //   agent,
    // });
    // console.log(response.headers, response.status, response.statusText);
    return this;
  }

  @route("index", { path: "/index" })
  index() {
    return this.renderJson({});
  }

  @route("forward", { path: "/forward" })
  testForward() {
    return this.forward("app:AppController:method1");
  }

  @route("index2", { path: "/index2" })
  index2() {
    throw new Error("myError", 502);
  }

  @route("index3", { path: "/index3" })
  index3() {
    throw new HttpError({ foo: "bar" }, 503, this.context);
  }

  @route("index4", { path: "/index4" })
  index4() {
    return this.render({
      route: this.route,
    });
  }
}

export default DefaultController;
