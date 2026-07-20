import path from "node:path";
import {
  Kernel,
  Module,
  services,
  GcScheduler,
  AUTO_STORE,
  EMPTY_INFRA,
  resolveAutoStore,
  readStoreLocation,
} from "nodefony";
import type { IIdempotencyStore } from "nodefony";
import type { IAdminBroker } from "./nodefony/interfaces/IAdminBroker";
import config from "./nodefony/config/config";
import type {
  FrameworkConfigInput,
  FrameworkConfig,
} from "./nodefony/config/config";
import {
  defineFrameworkConfig,
  frameworkConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";
import {
  getIdempotencyStoreFactory,
  registerIdempotencyStore,
  listIdempotencyStores,
  listIdempotencyBackends,
} from "./nodefony/src/idempotencyStoreRegistry";
import {
  RedisIdempotencyStore,
  type RedisIdempotencyClientLike,
} from "./nodefony/src/RedisIdempotencyStore";
import { scheduleIdempotencyGc } from "./nodefony/src/idempotencyGc";
import Router from "./nodefony/service/router";
import Route from "./nodefony/src/Route";
import Controller from "./nodefony/src/Controller";
import ResourceController from "./nodefony/src/ResourceController";
import Resolver from "./nodefony/src/Resolver";
import AdminBroker from "./nodefony/service/AdminBroker";
import MemoryIdempotencyStore from "./nodefony/service/IdempotencyStore";
import AdminApiController from "./nodefony/controller/AdminApiController";
import SessionAuthController, {
  mountSessionAuthRoutes,
} from "./nodefony/controller/SessionAuthController";
import TokenAuthController, {
  mountTokenAuthRoutes,
} from "./nodefony/controller/TokenAuthController";
import WebAuthnController, {
  mountWebAuthnRoutes,
} from "./nodefony/controller/WebAuthnController";
import OAuth2Controller, {
  mountOAuth2Routes,
} from "./nodefony/controller/OAuth2Controller";
import ApiKeyController, {
  mountApiKeyRoutes,
} from "./nodefony/controller/ApiKeyController";
import TotpController, {
  mountTotpRoutes,
} from "./nodefony/controller/TotpController";
import { createKernelAdminApi } from "./nodefony/src/KernelAdminApi";
import { createFrameworkAdminApi } from "./nodefony/src/FrameworkAdminApi";
import { buildPlaygroundSnapshot } from "./nodefony/src/PlaygroundAdminApi";
import { createSyslogAdminApi } from "./nodefony/src/SyslogAdminApi";
import Eta from "./nodefony/service/Eta";
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
  BypassFirewall,
  IsGranted,
  RequireScope,
  Anonymous,
  Csp,
  CsrfProtect,
  CsrfExempt,
  Idempotent,
  CurrentUser,
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

// ── Driver d'idempotence DISTRIBUÉ `redis` (builtin) ─────────────────────────
// Enregistré AU CHARGEMENT du module framework (toujours présent), calqué sur la
// registration des drivers backplane dans `@nodefony/realtime/index.ts`. Le
// framework POSSÈDE l'adaptateur Redis (le store vit ici) et résout le service
// `redis` par NOM dans le container — couplage STRUCTUREL, AUCUNE dépendance
// directe à `@nodefony/redis` (0 cycle), exactement comme `RedisBackplane` consomme
// `getClient("publish"/"subscribe")`. La SÉLECTION se fait par config
// (`idempotency.store: "redis"`) ; la CONNEXION vit dans `@nodefony/redis`.
// Appelé SEULEMENT si `idempotency.store === "redis"` (cf onKernelBoot) →
// **fail-loud** si redis demandé mais absent (jamais de dédup silencieuse en
// cluster = double-effet ; ≠ realtime fail-soft, car le risque diffère).
registerIdempotencyStore("redis", (ctx) => {
  const redis = ctx.module.kernel?.container?.get("redis") as
    { getClient(name: string): unknown } | undefined;
  if (!redis) {
    throw new Error(
      `the @nodefony/redis module is not loaded ` +
        `(add use("@nodefony/redis") in nodefony.config.ts)`,
    );
  }
  return new RedisIdempotencyStore(
    () =>
      (redis.getClient("main") ?? null) as RedisIdempotencyClientLike | null,
  );
});

// Augmente le registre de config des modules → `use("@nodefony/framework", { … })`
// propose les clés typées en complétion, et REFUSE une clé inconnue. Sans cette
// déclaration, `use()` retombe sur `Record<string, unknown>` : une clé mal
// orthographiée est retirée par Zod au boot, sans un mot.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/framework": FrameworkConfigInput;
  }
}

