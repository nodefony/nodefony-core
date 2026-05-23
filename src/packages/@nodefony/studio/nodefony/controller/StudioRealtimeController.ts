/// <reference types="node" />
import { Controller, route, controller } from "@nodefony/framework";
import type { IAdminBroker } from "@nodefony/framework";
import { Context, WebsocketContext } from "@nodefony/http";
import type { IAdminRequest } from "nodefony";
import {
  createSyslogBridge,
  createStatsTicker,
  createBrokerTicker,
  readGitBranch,
  CHANNELS,
  type AppMeta,
  type Publish,
} from "../realtime/providers";

/** État pub/sub par connexion, stocké sur le contexte (persiste entre messages). */
interface RealtimeConnState {
  welcomed: boolean;
  /** canal → dispose() du provider actif. */
  channels: Map<string, () => void>;
}

/**
 * StudioRealtimeController — endpoint WebSocket temps réel permanent de Studio.
 *
 * Route : `WS /nodefony/studio/api/realtime`. Protocole : **JSON-RPC 2.0**.
 *  - notifications serveur→client : `{ jsonrpc:"2.0", method:<channel>, params }` (push).
 *  - notifications client→serveur : `subscribe` / `unsubscribe` `{ channel }`, `ping`.
 *
 * **Pub/sub par canal** : le serveur ne pousse un canal QUE si le client s'y est abonné,
 * et arrête (dispose) dès qu'il se désabonne. → changer de page côté front = `unsubscribe`
 * du canal quitté, le WS reste ouvert. C'est le modèle exact de `RealtimeService` (P13.4).
 *
 * ── FORWARD-COMPAT P13.4 (migration locale, frontend inchangé) ──
 *  - Providers (`createSyslogBridge` / `createStatsTicker`) transport-agnostiques (`publish`).
 *  - Demain : ce controller disparaît ; les mêmes providers + le routage subscribe/unsubscribe
 *    + l'enveloppe JSON-RPC vivent dans `RealtimeService` (fan-out multi-clients). Canaux figés.
 *
 * ── Perf (règle ABSOLUE) ──
 *  - 1 provider = 1 listener/interval, démarré à `subscribe`, `dispose()` à `unsubscribe` ET
 *    à `onFinish` (close WS, AsyncResource-bound). `setInterval` unref.
 */
@controller("/nodefony/studio/api")
class StudioRealtimeController extends Controller {
  constructor(context: Context) {
    super("StudioRealtimeController", context);
  }

  @route("studio-ws-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    const ctx = this.context as WebsocketContext | undefined;
    if (!ctx) return;
    if (message == null) {
      this.onHandshake(ctx);
      return;
    }
    this.handleRpc(ctx, message.toString());
  }

  /** Handshake : welcome + cleanup global. Aucun canal poussé tant que pas de `subscribe`. */
  private onHandshake(ctx: WebsocketContext): void {
    const state = this.connState(ctx);
    if (state.welcomed) return;
    state.welcomed = true;

    ctx.once?.("onFinish", () => {
      for (const dispose of state.channels.values()) {
        try {
          dispose();
        } catch {
          /* noop */
        }
      }
      state.channels.clear();
      this.log("WS realtime client disconnected — cleanup done", "INFO");
    });

    this.publish(ctx, "realtime:welcome", {
      ts: Date.now(),
      protocol: "jsonrpc-2.0",
      channels: Object.values(CHANNELS),
    });
    this.log("WS realtime client connected", "INFO");
  }

  /** Route les messages JSON-RPC : notifications subscribe/unsubscribe/ping (pub/sub),
   *  ou requête `id` → `dispatchRequest` (actions, réponse `result`/`error`). */
  private handleRpc(ctx: WebsocketContext, raw: string): void {
    let msg: {
      jsonrpc?: unknown;
      id?: unknown;
      method?: unknown;
      params?: { channel?: string } & Record<string, unknown>;
    } | null = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return;

    // Le RÔLE d'une frame se lit sur `method`, PAS sur `id` : une RÉPONSE (id, sans
    // method) ne doit JAMAIS entrer dans le dispatch d'actions (sinon on lui
    // renverrait `-32601`). `id` autorisé string OU number (JSON-RPC 2.0 §id).
    const id = msg.id;
    const hasId = typeof id === "number" || typeof id === "string";
    const method = typeof msg.method === "string" ? msg.method : undefined;

    // Frame AVEC `method` = appel ENTRANT (le client/un pair nous appelle).
    if (method !== undefined) {
      if (hasId) {
        // Requête → attend une réponse `result`/`error` : direction ACTIONS.
        this.dispatchRequest(ctx, id as number | string, method, msg.params);
        return;
      }
      // Notifications (pas d'`id`) — pub/sub + heartbeat. Chemin chaud, sync.
      if (method === "subscribe") this.startChannel(ctx, msg.params?.channel);
      else if (method === "unsubscribe")
        this.stopChannel(ctx, msg.params?.channel);
      // `ping` = heartbeat no-op ; notification inconnue = ignorée (spec JSON-RPC :
      // pas de réponse à une notification).
      return;
    }

    // Frame SANS `method` mais AVEC `id` = RÉPONSE à une requête que le SERVEUR
    // aurait initiée (serveur→client). Pas encore d'initiateur côté serveur → on
    // l'ignore proprement (NE PAS répondre `-32601`). Brancher une `pending` map
    // ici le jour où le serveur appellera le client (bidirectionnel complet).
    void hasId; // frame sans method (réponse/erreur globale/invalide) → ignorée
  }

