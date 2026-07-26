import { Controller, route, controller, UseSession } from "@nodefony/framework";
import { Context } from "@nodefony/http";

@controller("/nodefony/test/graphql")
@UseSession()
class GraphQlController extends Controller {
  constructor(context: Context) {
    super("GraphQlController", context);
  }

  async initialize(): Promise<this> {
    this.setContextJson();
    return this;
  }

  @route("index-graphql", { path: "" })
  index() {
    return this.render({});
  }
}

export default GraphQlController;
