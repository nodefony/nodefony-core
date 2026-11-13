import { Service, Module, injectable } from "nodefony";
import type { IOrm, IRepository } from "@nodefony/orm-core";
import { ormRegistry } from "@nodefony/orm-core";
import { getRealtimeHub } from "@nodefony/realtime";
import {
  USER_REVOKED_EVENT,
  UserService,
  type IUserRevokedEvent,
} from "@nodefony/user";
import { DEMO_CONNECTOR } from "../config/config";
import {
  EVENT_ATTENDEE_ENTITY,
  EVENT_ENTITY,
  MESSAGE_ENTITY,
  ROOM_ENTITY,
  ROOM_MEMBER_ENTITY,
  type EventAttendeeRow,
  type EventRow,
  type MessageRow,
  type RoomMemberRow,
  type RoomRow,
} from "../entity/rooms";
import type {
  ChatMessage,
  ChatPerson,
} from "../../frontend/src/chat/chatContract";
import type { IMessageArchive, IMessageDraft } from "./ChatService";
import {
  LOBBY_ROOM_ID,
  headlineEvent,
  roomChannel,
  type IAdmissionFacts,
  type IRoomView,
  type RoomRole,
} from "../../frontend/src/chat/rooms";

/** Au plus cent salons publics listés. */
const PUBLIC_ROOMS_MAX = 100;

/** Le salon privé et l'événement semés en développement. */
const TEAM_ROOM_ID = "equipe";
const TEAM_EVENT_ID = "point-equipe";

/** Les cinq dépôts des salons. */
interface IRoomRepositories {
  orm: IOrm;
  rooms: IRepository<RoomRow>;
  members: IRepository<RoomMemberRow>;
  events: IRepository<EventRow>;
  attendees: IRepository<EventAttendeeRow>;
  messages: IRepository<MessageRow>;
}

/** Un message tel que le salon le montre : ni l'identité du compte, ni le salon. */
function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    author: row.author,
    text: row.text,
    sentAt: row.sentAt,
    ...(row.attachments ? { attachments: row.attachments } : {}),
  };
}

/**
 * Les salons du chat : qui y entre, qui y est, ce qu'on y voit — lus dans la
 * base SQLite de la démo (connecteur `demo`).
 *
 * Guide pour un agent : la RÈGLE d'admission est pure et partagée avec la
 * page (`frontend/src/chat/rooms.ts`, `admissionOf`) ; ce service ne fait
 * que LIRE les faits qu'elle demande. Les comptes vivent dans la base de
 * l'application : un salon ne garde que leur identifiant stable. Le lien se
 * fait donc par l'application — une lecture `$in` pour nommer
 * (`UserService.find`), et l'événement `onUserRevoked` pour retirer d'un
 * salon un compte supprimé. Tout changement d'appartenance est POUSSÉ :
 * `publishToUser` prévient la personne (sa liste de salons change), et
 * `evictUser` désabonne sur tous les serveurs qui la retire — une admission
 * acceptée est retenue sur la connexion, rien ne la périme seule.
 * Doc : `@nodefony/realtime/docs/canaux-a-membres.md`.
 */
@injectable()
class RoomService extends Service implements IMessageArchive {
  #repositories: IRoomRepositories | null = null;

  /**
   * @param module - le module qui le déclare ; absent dans un test, qui le
   *   construit sans kernel
   */
  constructor(module?: Module) {
    super("rooms", module?.container ?? undefined, module?.notificationsCenter);
    this.kernel?.on(USER_REVOKED_EVENT, (event: IUserRevokedEvent) =>
      event.reason === "deleted" ? this.forget(event.id) : undefined,
    );
  }

  /** La base de la démo est-elle ouverte ? (fermée sous une commande console) */
  isOpen(): boolean {
    return (
      ormRegistry.has(DEMO_CONNECTOR) &&
      ormRegistry.get(DEMO_CONNECTOR).isConnected()
    );
  }

