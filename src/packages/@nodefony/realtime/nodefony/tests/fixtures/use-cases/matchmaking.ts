import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "../../../../index";
import type { IRealtimeConnection } from "../../../../index";

/** Qui joue à quelle partie — en vrai, une table ou un Redis partagé. */
export const players = new Map<string, Set<string>>();

// Sa socket : `/api/match/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/match")
export class MatchRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("MatchRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("match-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  // `allow` lit l'appartenance : au premier abonnement ET à chaque reconnexion.
  @RealtimeChannel("match:*", {
    allow: (channel, who) =>
      who.id !== null && (players.get(channel)?.has(who.id) ?? false),
  })
  match(): () => void {
    return () => {};
  }

  override createRealtimeChannel(channel: string): (() => void) | null {
    return players.has(channel) ? () => {} : null;
  }

  @RealtimeInbound("match:find", { authenticated: true })
  async find(
    _params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null) return;
    const match = "match:42"; // la partie trouvée pour ce joueur
    const members = players.get(match) ?? new Set<string>();
    members.add(connection.userId); // 1. écrire l'appartenance là où `allow` la lit
    players.set(match, members);
    await getRealtimeHub().subscribeConnection(match, connection); // 2. abonner d'office
  }
}
