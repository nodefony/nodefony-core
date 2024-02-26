import { Service, Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import Router, { TypeController } from "./nodefony/service/router";
import Route from "./nodefony/src/Route";
import Controller from "./nodefony/src/Controller";
import Resolver from "./nodefony/src/Resolver";
import {
  controllers,
  DefineRoute,
  DefineController,
} from "./nodefony/decorators/routerDecorators";

@services([Router])
class Framework extends Module {
  constructor(kernel: Kernel) {
    super("framework", kernel, import.meta.url, config);
  }
}

export default Framework;
export {
  Controller,
  Route,
  Router,
  Resolver,
  DefineRoute,
  DefineController,
  controllers,
};
