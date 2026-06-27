import { Kernel, Module, services, registerLogDriver } from "nodefony";
import type { IAdminRegistry } from "nodefony";
import type { HttpKernel } from "@nodefony/http";
// P6.8 — banc d'idempotence des mutations socket (mutation admin à compteur).
import { createTestAdminApi } from "./nodefony/admin/TestAdminApi";
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
// P6.13 — récepteur webhook LOCAL (test des livraisons sortantes, /nodefony/test/webhooks/*)
import WebhookSinkController from "./nodefony/controller/WebhookSinkController";
// POC « API souveraine » — Phase 1 (JETABLE — supprimer le dossier nodefony/poc/
// + ces 2 imports + les 2 entrées @controllers après la revue Phase 6).
import PocBookController from "./nodefony/poc/PocBookController";
import PocInvokeController from "./nodefony/poc/PocInvokeController";
// POC Phase 2 (V4.2) — ResourceController souverain stateless + singleton.
import PocBookResourceController from "./nodefony/poc/PocBookResourceController";
// P6 J1 — banc ZONE PROTÉGÉE (dossier secure/ = préfixe /secure = zone "test-secure").
import SecureController from "./nodefony/secure/SecureController";
// P6 J8 — banc preuve garde @IsGranted côté WS via api.request (/nodefony/test/api/*).
import SecureWsController from "./nodefony/secure/SecureWsController";
// P6 J8 (volet b) — endpoint realtime JWT Bearer (zone test-api) pour prouver la
// garde @IsGranted via api.request sur le mode agent/M2M (pas seulement cookie).
import TestM2mRealtimeController from "./nodefony/secure/TestM2mRealtimeController";
// P6 J4 — banc ZONE API M2M (JWT Bearer, zone "test-api", /nodefony/test/m2m).
import ApiM2mController from "./nodefony/secure/ApiM2mController";
// P6.8 — banc DÉMO idempotence userland (@Idempotent, /nodefony/test/secure/idempotent).
import IdempotentDemoController from "./nodefony/secure/IdempotentDemoController";
// P6 J9 — enregistre le provider OAuth de TEST (side-effect), AVANT le onBoot du
// service oauth2 qui confronte les providers configurés au registre. DEV only.
import "./nodefony/secure/oauthTestProvider";
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
  // P6.13 — récepteur webhook local (réception + vérif signature + simulation d'erreurs)
  WebhookSinkController,
  // P6 — banc zone protégée (firewall, routes /nodefony/test/secure/*)
  SecureController,
  // P6 J8 — banc garde @IsGranted côté WS (api.request, /nodefony/test/api/*)
  SecureWsController,
  // P6 J8 (volet b) — endpoint realtime JWT Bearer (zone test-api M2M)
  TestM2mRealtimeController,
  // P6 J4 — banc zone API M2M (JWT Bearer, /nodefony/test/m2m/*)
  ApiM2mController,
  // P6.8 — banc démo idempotence userland (@Idempotent, /nodefony/test/secure/idempotent/*)
  IdempotentDemoController,
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
  // P6.8 — enregistre le producteur admin de TEST (banc idempotence) AVANT le
  // `mountAll()` du framework (à onKernelReady) → la mutation
  // `POST /nodefony/test/api/idem-probe` est montée (+ transport WEBSOCKET).
  override async onKernelBoot(): Promise<this> {
    const broker = this.kernel?.container?.get("adminBroker") as
      | IAdminRegistry
      | undefined;
    if (broker && !broker.has("test")) {
      broker.register(createTestAdminApi());
    }
    return this;
  }

  // P1.7 — register security hooks listeners for integration tests.
  override async onKernelReady(): Promise<this> {
    // NOTE — le service "users" (source d'identité du firewall : comptes admin/user
    // de la zone test-secure) n'est PLUS posé ici. C'est désormais l'APP racine qui
    // le provisionne au boot, en dev ET en prod, via `nodefony/security/provisionUsers.ts`
    // (dépôt Drizzle par défaut, in-memory via NF_USER_STORE). Ce module ne fournit
    // que les ROUTES protégées — pas l'identité. (Fix : l'auth était morte hors dev,
    // car seul ce module dev-only posait "users".)

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
