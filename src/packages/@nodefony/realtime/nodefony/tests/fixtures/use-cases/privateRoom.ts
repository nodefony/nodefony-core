import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  getRealtimeHub,
} from "../../../../index";

/** Les invités de chaque salon — en vrai, une table : `allow` peut l'interroger. */
export const guests = new Map<string, Set<string>>();

async function isGuest(room: string, user: string): Promise<boolean> {
  return guests.get(room)?.has(user) ?? false; // en vrai : `await repository.exists(…)`
}

export class RoomRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("RoomRealtime", context);
  }

  // Appelé UNE fois, au `subscribe` : une requête en base y est normale.
  @RealtimeChannel("room:*", {
    allow: async (channel, who) =>
      who.id !== null && (await isGuest(channel, who.id)),
  })
  room(): () => void {
    return () => {};
  }

  override createRealtimeChannel(channel: string): (() => void) | null {
    return guests.has(channel) ? () => {} : null;
  }
}

/** Exclure : retirer l'invitation (`allow` dira non), PUIS couper ce qu'il reçoit déjà. */
export function exclude(room: string, user: string): void {
  guests.get(room)?.delete(user);
  getRealtimeHub().evictUser(room, user); // ses onglets reçoivent `realtime:closed { reason: "evicted" }`
}
