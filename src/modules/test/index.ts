import {
  Kernel,
  Module,
  services,
  registerLogDriver,
  mcpText,
  overlayConfig,
} from "nodefony";
import type { IAdminRegistry, IMcpTool } from "nodefony";
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
import DiController from "./nodefony/controller/DiController";
import LifecycleController from "./nodefony/controller/LifecycleController";
import SseController, {
  SecureSseController,
} from "./nodefony/controller/SseController";
// S5-R — télécommande du registre de disponibilité (/readyz vu basculer 200⇄503).
import ReadinessController from "./nodefony/controller/ReadinessController";
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
import PipelineOrderController from "./nodefony/controller/PipelineOrderController";
// Décor de banc contre-pression WS — monté SEULEMENT sous interrupteur (voir plus bas).
import BackpressureRealtimeController from "./nodefony/controller/BackpressureRealtimeController";
import LiveSalonController from "./nodefony/controller/LiveSalonController";
import LiveSyslogController from "./nodefony/controller/LiveSyslogController";
// Portée `request` de l'injecteur : sondes + bancs (/nodefony/test/request-scope*).
import {
  RequestProbe,
  RequestProbeConsumer,
} from "./nodefony/controller/requestProbe";
import { RequestScopeController } from "./nodefony/controller/RequestScopeController";

import BenchOrmController, {
  SecureBenchOrmController,
} from "./nodefony/controller/BenchOrmController";
import {
  registerBenchOrmEntities,
  seedBenchOrm,
} from "./nodefony/entity/benchOrm";
import { registerAdoptFixtureEntity } from "./nodefony/entity/adoptFixture";
// P6 J8 — banc preuve garde @IsGranted côté WS via api.request (/nodefony/test/api/*).
import SecureWsController from "./nodefony/secure/SecureWsController";
// P6 J8 (volet b) — endpoint realtime JWT Bearer (zone test-api) pour prouver la
// garde @IsGranted via api.request sur le mode agent/M2M (pas seulement cookie).
import TestM2mRealtimeController from "./nodefony/secure/TestM2mRealtimeController";
// P6 J4 — banc ZONE API M2M (JWT Bearer, zone "test-api", /nodefony/test/m2m).
import ApiM2mController from "./nodefony/secure/ApiM2mController";
import ExternalJwtController from "./nodefony/secure/ExternalJwtController";
// P6.9 — banc du chemin du SUCCÈS : Nodefony est son propre émetteur découvrable.
import {
  SelfExternalController,
  ForeignAudienceController,
} from "./nodefony/secure/SelfExternalController";
// #269 — porte d'API ouverte par un jeton d'un VRAI Keycloak (profil `keycloak`).
import KeycloakApiController from "./nodefony/secure/KeycloakApiController";
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

/**
 * Un endpoint capable d'inonder une connexion est une amplification offerte à
 * qui la demande : il n'existe que le temps d'une mesure, jamais par défaut.
 */
const BENCH_WS_BACKPRESSURE = process.env.NF_BENCH_WS_BACKPRESSURE === "1";

/**
 * Décor du banc du cycle ORM (routes + entités Dolibarr + seed) — opt-in
 * `NF_BENCH_ORM=1` : il n'existe que le temps d'une mesure, jamais par défaut.
 */
const BENCH_ORM = process.env.NF_BENCH_ORM === "1";

/**
 * Drapeau posé par TOUS les bancs de débit (`wait-compare.sh`,
 * `bench-ab-mono.sh`, `bench-pairs.sh`) — jamais par l'intégration de la CI.
 */
const BENCH_ROUTE = process.env.NF_BENCH_ROUTE === "1";

/**
 * Banc du calque de configuration (#494) : un en-tête de TEST pose, pour la
 * requête qui le porte, un calque sur le plafond du corps. Il prouve sur le
 * serveur réel que le point d'accroche `onRequestScope` est dans la bulle ALS
 * et AVANT la lecture du corps. Module `policy:"dev"` : absent en production.
 */
const OVERLAY_TEST_HEADER = "x-nf-test-max-body";
function overlayProbe(context: unknown): void {
  const value = (context as { request?: { headers?: Record<string, unknown> } })
    .request?.headers?.[OVERLAY_TEST_HEADER];
  if (typeof value === "string") {
    overlayConfig("@nodefony/http", { maxBodySize: Number(value) });
  }
}

