/// <reference types="node" />
import { route, controller } from "@nodefony/framework";
import { RealtimeController } from "@nodefony/realtime";
import { Context, readBackpressureOptions } from "@nodefony/http";
import type { RealtimePublish } from "@nodefony/realtime";
import {
  countPushed,
  readBackpressureProbe,
  setProbedTransport,
  type IProbedTransport,
} from "./backpressureProbe";

/**
 * Décor de banc — endpoint realtime capable de **pousser du volume à la
 * demande**, pour éprouver la contre-pression WebSocket sur une VRAIE socket.
 *
 * Pourquoi il existe : la contre-pression (jeter une frame au-delà de
 * `backpressure.dropBytes`, fermer en `1013` au-delà de `closeBytes`) ne peut se
 * prouver qu'avec un client qui **ne draine pas** pendant que le serveur pousse.
 * Aucun endpoint du dépôt ne remplissait les deux conditions : la socket Studio
 * est derrière le pare-feu, l'endpoint M2M derrière un JWT, et les routes WS du
 * module de test sont des échos bruts qui n'utilisent même pas le transport
 * concerné. Sans ce décor, les seuils n'étaient vérifiables que sur une file
 * d'attente **simulée** — ce qui prouve la logique du seuil, pas la physique du
 * transport.
 *
 * ⚠️ **Ouvert par un interrupteur, jamais par défaut** : la route n'est montée
 * que si `NF_BENCH_WS_BACKPRESSURE=1`. Un endpoint public capable d'inonder une
 * connexion est une amplification offerte à qui la demande — il ne doit exister
 * que le temps d'une mesure.
 *
 * Usage (banc `ws-backpressure-e2e.mjs`) : le client ouvre la socket, **suspend la
 * lecture de sa socket**, puis s'abonne à `bench:stream` — le provider part en
 * rafale au 1ᵉʳ abonné et la file du serveur enfle jusqu'aux seuils.
 * Volume réglable : `NF_BENCH_WS_FRAMES` (400), `NF_BENCH_WS_BYTES` (16384).
 */
@controller("/nodefony/test/bench")
class BackpressureRealtimeController extends RealtimeController {
  constructor(context: Context) {
    super("BackpressureRealtimeController", context);
  }

  @route("test-bench-ws-backpressure", {
    path: "/backpressure",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
    // Au handshake, on inscrit le transport de CETTE connexion au mouchard :
    // c'est la seule vue fiable de ce qui a été refusé (le client, lui, ne
    // distingue pas une frame jetée d'une frame pas encore lue).
    if (message == null) {
      const t = (
        this.context as unknown as {
          __nfRealtime?: { transport: IProbedTransport };
        }
      ).__nfRealtime?.transport;
      setProbedTransport(
        t ?? null,
        readBackpressureOptions(
          (this.context as unknown as { server?: unknown })
            .server as Parameters<typeof readBackpressureOptions>[0],
        ),
      );
    }
  }

  /**
   * Lecture du mouchard — route PUBLIQUE et hors WebSocket, parce que le banc
   * interroge précisément au moment où il ne lit plus sa socket.
   */
  @route("test-bench-backpressure-probe", {
    path: "/backpressure/probe",
    requirements: { methods: ["GET"] },
  })
  async probe(): Promise<unknown> {
    return readBackpressureProbe() ?? { pushed: 0, dropped: 0, absent: true };
  }

  protected override realtimeChannels(): string[] {
    return ["bench:stream"];
  }

  /**
   * Le provider part en rafale au 1ᵉʳ abonné : l'abonnement EST le déclencheur,
   * ce qui évite de dépendre d'une action RPC (toute action porte un défaut
   * fermé — s'authentifier pour mesurer un mécanisme de transport n'aurait
   * aucun sens).
   */
  override createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    if (channel !== "bench:stream") return null;
    // La rafale part au 1ᵉʳ abonné, PAS par une action RPC : toute action porte
    // un défaut fermé (`authenticated`), ce qui obligerait le banc à s'authentifier
    // pour mesurer un mécanisme de transport qui n'a rien à voir avec l'identité.
    // Le canal, lui, est libre — c'est la surface juste pour ce décor.
    const frames = Number(process.env.NF_BENCH_WS_FRAMES ?? 400);
    const bytes = Number(process.env.NF_BENCH_WS_BYTES ?? 16384);
    const payload = { blob: "x".repeat(bytes) };
    const timer = setTimeout(() => {
      countPushed(frames);
      for (let i = 0; i < frames; i++) publish("bench:stream", payload);
    }, 50);
    timer.unref?.();
    return () => clearTimeout(timer);
  }
}

export default BackpressureRealtimeController;
