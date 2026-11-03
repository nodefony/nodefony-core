import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import { RealtimeChannel, RealtimeController } from "../../../../index";
import type { RealtimePublish } from "../../../../index";

// Sa socket : `/api/board/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/board")
export class BoardRealtime extends RealtimeController {
  /** Cadence du tableau : une publication par seconde, quel que soit le nombre d'écrans. */
  static readonly TICK_MS = 1000;

  constructor(context: ContextType) {
    super("BoardRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("board-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  // UN minuteur par serveur : créé au PREMIER écran, arrêté au DERNIER (la
  // fonction rendue est l'arrêt). Il publie par `publish`, que le hub lui
  // donne : rien de `this.context` ici, le producteur survit à la connexion
  // qui l'a créé.
  @RealtimeChannel("board:load", { roles: ["ROLE_SUPERVISOR"] })
  load(channel: string, publish: RealtimePublish): () => void {
    const timer = setInterval(
      () => publish(channel, BoardRealtime.measure()),
      BoardRealtime.TICK_MS,
    );
    timer.unref(); // un serveur qui s'arrête n'attend pas le prochain tick
    return () => clearInterval(timer);
  }

  /** Ce que publie chaque tick — ici la mémoire du processus, en vrai un service. */
  private static measure(): { rss: number; heap: number } {
    const { rss, heapUsed } = process.memoryUsage();
    return { rss, heap: heapUsed };
  }
}
