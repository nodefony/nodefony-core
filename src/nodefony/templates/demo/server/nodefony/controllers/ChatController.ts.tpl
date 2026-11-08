import { Inject } from "nodefony";
import type { ContractRouteSchemas } from "nodefony";
import { controller, route, Idempotent, IsGranted } from "@nodefony/framework";
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
import { HistoryQuery, SendBody } from "../../frontend/src/chat/chatSchemas";
import {
  ROOM_CHANNEL,
  TYPING_CHANNEL,
  type ChatContract,
  type ChatMessage,
} from "../../frontend/src/chat/chatContract";
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
 * (`frontend/src/chat/lessonSteps.ts`) : les renommer casse son test.
 */
// #region chat-broadcast
// Plusieurs pods : chaque publication sur un canal `chat:` traverse le bus.
@RealtimeBroadcast("chat:")
@controller("/demo/chat")
// #endregion
class ChatController extends ContractRealtimeController<ChatContract> {
  /**
   * Les VALEURS des routes du contrat — le schéma même que chaque route valide.
   * Vérifiées au démarrage : une route du contrat sans action ne démarre pas.
   */
  static readonly serverRoutes = {
    "POST /demo/chat/send": { body: SendBody },
    "GET /demo/chat/history": { query: HistoryQuery },
  } satisfies ContractRouteSchemas<ChatContract>;

  constructor(
    context: ContextType,
    @Inject("ChatService") private readonly chat: ChatService,
    @Inject("DemoPulseService") private readonly pulse: DemoPulseService,
  ) {
    super("chat", context);
  }

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
   * L'envoi — `POST /demo/chat/send` ou `socket.post(…)`. Sans session : 401,
   * avant d'entrer ici. La socket pose une clé d'idempotence par appel :
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

export default ChatController;
