import { Kernel, Module, services, registerLogDriver } from "nodefony";
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
import SessionRuntimeController from "./nodefony/controller/SessionRuntimeController";
import DecoratorController from "./nodefony/controller/DecoratorController";
import AlsController from "./nodefony/controller/AlsController";
import LifecycleController from "./nodefony/controller/LifecycleController";
import DomainController from "./nodefony/controller/DomainController";
import DomainClassController from "./nodefony/controller/DomainClassController";
import DbController from "./nodefony/controller/DbController";
// POC « API souveraine » — Phase 1 (JETABLE — supprimer le dossier nodefony/poc/
// + ces 2 imports + les 2 entrées @controllers après la revue Phase 6).
import PocBookController from "./nodefony/poc/PocBookController";
import PocInvokeController from "./nodefony/poc/PocInvokeController";
// POC Phase 2 (V4.2) — ResourceController souverain stateless + singleton.
import PocBookResourceController from "./nodefony/poc/PocBookResourceController";
// P6 J1 — banc ZONE PROTÉGÉE (dossier secure/ = préfixe /secure = zone "test-secure").
import SecureController from "./nodefony/secure/SecureController";
// P6 J4 — banc ZONE API M2M (JWT Bearer, zone "test-api", /nodefony/test/m2m).
import ApiM2mController from "./nodefony/secure/ApiM2mController";
import {
  InMemoryUserRepository,
  SECURE_TEST_USERS,
} from "./nodefony/secure/InMemoryUserRepository";
import { UserService } from "@nodefony/user";
import type { IPasswordEncoder } from "@nodefony/user";
import { controllers } from "@nodefony/framework";
// Commandes CLI de démo — bancs pour les 3 modes de boot (server/batch/daemon) et le
// dispatch d'une commande de module (namespace `test:<action>`).
import BatchTestCommand from "./nodefony/command/BatchTestCommand";
import DaemonTestCommand from "./nodefony/command/DaemonTestCommand";
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
  SessionRuntimeController,
  DecoratorController,
  AlsController,
  LifecycleController,
  DomainController,
  DomainClassController,
  DbController,
  // P6 — banc zone protégée (firewall, routes /nodefony/test/secure/*)
  SecureController,
  // P6 J4 — banc zone API M2M (JWT Bearer, /nodefony/test/m2m/*)
  ApiM2mController,
  // POC API souveraine (JETABLE)
  PocBookController,
  PocInvokeController,
  PocBookResourceController,
])
class Test extends Module {
  constructor(kernel: Kernel) {
    super("test", kernel, import.meta.url, config);
    // Enregistre les commandes de module dans commander DÈS la construction du module
    // (à onPreRegister, avant le parse différé du CliKernel) → `nodefony test:batch` /
    // `nodefony test:daemon` deviennent dispatchables. Le kernel.cli est présent ici.
    if (kernel.cli) {
      this.addCommand(BatchTestCommand);
      this.addCommand(DaemonTestCommand);
    }
  }
  // P1.7 — register security hooks listeners for integration tests.
  override async onKernelReady(): Promise<this> {
    // P6 J1 — source d'identité du banc sécurité : UserService réel sur
    // l'annuaire in-memory, posé sous "users" dans le container PARTAGÉ du
    // kernel. Le UserPasswordAuthenticator (zone "test-secure") le résout au
    // premier login — pas au boot (zéro coût si aucune requête protégée).
    // P6 J3 — la chaîne d'encodeurs vient du PONT config.encoders (section
    // `module-security` de la config du banc → firewall → container) : même
    // migration bcrypt→argon2id qu'à J2, désormais pilotée par la config.
    // AUCUN fallback : un boot cassé ici = pont cassé (c'est la preuve).
    const encoder = this.container?.get<IPasswordEncoder>("passwordEncoder");
    if (!encoder) {
      throw new Error(
        `banc test-secure: pont config.encoders absent — le firewall n'a pas ` +
          `posé "passwordEncoder" au container (section encoders non consommée ?)`,
      );
    }
    this.container?.set(
      "users",
      new UserService(new InMemoryUserRepository(SECURE_TEST_USERS), encoder),
    );
    // Démo Log Backplane — 2ᵉ driver de relecture `console` (DEV uniquement) pour
    // exercer le SWITCH dev-only depuis la page Logs. `query:false` → non
    // interrogeable : basculer dessus prouve (a) que le switch marche, (b) que
    // l'UI s'adapte aux capacités (Explorer affiche une alerte au lieu de requêter
    // dans le vide), (c) que le flux Live continue (`stream:true`, indépendant du
    // driver). Re-basculer sur `memory` réactive l'exploration. Jamais hors dev.
    if (this.kernel?.environment === "development") {
      registerLogDriver({
        name: "console",
        capabilities: { write: false, query: false, stream: true },
      });
    }
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
