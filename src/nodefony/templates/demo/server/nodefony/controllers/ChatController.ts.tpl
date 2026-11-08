import { Inject } from "nodefony";
import type { ContractRouteSchemas } from "nodefony";
import {
  controller,
  route,
  Idempotent,
  IsGranted,
  Param,
} from "@nodefony/framework";
import type { RouteInput } from "@nodefony/framework";
import {
  ContractRealtimeController,
  RealtimeBroadcast,
  RealtimeChannel,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
import {
  AttachBody,
  HistoryQuery,
  SendBody,
} from "../../frontend/src/chat/chatSchemas";
import { attachmentProblem } from "../../frontend/src/chat/attachments";
import {
  ROOM_CHANNEL,
  TYPING_CHANNEL,
  type ChatContract,
  type ChatMessage,
} from "../../frontend/src/chat/chatContract";
import { isUploadedFile } from "../service/ChatService";
import type ChatService from "../service/ChatService";
import type DemoPulseService from "../service/DemoPulseService";

/**
 * Le salon du chat — UN contrôleur, deux transports : chaque action répond en
 * HTTP ET par la socket (`/demo/chat/realtime`), sous la même sécurité.
 *
 * Guide pour un agent :
 *  • LIRE est libre, ÉCRIRE exige une session : l'envoi est une ACTION gardée
 *    par `@IsGranted`, et son auteur vient de `this.user` — l'identité que la
 *    zone `demo` (session, puis anonyme) a posée. Jamais un champ du client ;
 *  • les corps et les queries sont VALIDÉS par le framework avant l'action
 *    (`schema`), avec les schémas partagés de `frontend/src/chat/chatSchemas.ts` ;
 *  • l'historique vit dans `ChatService` (un contrôleur temps réel est
 *    instancié par connexion) ;
 *  • `@RealtimeBroadcast("chat:")` fait traverser le salon d'un serveur à
 *    l'autre (plusieurs pods, `nodefony cluster`).
 * Doc : `@nodefony/realtime/docs/cookbook-chat.md` ; générer l'équivalent :
 * `npx nodefony create controller chat --kind realtime` ; skill livré :
 * `nodefony-add-realtime-channel`.
 *
 * Les blocs `// #region <nom>` sont CITÉS par la page d'apprentissage
 * (`frontend/src/chat/chatTabs.ts`) : les renommer casse son test.
 */
// #region chat-broadcast
// Plusieurs pods : chaque publication sur un canal `chat:` traverse le bus.
@RealtimeBroadcast("chat:")
// #endregion
// #region chat-class
// Préfixe de toutes les routes de la classe.
@controller("/demo/chat")
// Le contrat typé : les canaux et les routes que le navigateur compile aussi.
class ChatController extends ContractRealtimeController<ChatContract> {
  // #endregion
  // #region chat-routes
  /**
   * Les VALEURS des routes du contrat — le schéma même que chaque route valide.
   * Vérifiées au démarrage : une route du contrat sans action ne démarre pas.
   */
  static readonly serverRoutes = {
    "POST /demo/chat/send": { body: SendBody },
    "GET /demo/chat/history": { query: HistoryQuery },
  } satisfies ContractRouteSchemas<ChatContract>;
  // #endregion

  // #region chat-inject
  /**
   * Les services arrivent par leur NOM (`@Inject("ChatService")`) : le
   * contrôleur, recréé à chaque connexion, ne garde rien ; l'historique vit
   * dans le service, unique pour toute l'application.
   */
  constructor(
    context: ContextType,
    @Inject("ChatService") private readonly chat: ChatService,
    @Inject("DemoPulseService") private readonly pulse: DemoPulseService,
  ) {
    super("chat", context);
  }
  // #endregion

  // #region chat-door
  /** Ouvre le pont : les actions ci-dessous deviennent joignables par la socket. */
  protected override realtimeApiRequest(): boolean {
    return true;
  }

  /** La porte WebSocket : `handleRealtime` porte tout le protocole. */
  @route("demo-chat-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }
  // #endregion

  // #region chat-history
  /** L'historique — `GET /demo/chat/history` ou `socket.get(…)`, ouvert à tous. */
  @route("demo-chat-history", {
    path: "/history",
    requirements: { methods: ["GET", "WEBSOCKET"] },
    schema: { query: HistoryQuery },
  })
  history(input: RouteInput<{ query: typeof HistoryQuery }>): ChatMessage[] {
    return this.chat.recent(input.query.limit, input.query.since);
  }
  // #endregion

  // #region chat-send
  /**
   * L'envoi — `POST /demo/chat/send` ou `socket.post(…)`. Sans session : 403
   * (le visiteur anonyme n'a aucun rôle), avant d'entrer ici. La socket pose une clé d'idempotence par appel :
   * `@Idempotent()` rend la réponse déjà calculée à une trame rejouée, au lieu
   * de publier deux fois.
   */
  @route("demo-chat-send", {
    path: "/send",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { body: SendBody },
  })
  @IsGranted(["ROLE_USER"])
  @Idempotent()
  send(input: RouteInput<{ body: typeof SendBody }>): { sentAt: number } {
    const me = this.user;
    if (me === null) throw new HttpError("connexion requise", 401);
    const message: ChatMessage = {
      author: me.identifier,
      text: input.body.text,
      sentAt: Date.now(),
    };
    this.chat.add(message);
    getRealtimeHub<ChatContract>().publish(ROOM_CHANNEL, message);
    this.pulse.recordChatMessage();
    return { sentAt: message.sentAt };
  }
  // #endregion

  // #region chat-attach
  /**
   * Un message AVEC des pièces — `POST /demo/chat/attachments`, multipart : le
   * champ `text` et jusqu'à cinq fichiers. HTTP SEULEMENT : des octets en
   * volume voyagent en flux jusqu'au disque, jamais dans une trame de socket.
   * La réponse va à l'expéditeur ; le message part sur le salon comme tout
   * autre, et l'expéditeur le reçoit par la socket, comme tout le monde.
   * `@Idempotent()` exige l'en-tête `Idempotency-Key` : un formulaire d'un
   * autre site ne sait pas le poser, l'envoi forgé s'arrête là.
   */
  @route("demo-chat-attach", {
    path: "/attachments",
    requirements: { methods: ["POST"] },
    schema: { body: AttachBody },
  })
  @IsGranted(["ROLE_USER"])
  @Idempotent()
  async attach(
    input: RouteInput<{ body: typeof AttachBody }>,
  ): Promise<{ sentAt: number }> {
    const me = this.user;
    if (me === null) throw new HttpError("connexion requise", 401);
    const files = this.files.filter(isUploadedFile);
    // Les règles de la page, REJOUÉES ici : le navigateur n'est jamais cru.
    const problem = attachmentProblem(
      input.body.text,
      files.map((file) => ({ name: file.filename, size: file.size })),
    );
    if (problem !== null) {
      await this.chat.discard(files);
      throw new HttpError(problem, files.length === 0 ? 400 : 413);
    }
    const message: ChatMessage = {
      author: me.identifier,
      text: input.body.text,
      sentAt: Date.now(),
      attachments: await this.chat.saveAttachments(files),
    };
    this.chat.add(message);
    getRealtimeHub<ChatContract>().publish(ROOM_CHANNEL, message);
    this.pulse.recordChatMessage();
    return { sentAt: message.sentAt };
  }
  // #endregion

  // #region chat-file
  /**
   * Une pièce — `GET /demo/chat/files/<id>`, lecture libre comme l'historique.
   * Le type servi vient des OCTETS : seules les images reconnues s'affichent
   * dans la page, tout le reste se télécharge ; `nosniff` interdit au
   * navigateur de deviner, `sandbox` désarme un document ouvert dans un onglet.
   */
  @route("demo-chat-file", {
    path: "/files/{id}",
    requirements: { methods: ["GET"] },
  })
  async file(@Param("id") id: string): Promise<void> {
    const stored = this.chat.attachment(id);
    if (stored === undefined)
      throw new HttpError("pièce introuvable, ou sortie du stockage", 404);
    const inline = stored.meta.kind === "image";
    await this.streamFile(stored.file, {
      "Content-Type": stored.mime,
      "Content-Disposition": contentDisposition(
        inline ? "inline" : "attachment",
        stored.meta.name,
      ),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    });
  }
  // #endregion

  // #region chat-room
  /** Le salon : lecture libre. Il relaie, il n'émet rien de lui-même. */
  @RealtimeChannel(ROOM_CHANNEL)
  room(): () => void {
    return () => {};
  }
  // #endregion

  // #region chat-typing
  /** La frappe en cours : lecture libre, volatile. */
  @RealtimeChannel(TYPING_CHANNEL)
  typing(): () => void {
    return () => {};
  }

  /**
   * Le signal « j'écris » : réservé aux connectés, et SANS champ — l'auteur
   * vient de la connexion. Une écriture anonyme diffusée à tous serait une
   * porte ouverte au premier script venu.
   */
  @RealtimeInbound(TYPING_CHANNEL, { authenticated: true })
  onTyping(): void {
    const author = this.user?.identifier;
    if (author === undefined) return;
    getRealtimeHub<ChatContract>().publish(TYPING_CHANNEL, { author });
  }
  // #endregion
}

/**
 * L'en-tête `Content-Disposition` d'une pièce (RFC 6266) : un nom ASCII de
 * repli, et le vrai nom en UTF-8 (`filename*`, RFC 8187) — le nom vient du
 * client, il est encodé, jamais recopié tel quel dans un en-tête.
 */
function contentDisposition(
  type: "inline" | "attachment",
  name: string,
): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const utf8 = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export default ChatController;
