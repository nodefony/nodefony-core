import { Service, Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import Router, { TypeController } from "./nodefony/service/router";
import test from "./nodefony/controller/testController";
import Route from "./nodefony/src/Route";
import Controller from "./nodefony/src/Controller";
import Resolver from "./nodefony/src/Resolver";
import { controllers } from "./nodefony/decorators/routerDecorators";

@controllers([test])
@services([Router])
class Framework extends Module {
  constructor(kernel: Kernel) {
    super("framework", kernel, import.meta.url, config);
  }
}

export default Framework;

export { Route, Controller, Resolver, Router, controllers };
