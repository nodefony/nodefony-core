/// <reference types="node" />
import { RealtimeController, route, controller } from "@nodefony/framework";
import type { IAdminBroker, RealtimePublish } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { IAdminRequest, RpcActionHandler, RateBounds } from "nodefony";
import { parseRate } from "nodefony";
import {
  createSyslogBridge,
  createStatsTicker,
  createBrokerTicker,
  readGitBranch,
  CHANNELS,
  type AppMeta,
} from "../realtime/providers";

/**
 * Bornes de cadence par canal cadencé — défaut + min/max (ms). Convention partagée avec
 * le front via {@link rateChannel}/{@link parseRate} (module isomorphe `nodefony`).
 */
const RATE_BOUNDS: Readonly<Record<string, RateBounds>> = {
  // Stats process (supervision page ET debug bar) : même ticker, canaux séparés.
  stats: { default: 1000, min: 250, max: 60000 },
  ormHealth: { default: 5000, min: 1000, max: 60000 },
  // Flux ORM : plus dynamique → défaut 2 s.
  ormFlow: { default: 2000, min: 500, max: 60000 },
};

/**
 * StudioRealtimeController — endpoint WebSocket temps réel permanent de Studio.
 *
 * Route : `WS /nodefony/studio/api/realtime`. Protocole : **JSON-RPC 2.0**.
 *
 * Dérive de {@link RealtimeController} (framework) : TOUT le protocole (handshake,
 * discrimination request/notification/response via `JsonRpcPeer`, actions, pub/sub
 * par canal, cleanup, perf) est porté par la base. Ce contrôleur ne déclare QUE son
 * métier : ses **canaux** ({@link createRealtimeChannel}) et ses **actions**
 * ({@link realtimeActions}).
 *
 * ── Canaux (pub/sub on-demand) ──
 *  - `syslog:stream` (Pdu kernel), `dashboard:stats`/`dashboard:supervision`,
 *    `debugbar:stats`, `orm:health`, `orm:flow` (suffixe `:<ms>` = granularité).
 * ── Actions (requête→réponse) ──
 *  - `kernel:ping` (liveness/RTT), `kernel:gc` (force GC si `--expose-gc`).
 *
 * Forward-compat P13.4 : la base + ces providers migrent dans `RealtimeService`.
 */
@controller("/nodefony/studio/api")
class StudioRealtimeController extends RealtimeController {
  constructor(context: Context) {
    super("StudioRealtimeController", context);
  }

