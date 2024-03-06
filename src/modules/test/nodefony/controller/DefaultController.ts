import { Controller, DefineRoute, DefineController } from "@nodefony/framework";
import { Context, HttpError } from "@nodefony/http";
import { inject, Fetch, Error } from "nodefony";
import https from "node:https";

class DefaultController extends Controller {
  static override basepath = "/nodefony/test";
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

  @DefineRoute("index", { path: "/index" })
  index() {
    this.log("passsss");
    this.renderJson({});
  }

  @DefineRoute("index2", { path: "/index2" })
  index2() {
    throw new Error("myError", 502);
  }

  @DefineRoute("index3", { path: "/index3" })
  index3() {
    throw new HttpError({ foo: "bar" }, 503, this.context);
  }

  @DefineRoute("index4", { path: "/index4" })
  index4() {
    this.render({});
  }
}

export default DefaultController;
