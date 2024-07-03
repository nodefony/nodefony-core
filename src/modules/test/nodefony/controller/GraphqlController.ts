import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { graphql } from "@nodefony/framework";
import { inject, Error } from "nodefony";

@controller("/nodefony/test/graphql")
class GraphQlController extends Controller {
  constructor(context: Context) {
    super("GraphQlController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    this.setContextJson();
    return this;
  }

  @route("index-graphql", { path: "" })
  index() {
    return this.render({});
  }
}

export default GraphQlController;
