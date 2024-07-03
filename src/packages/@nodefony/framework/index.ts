import { Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import Router from "./nodefony/service/router";
import Route from "./nodefony/src/Route";
import Controller from "./nodefony/src/Controller";
import Resolver from "./nodefony/src/Resolver";
import Twig from "./nodefony/service/Twig";
import Ejs from "./nodefony/service/Ejs";
//import mygraphql from "graphql";
//console.log(mygraphql);
import { mergeResolvers, mergeTypeDefs } from "@graphql-tools/merge";
import { mergeSchemas, makeExecutableSchema } from "@graphql-tools/schema";

import {
  controllers,
  route,
  controller,
} from "./nodefony/decorators/routerDecorators";

@services([Router, Twig, Ejs])
class Framework extends Module {
  constructor(kernel: Kernel) {
    super("framework", kernel, import.meta.url, config);
  }
}

const graphql = {
  //graphql: mygraphql,
  mergeSchemas,
  makeExecutableSchema,
  mergeResolvers,
  mergeTypeDefs,
};

export default Framework;
export {
  Controller,
  Route,
  Router,
  Resolver,
  Twig,
  Ejs,
  route,
  controller,
  controllers,
  graphql,
};
