import "reflect-metadata";
import type { ContextType } from "@nodefony/http";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { serverSocket } from "../../src/server/ServerRealtimeSocket.js";
import type {
  RealtimePublish,
  RealtimeInboundHandler,
} from "../../interfaces/IRealtimeController.js";
// Client EN SOURCE, comme le banc en boucle : c'est le code que le navigateur exécute.
import { NodefonySocket } from "../../../../../../nodefony/src/client/realtime/NodefonySocket.js";
import {
  LoopbackClientTransport,
  LoopbackWire,
  loopbackServerContext,
} from "../helpers/loopback.js";
import {
  CONFORMANCE_IN,
  CONFORMANCE_OUT,
  describeSocketConformance,
  type ISocketConformanceHarness,
} from "../helpers/socketConformance.js";

/**
 * La suite de conformité d'`IRealtimeSocket` jouée contre ses DEUX
 * implémentations (#629, ADR-0022 §10) :
 *
 * - `NodefonySocket` — le client navigateur, sur le câble en boucle face à un
 *   vrai `RealtimeController` : chaque trame traverse les deux moteurs ;
 * - `ServerRealtimeSocket` — la façade serveur au-dessus du hub.
 *
 * Dans les deux décors, l'autre côté émet par le hub (`serverSocket().publish`)
 * et observe ce que la socket publie : seul le chemin de la socket éprouvée change.
 */

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Controller du décor client : fournit le canal entrant, enregistre le sortant. */
class ConformanceRt extends RealtimeController {
  readonly received: unknown[] = [];

  constructor(ctx: ContextType) {
    super("conformance-rt", ctx);
  }

  protected override realtimeChannels(): string[] {
    return [CONFORMANCE_IN];
  }

  override createRealtimeChannel(
    _channel: string,
    _publish: RealtimePublish,
  ): (() => void) | null {
    // Le canal est alimenté par le hub (`serverSocket().publish`), pas par un
    // producteur propre : rien à démarrer, rien à arrêter.
    return () => undefined;
  }

  protected override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return {
      [CONFORMANCE_OUT]: (params) => {
        this.received.push(params);
      },
    };
  }

  /** Pont du câble : la route WS appelle normalement `handleRealtime`. */
  feed(raw: string | Uint8Array | null): void {
    this.handleRealtime(raw);
  }
}

describeSocketConformance(
  "NodefonySocket (client, câble en boucle)",
  async (): Promise<ISocketConformanceHarness> => {
    getRealtimeHub().clear();
    const wire = new LoopbackWire();
    const { ctx, fireFinish } = loopbackServerContext(wire);
    const rt = new ConformanceRt(ctx);
    wire.feedServer = (raw) => rt.feed(raw);
    const transport = new LoopbackClientTransport(wire);
    const client = new NodefonySocket(
      { url: "ws://loopback/realtime", autoReconnect: false },
      () => transport,
    );
    await client.connect();
    await flush(); // le handshake serveur livre le welcome
    await flush();
    const emitter = serverSocket();
    return {
      socket: client,
      deliver: (channel, payload) => emitter.publish(channel, payload),
      published: rt.received,
      settle: async () => {
        await flush();
        await flush();
      },
      dispose: () => {
        client.disconnect();
        fireFinish();
        getRealtimeHub().clear();
      },
    };
  },
);

describeSocketConformance(
  "ServerRealtimeSocket (façade serveur sur le hub)",
  async (): Promise<ISocketConformanceHarness> => {
    const hub = getRealtimeHub();
    hub.clear();
    const published: unknown[] = [];
    const observer = (payload: unknown): void => {
      published.push(payload);
    };
    hub.listen(CONFORMANCE_OUT, observer);
    const emitter = serverSocket();
    return {
      socket: serverSocket(),
      deliver: (channel, payload) => emitter.publish(channel, payload),
      published,
      settle: flush,
      dispose: () => {
        hub.unsubscribe(CONFORMANCE_OUT, observer);
        hub.clear();
      },
    };
  },
);
