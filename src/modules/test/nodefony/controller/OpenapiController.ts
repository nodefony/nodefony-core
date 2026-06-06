import { Controller, route, controller, UseSession } from "@nodefony/framework";
import { Context } from "@nodefony/http";
//import { inject, Error } from "nodefony";

@controller("/nodefony/test/openapi")
@UseSession()
class OpenApiController extends Controller {
  constructor(context: Context) {
    super("OpenApiController", context);
  }

  @route("index-openapi", { path: "" })
  index() {
    this.render({});
  }
}

export default OpenApiController;
