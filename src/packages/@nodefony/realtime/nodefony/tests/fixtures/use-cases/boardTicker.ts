import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  getRealtimeHub,
} from "../../../../index";

/** Cadence du tableau : une publication par seconde, quel que soit le nombre d'écrans. */
export const TICK_MS = 1000;

/** Ce que publie chaque tick — ici la mémoire du processus, en vrai un service. */
export function publishLoad(): void {
  const { rss, heapUsed } = process.memoryUsage();
  getRealtimeHub().publish("board:load", { rss, heap: heapUsed });
}

// Sa socket : `/api/board/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/board")
export class BoardRealtime extends RealtimeController {
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

  // UN minuteur par serveur : créé au PREMIER écran, arrêté au DERNIER. Rien de
  // `this.context` ici : le producteur survit à la connexion qui l'a créé.
  @RealtimeChannel("board:load", { roles: ["ROLE_SUPERVISOR"] })
  load(): () => void {
    const timer = setInterval(publishLoad, TICK_MS);
    timer.unref(); // un serveur qui s'arrête n'attend pas le prochain tick
    return () => clearInterval(timer);
  }
}
