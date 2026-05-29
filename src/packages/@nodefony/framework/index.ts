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
import Eta from "./nodefony/service/Eta";
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
  Options,
  Head,
  All,
  HttpCode,
  Header,
  Redirect,
  Param,
  Body,
  Query,
  Headers,
  Cookie,
  Session,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
} from "./nodefony/decorators/routerDecorators";

@services([Router, Eta, AdminBroker])
class Framework extends Module {
  constructor(kernel: Kernel) {
    super("framework", kernel, import.meta.url, config);
  }

  /**
   * Phase `onReady` (après le boot de tous les modules) : enregistre le
   * producteur admin du kernel puis monte le data plane `/nodefony/<ns>/api/*`.
   *
   * Les autres modules s'enregistrent dans leur `onKernelBoot` / `onKernelReady`
   * (le module realtime auto-enregistre son producteur `realtime` ici) → tous
   * présents au moment du `mountAll()` qui clôt cette phase.
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
        broker.register(createFrameworkAdminApi(broker));
      }
      if (this.kernel.syslog && !broker.has("syslog")) {
        // Viewer de fichiers = confort DEV (remplace `tail -f`). En prod, les
        // logs vont sur stdout/stderr → collecteur : pas de fichiers exposés.
        const tmp = this.kernel.tmpDir?.path;
        broker.register(
          createSyslogAdminApi(this.kernel.syslog, {
            // `isProd` n'est pas fiable (défaut `true`, jamais remis à false en
            // dev) → on se fie à `environment` (vaut "development" au runtime).
            logDir: typeof tmp === "string" ? tmp : undefined,
            enableFiles: this.kernel.environment !== "production",
          }),
        );
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
  Eta,
  route,
  controller,
  controllers,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Options,
  Head,
  All,
  HttpCode,
  Header,
  Redirect,
  Param,
  Body,
  Query,
  Headers,
  Cookie,
  Session,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  graphql,
};
export type {
  IController,
  IRoute,
  IResolver,
  IAdminBroker,
  IAdminRoute,
} from "./nodefony/interfaces/index.js";
