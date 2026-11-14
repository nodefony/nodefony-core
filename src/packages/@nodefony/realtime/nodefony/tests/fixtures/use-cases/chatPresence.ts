import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "../../../../index";

/** Le canal du salon : il porte les messages, la frappe — et la présence. */
export const ROOM_CHANNEL = "chat:room";

/** « Untel écrit » : un message ÉPHÉMÈRE du canal, jamais gardé, jamais rejoué. */
export interface ChatTyping {
  typing: string;
}

@controller("/chat")
export class ChatController extends RealtimeController {
  constructor(context: ContextType) {
    super("chat", context);
  }

  @route("chat-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  // La présence est portée PAR le canal : être abonné, c'est être présent. Ni
  // minuteur, ni liste à tenir, ni second canal — et elle reste juste quand
  // l'application tourne sur plusieurs pods (étape 7).
  @RealtimeChannel(ROOM_CHANNEL, { presence: true })
  room(): () => void {
    return () => {};
  }

  // La frappe n'est PAS un état de présence : c'est un message du canal, que
  // chacun reçoit parce qu'il y est abonné, et que l'écran efface seul.
  @RealtimeInbound("chat:typing")
  onTyping(params: unknown): void {
    if (!ChatController.isTyping(params)) return;
    const typing: ChatTyping = { typing: params.author.slice(0, 40) };
    getRealtimeHub().publish(ROOM_CHANNEL, typing);
  }

  /** Ce qui arrive du réseau n'est pas fiable : un auteur non vide, ou rien. */
  private static isTyping(value: unknown): value is { author: string } {
    return (
      typeof value === "object" &&
      value !== null &&
      "author" in value &&
      typeof value.author === "string" &&
      value.author.length > 0
    );
  }
}