// Services de portée `request` : DÉCLARÉS ici, jamais instanciés au démarrage —
// chaque requête crée les siens à leur première résolution.
@services([RequestProbe, RequestProbeConsumer])
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
  DiController,
  LifecycleController,
  // Flux d'événements serveur — /nodefony/test/sse/*, HTTP/1.1 et HTTP/2
  SseController,
  SecureSseController,
  ReadinessController,
  DomainController,
  DomainClassController,
  DbController,
  // P6.13 — récepteur webhook local (réception + vérif signature + simulation d'erreurs)
  WebhookSinkController,
  // P6 — banc zone protégée (firewall, routes /nodefony/test/secure/*)
  SecureController,
  // Banc d'ORDRE du pipeline — lecture publique du mouchard `initialize()`
  // écrit par SecureController (routes /nodefony/test/pipeline-order/*)
  PipelineOrderController,
  // P6 J8 — banc garde @IsGranted côté WS (api.request, /nodefony/test/api/*)
  SecureWsController,
  // P6 J8 (volet b) — endpoint realtime JWT Bearer (zone test-api M2M)
  TestM2mRealtimeController,
  // P6 J4 — banc zone API M2M (JWT Bearer, /nodefony/test/m2m/*)
  ApiM2mController,
  // P6.9 — banc zone serveur de ressource (jetons TIERS, /nodefony/test/external/*)
  ExternalJwtController,
  // P6.9 — chemin du SUCCÈS (/nodefony/test/self-external/*) et son refus par
  // AUDIENCE (/nodefony/test/foreign-audience/*)
  SelfExternalController,
  ForeignAudienceController,
  // #269 — jeton d'un vrai Keycloak : même compte qu'au login BFF (/nodefony/test/keycloak/*)
  KeycloakApiController,
  // P6.8 — banc démo idempotence userland (@Idempotent, /nodefony/test/secure/idempotent/*)
  IdempotentDemoController,
  // Le canal temps réel COMMUN des quatre vitrines de front (React, Vue,
  // Angular, Svelte) : un seul endpoint `/api/live/realtime`, un seul canal
  // `live:salon`, quatre pages qui doivent s'y brancher à l'identique.
  LiveSalonController,
  LiveSyslogController,
  // Portée `request` de l'injecteur — HTTP et WS
  RequestScopeController,
  // Décor du banc de contre-pression WS (opt-in `NF_BENCH_WS_BACKPRESSURE=1`)
  ...(BENCH_WS_BACKPRESSURE ? [BackpressureRealtimeController] : []),
  // Décor du banc du cycle ORM (opt-in `NF_BENCH_ORM=1`)
  ...(BENCH_ORM ? [BenchOrmController, SecureBenchOrmController] : []),
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
  // Entités du banc ORM : enregistrées AVANT le `connect()` du DrizzleService
  // (hook `onBoot`) — l'adapter matérialise les tables des entités connues.
  override async onKernelRegister(): Promise<this> {
    if (BENCH_ORM) {
      await registerBenchOrmEntities();
    }
    // Décor du banc d'adoption en ligne de commande (opt-in `NF_ADOPT_FIXTURE`)
    // — la seule table que l'application DÉCLARE en propre, sans quoi
    // `orm:migrate:baseline --from-database` n'a rien à adopter sur ce dépôt.
    // La fonction ne fait rien quand la variable est absente : c'est elle, et
    // non ce fichier, qui porte la condition.
    registerAdoptFixtureEntity();
    return this;
  }

  // P6.8 — enregistre le producteur admin de TEST (banc idempotence) AVANT le
  // `mountAll()` du framework (à onKernelReady) → la mutation
  // `POST /nodefony/test/api/idem-probe` est montée (+ transport WEBSOCKET).
  override async onKernelBoot(): Promise<this> {
    const broker = this.kernel?.container?.get("adminBroker") as
      IAdminRegistry | undefined;
    if (broker && !broker.has("test")) {
      broker.register(createTestAdminApi());
    }
    // Jamais sous un banc : un écouteur `onRequestScope` y ferait payer à
    // CHAQUE requête mesurée un `fireAsync` que le camp témoin ne paie pas —
    // et, sur un GET, rendrait ASYNCHRONE tout le pipeline qui suit (le
    // chemin sans Promise n'était alors jamais mesuré). Biais mesuré contre
    // nous (47 → 44 Promises par requête sur le banc ORM). Le critère est le
    // drapeau du banc, PAS l'environnement : l'intégration de la CI tourne elle
    // aussi en production, sous la même dérogation `NF_WITH_DEV_MODULES` que les
    // bancs, SANS drapeau de banc — c'est elle qui éprouve le calque
    // (`config-overlay.test.ts`).
    if (this.kernel && !BENCH_ORM && !BENCH_ROUTE) {
      this.kernel.on("onRequestScope", overlayProbe);
    }
    return this;
  }

  /**
   * Outil MCP de ce module — le décor qui prouve qu'une APPLICATION peut
   * ajouter le sien.
   *
   * Sans lui, le registre ne serait éprouvé que par des modules fabriqués dans
   * une suite unitaire : le chemin réel — `kernel.modules` parcouru par le
   * controller du devkit, sur un serveur qui tourne — resterait sans témoin.
   * C'est ce que ce module existe pour faire.
   */
  /** Dernier passage de l'outil `test_progress` (banc du flux MCP). */
  #lastProgressRun: { steps: number; done: number; aborted: boolean } | null =
    null;

  override getMcpTools(): IMcpTool[] {
    return [
      {
        name: "test_probe",
        description:
          "Sonde du module de test : renvoie ce qu'on lui donne, avec le nom " +
          "du module qui a répondu. Sert aux bancs d'intégration MCP — sans " +
          "intérêt pour une application réelle.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Texte à faire écho" },
          },
        },
        handler: (args) =>
          mcpText({
            module: this.name,
            echo: typeof args.message === "string" ? args.message : null,
          }),
      },
      {
        // Décor du FLUX : un outil long qui signale chaque étape et s'arrête
        // quand l'agent part. Son dernier passage est relu par
        // `test_progress_last` — c'est ce qui prouve l'annulation sur la route.
        name: "test_progress",
        description:
          "Sonde du module de test : avance de `steps` étapes espacées de " +
          "`delayMs`, signale chacune (progression MCP), s'arrête si l'appel " +
          "est abandonné. Sert au banc du flux SSE de la porte MCP.",
        inputSchema: {
          type: "object",
          properties: {
            steps: { type: "integer", description: "Étapes (1 à 50)" },
            delayMs: {
              type: "integer",
              description: "Pause entre étapes (0 à 2000 ms)",
            },
          },
        },
        handler: async (args, _caller, run) => {
          const steps = Math.min(50, Math.max(1, Number(args.steps) || 3));
          const delayMs = Math.min(
            2000,
            Math.max(0, Number(args.delayMs) || 150),
          );
          const state = { steps, done: 0, aborted: false };
          this.#lastProgressRun = state;
          for (let i = 1; i <= steps; i++) {
            if (run?.signal.aborted) {
              state.aborted = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            state.done = i;
            run?.progress(i, steps, `étape ${i}/${steps}`);
          }
          if (run?.signal.aborted) state.aborted = true;
          return mcpText(state);
        },
      },
      {
        // Décor de l'OPACITÉ : l'exception porte un faux chemin sensible, qui
        // doit rester au journal du serveur et ne jamais atteindre l'agent.
        name: "test_crash",
        description:
          "Sonde du module de test : lève toujours une exception. Sert au banc " +
          "qui vérifie que son message reste au journal du serveur.",
        inputSchema: { type: "object", properties: {} },
        handler: () => {
          throw new Error("/home/x/.ssh/id_rsa — sonde de fuite MCP");
        },
      },
      {
        name: "test_progress_last",
        description:
          "Sonde du module de test : rend le dernier passage de " +
          "`test_progress` (étapes faites, abandon constaté).",
        inputSchema: { type: "object", properties: {} },
        handler: () => mcpText(this.#lastProgressRun),
      },
      {
        // Décor de la RÉTENTION : cette porte n'authentifie personne, donc cet
        // outil ne doit JAMAIS apparaître ni répondre. C'est le seul moyen de
        // prouver le fail-closed là où il compte — sur la route, pas dans une
        // fonction pure qu'on nourrit soi-même.
        name: "test_probe_secret",
        description:
          "Sonde RÉSERVÉE du module de test — ne doit jamais être servie tant " +
          "que la porte MCP n'authentifie pas. Sert au banc du fail-closed.",
        inputSchema: { type: "object", properties: {} },
        scopes: ["test:secret"],
        handler: (_args, caller) =>
          mcpText({ never: true, sujet: caller.subject ?? null }),
      },
    ];
  }

  // P1.7 — register security hooks listeners for integration tests.
  override async onKernelReady(): Promise<this> {
    // Seed du banc ORM : APRÈS le connect (onBoot) — idempotent.
    if (BENCH_ORM) {
      await seedBenchOrm((m) => this.log(m, "INFO"));
    }
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
    // Témoins des hooks de sécurité (`security-hooks.test.ts`). Même règle que
    // l'écouteur `onRequestScope` ci-dessus : `beforeResolve` tire sur CHAQUE
    // requête, et un seul écouteur fait passer tout GET par `fireAsync` (une
    // Promise, une microtâche) — un coût qu'une application sans ce hook ne
    // paie pas, imputé à Nodefony sur les bancs de débit (#508).
    const httpKernel = BENCH_ROUTE
      ? undefined
      : this.kernel?.get<HttpKernel>("HttpKernel");
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
        securityHooksState.lastAuthFailureReason =
          err instanceof Error ? err.message : String(err);
        securityHooksState.lastHook = "onAuthFailure";
      });
    }
    return this;
  }
}

export default Test;
