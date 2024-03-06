import { Controller, DefineRoute, DefineController } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { inject, Error } from "nodefony";

@DefineController("rest", {})
class RestController extends Controller {
  static override basepath = "/nodefony/test";
  constructor(context: Context) {
    super("RestController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    return this;
  }

  @DefineRoute("index-rest", { path: "/rest" })
  index() {
    this.renderJson({});
  }
}

export default RestController;
