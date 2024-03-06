import { Controller, DefineRoute, DefineController } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { graphql } from "@nodefony/framework";
import { inject, Error } from "nodefony";

@DefineController("graphql", {})
class GraphQlController extends Controller {
  static override basepath = "/nodefony/test";
  constructor(context: Context) {
    super("GraphQlController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession();
    this.setContextJson();
    return this;
  }

  @DefineRoute("index-graphql", { path: "/graphql" })
  index() {
    return this.render({});
  }
}

export default GraphQlController;
