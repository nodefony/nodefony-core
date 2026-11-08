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

/**
 * Un message AVEC des pièces : un `POST` multipart, hors du pont socket — des
 * octets en volume voyagent en HTTP, en flux jusqu'au disque.
 */
export const CHAT_ATTACH_PATH = "/demo/chat/attachments";

/** Une pièce se lit à `${CHAT_FILE_PATH}/<id>`. */
export const CHAT_FILE_PATH = "/demo/chat/files";

/** Au plus cinq pièces par message… */
export const ATTACHMENT_MAX_COUNT = 5;

/** …de 2 Mio chacune (2 × 1024 × 1024 octets). */
export const ATTACHMENT_MAX_BYTES = 2_097_152;

/**
 * Ce qu'une pièce montre dans le salon — décidé par le SERVEUR d'après son
 * contenu, jamais d'après son nom ni le type que le navigateur déclare.
 */
export type ChatAttachmentKind =
  "image" | "text" | "pdf" | "archive" | "document" | "sheet" | "file";

/** Le format reconnu d'une archive ou d'un document bureautique. */
export type ChatAttachmentFormat =
  "zip" | "tar" | "tar.gz" | "docx" | "odt" | "xlsx" | "ods";

/** Une entrée d'archive, lue dans son INDEX — rien n'est extrait. */
export interface ChatArchiveEntry {
  name: string;
  /** Taille déclarée par l'archive, décompressée. */
  size: number;
}

/** Une pièce jointe, telle que le salon l'annonce à tous. */
export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  kind: ChatAttachmentKind;
  /** Texte : son nombre de lignes. */
  lines?: number;
  /** Texte : ses premières lignes. */
  preview?: string;
  /** Archive ou document : le format reconnu. */
  format?: ChatAttachmentFormat;
  /** Archive : ses premières entrées… */
  entries?: ChatArchiveEntry[];
  /** …sur ce nombre total. */
  total?: number;
  /** Document Word ou ODT : ses premiers paragraphes. */
  paragraphs?: string[];
  /** Tableur : le coin haut-gauche de la première feuille. */
  rows?: string[][];
  /** L'aperçu s'arrête avant la fin (plafond atteint). */
  truncated?: boolean;
  /** Sortie du stockage borné : le message reste, la pièce non. */
  expired?: boolean;
}

/** Un message du salon. L'auteur est posé par le SERVEUR, jamais par le client. */
export interface ChatMessage {
  author: string;
  text: string;
  sentAt: number;
  /** Les pièces du message, absentes d'un message de texte seul. */
  attachments?: ChatAttachment[];
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
