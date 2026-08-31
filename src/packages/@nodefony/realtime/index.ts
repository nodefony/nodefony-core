/**
 * @nodefony/realtime — Couche realtime serveur Nodefony.
 *
 * Ce module porte le hub WebSocket (broker fan-out), le protocole JSON-RPC 2.0
 * (peer isomorphe partagé avec le client core) et le backplane cluster. Trois
 * drivers natifs : `loopback` (mono-process), `cluster` (IPC Node) et `redis`
 * (multi-hôte) ; le registre `backplaneRegistry` est ouvert aux drivers écrits
 * par l'application.
 *
 * Le wiring cluster (`onCluster` → branchement `ClusterBackplane` IPC +
 * `ClusterProbeClient`) vit dans le hook du Module class ci-dessous. Le client
 * isomorphe n'est PAS ici : il vit dans le cœur, subpath `nodefony/client`
 * (décision figée — pas de package navigateur).
 *
 * Lire `docs/index.md` pour la vue d'ensemble vulgarisée.
 *
 * Voir aussi :
 *  - CLAUDE.md  — décisions d'archi figées + 5 seams sécurité
 *  - MEMORY.md  — internals IA
 *  - README.md  — usage humain
 *  - docs/      — doc dev vulgarisée
 */
import { Kernel, Module, services, withTimeout } from "nodefony";
import defaultConfig from "./nodefony/config/config";
import {
  defineRealtimeConfig,
  realtimeConfigJsonSchema,
  type IRealtimeConfig,
  type IRealtimeConfigInput,
} from "./nodefony/config/defineModuleConfig";
import RealtimeService from "./nodefony/src/service/RealtimeService";

// Symboles serveur exportés (les surfaces consommateurs userland).
import RealtimeController from "./nodefony/src/server/RealtimeController";
import ServerRealtimeSocket, {
  serverSocket,
} from "./nodefony/src/server/ServerRealtimeSocket";
import RealtimeHub, {
  getRealtimeHub,
  SLOW_CONSUMER_BYTES,
  RESERVED_SYSTEM_PREFIXES,
  isReservedSystemChannel,
} from "./nodefony/src/server/RealtimeHub";
import LoopbackBackplane from "./nodefony/src/backplane/LoopbackBackplane";
import RedisBackplane, {
  createRedisServiceTransport,
  resolveRedisChannel,
  REDIS_RT_CHANNEL,
  type IRedisPublisher,
  type IRedisSubscriber,
} from "./nodefony/src/backplane/RedisBackplane";
import { resolveBackplaneOriginId } from "./nodefony/src/backplane/originId";
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
import type { IBackplane } from "./nodefony/interfaces/IBackplane";

/**
 * Délai max (ms) d'attente du `backplane.start()` au boot avant de basculer en
 * hub local (fail-soft). Garde anti-gel : un transport réseau qui pend ne doit
 * pas bloquer la montée des serveurs. Cf `Realtime.#startWithTimeout`.
 */
const BACKPLANE_START_TIMEOUT_MS = 5_000;

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
// `nodefony cluster`, repéré par NF_CLUSTER=1).
registerBackplaneDriver(ClusterBackplane.driver, (ctx) =>
  ctx.role === "WORKER" && process.env.NF_CLUSTER === "1"
    ? new ClusterBackplane(processIpcTransport, ctx.originId)
    : null,
);

