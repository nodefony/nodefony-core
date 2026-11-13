import type { IRealtimeContract } from "nodefony/client";
import type { IFilePreview } from "../kit/preview";
import type {
  CreateRoomBody,
  EventBody,
  EventParams,
  HistoryQuery,
  InviteBody,
  PeopleQuery,
  ReplyBody,
  RoomParams,
  SendBody,
  UserParams,
} from "./chatSchemas";
import type { IRoomEvent, IRoomView } from "./rooms";

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

/**
 * Un départ attend cinq secondes avant d'être annoncé, et s'annule si la
 * personne revient : un rechargement de page ne fait pas « parti, revenu ».
 */
export const PRESENCE_GRACE_MS = 5000;

/** Au plus cinquante identités par demande de noms. */
export const PEOPLE_MAX = 50;

/**
 * Une personne présente, telle que l'annuaire du salon la nomme. La présence
 * ne porte qu'une identité OPAQUE (l'`id` stable du compte) : le nom, c'est
 * l'application qui le donne, par sa route.
 */
export interface ChatPerson {
  id: string;
  name: string;
}

/**
 * Un message AVEC des pièces : un `POST` multipart, hors du pont socket — des
 * octets en volume voyagent en HTTP, en flux jusqu'au disque.
 */
export const CHAT_ATTACH_PATH = "/demo/chat/rooms/{room}/attachments";

/** Une pièce se lit à `${CHAT_FILE_PATH}/<id>`. */
export const CHAT_FILE_PATH = "/demo/chat/files";

/**
 * Au plus 64 Kio de texte par message, comptés en octets UTF-8 — la borne
 * d'un événement Matrix (65 536 octets). De quoi coller un fichier source ou
 * une trace d'erreur entière (~1 650 lignes de TypeScript, ~650 lignes de
 * journal). Le réseau et la base comptent des OCTETS, pas des caractères : un
 * emoji en vaut quatre. Au-delà, c'est un fichier — une pièce jointe.
 */
export const MESSAGE_MAX_BYTES = 65_536;

/** Au plus deux cents messages par lecture de l'historique. */
export const CHAT_HISTORY_LIMIT = 200;

/** Au plus cinq pièces par message… */
export const ATTACHMENT_MAX_COUNT = 5;

/** …de 2 Mio chacune (2 × 1024 × 1024 octets). */
export const ATTACHMENT_MAX_BYTES = 2_097_152;

/**
 * Une pièce jointe, telle que le salon l'annonce à tous. Ce qu'elle montre
 * (`kind` et son aperçu, `IFilePreview` du kit) est décidé par le SERVEUR
 * d'après son contenu, jamais d'après son nom ni le type que le navigateur
 * déclare.
 */
export interface ChatAttachment extends IFilePreview {
  id: string;
  name: string;
  size: number;
  /** Sortie du stockage borné : le message reste, la pièce non. */
  expired?: boolean;
}

/** Un message du salon. L'auteur est posé par le SERVEUR, jamais par le client. */
export interface ChatMessage {
  /**
   * Identifiant STABLE, tiré par le serveur à l'archivage (XEP-0359
   * `stanza-id`) : la page dédoublonne dessus, une réponse ou une réaction le
   * viseront.
   */
  id: string;
  author: string;
  text: string;
  sentAt: number;
  /** Les pièces du message, absentes d'un message de texte seul. */
  attachments?: ChatAttachment[];
}

/**
 * Ce que porte le canal d'un salon (`chat:room:<id>`) : un message, ou le
 * signal « Untel écrit… » — éphémère, ni conservé ni compté. La frappe est un
 * message du canal, jamais un état de la présence (RFC 6121 §4.4.1, ADR-0025
 * P4) : elle suit les mêmes droits que le salon.
 */
export type RoomFrame =
  | { kind: "message"; message: ChatMessage }
  | { kind: "typing"; author: string };

/**
 * Une trame venue du réseau est-elle une `RoomFrame` ? La page le vérifie
 * avant de l'afficher : le type d'un canal de famille n'est pas encore porté
 * par le contrat jusqu'à `socket.on`.
 */
export function isRoomFrame(value: unknown): value is RoomFrame {
  if (typeof value !== "object" || value === null) return false;
  const kind: unknown = Reflect.get(value, "kind");
  if (kind === "typing")
    return typeof Reflect.get(value, "author") === "string";
  if (kind !== "message") return false;
  const message: unknown = Reflect.get(value, "message");
  return (
    typeof message === "object" &&
    message !== null &&
    typeof Reflect.get(message, "id") === "string" &&
    typeof Reflect.get(message, "author") === "string" &&
    typeof Reflect.get(message, "text") === "string" &&
    typeof Reflect.get(message, "sentAt") === "number"
  );
}

/** Ce que reçoit le canal personnel : « ta liste de salons a changé, relis-la ». */
export interface RoomsNotice {
  type: "rooms:changed";
}

// #region chat-contract
export interface ChatContract extends IRealtimeContract {
  serverToClient: {
    /** Un canal par salon — admis par la règle des salons, présence comprise. */
    [room: `chat:room:${string}`]: RoomFrame;
    /** Le canal personnel (`publishToUser`), joint d'office à toute connexion authentifiée. */
    [user: `user:${string}`]: RoomsNotice;
  };
  /** Les routes, appelées en HTTP ou par la socket : "<VERBE> <chemin>". */
  serverRoutes: {
    "GET /demo/chat/rooms": { result: IRoomView[] };
    "POST /demo/chat/rooms/{room}/send": {
      params: typeof RoomParams;
      body: typeof SendBody;
      result: { id: string; sentAt: number };
    };
    "POST /demo/chat/rooms/{room}/typing": {
      params: typeof RoomParams;
      result: { ok: true };
    };
    "GET /demo/chat/rooms/{room}/history": {
      params: typeof RoomParams;
      query: typeof HistoryQuery;
      result: ChatMessage[];
    };
    "GET /demo/chat/rooms/{room}/people": {
      params: typeof RoomParams;
      query: typeof PeopleQuery;
      result: ChatPerson[];
    };
    "POST /demo/chat/rooms": {
      body: typeof CreateRoomBody;
      result: IRoomView;
    };
    "POST /demo/chat/rooms/{room}/members": {
      params: typeof RoomParams;
      body: typeof InviteBody;
      result: { ok: true };
    };
    "POST /demo/chat/rooms/{room}/events": {
      params: typeof RoomParams;
      body: typeof EventBody;
      result: IRoomEvent;
    };
    "POST /demo/chat/events/{event}/reply": {
      params: typeof EventParams;
      body: typeof ReplyBody;
      result: { ok: true };
    };
    "POST /demo/chat/direct/{user}": {
      params: typeof UserParams;
      result: IRoomView;
    };
  };
}
// #endregion
