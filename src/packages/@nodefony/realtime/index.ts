/**
 * @nodefony/realtime — Couche realtime serveur Nodefony.
 *
 * Ce module porte le hub WebSocket (broker fan-out), le protocole JSON-RPC 2.0
 * (peer isomorphe partagé avec le client core), le backplane cluster
 * (Loopback / Cluster IPC / Redis / Kafka) et, à terme, les protocoles TCP / UDP
 * / Unix sockets (P13.1).
 *
 * État : P13.0 — code serveur rapatrié depuis `@nodefony/framework`
 * (RealtimeHub, RealtimeController, RealtimeAdminApi, ClusterProbeClient,
 * WsConnectionTransport, LoopbackBackplane, ClusterBackplane et leurs
 * interfaces/tests). Le wiring cluster (`onCluster` → branchement
 * `ClusterBackplane` IPC + `ClusterProbeClient`) vit désormais dans le hook du
 * Module class ci-dessous. Le client isomorphe reste dans le subpath
 * `nodefony/realtime` du core (décision figée — pas de package navigateur).
 *
 * Lire `docs/index.md` pour la vue d'ensemble vulgarisée.
 *
 * Voir aussi :
 *  - CLAUDE.md  — décisions d'archi figées + 5 seams sécurité
 *  - MEMORY.md  — internals IA
 *  - README.md  — usage humain
 *  - docs/      — doc dev vulgarisée (6 pages)
 */
import { Kernel, Module, services } from "nodefony";
import defaultConfig from "./nodefony/config/config";
import {
  defineRealtimeConfig,
  type IRealtimeConfig,
  type IRealtimeConfigInput,
} from "./nodefony/config/defineRealtimeConfig";
import RealtimeService from "./nodefony/src/service/RealtimeService";

// Symboles serveur exportés (les surfaces consommateurs userland).
import RealtimeController from "./nodefony/src/server/RealtimeController";
import RealtimeHub, {
  getRealtimeHub,
  SLOW_CONSUMER_BYTES,
} from "./nodefony/src/server/RealtimeHub";
import LoopbackBackplane from "./nodefony/src/backplane/LoopbackBackplane";
import RedisBackplane, {
  createRedisServiceTransport,
  REDIS_RT_CHANNEL,
  type IRedisPublisher,
  type IRedisSubscriber,
} from "./nodefony/src/backplane/RedisBackplane";
import ClusterBackplane, {
  processIpcTransport,
} from "./nodefony/src/backplane/ClusterBackplane";
import {
  registerBackplaneDriver,
  getBackplaneDriver,
  listBackplaneDrivers,
} from "./nodefony/src/backplane/backplaneRegistry";
import ClusterProbeClient, {
  setClusterProbeClient,
  clusterProbeHealth,
  clusterProbeRequestEnrich,
  clusterProbeInstance,
  mergeClusterHealth,
  processProbeTransport,
} from "./nodefony/src/cluster/ClusterProbeClient";
import WsConnectionTransport from "./nodefony/src/transport/WsConnectionTransport";
import {
  createRealtimeAdminApi,
  buildRealtimeHealth,
  buildOwnHealth,
} from "./nodefony/src/server/RealtimeAdminApi";
import type { IAdminBroker } from "@nodefony/framework";

// ── Drivers backplane natifs ──────────────────────────────────────────────
//
// Enregistrés UNE fois au chargement du module (index = entry, jamais
// tree-shaké). Chaque driver porte son propre nom (`X.driver`) → aucun littéral
// de driver dupliqué, aucune chaîne de `if` côté wiring. Un utilisateur ajoute
// le sien via `registerBackplaneDriver("nats", factory)` sans toucher au cœur.
// Une fabrique renvoie `null` quand le driver est inactif dans le contexte (le
// hub reste local, 0 overhead).

// `loopback` : mono-process — le hub fan-out localement, aucun backplane objet.
registerBackplaneDriver(LoopbackBackplane.driver, () => null);

