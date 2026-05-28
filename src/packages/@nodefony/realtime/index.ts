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
import { Kernel, Module } from "nodefony";
import defaultConfig from "./nodefony/config/config";
import { realtimeConfigSchema } from "./nodefony/config/schema";

// Symboles serveur exportés (les surfaces consommateurs userland).
import RealtimeController from "./nodefony/src/server/RealtimeController";
import RealtimeHub, {
  getRealtimeHub,
  SLOW_CONSUMER_BYTES,
} from "./nodefony/src/server/RealtimeHub";
import LoopbackBackplane from "./nodefony/src/backplane/LoopbackBackplane";
import ClusterBackplane, {
  processIpcTransport,
} from "./nodefony/src/backplane/ClusterBackplane";
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

class Realtime extends Module {
  constructor(kernel: Kernel) {
    super("realtime", kernel, import.meta.url, defaultConfig);
    // Backplane cross-process : le kernel annonce le rôle cluster via `onCluster`
    // (émis en preRegister, avant onRegister). `once` = 1 seul fire / process, listener
    // boot-time (pas de coût par requête). En worker de cluster → branche le
    // ClusterBackplane IPC sur le hub ; sinon no-op (mono-process reste Loopback).
    kernel.once("onCluster", (role: "MASTER" | "WORKER") =>
      this.#wireCluster(role),
    );
  }

  /**
   * Validation Zod de la config racine merge au boot (convention figée 2026-05-28,
   * cf [[feedback_config_validation_zod]]). Plante propre avec messages clairs si
   * la config (defaults + module.options) n'est pas conforme au schéma — évite tous
   * les `undefined.x` silencieux en runtime.
   */
  override async onKernelRegister(): Promise<this> {
    const parsed = realtimeConfigSchema.safeParse(this.options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join(" · ");
      throw new Error(`[@nodefony/realtime] Invalid config: ${issues}`);
    }
    return this;
  }

  /**
   * Phase `onReady` (après le boot de tous les modules) : enregistre le producteur
   * admin de la **socket Nodefony** (`/nodefony/realtime/api/*`) si le broker
   * `framework/AdminBroker` est dispo. Auto-observabilité du `RealtimeHub`.
   */
  override async onKernelReady(): Promise<this> {
    const broker = this.kernel?.container?.get("adminBroker") as
      | IAdminBroker
      | undefined;
    if (broker && !broker.has("realtime")) {
      broker.register(createRealtimeAdminApi());
    }
    return this;
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
  #wireCluster(role: "MASTER" | "WORKER"): void {
    if (role !== "WORKER" || process.env.NODEFONY_CLUSTER !== "1") return;
    const hub = getRealtimeHub();
    if (hub.backplane === null) {
      hub.setBackplane(
        new ClusterBackplane(processIpcTransport, String(process.pid)),
      );
      this.log(
        "RealtimeHub: ClusterBackplane IPC branché (worker cluster)",
        "INFO",
      );
    }
    // Sonde agrégée pod (Phase 4c) — opt-in, désactivable → bypass total.
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
};

export { RealtimeError } from "./nodefony/src/errors/RealtimeError";
export type { RealtimeConfig } from "./nodefony/config/config";

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
export type { IClusterProbeTransport } from "./nodefony/src/cluster/ClusterProbeClient";
export type { RawWsConnection } from "./nodefony/src/transport/WsConnectionTransport";
export type {
  IRealtimeProbe,
  IRealtimeHealth,
  IRealtimeClusterHealth,
  IRealtimeChannelStat,
  IRealtimeConnProbe,
} from "./nodefony/interfaces/IRealtimeProbe";