@services([Router, Eta, AdminBroker, MemoryIdempotencyStore])
class Framework extends Module<FrameworkConfig> {
  /** Balayage périodique du store d'idempotence SQL (drizzle) — `null` sinon. */
  #idempotencyGc: GcScheduler | null = null;
  /**
   * Store d'idempotence distribué (drizzle/redis) posé au container, retenu pour
   * rafraîchir sa `location` au `onKernelReady` (à `onKernelBoot` l'ORM n'est pas
   * encore connecté → `readStoreLocation` vide). `null` = repli mémoire (per-pod).
   */
  #idempotencyStore: IIdempotencyStore | null = null;

  constructor(kernel: Kernel) {
    super("framework", kernel, import.meta.url, config);
  }

  /** JSON Schema de la config framework → data plane admin (config riche Studio). */
  override configSchema(): unknown {
    return frameworkConfigJsonSchema();
  }

  /**
   * Phase `onRegister` : valide la config du module via le builder
   * ({@link defineFrameworkConfig}) AVANT que les `@services` (Router,
   * AdminBroker — qui lisent `module.options.router`/`.adminBroker`) ne soient
   * instanciés à `onBoot`. Une config invalide plante proprement ici avec un
   * message clair, plutôt qu'un `undefined.x` silencieux en runtime
   * (cf `feedback_config_validation_zod`). La config validée est ré-assignée à
   * `this.options` (matérialise les défauts, préserve `router`/`adminBroker`).
   */
  override async onKernelRegister(): Promise<this> {
    this.options = defineFrameworkConfig(
      (this.options as FrameworkConfigInput) ?? {},
    );
    return this;
  }

