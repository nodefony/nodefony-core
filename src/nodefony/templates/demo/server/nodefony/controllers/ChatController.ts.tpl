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
} from "@nodefony/realtime";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
import {
  AttachBody,
  CreateRoomBody,
  EventBody,
  EventParams,
  HistoryQuery,
  InviteBody,
  LinkParams,
  PeopleQuery,
  ReplyBody,
  RoomParams,
  SendBody,
  UserParams,
} from "../../frontend/src/chat/chatSchemas";
import { attachmentProblem } from "../../frontend/src/chat/attachments";
import {
  PRESENCE_GRACE_MS,
  type ChatContract,
  type ChatLinkPreview,
  type ChatMessage,
  type ChatPerson,
} from "../../frontend/src/chat/chatContract";
import {
  ROOM_CHANNEL_PATTERN,
  admissionOf,
  roomIdOf,
  type IRoomEvent,
  type IRoomView,
} from "../../frontend/src/chat/rooms";
import { isUploadedFile } from "../service/ChatService";
import type ChatService from "../service/ChatService";
import type RoomService from "../service/RoomService";
import { RoomRefusal, type RoomRefusalReason } from "../service/RoomService";
import RoomAdmission from "../service/RoomAdmission";

/** Une route qui vise un salon : `/demo/chat/rooms/{room}/…`. */
type RoomInput<S extends object = object> = RouteInput<
  { params: typeof RoomParams } & S
>;

