import { Controller, DefineRoute, DefineController } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { inject, Error } from "nodefony";

@DefineController("openapi", {})
class OpenApiController extends Controller {
  static override basepath = "/nodefony/test";
  constructor(context: Context) {
    super("OpenApiController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    return this;
  }

  @DefineRoute("index-openapi", { path: "/openapi" })
  index() {
    this.render({});
  }
}

export default OpenApiController;
