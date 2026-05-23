import { Kernel, Module, services } from "nodefony";
import type { HttpKernel } from "@nodefony/http";
import config from "./nodefony/config/config";
import DefaultController, {
  securityHooksState,
} from "./nodefony/controller/DefaultController";
import OpenapiController from "./nodefony/controller/OpenapiController";
import RestController from "./nodefony/controller/RestController";
import GraphqlController from "./nodefony/controller/GraphqlController";
import HtmlController from "./nodefony/controller/HtmlController";
import RouterController from "./nodefony/controller/RouteController";
import WebsocketController from "./nodefony/controller/WebSocketController";
import FrameworkController from "./nodefony/controller/FrameworkController";
import DecoratorController from "./nodefony/controller/DecoratorController";
import AlsController from "./nodefony/controller/AlsController";
import { controllers } from "@nodefony/framework";
// Entité de démo Sequelize (orm-core) — enregistrée au top-level (side-effect).
import "./nodefony/entity/auditEntity";
// Fixture "gros schéma" Dolibarr (410 tables, GPLv3, .gitignore) sur l'ORM Drizzle
// par défaut — register au top-level AVANT le onBoot du DrizzleService (qui crée les
// tables via CREATE TABLE IF NOT EXISTS depuis l'entityRegistry).
import { registerDolibarrEntities } from "./nodefony/entity/dolibarr";
registerDolibarrEntities("default");

@services([])
@controllers([
  DefaultController,
  HtmlController,
  GraphqlController,
  RestController,
  OpenapiController,
  RouterController,
  WebsocketController,
  FrameworkController,
  DecoratorController,
  AlsController,
])
class Test extends Module {
  constructor(kernel: Kernel) {
    super("test", kernel, import.meta.url, config);
  }
  // P1.7 — register security hooks listeners for integration tests.
  override async onKernelReady(): Promise<this> {
    const httpKernel = this.kernel?.get<HttpKernel>("HttpKernel");
    if (httpKernel) {
      httpKernel.on("beforeResolve", () => {
        securityHooksState.beforeResolveCount++;
        securityHooksState.lastHook = "beforeResolve";
      });
      httpKernel.on("afterAuth", () => {
        securityHooksState.afterAuthCount++;
        securityHooksState.lastHook = "afterAuth";
      });
      httpKernel.on("onAuthFailure", (_ctx: unknown, err: Error) => {
        securityHooksState.onAuthFailureCount++;
        securityHooksState.lastAuthFailureReason = err?.message ?? String(err);
        securityHooksState.lastHook = "onAuthFailure";
      });
    }
    return this;
  }
}

export default Test;