// `cluster` : IPC entre workers d'un même pod (actif seulement en worker de
// `nodefony cluster`, repéré par NODEFONY_CLUSTER=1).
registerBackplaneDriver(ClusterBackplane.driver, (ctx) =>
  ctx.role === "WORKER" && process.env.NODEFONY_CLUSTER === "1"
    ? new ClusterBackplane(processIpcTransport, ctx.originId)
    : null,
);

// `redis` : fan-out cross-pod multi-host via pub/sub. Consomme les connexions
// `publish`/`subscribe` de `@nodefony/redis` (RedisService) — couplage structurel
// par l'adaptateur, aucune dépendance directe. Fail-soft si redis absent.
registerBackplaneDriver(RedisBackplane.driver, (ctx) => {
  const redisService = ctx.module.kernel?.container?.get("redis") as
    | { getClient(name: string): unknown }
    | undefined;
  if (!redisService) {
    ctx.module.log(
      `driver "${RedisBackplane.driver}" : module @nodefony/redis absent (non listé dans @modules) — RealtimeHub reste local`,
      "WARNING",
    );
    return null;
  }
  const publisher = redisService.getClient("publish") as IRedisPublisher | null;
  const subscriber = redisService.getClient(
    "subscribe",
  ) as IRedisSubscriber | null;
  if (!publisher || !subscriber) {
    ctx.module.log(
      `driver "${RedisBackplane.driver}" : connexions Redis publish/subscribe indisponibles — RealtimeHub reste local`,
      "WARNING",
    );
    return null;
  }
  return new RedisBackplane(
    createRedisServiceTransport(publisher, subscriber),
    ctx.originId,
  );
});

@services([RealtimeService])
class Realtime extends Module {
  /** Rôle topologique du process, capté à `onCluster` (défaut mono-process). */
  #clusterRole: "MASTER" | "WORKER" | "MONO" = "MONO";

  constructor(kernel: Kernel) {
    super("realtime", kernel, import.meta.url, defaultConfig);
    // Le kernel annonce le rôle cluster via `onCluster` (émis en preRegister,
    // avant onRegister). `once` = 1 fire / process, listener boot-time (0 coût
    // par requête). On capte le rôle (consommé par la sélection de backplane à
    // `onKernelBoot`) et on branche la sonde pod. Le backplane lui-même est
    // résolu via le registre de drivers (cf #wireBackplane) — pas ici.
    kernel.once("onCluster", (role: "MASTER" | "WORKER") => {
      this.#clusterRole = role;
      this.#wireClusterProbe(role);
    });
  }

  /**
   * Validation Zod de la config racine merge au boot (convention figée 2026-05-28,
   * cf [[feedback_config_validation_zod]]) — via le builder `defineRealtimeConfig`
   * (source unique `nodefony/config/schema.ts`). Plante propre avec messages clairs
   * si la config (defaults + `module.options`) n'est pas conforme au schéma — évite
   * tous les `undefined.x` silencieux en runtime.
   *
   * La config validée + gelée est exposée au container sous `realtimeConfig` pour
   * que le `RealtimeService` (instancié à `onPreBoot` via `@services`) la consomme
   * sans dupliquer la validation.
   */
  override async onKernelRegister(): Promise<this> {
    let validated: IRealtimeConfig;
    try {
      validated = defineRealtimeConfig(
        (this.options ?? {}) as IRealtimeConfigInput,
      );
    } catch (e) {
      const issues =
        e instanceof Error && "issues" in e && Array.isArray(e.issues)
          ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join(" · ")
          : (e as Error).message;
      throw new Error(`[@nodefony/realtime] Invalid config: ${issues}`);
    }
    this.set("realtimeConfig", validated);
    return this;
  }

