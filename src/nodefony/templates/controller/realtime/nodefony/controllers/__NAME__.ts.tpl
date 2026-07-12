import { route, controller } from "@nodefony/framework";
import { RealtimeController, RealtimeChannel } from "@nodefony/realtime";
import type { RealtimePublish } from "@nodefony/realtime";
import type { RpcActionHandler } from "nodefony";
import type { ContextType } from "@nodefony/http";

/**
 * <%= it.nameClass %> — endpoint temps réel de la socket Nodefony (JSON-RPC
 * 2.0). La base {@link RealtimeController} porte TOUT le protocole (handshake,
 * pub/sub par canal, actions requête→réponse, cleanup, fan-out par le hub) :
 * cette classe ne déclare QUE son métier — ses canaux et ses actions.
 *
 * Généré par `nodefony create controller --kind realtime`.
 *
 * Côté client (navigateur — le core `nodefony` est isomorphe) :
 * ```ts
 * import { RealtimeClient } from "nodefony";
 * const scheme = location.protocol === "https:" ? "wss" : "ws";
 * const socket = new RealtimeClient({
 *   url: `${scheme}://${location.host}<%= it.route %>/realtime`,
 * });
 * socket.on("<%= it.channel %>:ticker", (msg) => console.log("tick", msg));
 * await socket.connect();
 * socket.subscribe("<%= it.channel %>:ticker");        // flux serveur → client
 * const pong = await socket.request("<%= it.channel %>:ping", {}); // RPC aller-retour
 * ```
 * (React : hooks `nodefony/react` — `useNodefonySocket` / `useChannel`.)
 */
@controller("<%= it.route %>")
class <%= it.nameClass %> extends RealtimeController {
  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  @route("<%= it.kebab %>-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /** Canaux annoncés au handshake (`realtime:welcome`). */
  protected override realtimeChannels(): string[] {
    return ["<%= it.channel %>:ticker"];
  }

  /** Actions RPC (requête→réponse) — liveness + round-trip mesurable client. */
  protected override realtimeActions(): Record<string, RpcActionHandler> {
    return {
      "<%= it.channel %>:ping": () => ({
        pong: true,
        ts: Date.now(),
        pid: process.pid,
      }),
    };
  }

  /**
   * Canal démo : 1 tick/s TANT QU'au moins un client est abonné. Le provider
   * est créé au 1ᵉʳ `subscribe` et son dispose est GARANTI au dernier
   * `unsubscribe`/close (1 provider par canal par pod, fan-out par le hub) —
   * zéro coût quand personne n'écoute.
   */
  @RealtimeChannel("<%= it.channel %>:ticker")
  ticker(channel: string, publish: RealtimePublish): () => void {
    let n = 0;
    const timer = setInterval(() => {
      publish(channel, { n: ++n, ts: Date.now(), pid: process.pid });
    }, 1000);
    timer.unref();
    return () => clearInterval(timer);
  }
}

export default <%= it.nameClass %>;