// `redis` : fan-out cross-pod multi-host via pub/sub. Consomme les connexions
// `publish`/`subscribe` de `@nodefony/redis` (RedisService) — couplage structurel
// par l'adaptateur, aucune dépendance directe. Fail-soft si redis absent.
registerBackplaneDriver(RedisBackplane.driver, (ctx) => {
  const redisService = ctx.module.kernel?.container?.get("redis") as
    { getClient(name: string): unknown } | undefined;
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
  // Cloison multi-app sur Redis mutualisé (le `database` Redis ne cloisonne pas
  // le pub/sub) : canal suffixé par `backplane.namespace`, sinon dérivé du nom
  // d'app — deux apps distinctes n'échangent jamais leurs fan-outs.
  const namespace =
    ctx.config.backplane.namespace ?? ctx.module.kernel?.projectName;
  // Authenticité du bus PARTAGÉ (F83). Redis pub/sub n'authentifie pas l'émetteur :
  // sans secret, une écriture tierce dans ce Redis se diffuse à tous les pods. On
  // ne REFUSE pas de démarrer (le fan-out cross-pod resterait cassé sur toute app
  // déjà déployée), mais la dégradation est ANNONCÉE — jamais silencieuse.
  const secret = ctx.config.backplane.secret ?? null;
  if (!secret) {
    ctx.module.log(
      `driver "${RedisBackplane.driver}" : bus NON AUTHENTIFIÉ — les messages ne ` +
        `sont pas scellés. Quiconque écrit dans ce Redis publie sur les canaux de ` +
        `tous les pods. Poser backplane.secret (ou NF_REALTIME_BACKPLANE_SECRET, ` +
        `≥ 32 caractères, identique sur tous les pods) pour sceller le transport.`,
      "WARNING",
    );
  }
  return new RedisBackplane(
    createRedisServiceTransport(publisher, subscriber),
    ctx.originId,
    resolveRedisChannel(namespace),
    secret,
    {
      // Borne mémoire des publications en vol + annonce des transitions : une
      // saturation du bus sacrifie du fan-out cross-pod, ça se dit dans les logs
      // du module (cf principe « pas de dégradation silencieuse »).
      maxQueueBytes: ctx.config.backplane.maxQueueBytes,
      onNotice: (message, severity) => ctx.module.log(message, severity),
    },
  );
});

// Augmente le registre de config des modules → `use("@nodefony/realtime", { … })`
// propose les clés typées en complétion, et REFUSE une clé inconnue. Sans cette
// déclaration, `use()` retombe sur `Record<string, unknown>` : une clé mal
// orthographiée est retirée par Zod au boot, sans un mot.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/realtime": IRealtimeConfigInput;
  }
}

@services([RealtimeService])
class Realtime extends Module<IRealtimeConfig> {
  /** Module optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  /** Rôle topologique du process, capté à `onCluster` (défaut mono-process). */
  #clusterRole: "MASTER" | "WORKER" | "MONO" = "MONO";

  constructor(kernel: Kernel) {
    super("realtime", kernel, import.meta.url, defaultConfig);
    // Le kernel annonce le rôle cluster via `onCluster` (émis en preRegister,
    // avant onRegister). `once` = 1 fire / process, listener boot-time (0 coût
    // par requête). On capte le rôle (consommé par la sélection de backplane à
    // `onKernelBoot`) et on branche la sonde pod. Le backplane lui-même est
    // résolu via le registre de drivers (cf #wireBackplane) — pas ici.
    // On CAPTE seulement le rôle ici (onCluster = preRegister, AVANT que la config
    // validée soit posée à `onKernelRegister`). Le branchement de la sonde est
    // différé à `onKernelBoot` — sinon `cluster.probe.enabled` serait illisible
    // (config absente à ce stade) → champ mort.
    kernel.once("onCluster", (role: "MASTER" | "WORKER") => {
      this.#clusterRole = role;
    });
  }

  /** JSON Schema de la config realtime → data plane admin (config riche Studio). */
  override configSchema(): unknown {
    return realtimeConfigJsonSchema();
  }