  /**
   * Phase `onBoot` (après les `@services` à `onPreBoot` → le défaut mémoire
   * `idempotencyStore` est déjà enregistré, ET après l'`onPreBoot` des autres
   * modules → le service `redis` est résoluble) : si la config sélectionne un
   * store d'idempotence **distribué** (`idempotency.store` ≠ `memory`), le résout
   * via le registre et **override** le service `idempotencyStore` → toutes les
   * mutations (`@Idempotent` + data plane admin) dédupliquent cross-pod.
   *
   * **Politique en cas d'échec de résolution** (nom inconnu, ou store distribué
   * qui ne peut pas s'initialiser — ex. `idempotency.store="redis"` sans module
   * `@nodefony/redis`) :
   *  - **prod** → **fatal** (rethrow → le module framework est `critical` → boot
   *    avorté) : en cluster multi-pod, dégrader en silence vers le cache per-pod
   *    serait du double-effet non dédupliqué (cf « pas de dégradation silencieuse »).
   *  - **dev/test** (mono-pod) → **WARNING fort + fallback sur le cache mémoire**
   *    déjà en place : la dédup per-pod suffit hors cluster, et on ne casse PAS le
   *    framework (= le routeur) pour une option d'infra absente en local. Jamais
   *    silencieux (le WARNING annonce la dégradation).
   */
  override async onKernelBoot(): Promise<this> {
    const configured =
      (this.options as FrameworkConfig)?.idempotency?.store ?? AUTO_STORE;
    let name = configured;
    let reason = `store explicitement configuré ("${configured}")`;
    if (name === AUTO_STORE) {
      // `auto` (défaut) = suivre l'infra déclarée (cache redis > database),
      // borné aux backends UTILISABLES (memory builtin @services + distribués) —
      // `listIdempotencyBackends()`, pas `listIdempotencyStores()` : inclure memory
      // permet à l'override global `NF_STORE=memory` de sélectionner le builtin (banc
      // de charge). Normal : memory n'est jamais une préférence, seulement le repli.
      const auto = resolveAutoStore(
        "ephemeral",
        this.kernel?.infra ?? EMPTY_INFRA,
        listIdempotencyBackends(),
      );
      name = auto.store;
      reason = auto.reason;
      this.log(`idempotency.store "auto" → "${name}" (${auto.reason})`, "INFO");
    }
    if (name === "memory") {
      // Prod-guard : dédup PER-POD uniquement — en multi-pod, un rejeu routé
      // vers un autre pod n'est pas dédupliqué (double-effet possible).
      if (this.kernel?.environment === "production") {
        this.log(
          `idempotency.store "memory" en PRODUCTION — déduplication per-pod uniquement : ` +
            `un rejeu routé vers un autre pod n'est pas dédupliqué (double-effet possible). ` +
            `Déclarer une infra partagée (NF_REDIS_URL ou NF_DATABASE_URL).`,
          "WARNING",
        );
      }
      this.kernel?.registerStoreResolution({
        brick: "idempotency",
        nature: "ephemeral",
        configured,
        resolved: "memory",
        // Affichage : memory (builtin @services) + distribués → le résolu figure
        // toujours dans les dispo (≠ listIdempotencyStores, résolution seule).
        available: listIdempotencyBackends(),
        reason,
        configPath: "framework.idempotency.store",
      });
      return this; // défaut per-pod déjà posé par @services (MemoryIdempotencyStore)
    }
    try {
      const factory = getIdempotencyStoreFactory(name);
      if (!factory) {
        throw new Error(
          `not registered (known distributed stores: [${listIdempotencyStores().join(", ") || "none"}])`,
        );
      }
      const store = factory({
        module: this,
        config: this.options as FrameworkConfig,
      });
      this.set("idempotencyStore", store); // override du défaut mémoire (cross-pod)
      this.#idempotencyStore = store; // retenu pour rafraîchir `location` au onReady
      this.log(`Idempotency store → "${name}" (distributed)`, "INFO");
      this.kernel?.registerStoreResolution({
        brick: "idempotency",
        nature: "ephemeral",
        configured,
        resolved: name,
        // memory (builtin) + distribués → le résolu figure toujours dans les dispo.
        available: listIdempotencyBackends(),
        reason,
        configPath: "framework.idempotency.store",
        // À `onKernelBoot` l'ORM drizzle n'est pas encore connecté → location vide.
        // Rafraîchie à `onKernelReady` (cf {@link Framework.onKernelReady}).
        location: readStoreLocation(store),
      });
      // Store SANS expiration native (drizzle expose `gc` ; redis=TTL PX et
      // memory=purge passive ne l'exposent pas) → arme un balayage périodique HORS
      // hot-path. Corrige le « gc orphelin » : sans ça, les clés SQL expirées
      // s'accumulaient indéfiniment. Logique isolée dans `scheduleIdempotencyGc`
      // (testable sans booter un kernel).
      const idem = (this.options as FrameworkConfig).idempotency;
      this.#idempotencyGc = scheduleIdempotencyGc(store, {
        intervalS: idem.gcIntervalS,
        jitter: idem.gcJitter,
        onError: (e) => this.log(e as Error, "WARNING"),
        log: (m) => this.log(m, "INFO"),
      });
      if (this.#idempotencyGc) {
        this.kernel?.once("onTerminate", () => this.#idempotencyGc?.stop());
      }
    } catch (e) {
      const msg =
        `[@nodefony/framework] idempotency.store="${name}" failed to initialize: ` +
        `${(e as Error).message}.`;
      if (this.kernel?.environment === "production") {
        // Cluster prod : pas de dédup cross-pod = double-effet → boot avorté.
        throw new Error(
          `${msg} A distributed store is mandatory in production.`,
        );
      }
      // Dev/test mono-pod : on garde le cache mémoire (dédup per-pod), LOUDEMENT.
      this.log(
        `${msg} Falling back to the per-pod "memory" store (dev/test only; ` +
          `a distributed store is required for a multi-pod cluster).`,
        "WARNING",
      );
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
    // Rafraîchit la `location` de la brique idempotency : à `onKernelBoot` l'ORM
    // drizzle n'était pas connecté (fabrique lazy) → l'emplacement du `.db` n'était
    // pas lisible. Ici (après le boot de TOUS les modules) il l'est. On ré-enregistre
    // la résolution existante (idempotent par brick) en ne changeant QUE la location.
    const idemLocation = readStoreLocation(this.#idempotencyStore);
    if (idemLocation && this.kernel) {
      const current = this.kernel.storeResolutions.find(
        (r) => r.brick === "idempotency",
      );
      if (current && !current.location) {
        this.kernel.registerStoreResolution({
          ...current,
          location: idemLocation,
        });
      }
    }
    const broker = this.kernel?.container?.get("adminBroker") as
      IAdminBroker | undefined;
    if (broker && this.kernel) {
      if (!broker.has("kernel")) {
        broker.register(createKernelAdminApi(this.kernel));
      }
      if (!broker.has("framework")) {
        broker.register(
          createFrameworkAdminApi(broker, {
            // Playground = console qui EXÉCUTE des actions depuis le navigateur
            // → monté en dev uniquement (`-d` inclus), jamais en prod.
            // `debug` est un DebugType (bool | filtre) → truthiness voulue.
            playground:
              this.kernel.environment === "development" ||
              Boolean(this.kernel.debug),
          }),
        );
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
    // P6 J4 — émission/rotation JWT : routes montées seulement si le service
    // `tokenService` est présent (security chargé + JWT activé). 404 sinon.
    if (this.kernel?.container?.get("tokenService")) {
      mountTokenAuthRoutes(this);
    }
    // P6 J9 — cérémonies WebAuthn/passkeys : routes montées seulement si le
    // service `webauthn` est présent (security chargé + passkeys activés).
    if (this.kernel?.container?.get("webauthn")) {
      mountWebAuthnRoutes(this);
    }
    // P6 J9 — social login OAuth2 : routes montées seulement si le service
    // `oauth2` est présent (security chargé + ≥1 provider configuré). 404 sinon.
    if (this.kernel?.container?.get("oauth2")) {
      mountOAuth2Routes(this);
    }
    // P6.12 — gestion des clés API (PAT) : routes montées seulement si le service
    // `apiKeys` est présent (security chargé + clés activées). 404 sinon. Ces
    // routes sont PROTÉGÉES par la zone data plane (session), pas bypassées.
    if (this.kernel?.container?.get("apiKeys")) {
      mountApiKeyRoutes(this);
    }
    // P6.17 — self-service 2FA TOTP : routes montées seulement si le service
    // `totp` est présent (security chargé + 2FA activé). 404 sinon. Protégées par
    // la zone data plane (session BFF), pas bypassées.
    if (this.kernel?.container?.get("totp")) {
      mountTotpRoutes(this);
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
  MemoryIdempotencyStore,
  AdminApiController,
  SessionAuthController,
  mountSessionAuthRoutes,
  TokenAuthController,
  mountTokenAuthRoutes,
  WebAuthnController,
  mountWebAuthnRoutes,
  OAuth2Controller,
  mountOAuth2Routes,
  ApiKeyController,
  mountApiKeyRoutes,
  TotpController,
  mountTotpRoutes,
  createKernelAdminApi,
  createFrameworkAdminApi,
  createSyslogAdminApi,
  buildPlaygroundSnapshot,
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
  BypassFirewall,
  IsGranted,
  RequireScope,
  Anonymous,
  Csp,
  CsrfProtect,
  CsrfExempt,
  Idempotent,
  CurrentUser,
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
  registerIdempotencyStore,
  getIdempotencyStoreFactory,
  listIdempotencyStores,
};
export { frameworkConfigSchema } from "./nodefony/config/config";
export type {
  IdempotencyStoreFactory,
  IIdempotencyStoreFactoryContext,
} from "./nodefony/src/idempotencyStoreRegistry";
export type {
  SecurityClause,
  SecurityRequirement,
  CspDirectives,
} from "./nodefony/decorators/routerDecorators";
export type { ControllerScope } from "./nodefony/src/Controller";
export type { FrameworkAdminApiOptions } from "./nodefony/src/FrameworkAdminApi";
export type {
  PlaygroundAction,
  PlaygroundController,
  PlaygroundGuards,
  PlaygroundParam,
} from "./nodefony/src/PlaygroundAdminApi";
export type { IResourceService } from "./nodefony/src/ResourceController";
export type {
  FrameworkConfig,
  FrameworkConfigInput,
} from "./nodefony/config/config";
export {
  defineFrameworkConfig,
  frameworkConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";
export type {
  IController,
  IRoute,
  IResolver,
  IAdminBroker,
  IAdminRoute,
  IIdempotencyStore,
  IdempotencyOutcome,
  IdempotentResponse,
} from "./nodefony/interfaces/index.js";