  /**
   * Les dépôts, résolus au premier usage : l'ORM se connecte au démarrage
   * (`onBoot`), après la construction des services.
   *
   * @throws Error si le connecteur `demo` n'est pas ouvert
   */
  #repos(): IRoomRepositories {
    if (this.#repositories !== null) return this.#repositories;
    if (!ormRegistry.has(DEMO_CONNECTOR))
      throw new Error(
        `salons du chat : le connecteur « ${DEMO_CONNECTOR} » n'est pas ouvert (module @nodefony/drizzle chargé ?)`,
      );
    const orm = ormRegistry.get(DEMO_CONNECTOR);
    this.#repositories = {
      orm,
      rooms: orm.getRepository<RoomRow>(ROOM_ENTITY),
      members: orm.getRepository<RoomMemberRow>(ROOM_MEMBER_ENTITY),
      events: orm.getRepository<EventRow>(EVENT_ENTITY),
      attendees: orm.getRepository<EventAttendeeRow>(EVENT_ATTENDEE_ENTITY),
      messages: orm.getRepository<MessageRow>(MESSAGE_ENTITY),
    };
    return this.#repositories;
  }

  // #region messages-archive
  /**
   * Archive un message : la base tire son `id` (XEP-0359), l'instant est
   * celui du SERVEUR — jamais une horloge du client.
   */
  async archive(roomId: string, draft: IMessageDraft): Promise<ChatMessage> {
    const row = await this.#repos().messages.create({
      roomId,
      authorId: draft.authorId,
      author: draft.author,
      text: draft.text,
      sentAt: Date.now(),
      attachments: draft.attachments ?? null,
    });
    return toMessage(row);
  }

  /**
   * Les derniers messages d'un salon, dans l'ordre d'envoi : lus du plus
   * récent au plus ancien (l'index `message_room_sent_idx` sert les deux
   * critères), puis retournés.
   */
  async history(
    roomId: string,
    limit: number,
    since?: number,
  ): Promise<ChatMessage[]> {
    const rows = await this.#repos().messages.find(
      since === undefined ? { roomId } : { roomId, sentAt: { $gt: since } },
      { limit, order: [["sentAt", "DESC"]] },
    );
    return rows.reverse().map(toMessage);
  }
  // #endregion

  // #region rooms-admission
  /**
   * Ce que la base dit d'un salon et d'une personne — les faits que la règle
   * pure `admissionOf` tranche. Lu à chaque `subscribe` (et à chaque
   * reconnexion) : jamais de cache, une admission doit voir la base du moment.
   *
   * @param roomId - le salon demandé
   * @param userId - l'identité stable du compte ; `null` pour un anonyme
   */
  async admissionFacts(
    roomId: string,
    userId: string | null,
  ): Promise<IAdmissionFacts> {
    const { rooms, members, events, attendees } = this.#repos();
    const room = await rooms.findOne({ id: roomId });
    if (room === null) return { room: null, member: false, invitations: [] };
    const facts = { access: room.access, locked: room.locked };
    if (userId === null) return { room: facts, member: false, invitations: [] };
    if (await members.exists({ roomId, userId }))
      return { room: facts, member: true, invitations: [] };
    const invited = await attendees.find({ userId });
    if (invited.length === 0)
      return { room: facts, member: false, invitations: [] };
    const byEvent = new Map(invited.map((row) => [row.eventId, row.partstat]));
    const roomEvents = await events.find({
      roomId,
      id: { $in: [...byEvent.keys()] },
    });
    return {
      room: facts,
      member: false,
      invitations: roomEvents.map((event) => ({
        start: event.start,
        end: event.end,
        status: event.status,
        partstat: byEvent.get(event.id) ?? "needs-action",
      })),
    };
  }
  // #endregion

  /**
   * Les salons qu'une personne voit : les publics, ceux dont elle est membre,
   * ceux d'un événement auquel elle est invitée — chacun avec son rôle et
   * l'événement à montrer.
   *
   * @param userId - l'identité stable du compte ; `null` pour un anonyme
   * @param now - l'instant, en ms
   */
  async roomsFor(userId: string | null, now: number): Promise<IRoomView[]> {
    const { rooms, members, events, attendees } = this.#repos();
    const listed = new Map<string, RoomRow>();
    for (const room of await rooms.find(
      { access: "public" },
      { limit: PUBLIC_ROOMS_MAX, order: [["createdAt", "ASC"]] },
    ))
      listed.set(room.id, room);
    const roles = new Map<string, RoomRole>();
    if (userId !== null) {
      for (const member of await members.find({ userId }))
        roles.set(member.roomId, member.role);
      const invited = await attendees.find({ userId });
      const wanted = new Set(roles.keys());
      if (invited.length > 0) {
        const ids = invited.map((row) => row.eventId);
        for (const event of await events.find({ id: { $in: ids } }))
          wanted.add(event.roomId);
      }
      const missing = [...wanted].filter((id) => !listed.has(id));
      if (missing.length > 0)
        for (const room of await rooms.find({ id: { $in: missing } }))
          listed.set(room.id, room);
    }
    if (listed.size === 0) return [];
    const upcoming = await events.find({
      roomId: { $in: [...listed.keys()] },
      end: { $gte: now },
    });
    return [...listed.values()].map((room) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
      access: room.access,
      locked: room.locked,
      description: room.description ?? null,
      role: roles.get(room.id) ?? null,
      event: headlineEvent(
        upcoming.filter((event) => event.roomId === room.id),
        now,
      ),
    }));
  }

  // #region chat-people
  /**
   * Nomme les personnes PRÉSENTES dans un salon. La présence ne donne qu'une
   * identité opaque ; le nom vient des comptes, lus par l'ORM de
   * l'application (`UserService.find`, Drizzle ou Mongoose — la même ligne).
   *
   * Une identité absente du salon n'est jamais nommée : sans ce filtre, la
   * route deviendrait un annuaire de TOUS les comptes, à qui devinerait des
   * identifiants.
   *
   * @param roomId - le salon dont on nomme les présents
   * @param ids - les identités demandées, déjà bornées par `PeopleQuery`
   * @returns les présents trouvés ; un inconnu est simplement omis
   */
  async people(roomId: string, ids: readonly string[]): Promise<ChatPerson[]> {
    const present = getRealtimeHub().presence(roomChannel(roomId))?.members;
    if (present === undefined) return [];
    const wanted = [...new Set(ids)].filter((id) => present.has(id));
    const users = this.get<unknown>("users");
    if (wanted.length === 0 || !(users instanceof UserService)) return [];
    const found = await users.find({ id: { $in: wanted } });
    return found.map((user) => ({ id: user.id, name: user.identifier }));
  }
  // #endregion

  // #region rooms-membership
  /**
   * Ajoute un membre — puis le PRÉVIENT : sa liste de salons change, la page
   * la relit et s'abonne. L'appartenance est écrite AVANT le geste temps
   * réel : la page qui relit trouve le salon.
   */
  async addMember(
    roomId: string,
    userId: string,
    role: RoomRole = "member",
  ): Promise<void> {
    await this.#repos().members.upsert(
      { roomId, userId },
      { role },
      { joinedAt: Date.now() },
    );
    getRealtimeHub().publishToUser(userId, { type: "rooms:changed" });
  }

  /**
   * Retire un membre — puis l'ÉJECTE du salon sur tous les serveurs : son
   * admission était retenue sur sa connexion, rien ne l'aurait retirée seule.
   * Un salon public le garde comme simple visiteur : l'éjection ne vaut que
   * pour un salon où il n'a plus le droit d'entrer.
   */
  async removeMember(roomId: string, userId: string): Promise<void> {
    const { rooms, members } = this.#repos();
    await members.deleteOne({ roomId, userId });
    const room = await rooms.findOne({ id: roomId });
    if (room !== null && (room.access === "private" || room.locked))
      getRealtimeHub().evictUser(roomChannel(roomId), userId);
    getRealtimeHub().publishToUser(userId, { type: "rooms:changed" });
  }
  // #endregion

  /**
   * Un compte supprimé de l'application : ses appartenances, invitations et
   * messages disparaissent aussi de la base de la démo — l'intégrité qu'une
   * clé étrangère ne peut pas porter d'une base à l'autre, et l'effacement
   * qu'on doit à une personne qui part (RGPD, art. 17).
   */
  async forget(userId: string): Promise<void> {
    if (!this.isOpen()) return;
    const { members, attendees, messages } = this.#repos();
    await members.delete({ userId });
    await attendees.delete({ userId });
    await messages.delete({ authorId: userId });
  }

  /**
   * Sème les salons de démonstration, hors production : le salon public
   * (`salon`), un salon privé de l'administrateur, et un événement EN COURS
   * dans ce dernier — recalé à chaque démarrage. Idempotent : un salon déjà
   * là n'est pas recréé.
   */
  async seed(now: number = Date.now()): Promise<void> {
    // Une commande console charge aussi la démo, sans ouvrir de base.
    if (!this.isOpen()) return;
    const { rooms, members, events, attendees } = this.#repos();
    const users = this.get<unknown>("users");
    const admin =
      users instanceof UserService
        ? await users.findByIdentifier("admin")
        : null;
    const ownerId = admin?.id ?? "system";
    if (!(await rooms.exists({ id: LOBBY_ROOM_ID })))
      await rooms.create({
        id: LOBBY_ROOM_ID,
        name: "salon",
        kind: "chat",
        access: "public",
        ownerId,
        description: "Le salon public : lecture libre, écriture sous session.",
        createdAt: now,
      });
    if (admin === null) return;
    if (!(await rooms.exists({ id: TEAM_ROOM_ID })))
      await rooms.create({
        id: TEAM_ROOM_ID,
        name: "équipe",
        kind: "conference",
        access: "private",
        ownerId,
        description:
          "Un salon privé : membres et invités d'un événement en cours.",
        createdAt: now,
      });
    await members.upsert(
      { roomId: TEAM_ROOM_ID, userId: ownerId },
      { role: "owner" },
      { joinedAt: now },
    );
    await events.upsert(
      { id: TEAM_EVENT_ID },
      { start: now - 5 * 60_000, end: now + 55 * 60_000 },
      {
        roomId: TEAM_ROOM_ID,
        organizerId: ownerId,
        title: "Point d'équipe",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        status: "confirmed",
      },
    );
    await attendees.upsert(
      { eventId: TEAM_EVENT_ID, userId: ownerId },
      { partstat: "accepted" },
      { role: "chair" },
    );
  }
}

export default RoomService;
