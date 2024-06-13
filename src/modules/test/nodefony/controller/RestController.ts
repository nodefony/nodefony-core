import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
//import { inject, Error } from "nodefony";

@controller("/nodefony/test/rest", {})
class RestController extends Controller {
  constructor(context: Context) {
    super("RestController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    return this;
  }

  @route("index-rest", { path: "" })
  index() {
    this.renderJson({});
  }
}

export default RestController;
