/// <reference types="node" />
import { route, controller } from "@nodefony/framework";
import {
  RealtimeAction,
  RealtimeChannel,
  RealtimeController,
} from "@nodefony/realtime";
import type { RealtimePublish } from "@nodefony/realtime";
import { Context, isWebsocketContext } from "@nodefony/http";
import { JsonRpcServerError, RpcError } from "nodefony";

/**
 * Diffusion du canal `codec:tick`, tant qu'un abonné écoute — `null` au départ
 * du dernier (même patron que le salon des vitrines : le contrôleur vit par
 * connexion, le canal par processus).
 */
let publishTick: RealtimePublish | null = null;

/** Bornes de `codec:burst` : voir {@link LiveCodecController.burst}. */
const BURST_MAX_COUNT = 100_000;
const BURST_MAX_BYTES = 65_536;
/** File d'envoi au-delà de laquelle la rafale rend la main (seuil d'un flux Node). */
const BURST_HIGH_WATER = 16_384;

/** Entier `0 ≤ n ≤ max` lu dans les paramètres d'une action, 0 sinon. */
function readBound(params: unknown, key: string, max: number): number {
  if (typeof params !== "object" || params === null || !(key in params)) {
    return 0;
  }
  const value: unknown = Reflect.get(params, key);
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, max)
    : 0;
}

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
   * Refuse volontairement : une `RpcError` dont le code et les données — octets
   * compris — doivent traverser le codec à l'identique.
   */
  @RealtimeAction("codec:fail", { authenticated: false })
  fail(): never {
    throw new RpcError("refusé", JsonRpcServerError.DEFAULT, {
      status: 409,
      data: new Uint8Array([4, 2]),
    });
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

  /**
   * Rafale vers CETTE connexion (`codec:item`, notification ciblée) : `count`
   * messages de `bytes` octets — le pendant d'un flux serveur gRPC (`Watch`),
   * pour comparer leurs débits à charge utile égale (#695, critère 22).
   *
   * L'émetteur respecte la contre-pression comme l'adaptateur gRPC attend
   * `drain` : il rend la main tant que la file d'envoi dépasse 16 Kio (le seuil
   * d'un flux Node). Sans cela il mesurerait la vitesse de remplissage d'une
   * file, et la politique `drop` jetterait des trames. Bornée (100 000 messages,
   * 64 Kio) : le module de test est réservé au développement, la borne évite
   * qu'une faute de frappe sature le poste.
   *
   * @returns messages émis, et trames jetées par la contre-pression (0 attendu).
   */
  @RealtimeAction("codec:burst", { authenticated: false })
  async burst(params: unknown): Promise<{ sent: number; dropped: number }> {
    const count = readBound(params, "count", BURST_MAX_COUNT);
    const bytes = readBound(params, "bytes", BURST_MAX_BYTES);
    const ctx = this.context;
    const transport =
      ctx !== undefined && isWebsocketContext(ctx)
        ? (ctx.__nfRealtime?.transport ?? null)
        : null;
    if (transport === null) return { sent: 0, dropped: 0 };
    const dropped = transport.dropped;
    const data = new Uint8Array(bytes);
    for (let seq = 0; seq < count; seq++) {
      while (transport.bufferedAmount > BURST_HIGH_WATER) {
        if (transport.readyState !== 1) return { sent: seq, dropped: 0 };
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      this.notifyClient("codec:item", { seq, data });
    }
    return { sent: count, dropped: transport.dropped - dropped };
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