  /**
   * Phase `onBoot` (avant le `mountAll` de framework dans `onReady`) — enregistre
   * le producteur admin de la **socket Nodefony** (`/nodefony/realtime/api/*`)
   * sur le broker `framework/AdminBroker`. Auto-observabilité du `RealtimeHub`.
   *
   * ⚠️ Ne PAS déplacer dans `onKernelReady` : framework fait `broker.mountAll()`
   * dans SON `onKernelReady` ; les modules listés APRÈS framework dans `@modules()`
   * (cas de @nodefony/realtime) verraient leur `register` rejeté avec
   * « AdminBroker: register("realtime") après mountAll — routes figées ».
   * `onKernelBoot` court donc avant et garantit l'ordre.
   */
  override async onKernelBoot(): Promise<this> {
    const broker = this.kernel?.container?.get("adminBroker") as
      | IAdminBroker
      | undefined;
    if (broker && !broker.has("realtime")) {
      broker.register(createRealtimeAdminApi());
    }
    await this.#wireBackplane();
    return this;
  }

  /**
   * Sélectionne et branche le backplane via le **registre de drivers** — résout
   * `config.backplane.driver` (chaîne) → fabrique, SANS connaître aucun nom de
   * driver en dur (pas de chaîne de `if`). La fabrique construit l'instance (ou
   * renvoie `null` = inactif dans ce contexte → hub local).
   *
   * Phase `onKernelBoot` : après l'`initialize` des services (`onPreBoot`, donc
   * un éventuel `RedisService` a ouvert ses connexions) et avant le trafic
   * (`onReady` → `mountAll`). On `await start()` AVANT `setBackplane` pour
   * garantir l'abonnement effectif (le `start()` interne de `setBackplane` est
   * alors un no-op idempotent) — un driver async (Redis) perdrait sinon les
   * premiers messages (setBackplane appelle start en fire-and-forget).
   *
   * No-op si un backplane custom est déjà posé (instance config / service DI
   * `realtimeBackplane`, branché par `RealtimeService.initialize`). Warn fail-soft
   * si le driver déclaré est inconnu du registre.
   */
  async #wireBackplane(): Promise<void> {
    const config = this.get("realtimeConfig") as IRealtimeConfig | undefined;
    if (!config) return;
    const hub = getRealtimeHub();
    if (hub.backplane !== null) return; // custom (instance/DI) déjà branché

    const driverName = config.backplane.driver;
    const factory = getBackplaneDriver(driverName);
    if (!factory) {
      this.log(
        `backplane driver "${driverName}" inconnu du registre (disponibles : ${listBackplaneDrivers().join(", ")}) — RealtimeHub reste local`,
        "WARNING",
      );
      return;
    }
    const backplane = await factory({
      module: this,
      originId: String(process.pid),
      role: this.#clusterRole,
      config,
    });
    if (!backplane) return; // driver inactif ici (loopback, cluster hors worker…)
    await backplane.start();
    hub.setBackplane(backplane);
    this.log(
      `RealtimeHub: backplane "${driverName}" branché (${backplane.constructor.name})`,
      "INFO",
    );
  }

  /**
   * Branche les composants cluster du process en worker de `nodefony cluster` (repéré
   * par l'env `NODEFONY_CLUSTER=1` posée côté master) : le {@link ClusterBackplane}
   * (fan-out realtime cross-process) ET le {@link ClusterProbeClient} (sonde agrégée
   * pod, Phase 4c).
   *
   * No-op si rôle MASTER, mono-process, ou worker `staging`/`preprod` legacy. La sonde
   * est en plus gardée par `NODEFONY_CLUSTER_PROBE` (≠ "0") → **bypass total** quand
   * désactivée : pas de client, donc 0 timer / 0 listener / 0 IPC, et l'endpoint santé
   * sert la vue per-instance. Le backplane (realtime) reste indépendant de la sonde.
   * Idempotent.
   */
  #wireClusterProbe(role: "MASTER" | "WORKER"): void {
    if (role !== "WORKER" || process.env.NODEFONY_CLUSTER !== "1") return;
    // Sonde agrégée pod (Phase 4c) — opt-in, désactivable → bypass total
    // (0 client / 0 timer / 0 IPC quand off). Indépendante du backplane realtime,
    // qui est résolu par le registre de drivers à `onKernelBoot`.
    if (process.env.NODEFONY_CLUSTER_PROBE !== "0") {
      setClusterProbeClient(new ClusterProbeClient()).start(buildOwnHealth);
      this.log("RealtimeHub: ClusterProbeClient branché (sonde pod)", "INFO");
    }
  }
}

