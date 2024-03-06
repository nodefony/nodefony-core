import { Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import DefaultController from "./nodefony/controller/DefaultController";
import OpenapiController from "./nodefony/controller/OpenapiController";
import RestController from "./nodefony/controller/RestController";
import GraphqlController from "./nodefony/controller/GraphqlController";
import HtmlController from "./nodefony/controller/HtmlController";
import { controllers } from "@nodefony/framework";

@services([])
@controllers([
  DefaultController,
  HtmlController,
  GraphqlController,
  RestController,
  OpenapiController,
])
class Test extends Module {
  constructor(kernel: Kernel) {
    super("test", kernel, import.meta.url, config);
  }
}

export default Test;
export {};
