import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "../../../../index";
import type { IRealtimeConnection } from "../../../../index";
import { getRoomMemberService } from "../service/RoomMemberService";

/** L'identifiant du salon d'un canal `room:<id>`, `null` hors de la famille. */
function roomOf(channel: string): string | null {
  return channel.startsWith("room:") ? channel.slice("room:".length) : null;
}

/** L'appartenance vit en base : une ligne `RoomMember` (salon, compte). */
async function isMember(channel: string, user: string): Promise<boolean> {
  const room = roomOf(channel);
  if (room === null) return false;
  return (await getRoomMemberService().findOne({ room, user })) !== null;
}

export class RoomRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("RoomRealtime", context);
  }

  // Appelé UNE fois, au `subscribe` (et à chaque page rechargée) : une requête
  // en base y est normale.
  @RealtimeChannel("room:*", {
    allow: async (channel, who) =>
      who.id !== null && (await isMember(channel, who.id)),
  })
  room(): () => void {
    return () => {};
  }

  // Un canal décoré n'est servi que sous son nom exact : la famille l'est ici.
  override createRealtimeChannel(channel: string): (() => void) | null {
    return roomOf(channel) === null ? null : () => {};
  }

  // Une entrée n'hérite PAS de la politique du canal : elle vérifie l'appartenance
  // elle-même, par la MÊME fonction qu'`allow`, et l'auteur vient de la connexion.
  @RealtimeInbound("room:send", { authenticated: true })
  async send(
    params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null || !isMessage(params)) return;
    if (!(await isMember(params.room, connection.userId))) return;
    getRealtimeHub().publish(params.room, {
      author: connection.userId,
      text: params.text.slice(0, 500),
    });
  }
}

/** Exclure : retirer l'appartenance (`allow` dira non), PUIS couper ce qu'il reçoit déjà. */
export async function exclude(channel: string, user: string): Promise<void> {
  const room = roomOf(channel);
  if (room === null) return;
  await getRoomMemberService().delete({ room, user });
  getRealtimeHub().evictUser(channel, user); // ses onglets reçoivent `realtime:closed { reason: "evicted" }`
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
