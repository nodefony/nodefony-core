/// <reference types="node" />
import { Controller, route, controller } from "@nodefony/framework";
import { Context, WebsocketContext } from "@nodefony/http";
import {
  createSyslogBridge,
  createStatsTicker,
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

  /** Route les messages JSON-RPC : subscribe / unsubscribe / ping ; requête id → not found. */
  private handleRpc(ctx: WebsocketContext, raw: string): void {
    let msg: { id?: unknown; method?: string; params?: { channel?: string } } | null = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.method === "subscribe") {
      this.startChannel(ctx, msg.params?.channel);
      return;
    }
    if (msg.method === "unsubscribe") {
      this.stopChannel(ctx, msg.params?.channel);
      return;
    }
    if (msg.method === "ping") return; // heartbeat

    if ("id" in msg && typeof msg.id === "number") {
      this.send(ctx, {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `method not found: ${msg.method ?? ""}` },
      });
    }
  }

  /** Démarre le provider d'un canal (idempotent). */
  private startChannel(ctx: WebsocketContext, channel?: string): void {
    if (!channel) return;
    const state = this.connState(ctx);
    if (state.channels.has(channel)) return; // déjà actif sur cette connexion
    const publish: Publish = (ch, payload) => this.publish(ctx, ch, payload);
    let dispose: (() => void) | null = null;
    if (channel === CHANNELS.syslog && this.syslog) {
      dispose = createSyslogBridge(this.syslog, publish);
    } else if (channel === CHANNELS.stats) {
      dispose = createStatsTicker(publish, 1000, this.appMeta());
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

  /** Métadonnées app statiques (env, branche git, version) pour `dashboard:stats`. */
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
  private publish(ctx: WebsocketContext, channel: string, payload: unknown): void {
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