/**
 * Les salons du chat — UN contrôleur, deux transports : chaque action répond
 * en HTTP ET par la socket (`/demo/chat/realtime`), sous la même sécurité.
 *
 * Guide pour un agent :
 *  • un SALON = un canal `chat:room:<id>` ; qui y entre est décidé par la
 *    règle des salons (`frontend/src/chat/rooms.ts`, `admissionOf`), lue en
 *    base par `RoomAdmission` pour la socket et par `#admitted` pour les
 *    routes — la MÊME règle, quel que soit le chemin ;
 *  • LIRE un salon public est libre, ÉCRIRE exige une session (`@IsGranted`)
 *    ET d'être admis ; l'auteur vient de `this.user`, jamais d'un champ du
 *    client ;
 *  • corps, queries et paramètres sont VALIDÉS avant l'action (`schema`), par
 *    les schémas partagés de `frontend/src/chat/chatSchemas.ts` ;
 *  • l'historique vit dans `ChatService`, les salons dans `RoomService` (un
 *    contrôleur temps réel est instancié par connexion) ;
 *  • `@RealtimeBroadcast("chat:")` fait traverser chaque salon d'un serveur à
 *    l'autre (plusieurs pods, `nodefony cluster`).
 * Doc : `@nodefony/realtime/docs/canaux-a-membres.md` ; générer l'équivalent :
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
    "GET /demo/chat/rooms": {},
    "POST /demo/chat/rooms/{room}/send": { params: RoomParams, body: SendBody },
    "POST /demo/chat/rooms/{room}/typing": { params: RoomParams },
    "GET /demo/chat/rooms/{room}/history": {
      params: RoomParams,
      query: HistoryQuery,
    },
    "GET /demo/chat/rooms/{room}/people": {
      params: RoomParams,
      query: PeopleQuery,
    },
    "POST /demo/chat/rooms": { body: CreateRoomBody },
    "POST /demo/chat/rooms/{room}/members": {
      params: RoomParams,
      body: InviteBody,
    },
    "POST /demo/chat/rooms/{room}/events": {
      params: RoomParams,
      body: EventBody,
    },
    "POST /demo/chat/events/{event}/reply": {
      params: EventParams,
      body: ReplyBody,
    },
    "POST /demo/chat/direct/{user}": { params: UserParams },
    "GET /demo/chat/rooms/{room}/messages/{message}/links/{index}": {
      params: LinkParams,
    },
  } satisfies ContractRouteSchemas<ChatContract>;
  // #endregion

  // #region chat-inject
  /**
   * Les services arrivent par leur NOM (`@Inject("ChatService")`) : le
   * contrôleur, recréé à chaque connexion, ne garde rien ; l'historique et
   * les salons vivent dans des services, uniques pour toute l'application.
   */
  constructor(
    context: ContextType,
    @Inject("ChatService") private readonly chat: ChatService,
    @Inject("RoomService") private readonly rooms: RoomService,
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

  // #region chat-admitted
  /**
   * La garde des routes d'un salon — la MÊME règle que le canal : un salon
   * inconnu répond 404, un salon où l'on n'entre pas répond 403.
   */
  async #admitted(roomId: string): Promise<void> {
    const facts = await this.rooms.admissionFacts(
      roomId,
      this.user?.id ?? null,
    );
    if (facts.room === null) throw new HttpError("salon introuvable", 404);
    if (admissionOf(facts, Date.now()) === "refused")
      throw new HttpError("ce salon est réservé à ses membres", 403);
  }
  // #endregion

  // #region chat-rooms
  /** Les salons que je vois : publics, les miens, ceux où l'on m'invite. */
  @route("demo-chat-rooms", {
    path: "/rooms",
    requirements: { methods: ["GET", "WEBSOCKET"] },
  })
  roomList(): Promise<IRoomView[]> {
    return this.rooms.roomsFor(this.user?.id ?? null, Date.now());
  }
  // #endregion

  /** La personne connectée — `@IsGranted` l'a déjà exigée. */
  #me(): { id: string; identifier: string } {
    const me = this.user;
    if (me === null) throw new HttpError("connexion requise", 401);
    return me;
  }

  // #region rooms-refused
  /**
   * Un geste du service, son refus traduit en statut, avec le message que la
   * page affiche sous le champ fautif. La seule traduction : `RoomService`
   * dit POURQUOI, le contrôleur dit COMMENT.
   */
  async #refused<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof RoomRefusal)
        throw new HttpError(error.message, statusOf(error.reason));
      throw error;
    }
  }
  // #endregion

  // #region rooms-create-route
  /**
   * Créer un salon — `POST /demo/chat/rooms` ou `socket.post(…)`. Le nom
   * arrive validé ET normalisé (`CreateRoomBody`) ; la session en devient
   * propriétaire. `@Idempotent()` : un double clic ne crée qu'un salon.
   */
  @route("demo-chat-room-create", {
    path: "/rooms",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { body: CreateRoomBody },
  })
  @IsGranted(["ROLE_USER"])
  @Idempotent()
  createRoom(
    input: RouteInput<{ body: typeof CreateRoomBody }>,
  ): Promise<IRoomView> {
    const me = this.#me();
    return this.#refused(() => this.rooms.createRoom(me.id, input.body));
  }
  // #endregion

  // #region rooms-invite-route
  /**
   * Inviter — `POST …/rooms/{room}/members`. Le rôle de qui invite est relu
   * EN BASE (le bouton caché par la page ne protège rien) : 403 sinon.
   */
  @route("demo-chat-room-invite", {
    path: "/rooms/{room}/members",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { params: RoomParams, body: InviteBody },
  })
  @IsGranted(["ROLE_USER"])
  async invite(
    input: RoomInput<{ body: typeof InviteBody }>,
  ): Promise<{ ok: true }> {
    const me = this.#me();
    await this.#refused(() =>
      this.rooms.invite(
        input.params.room,
        me.id,
        input.body.identifier,
        input.body.role,
      ),
    );
    return { ok: true };
  }
  // #endregion

  /** Planifier un événement — `POST …/rooms/{room}/events`. */
  @route("demo-chat-room-event", {
    path: "/rooms/{room}/events",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { params: RoomParams, body: EventBody },
  })
  @IsGranted(["ROLE_USER"])
  @Idempotent()
  planEvent(input: RoomInput<{ body: typeof EventBody }>): Promise<IRoomEvent> {
    const me = this.#me();
    return this.#refused(() =>
      this.rooms.planEvent(input.params.room, me.id, input.body),
    );
  }

  /** Accepter ou décliner une invitation — `POST /demo/chat/events/{event}/reply`. */
  @route("demo-chat-event-reply", {
    path: "/events/{event}/reply",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { params: EventParams, body: ReplyBody },
  })
  @IsGranted(["ROLE_USER"])
  async reply(
    input: RouteInput<{
      params: typeof EventParams;
      body: typeof ReplyBody;
    }>,
  ): Promise<{ ok: true }> {
    const me = this.#me();
    await this.#refused(() =>
      this.rooms.reply(input.params.event, me.id, input.body.partstat),
    );
    return { ok: true };
  }

  // #region rooms-direct-route
  /**
   * Écrire en privé — `POST /demo/chat/direct/{user}` : rend le salon à deux,
   * existant ou neuf. Sans corps, et sans `@Idempotent()` : l'opération l'est
   * par construction (un `upsert` sur le nom de la paire).
   */
  @route("demo-chat-direct", {
    path: "/direct/{user}",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { params: UserParams },
  })
  @IsGranted(["ROLE_USER"])
  openDirect(
    input: RouteInput<{ params: typeof UserParams }>,
  ): Promise<IRoomView> {
    const me = this.#me();
    return this.#refused(() => this.rooms.openDirect(me, input.params.user));
  }
  // #endregion

  // #region chat-history
  /** L'historique d'un salon — `GET …/history` ou `socket.get(…)`. */
  @route("demo-chat-history", {
    path: "/rooms/{room}/history",
    requirements: { methods: ["GET", "WEBSOCKET"] },
    schema: { params: RoomParams, query: HistoryQuery },
  })
  async history(
    input: RoomInput<{ query: typeof HistoryQuery }>,
  ): Promise<ChatMessage[]> {
    await this.#admitted(input.params.room);
    return this.chat.recent(
      input.params.room,
      input.query.limit,
      input.query.since,
    );
  }

  /**
   * L'aperçu d'un lien d'un message — `GET …/messages/{message}/links/{index}`.
   * Jamais une adresse : le lien de rang `index` du message, relu en base,
   * dans un salon où l'on entre.
   */
  @route("demo-chat-link", {
    path: "/rooms/{room}/messages/{message}/links/{index}",
    requirements: { methods: ["GET", "WEBSOCKET"] },
    schema: { params: LinkParams },
  })
  async link(
    input: RouteInput<{ params: typeof LinkParams }>,
  ): Promise<ChatLinkPreview> {
    await this.#admitted(input.params.room);
    throw new HttpError("aperçu de lien : pas encore servi", 501);
  }
  // #endregion

  // #region chat-send
  /**
   * L'envoi — `POST …/send` ou `socket.post(…)`. Sans session : 403 (le
   * visiteur anonyme n'a aucun rôle), avant d'entrer ici. La socket pose une
   * clé d'idempotence par appel : `@Idempotent()` rend la réponse déjà
   * calculée à une trame rejouée, au lieu de publier deux fois.
   */
  @route("demo-chat-send", {
    path: "/rooms/{room}/send",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { params: RoomParams, body: SendBody },
  })
  @IsGranted(["ROLE_USER"])
  @Idempotent()
  async send(
    input: RoomInput<{ body: typeof SendBody }>,
  ): Promise<{ id: string; sentAt: number }> {
    const me = this.user;
    if (me === null) throw new HttpError("connexion requise", 401);
    await this.#admitted(input.params.room);
    const { id, sentAt } = await this.chat.publish(input.params.room, {
      authorId: me.id,
      author: me.identifier,
      text: input.body.text,
    });
    return { id, sentAt };
  }
  // #endregion

  // #region chat-attach
  /**
   * Un message AVEC des pièces — `POST …/attachments`, multipart : le champ
   * `text` et jusqu'à cinq fichiers. HTTP SEULEMENT : des octets en volume
   * voyagent en flux jusqu'au disque, jamais dans une trame de socket. Le
   * message part sur le salon comme tout autre. `@Idempotent()` exige
   * l'en-tête `Idempotency-Key` : un formulaire d'un autre site ne sait pas le
   * poser, l'envoi forgé s'arrête là.
   */
  @route("demo-chat-attach", {
    path: "/rooms/{room}/attachments",
    requirements: { methods: ["POST"] },
    schema: { params: RoomParams, body: AttachBody },
  })
  @IsGranted(["ROLE_USER"])
  @Idempotent()
  async attach(
    input: RoomInput<{ body: typeof AttachBody }>,
  ): Promise<{ id: string; sentAt: number }> {
    const me = this.user;
    if (me === null) throw new HttpError("connexion requise", 401);
    const files = this.files.filter(isUploadedFile);
    try {
      await this.#admitted(input.params.room);
    } catch (refusal) {
      await this.chat.discard(files);
      throw refusal;
    }
    // Les règles de la page, REJOUÉES ici : le navigateur n'est jamais cru.
    const problem = attachmentProblem(
      input.body.text,
      files.map((file) => ({ name: file.filename, size: file.size })),
    );
    if (problem !== null) {
      await this.chat.discard(files);
      throw new HttpError(problem, files.length === 0 ? 400 : 413);
    }
    const { id, sentAt } = await this.chat.publish(input.params.room, {
      authorId: me.id,
      author: me.identifier,
      text: input.body.text,
      attachments: await this.chat.saveAttachments(files),
    });
    return { id, sentAt };
  }
  // #endregion

  // #region chat-file
  /**
   * Une pièce — `GET /demo/chat/files/<id>`. Son adresse est un identifiant
   * tiré au hasard par le serveur, impossible à deviner. Le type servi vient
   * des OCTETS : seules les images reconnues et les PDF s'affichent, tout le
   * reste se télécharge ; `nosniff` interdit au navigateur de deviner,
   * `sandbox` désarme un document ouvert dans un onglet. Un PDF fait
   * exception à `sandbox` : Chrome refuse d'afficher un PDF sous `sandbox`.
   * Sa visionneuse est isolée de la page, et il ne s'encadre que par une page
   * de l'application (`frame-ancestors 'self'`).
   */
  @route("demo-chat-file", {
    path: "/files/{id}",
    requirements: { methods: ["GET"] },
  })
  async file(@Param("id") id: string): Promise<void> {
    const stored = this.chat.attachment(id);
    if (stored === undefined)
      throw new HttpError("pièce introuvable, ou sortie du stockage", 404);
    const pdf = stored.meta.kind === "pdf";
    const inline = pdf || stored.meta.kind === "image";
    await this.streamFile(stored.file, {
      "Content-Type": stored.mime,
      "Content-Disposition": contentDisposition(
        inline ? "inline" : "attachment",
        stored.meta.name,
      ),
      "X-Content-Type-Options": "nosniff",
      ...(pdf
        ? {
            "Content-Security-Policy": "frame-ancestors 'self'",
            "X-Frame-Options": "SAMEORIGIN",
          }
        : { "Content-Security-Policy": "sandbox" }),
    });
  }
  // #endregion

  // #region chat-people-route
  /**
   * L'annuaire d'un salon — `GET …/people?ids=…`. La page reçoit des
   * identités opaques par la présence ; elle demande ici leurs noms, et seuls
   * les PRÉSENTS de CE salon sont nommés (`RoomService.people`).
   */
  @route("demo-chat-people", {
    path: "/rooms/{room}/people",
    requirements: { methods: ["GET", "WEBSOCKET"] },
    schema: { params: RoomParams, query: PeopleQuery },
  })
  async people(
    input: RoomInput<{ query: typeof PeopleQuery }>,
  ): Promise<ChatPerson[]> {
    await this.#admitted(input.params.room);
    return this.rooms.people(input.params.room, input.query.ids);
  }
  // #endregion

  // #region chat-room
  /**
   * Tous les salons, déclarés UNE fois par un motif. `RoomAdmission` tranche
   * qui entre (lu en base, au `subscribe`) ; `anonymous: true` laisse un
   * visiteur lire un salon PUBLIC — la règle le refuse ailleurs. La présence
   * suit l'abonnement : qui est admis figure dans la liste, nommé s'il a un
   * compte, compté sinon ; un départ attend `grace` avant d'être annoncé
   * (ADR-0025 P5).
   */
  @RealtimeChannel(ROOM_CHANNEL_PATTERN, {
    allow: RoomAdmission,
    anonymous: true,
    presence: { grace: PRESENCE_GRACE_MS },
  })
  room(): () => void {
    return () => {};
  }

  /**
   * Un canal décoré n'est servi que sous son nom exact : chaque salon de la
   * famille l'est ici. Synchrone et sans lecture — c'est `RoomAdmission` qui
   * lit la base.
   */
  override createRealtimeChannel(channel: string): (() => void) | null {
    return roomIdOf(channel) === null ? null : () => {};
  }
  // #endregion

  // #region chat-typing
  /**
   * « J'écris » — `POST …/typing`, sans corps : l'auteur vient de la
   * connexion. Réservé aux connectés ADMIS dans le salon ; le signal part sur
   * le canal du salon, en message éphémère, et ne fuit donc jamais hors de
   * lui.
   */
  @route("demo-chat-typing", {
    path: "/rooms/{room}/typing",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { params: RoomParams },
  })
  @IsGranted(["ROLE_USER"])
  async typing(input: RoomInput): Promise<{ ok: true }> {
    const author = this.user?.identifier;
    if (author === undefined) throw new HttpError("connexion requise", 401);
    await this.#admitted(input.params.room);
    this.chat.typing(input.params.room, author);
    return { ok: true };
  }
  // #endregion
}

/**
 * Le statut HTTP d'une raison de refus. Le `switch` est EXHAUSTIF : une
 * raison ajoutée au service sans statut ne compile pas.
 */
function statusOf(reason: RoomRefusalReason): number {
  switch (reason) {
    case "not-found":
      return 404;
    case "forbidden":
      return 403;
    case "conflict":
      return 409;
    case "invalid":
      return 422;
  }
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
