import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "../../../../index";
import type { IRealtimeConnection } from "../../../../index";

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

  // Un canal décoré n'est servi que sous son nom exact : `room:7` est servi ici.
  override createRealtimeChannel(channel: string): (() => void) | null {
    return guests.has(channel) ? () => {} : null;
  }

  // Une entrée n'hérite PAS de la politique du canal : elle vérifie l'appartenance
  // elle-même, par le MÊME registre qu'`allow`, et l'auteur vient de la connexion.
  @RealtimeInbound("room:send", { authenticated: true })
  async send(
    params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null || !isMessage(params)) return;
    if (!(await isGuest(params.room, connection.userId))) return;
    getRealtimeHub().publish(params.room, {
      author: connection.userId,
      text: params.text.slice(0, 500),
    });
  }
}

/** Exclure : retirer l'invitation (`allow` dira non), PUIS couper ce qu'il reçoit déjà. */
export function exclude(room: string, user: string): void {
  guests.get(room)?.delete(user);
  getRealtimeHub().evictUser(room, user); // ses onglets reçoivent `realtime:closed { reason: "evicted" }`
}

function isMessage(value: unknown): value is { room: string; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "room" in value &&
    "text" in value &&
    typeof value.room === "string" &&
    typeof value.text === "string"
  );
}
