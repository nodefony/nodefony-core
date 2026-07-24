/// <reference types="node" />
import { route, controller } from "@nodefony/framework";
import { RealtimeController } from "@nodefony/realtime";
import { Context } from "@nodefony/http";
import type { RealtimePublish } from "@nodefony/realtime";

/** Vue minimale du transport de la connexion — ce que la sonde en lit. */
interface ConnProbe {
  readonly readyState: number;
  readonly bufferedAmount: number;
  readonly dropped: number;
}

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
 * Usage (banc `ws-backpressure-e2e.mjs`) : le client ouvre la socket, s'abonne à
 * `bench:flood`, **suspend la lecture de sa socket**, puis demande l'inondation
 * par l'action `bench:flood`. La file du serveur enfle jusqu'aux seuils.
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
  }

  protected override realtimeChannels(): string[] {
    return ["bench:flood"];
  }

  /**
   * Le canal ne pousse RIEN de lui-même : c'est l'action `bench:flood` qui
   * alimente, pour que la mesure décide du volume et du moment. Un provider qui
   * pousserait en continu rendrait le banc dépendant de son propre minuteur.
   */
  override createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    if (channel !== "bench:flood") return null;
    this.#publish = publish;
    return () => {
      this.#publish = null;
    };
  }

  #publish: RealtimePublish | null = null;

  protected override realtimeActions(): Record<
    string,
    (params?: unknown) => unknown
  > {
    return {
      /**
       * Pousse `frames` charges de `bytes` octets sur `bench:flood`.
       * Rend ce que la sonde de CETTE connexion voit ensuite : octets en file,
       * frames jetées, état de la socket — les trois grandeurs qui disent si la
       * contre-pression a mordu.
       */
      "bench:flood": (params?: unknown) => {
        const p = (params ?? {}) as { frames?: number; bytes?: number };
        const frames = Math.min(Math.max(p.frames ?? 200, 1), 5000);
        const bytes = Math.min(Math.max(p.bytes ?? 16384, 1), 1 << 20);
        const payload = { blob: "x".repeat(bytes) };
        for (let i = 0; i < frames; i++)
          this.#publish?.("bench:flood", payload);
        // Le transport de CETTE connexion, tenu par la base sur le contexte.
        const probe = (
          this.context as unknown as {
            __nfRealtime?: { transport: ConnProbe };
          }
        ).__nfRealtime?.transport;
        return {
          pushed: frames,
          bytes,
          bufferedAmount: probe?.bufferedAmount ?? -1,
          dropped: probe?.dropped ?? -1,
          readyState: probe?.readyState ?? -1,
        };
      },
    };
  }
}

export default BackpressureRealtimeController;