export default Realtime;
export { Realtime };

// Surface publique du module serveur (consommateurs userland).
export {
  RealtimeController,
  RealtimeHub,
  getRealtimeHub,
  SLOW_CONSUMER_BYTES,
  LoopbackBackplane,
  ClusterBackplane,
  RedisBackplane,
  createRedisServiceTransport,
  REDIS_RT_CHANNEL,
  registerBackplaneDriver,
  getBackplaneDriver,
  listBackplaneDrivers,
  processIpcTransport,
  ClusterProbeClient,
  setClusterProbeClient,
  processProbeTransport,
  clusterProbeHealth,
  clusterProbeRequestEnrich,
  clusterProbeInstance,
  mergeClusterHealth,
  WsConnectionTransport,
  createRealtimeAdminApi,
  buildRealtimeHealth,
  buildOwnHealth,
  RealtimeService,
};

export { RealtimeError } from "./nodefony/src/errors/RealtimeError";
export type { RealtimeConfig } from "./nodefony/config/config";

// Token anonyme (singleton gelé) — fallback Zero Trust quand aucun matcher capture.
export { ANONYMOUS_REALTIME_TOKEN } from "./nodefony/src/server/AnonymousRealtimeToken";

// Builder type-safe + JSON Schema (Bloc A étape 5).
export {
  defineRealtimeConfig,
  realtimeConfigJsonSchema,
} from "./nodefony/config/defineRealtimeConfig";
export type {
  IRealtimeConfig,
  IRealtimeConfigInput,
} from "./nodefony/config/defineRealtimeConfig";

// Décorateurs realtime (style déclaratif, NestJS-like) — P13 Bloc A étape 3.
export {
  RealtimeAction,
  RealtimeChannel,
  RealtimeInbound,
} from "./nodefony/decorators/realtimeDecorators";
export type { RealtimeChannelFactory } from "./nodefony/decorators/realtimeDecorators";

// Types publics
export type {
  IRealtimeController,
  RealtimePublish,
  RealtimeInboundHandler,
} from "./nodefony/interfaces/IRealtimeController";
export type {
  ChannelSink,
  ChannelFactory,
} from "./nodefony/src/server/RealtimeHub";
export type {
  IBackplane,
  IBackplaneMessage,
  BackplaneHandler,
} from "./nodefony/interfaces/IBackplane";
export type {
  IClusterBackplaneTransport,
  ClusterBackplaneEnvelope,
} from "./nodefony/src/backplane/ClusterBackplane";
export type {
  IRedisBackplaneTransport,
  IRedisPublisher,
  IRedisSubscriber,
} from "./nodefony/src/backplane/RedisBackplane";
export type {
  BackplaneFactory,
  IBackplaneFactoryContext,
} from "./nodefony/src/backplane/backplaneRegistry";
export type { IClusterProbeTransport } from "./nodefony/src/cluster/ClusterProbeClient";
export type { RawWsConnection } from "./nodefony/src/transport/WsConnectionTransport";
export type {
  IRealtimeProbe,
  IRealtimeHealth,
  IRealtimeClusterHealth,
  IRealtimeChannelStat,
  IRealtimeConnProbe,
} from "./nodefony/interfaces/IRealtimeProbe";

// Seam sécurité #2 — contrats handshake authenticators (P13 Bloc A étape 6).
export type { IRealtimeToken } from "./nodefony/interfaces/IRealtimeToken";
export type { IRealtimeHandshake } from "./nodefony/interfaces/IRealtimeHandshake";
export type { IRealtimeAuthenticator } from "./nodefony/interfaces/IRealtimeAuthenticator";
export type {
  IRealtimeAuthenticatorMatcher,
  ICompiledRealtimeMatcher,
} from "./nodefony/interfaces/IRealtimeAuthenticatorMatcher";
