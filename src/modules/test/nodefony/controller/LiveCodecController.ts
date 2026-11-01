/// <reference types="node" />
import { route, controller } from "@nodefony/framework";
import {
  RealtimeAction,
  RealtimeChannel,
  RealtimeController,
} from "@nodefony/realtime";
import type { RealtimePublish } from "@nodefony/realtime";
import { Context } from "@nodefony/http";

/**
 * Diffusion du canal `codec:tick`, tant qu'un abonné écoute — `null` au départ
 * du dernier (même patron que le salon des vitrines : le contrôleur vit par
 * connexion, le canal par processus).
 */
let publishTick: RealtimePublish | null = null;

/**
 * Banc du **codec binaire sur un serveur réel** (ADR-0022 §2) : une poignée de
 * main `ws` véritable, des trames binaires sur le fil, et des octets qui
 * traversent sans base64 — ce que le décor en mémoire du paquet realtime ne
 * peut pas montrer.
 *
 * Sous la zone `test-live` (`^/api/live/`, session puis anonyme) : le banc se
 * connecte sans compte, comme les vitrines. Les deux actions sont donc OUVERTES
 * (`{ authenticated: false }`) : une action est fermée par défaut, et le banc
 * éprouve un transport, pas une identité.
 *
 * Banc : `realtime/nodefony/tests/integration/realtimeCodecServer.e2e.test.ts`.
 */
@controller("/api/live")
class LiveCodecController extends RealtimeController {
  constructor(context: Context) {
    super("LiveCodecController", context);
  }

  /** L'endpoint WebSocket du banc. */
  @route("test-live-codec", {
    path: "/codec",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /** Rend la charge telle que reçue — octets compris. */
  @RealtimeAction("codec:echo", { authenticated: false })
  echo(params: unknown): { echoed: unknown } {
    return { echoed: params };
  }

  /**
   * Diffuse sur `codec:tick` une charge qui porte des octets, à TOUS les
   * abonnés : chacun doit la recevoir encodée par SON codec.
   */
  @RealtimeAction("codec:publish", { authenticated: false })
  publish(params: unknown): { published: boolean } {
    const seq =
      typeof params === "object" &&
      params !== null &&
      "seq" in params &&
      typeof params.seq === "number"
        ? params.seq
        : 0;
    if (publishTick === null) return { published: false };
    publishTick("codec:tick", { seq, data: new Uint8Array([1, 2, 3, 255]) });
    return { published: true };
  }

  /** Canal de diffusion du banc, alimenté par {@link publish}. */
  @RealtimeChannel("codec:tick")
  tick(_channel: string, publish: RealtimePublish): () => void {
    publishTick = publish;
    return () => {
      publishTick = null;
    };
  }
}

export default LiveCodecController;
