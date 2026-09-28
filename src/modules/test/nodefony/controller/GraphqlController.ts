import { Controller, route, controller, UseSession } from "@nodefony/framework";
import { Context } from "@nodefony/http";

@controller("/nodefony/test/graphql")
@UseSession()
class GraphQlController extends Controller {
  constructor(context: Context) {
    super("GraphQlController", context);
  }

  // Le mode JSON se pose PAR requête, dans l'action : dans `initialize()`, il ne
  // toucherait que la requête qui crée ce singleton.
  @route("index-graphql", { path: "" })
  index() {
    return this.renderJson({});
  }
}

export default GraphQlController;
