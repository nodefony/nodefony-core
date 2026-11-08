import type { IRealtimeContract } from "nodefony/client";
import type { HistoryQuery, SendBody } from "./chatSchemas";

/**
 * Le contrat du salon — des TYPES seulement, lus par les deux côtés :
 * `ChatController extends ContractRealtimeController<ChatContract>` côté
 * serveur, `NodefonySocket.fromContract<ChatContract>()` côté page.
 *
 * Guide pour un agent : une faute de nom de canal, de route ou de charge ne
 * compile d'aucun côté. Le fichier disparaît à la construction (types seuls).
 * Type : `IRealtimeContract` (`nodefony/client`) ; doc :
 * `@nodefony/realtime/docs/actions.md` (« Un contrat pour les deux bouts »).
 */

/** Adresse de la socket du salon. */
export const CHAT_REALTIME_PATH = "/demo/chat/realtime";

/** Le salon : chaque message envoyé. */
export const ROOM_CHANNEL = "chat:room";

/** « Untel écrit… » : volatil, ni conservé ni compté. */
export const TYPING_CHANNEL = "chat:typing";

/** Un message du salon. L'auteur est posé par le SERVEUR, jamais par le client. */
export interface ChatMessage {
  author: string;
  text: string;
  sentAt: number;
}

// #region chat-contract
export interface ChatContract extends IRealtimeContract {
  serverToClient: {
    "chat:room": ChatMessage;
    "chat:typing": { author: string };
  };
  /** Le signal de frappe : AUCUN champ — l'auteur vient de la connexion. */
  clientToServer: { "chat:typing": Record<string, never> };
  /** Les routes, appelées en HTTP ou par la socket : "<VERBE> <chemin>". */
  serverRoutes: {
    "POST /demo/chat/send": {
      body: typeof SendBody;
      result: { sentAt: number };
    };
    "GET /demo/chat/history": {
      query: typeof HistoryQuery;
      result: ChatMessage[];
    };
  };
}
// #endregion