  @route("studio-ws-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /** Canaux annoncés au handshake. */
  protected override realtimeChannels(): string[] {
    return Object.values(CHANNELS);
  }

  /** Actions RPC (requête→réponse, direction contrôle). */
  protected override realtimeActions(): Record<string, RpcActionHandler> {
    return {
      "kernel:ping": () => this.actionPing(),
      "kernel:gc": () => this.actionGc(),
    };
  }

  /**
   * Crée le provider d'un canal au `subscribe`. Le suffixe `:<ms>` (borné) pilote la
   * granularité. Renvoie le `dispose` (la base l'appelle au `unsubscribe` ET au close)
   * ou `null` si le canal est inconnu.
   */
  createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    // Base « stats process » : supervision (page) ET debug bar partagent le MÊME
    // ticker (sondes process) mais sur des canaux SÉPARÉS.
    const statsBase =
      channel === CHANNELS.supervision ||
      channel.startsWith(`${CHANNELS.supervision}:`)
        ? CHANNELS.supervision
        : channel === CHANNELS.debugbar ||
            channel.startsWith(`${CHANNELS.debugbar}:`)
          ? CHANNELS.debugbar
          : null;

    if (channel === CHANNELS.syslog && this.syslog) {
      return createSyslogBridge(this.syslog, publish);
    }
    if (statsBase) {
      // Granularité client via suffixe `:<ms>` (borné 250 ms–60 s). Défaut 1 s.
      const ms = parseRate(channel, statsBase, RATE_BOUNDS.stats);
      // La supervision compte les erreurs CÔTÉ SERVEUR (syslog passé) → pas besoin
      // d'abonner le dashboard à syslog:stream. La debug bar non.
      const sysForErrors =
        statsBase === CHANNELS.supervision ? this.syslog : undefined;
      return createStatsTicker(
        publish,
        ms,
        this.appMeta(),
        channel,
        sysForErrors ?? undefined,
      );
    }
    if (
      channel === CHANNELS.ormHealth ||
      channel.startsWith(`${CHANNELS.ormHealth}:`)
    ) {
      // Granularité `orm:health:<ms>` (borné 1–60 s). Défaut 5 s.
      const ms = parseRate(channel, CHANNELS.ormHealth, RATE_BOUNDS.ormHealth);
      // Broker capturé À LA CRÉATION (singleton long-lived) : le provider est PARTAGÉ
      // par le hub et survit à la connexion qui l'a créé — ne JAMAIS capturer `this`.
      const broker = this.get<IAdminBroker>("adminBroker");
      return createBrokerTicker(
        () =>
          StudioRealtimeController.fetchOrmEndpoint(
            broker,
            "connection/health",
          ),
        publish,
        channel,
        ms,
      );
    }
    if (
      channel === CHANNELS.ormFlow ||
      channel.startsWith(`${CHANNELS.ormFlow}:`)
    ) {
      // Flux ORM : plus dynamique → défaut 2 s (borné 500 ms–60 s).
      const ms = parseRate(channel, CHANNELS.ormFlow, RATE_BOUNDS.ormFlow);
      const broker = this.get<IAdminBroker>("adminBroker");
      return createBrokerTicker(
        () => StudioRealtimeController.fetchOrmEndpoint(broker, "flow"),
        publish,
        channel,
        ms,
      );
    }
    return null;
  }

  /**
   * Action `kernel:ping` — liveness + round-trip (le client mesure le RTT). Lecture
   * pure, aucun effet de bord.
   */
  private actionPing(): {
    pong: true;
    ts: number;
    uptime: number;
    pid: number;
    version?: string;
  } {
    return {
      pong: true,
      ts: Date.now(),
      uptime: process.uptime(),
      pid: process.pid,
      version: this.kernel?.version,
    };
  }

  /**
   * Action `kernel:gc` — force un cycle GC V8 si lancé avec `--expose-gc`. Renvoie le
   * delta heap (futur bouton « Force GC »). `available:false` sinon (dégradation gracieuse).
   */
  private actionGc(): {
    available: boolean;
    before?: number;
    after?: number;
    freed?: number;
  } {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc !== "function") return { available: false };
    const before = process.memoryUsage().heapUsed;
    gc();
    const after = process.memoryUsage().heapUsed;
    return { available: true, before, after, freed: before - after };
  }

  /**
   * Appelle un endpoint admin du namespace `orm` via le broker (`orm/connection/health`,
   * `orm/flow`…) — Studio reste générique (pas de dép directe à orm-core). `null` si absent.
   *
   * **Statique** + `broker` en paramètre : appelé depuis un provider de canal PARTAGÉ (hub),
   * qui doit capturer le broker (singleton long-lived) à la création, JAMAIS `this` (la
   * connexion créatrice peut fermer alors que le provider partagé survit).
   */
  private static async fetchOrmEndpoint(
    broker: IAdminBroker | null | undefined,
    path: string,
  ): Promise<unknown> {
    const orm = broker?.list().find((p) => p.adminNamespace === "orm");
    const ep = orm?.adminEndpoints().find((e) => e.path === path);
    if (!ep) return null;
    return ep.handler({
      params: {},
      query: {},
      body: null,
      user: null,
      roles: [],
    } as IAdminRequest);
  }

  /** Métadonnées app statiques (env, branche git, version) pour `dashboard:supervision`. */
  private appMeta(): AppMeta {
    const k = this.kernel;
    return {
      name: k?.projectName,
      version: k?.version,
      env: k?.environment,
      debug: Boolean(k?.debug),
      branch: readGitBranch(),
    };
  }
}

export default StudioRealtimeController;