  /**
   * Validation Zod de la config racine merge au boot (convention figée 2026-05-28,
   * cf [[feedback_config_validation_zod]]) — via le builder `defineRealtimeConfig`
   * (source unique `nodefony/config/config.ts`). Plante propre avec messages clairs
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
      throw new Error(`[@nodefony/realtime] Invalid config: ${issues}`, {
        cause: e,
      });
    }
    // Config validée exposée via this.options → `this.config` (accès uniforme
    // typé). Le RealtimeService la lit sur son module (`this.module.config`).
    this.options = validated;
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
    // `enabled: false` → module inerte : ni API admin, ni backplane, ni sonde pod.
    // Cf `realtimeConfigSchema.enabled` (registry chargé, mais 0 listener actif).
    const cfg = this.config;
    if (!cfg.enabled) {
      this.log(
        "realtime enabled:false → boot inerte (ni admin API ni backplane ni sonde)",
        "INFO",
      );
      return this;
    }
    const broker = this.kernel?.container?.get("adminBroker") as
      IAdminBroker | undefined;
    if (broker && !broker.has("realtime")) {
      broker.register(createRealtimeAdminApi());
    }
    await this.#wireBackplane();
    // Sonde pod (cluster worker) — différée ici pour lire `cluster.probe.enabled`
    // (config indisponible dans le callback `onCluster` du constructeur).
    this.#wireClusterProbe(this.#clusterRole);
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
    const config = this.config;
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
      // Unique cross-pod (NF_POD_NAME/hostname + pid) — un PID nu est namespacé
      // par conteneur (2 pods k8s = PID 1) et ferait avaler le fan-out par
      // l'anti-écho. Cf resolveBackplaneOriginId.
      originId: resolveBackplaneOriginId(),
      role: this.#clusterRole,
      config,
    });
    if (!backplane) {
      // Driver inactif ici (loopback, cluster hors worker, fallback fail-soft) →
      // hub local. Une ligne claire au boot quand même (carte d'identité).
      this.log(
        `realtime backplane  driver=${driverName} kind=local cross-pod=no (hub local)`,
        "INFO",
      );
      return;
    }
    try {
      await this.#startWithTimeout(backplane, BACKPLANE_START_TIMEOUT_MS);
    } catch (e) {
      // Échec / timeout du transport (Redis injoignable, file offline qui pend,
      // Kafka down…) → on NE branche PAS le backplane : le hub reste LOCAL et le
      // boot continue (fail-soft). Sans cette garde, un `await start()` qui pend
      // gèle `onKernelBoot` → `onReady`/`initServers` ne fire jamais → les 4
      // serveurs ne montent pas (cf KIT résilience de boot, Phase 2).
      this.log(
        `realtime backplane driver=${driverName} indisponible ` +
          `(${(e as Error).message}) — fallback hub LOCAL, boot poursuivi ` +
          `(pas de fan-out cross-pod)`,
        "WARNING",
      );
      return;
    }
    hub.setBackplane(backplane);
    const info = backplane.describe();
    this.log(
      `realtime backplane  driver=${info.driver} kind=${info.kind} ` +
        `origin=${info.originId} cross-pod=${info.crossPod ? "yes" : "no"}` +
        (info.channel ? ` channel=${info.channel}` : ""),
      "INFO",
    );
  }

  /**
   * `backplane.start()` borné par un **timeout** — un driver réseau (Redis/Kafka)
   * dont la connexion pend (serveur injoignable, file offline node-redis) ne doit
   * jamais geler le boot.
   *
   * Délègue la garde au util générique du core {@link withTimeout} (timer `unref`
   * + cleanup `finally` + filet anti-`unhandledRejection` si `start()` rejette
   * après que le timeout a gagné la course). Spécificité realtime conservée ici :
   * au timeout/échec, un `stop()` **best-effort** pour ne pas laisser une
   * connexion à demi-ouverte derrière.
   *
   * @param backplane - driver à démarrer.
   * @param ms - délai max avant de considérer le `start()` en échec.
   * @throws si `start()` rejette ou dépasse `ms`.
   */
  async #startWithTimeout(backplane: IBackplane, ms: number): Promise<void> {
    try {
      await withTimeout(
        Promise.resolve(backplane.start()),
        ms,
        "realtime backplane start",
      );
    } catch (e) {
      void Promise.resolve(backplane.stop()).catch(() => {});
      throw e;
    }
  }

  /**
   * Branche les composants cluster du process en worker de `nodefony cluster` (repéré
   * par l'env `NF_CLUSTER=1` posée côté master) : le {@link ClusterBackplane}
   * (fan-out realtime cross-process) ET le {@link ClusterProbeClient} (sonde agrégée
   * pod, Phase 4c).
   *
   * No-op si rôle MASTER, mono-process, ou worker `staging`/`preprod` legacy. La sonde
   * est en plus gardée par `NF_CLUSTER_PROBE` (≠ "0") → **bypass total** quand
   * désactivée : pas de client, donc 0 timer / 0 listener / 0 IPC, et l'endpoint santé
   * sert la vue per-instance. Le backplane (realtime) reste indépendant de la sonde.
   * Idempotent.
   */
  #wireClusterProbe(role: "MASTER" | "WORKER" | "MONO"): void {
    if (role !== "WORKER" || process.env.NF_CLUSTER !== "1") return;
    // Sonde agrégée pod (Phase 4c) — opt-in, désactivable → bypass total
    // (0 client / 0 timer / 0 IPC quand off). Indépendante du backplane realtime,
    // qui est résolu par le registre de drivers à `onKernelBoot`.
    // Deux leviers de coupure : la config `cluster.probe.enabled` ET l'override
    // env `NF_CLUSTER_PROBE=0` — l'un OU l'autre à false suffit.
    const probeEnabled = this.config.cluster.probe.enabled;
    if (probeEnabled && process.env.NF_CLUSTER_PROBE !== "0") {
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
  ServerRealtimeSocket,
  serverSocket,
  RealtimeHub,
  getRealtimeHub,
  SLOW_CONSUMER_BYTES,
  RESERVED_SYSTEM_PREFIXES,
  isReservedSystemChannel,
  LoopbackBackplane,
  ClusterBackplane,
  RedisBackplane,
  createRedisServiceTransport,
  resolveRedisChannel,
  resolveBackplaneOriginId,
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
} from "./nodefony/config/defineModuleConfig";
export type {
  IRealtimeConfig,
  IRealtimeConfigInput,
} from "./nodefony/config/defineModuleConfig";

