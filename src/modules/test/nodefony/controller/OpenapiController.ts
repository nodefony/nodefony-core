import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
//import { inject, Error } from "nodefony";

@controller("/nodefony/test/openapi")
class OpenApiController extends Controller {
  constructor(context: Context) {
    super("OpenApiController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    return this;
  }

  @route("index-openapi", { path: "" })
  index() {
    this.render({});
  }
}

export default OpenApiController;