  /**
   * Dispatch d'une requête JSON-RPC 2.0 (action de contrôle, attend un `result`).
   *
   * Renvoie le résultat (ou l'erreur) sur la connexion avec le MÊME `id` — c'est
   * la `Promise` que résout `RealtimeClient.request()` côté navigateur. Un handler
   * peut être sync ou async (normalisé en `Promise`). Méthode inconnue → `-32601` ;
   * handler qui throw → `-32603` avec un message GÉNÉRIQUE (le détail reste serveur,
   * loggé — pas de fuite d'info au client, Zero Trust).
   *
   * Forward-compat P13.4 : ce routeur + ces actions migreront tels quels dans
   * `RealtimeService` (même enveloppe JSON-RPC, fan-out multi-clients).
   */
  private dispatchRequest(
    ctx: WebsocketContext,
    id: number | string,
    method: string | undefined,
    params: Record<string, unknown> | undefined,
  ): void {
    let result: unknown;
    switch (method) {
      case "kernel:ping":
        result = this.actionPing();
        break;
      case "kernel:gc":
        result = this.actionGc();
        break;
      default:
        this.send(ctx, {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${method ?? ""}` },
        });
        return;
    }
    void params; // réservé aux actions paramétrées (ex. orm:flow:reset {connector})
    Promise.resolve(result).then(
      (r) => this.send(ctx, { jsonrpc: "2.0", id, result: r }),
      (err: unknown) => {
        this.log(
          `RPC ${method} failed: ${err instanceof Error ? err.message : String(err)}`,
          "ERROR",
        );
        this.send(ctx, {
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: "internal error" },
        });
      },
    );
  }

  /**
   * Action `kernel:ping` — liveness + round-trip. Renvoie un `result` minimal :
   * le client mesure la latence WS (RTT) et confirme que la direction
   * requête→réponse fonctionne. Lecture pure, aucun effet de bord.
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
   * Action `kernel:gc` — force un cycle de garbage collection V8 SI le process a
   * été lancé avec `--expose-gc` (`global.gc`). Renvoie le delta heap (avant/après)
   * pour un futur bouton « Force GC » de la supervision. `available:false` sinon
   * (aucun crash, dégradation gracieuse). Action de CONTRÔLE à effet réel.
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

  /** Démarre le provider d'un canal (idempotent). */
  private startChannel(ctx: WebsocketContext, channel?: string): void {
    if (!channel) return;
    const state = this.connState(ctx);
    if (state.channels.has(channel)) return; // déjà actif sur cette connexion
    const publish: Publish = (ch, payload) => this.publish(ctx, ch, payload);
    let dispose: (() => void) | null = null;
    // Base « stats process » : le canal supervision (page) ET le canal dédié à la
    // debug bar partagent le MÊME ticker (sondes process), mais sur des canaux
    // SÉPARÉS → la barre ne maintient pas le canal supervision actif.
    const statsBase =
      channel === CHANNELS.supervision ||
      channel.startsWith(`${CHANNELS.supervision}:`)
        ? CHANNELS.supervision
        : channel === CHANNELS.debugbar ||
            channel.startsWith(`${CHANNELS.debugbar}:`)
          ? CHANNELS.debugbar
          : null;
    if (channel === CHANNELS.syslog && this.syslog) {
      dispose = createSyslogBridge(this.syslog, publish);
    } else if (statsBase) {
      // Granularité pilotée par le client via le suffixe `:<ms>` (borné 250 ms–60 s).
      // Défaut 1 s pour le canal nu. Publie sur le canal EXACT souscrit.
      const ms =
        channel === statsBase
          ? 1000
          : Math.min(
              60000,
              Math.max(
                250,
                parseInt(channel.slice(statsBase.length + 1), 10) || 1000,
              ),
            );
      // Le canal supervision compte les erreurs CÔTÉ SERVEUR (syslog passé) →
      // pas besoin d'abonner le dashboard à syslog:stream. La debug bar non.
      const sysForErrors =
        statsBase === CHANNELS.supervision ? this.syslog : undefined;
      dispose = createStatsTicker(
        publish,
        ms,
        this.appMeta(),
        channel,
        sysForErrors ?? undefined,
      );
    } else if (
      channel === CHANNELS.ormHealth ||
      channel.startsWith(`${CHANNELS.ormHealth}:`)
    ) {
      // Granularité pilotée par le client via le suffixe `orm:health:<ms>`
      // (borné 1–60 s). Défaut 5 s pour le canal nu. Publie sur le canal souscrit.
      const ms =
        channel === CHANNELS.ormHealth
          ? 5000
          : Math.min(
              60000,
              Math.max(
                1000,
                parseInt(channel.slice(CHANNELS.ormHealth.length + 1), 10) ||
                  5000,
              ),
            );
      dispose = createBrokerTicker(
        () => this.fetchOrmHealth(),
        publish,
        channel,
        ms,
      );
    } else if (
      channel === CHANNELS.ormFlow ||
      channel.startsWith(`${CHANNELS.ormFlow}:`)
    ) {
      // Flux ORM : plus dynamique que la santé → défaut 2 s (borné 500 ms–60 s).
      const ms =
        channel === CHANNELS.ormFlow
          ? 2000
          : Math.min(
              60000,
              Math.max(
                500,
                parseInt(channel.slice(CHANNELS.ormFlow.length + 1), 10) ||
                  2000,
              ),
            );
      dispose = createBrokerTicker(
        () => this.fetchOrmFlow(),
        publish,
        channel,
        ms,
      );
    }
    if (dispose) {
      state.channels.set(channel, dispose);
      this.log(`WS subscribe → ${channel}`, "DEBUG");
    }
  }

  /** Arrête le provider d'un canal. */
  private stopChannel(ctx: WebsocketContext, channel?: string): void {
    if (!channel) return;
    const state = this.connState(ctx);
    const dispose = state.channels.get(channel);
    if (dispose) {
      try {
        dispose();
      } catch {
        /* noop */
      }
      state.channels.delete(channel);
      this.log(`WS unsubscribe → ${channel}`, "DEBUG");
    }
  }

  /**
   * Produit le diagnostic ORM pour le canal `orm:health` en invoquant l'endpoint
   * admin `orm/connection/health` **via le broker** (Studio reste générique : pas
   * de dép directe à orm-core). `null` si l'ORM n'est pas monté.
   */
  private async fetchOrmHealth(): Promise<unknown> {
    const broker = this.get<IAdminBroker>("adminBroker");
    const orm = broker?.list().find((p) => p.adminNamespace === "orm");
    const ep = orm
      ?.adminEndpoints()
      .find((e) => e.path === "connection/health");
    if (!ep) return null;
    return ep.handler({
      params: {},
      query: {},
      body: null,
      user: null,
      roles: [],
    } as IAdminRequest);
  }

  /**
   * Produit le flux ORM pour le canal `orm:flow` en invoquant l'endpoint admin
   * `orm/flow` **via le broker** (Studio reste générique). `null` si non monté.
   */
  private async fetchOrmFlow(): Promise<unknown> {
    const broker = this.get<IAdminBroker>("adminBroker");
    const orm = broker?.list().find((p) => p.adminNamespace === "orm");
    const ep = orm?.adminEndpoints().find((e) => e.path === "flow");
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

  /** Lit/initialise l'état pub/sub stocké sur le contexte (persiste entre messages WS). */
  private connState(ctx: WebsocketContext): RealtimeConnState {
    const holder = ctx as unknown as { __studioRealtime?: RealtimeConnState };
    if (!holder.__studioRealtime) {
      holder.__studioRealtime = { welcomed: false, channels: new Map() };
    }
    return holder.__studioRealtime;
  }

  /**
   * Push sur la connexion ws BRUTE. Après le handshake `requestEnded=true` → `ctx.send()`
   * rejette ; on streame donc directement sur le socket `ws` (garde `readyState === 1`).
   */
  private publish(
    ctx: WebsocketContext,
    channel: string,
    payload: unknown,
  ): void {
    this.send(ctx, { jsonrpc: "2.0", method: channel, params: payload });
  }

  private send(ctx: WebsocketContext, obj: unknown): void {
    const conn = ctx.connection;
    try {
      if (conn && conn.readyState === 1 /* ws OPEN */) {
        conn.send(JSON.stringify(obj), () => {
          /* swallow send error (socket fermée) */
        });
      }
    } catch {
      /* socket fermée */
    }
  }
}

export default StudioRealtimeController;