// Décorateurs realtime (style déclaratif, NestJS-like) — P13 Bloc A étape 3.
export {
  RealtimeAction,
  RealtimeBroadcast,
  RealtimeChannel,
  RealtimeInbound,
  getDeclaredBroadcastPrefixes,
} from "./nodefony/decorators/realtimeDecorators";
export type { RealtimeChannelFactory } from "./nodefony/decorators/realtimeDecorators";

// Types publics
export type {
  IRealtimeController,
  RealtimePublish,
  RealtimeInboundHandler,
} from "./nodefony/interfaces/IRealtimeController";
export type { IChannelPolicy } from "./nodefony/interfaces/IChannelPolicy";
export type { IClientLogsLimits } from "./nodefony/interfaces/IClientLogsLimits";
// Réception des journaux du navigateur (#35). La plateforme déclare le canal
// elle-même quand la config l'ouvre ; la fabrique reste exportée pour qu'une
// application puisse le porter sur un endpoint à elle, avec d'autres bornes.
export {
  createSyslogUplinkHandler,
  BROWSER_ORIGIN,
  MAX_CLIENT_SEVERITY,
} from "./nodefony/src/server/syslogUplink";
export type {
  SyslogUplinkHandlerOptions,
  ClientSeverity,
} from "./nodefony/src/server/syslogUplink";
export type {
  ChannelSink,
  ChannelFactory,
} from "./nodefony/src/server/RealtimeHub";
export type {
  IBackplane,
  IBackplaneMessage,
  BackplaneHandler,
  IBackplaneInfo,
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
