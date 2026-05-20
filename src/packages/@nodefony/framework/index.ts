import { Kernel, Module, services } from "nodefony";
import type { IAdminBroker } from "./nodefony/interfaces/IAdminBroker";
import config from "./nodefony/config/config";
import Router from "./nodefony/service/router";
import Route from "./nodefony/src/Route";
import Controller from "./nodefony/src/Controller";
import Resolver from "./nodefony/src/Resolver";
import AdminBroker from "./nodefony/service/AdminBroker";
import AdminApiController from "./nodefony/src/AdminApiController";
import { createKernelAdminApi } from "./nodefony/src/KernelAdminApi";
import { createFrameworkAdminApi } from "./nodefony/src/FrameworkAdminApi";
import { createSyslogAdminApi } from "./nodefony/src/SyslogAdminApi";
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
  Get,
  Post,
  Put,
  Delete,
  Patch,
  HttpCode,
  Header,
  Redirect,
  Param,
  Body,
  Query,
} from "./nodefony/decorators/routerDecorators";

@services([Router, Twig, Ejs, AdminBroker])
class Framework extends Module {
  constructor(kernel: Kernel) {
    super("framework", kernel, import.meta.url, config);
  }

  /**
   * Phase `onReady` (après le boot de tous les modules) : enregistre le
   * producteur admin du kernel puis monte le data plane `/nodefony/<ns>/api/*`.
   *
   * Les autres modules s'enregistrent dans leur `onKernelBoot` (phase
   * antérieure) → tous présents au moment du `mountAll()` ici.
   */
  override async onKernelReady(): Promise<this> {
    const broker = this.kernel?.container?.get("adminBroker") as
      | IAdminBroker
      | undefined;
    if (broker && this.kernel) {
      if (!broker.has("kernel")) {
        broker.register(createKernelAdminApi(this.kernel));
      }
      if (!broker.has("framework")) {
        broker.register(createFrameworkAdminApi());
      }
      if (this.kernel.syslog && !broker.has("syslog")) {
        broker.register(createSyslogAdminApi(this.kernel.syslog));
      }
      broker.mountAll();
    }
    return this;
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
  AdminBroker,
  AdminApiController,
  createKernelAdminApi,
  createFrameworkAdminApi,
  createSyslogAdminApi,
  Twig,
  Ejs,
  route,
  controller,
  controllers,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  HttpCode,
  Header,
  Redirect,
  Param,
  Body,
  Query,
  graphql,
};
export type {
  IController,
  IRoute,
  IResolver,
  IAdminBroker,
  IAdminRoute,
} from "./nodefony/interfaces/index.js";
