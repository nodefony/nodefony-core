import path from "node:path";
import { Kernel, Module, services } from "nodefony";
import type { IAdminBroker } from "./nodefony/interfaces/IAdminBroker";
import config from "./nodefony/config/config";
import {
  frameworkConfigSchema,
  frameworkConfigJsonSchema,
  type FrameworkConfigInput,
} from "./nodefony/config/schema";
import Router from "./nodefony/service/router";
import Route from "./nodefony/src/Route";
import Controller from "./nodefony/src/Controller";
import ResourceController from "./nodefony/src/ResourceController";
import Resolver from "./nodefony/src/Resolver";
import AdminBroker from "./nodefony/service/AdminBroker";
import AdminApiController from "./nodefony/src/AdminApiController";
import SessionAuthController, {
  mountSessionAuthRoutes,
} from "./nodefony/src/SessionAuthController";
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
  Domain,
  Scope,
  UseSession,
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
  routeExpectsBodyStream,
} from "./nodefony/decorators/routerDecorators";

@services([Router, Eta, AdminBroker])
class Framework extends Module {
  constructor(kernel: Kernel) {
    super("framework", kernel, import.meta.url, config);
  }

  /**
   * Phase `onRegister` : valide la config du module contre le schéma Zod
   * ({@link frameworkConfigSchema}) AVANT que les `@services` (Router,
   * AdminBroker — qui lisent `module.options.router`/`.adminBroker`) ne soient
   * instanciés à `onBoot`. Une config invalide plante proprement ici avec un
   * message clair, plutôt qu'un `undefined.x` silencieux en runtime
   * (cf `feedback_config_validation_zod`). La config validée est ré-assignée à
   * `this.options` (matérialise les défauts, préserve `router`/`adminBroker`).
   */
  override async onKernelRegister(): Promise<this> {
    try {
      this.options = frameworkConfigSchema.parse(
        (this.options as FrameworkConfigInput) ?? {},
      );
    } catch (e) {
      const issues =
        e instanceof Error && "issues" in e && Array.isArray(e.issues)
          ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join(" · ")
          : (e as Error).message;
      throw new Error(`[@nodefony/framework] Invalid config: ${issues}`);
    }
    return this;
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
        // Pointe sur le RÉPERTOIRE DES LOGS (où le Kernel écrit `.log` + `.jsonl`),
        // PAS sur `tmpDir` (ex-bug : la tab Fichiers listait `tmp/`, jamais les
        // vrais logs). Source unique = `config.log.dir` (défaut "logs"), sous cwd.
        const logDir = path.resolve(
          process.cwd(),
          this.kernel.options?.log?.dir ?? "logs",
        );
        broker.register(
          createSyslogAdminApi(this.kernel.syslog, {
            // `isProd` n'est pas fiable (défaut `true`, jamais remis à false en
            // dev) → on se fie à `environment` (vaut "development" au runtime).
            logDir,
            enableFiles: this.kernel.environment !== "production",
            // Garde le switch de driver (backplane/driver POST) en dev-only.
            environment: this.kernel.environment,
          }),
        );
      }
      broker.mountAll();
    }
    // P6 J3 — flux de session BFF : routes montées SEULEMENT si le service
    // `authFlow` est présent (module security chargé). Sans lui : 404, zéro
    // surface d'attaque, framework reste indépendant de security.
    if (this.kernel?.container?.get("authFlow")) {
      mountSessionAuthRoutes(this);
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
  ResourceController,
  Route,
  Router,
  Resolver,
  AdminBroker,
  AdminApiController,
  SessionAuthController,
  mountSessionAuthRoutes,
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
  Domain,
  Scope,
  UseSession,
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
  routeExpectsBodyStream,
  graphql,
  frameworkConfigSchema,
  frameworkConfigJsonSchema,
};
export type { ControllerScope } from "./nodefony/src/Controller";
export type { IResourceService } from "./nodefony/src/ResourceController";
export type {
  FrameworkConfig,
  FrameworkConfigInput,
} from "./nodefony/config/schema";
export type {
  IController,
  IRoute,
  IResolver,
  IAdminBroker,
  IAdminRoute,
} from "./nodefony/interfaces/index.js";
