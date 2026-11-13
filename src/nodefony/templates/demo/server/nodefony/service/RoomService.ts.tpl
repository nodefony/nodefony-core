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
  RoomsNotice,
} from "../../frontend/src/chat/chatContract";
import type { IMessageArchive, IMessageDraft } from "./ChatService";
import {
  DIRECT_PREFIX,
  LOBBY_ROOM_ID,
  ROOM_NAME_MAX,
  ROOMS_OWNED_MAX,
  canAppoint,
  canManage,
  directKey,
  directPeer,
  headlineEvent,
  roomChannel,
  type IAdmissionFacts,
  type IRoomEvent,
  type IRoomView,
  type RoomAccess,
  type RoomRole,
} from "../../frontend/src/chat/rooms";

/** Au plus cent salons publics listés. */
const PUBLIC_ROOMS_MAX = 100;

/** « Ta liste de salons a changé » : un seul objet, poussé tel quel. */
const ROOMS_CHANGED: RoomsNotice = Object.freeze({ type: "rooms:changed" });

/**
 * Prévient une personne que sa liste de salons a changé : son canal
 * personnel (`user:<id>`) la joint sur tous les serveurs, la page relit.
 */
function pushRoomsChanged(userId: string): void {
  getRealtimeHub().publishToUser(userId, ROOMS_CHANGED);
}

/**
 * Pourquoi un geste sur les salons est refusé. Le service dit la RAISON, le
 * contrôleur en fait un statut HTTP (`ChatController`, `#refused`) : la même
 * règle sert une route, la socket, ou un test sans serveur.
 */
export type RoomRefusalReason =
  "not-found" | "forbidden" | "conflict" | "invalid";

/** Un geste refusé, avec un message lisible par la personne. */
export class RoomRefusal extends Error {
  override readonly name = "RoomRefusal";

  /**
   * @param reason - la raison, que le contrôleur traduit en statut
   * @param message - ce que la page affiche sous le champ fautif
   */
  constructor(
    readonly reason: RoomRefusalReason,
    message: string,
  ) {
    super(message);
  }
}

/** Ce que demande la création d'un salon — déjà validé par `CreateRoomBody`. */
export interface IRoomDraft {
  name: string;
  access: RoomAccess;
  description?: string | undefined;
}

/** Ce que demande un événement — déjà validé par `EventBody`. */
export interface IEventDraft {
  title: string;
  start: number;
  end: number;
  timeZone: string;
  attendees: readonly string[];
}

/** Un compte tel que les salons le connaissent : son identité et son nom. */
export interface IAccount {
  id: string;
  identifier: string;
}

/** Un événement tel que la liste le montre — jamais l'organisateur ni la description. */
function toRoomEvent(
  event: EventRow,
  partstat: IRoomEvent["partstat"],
): IRoomEvent {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    status: event.status,
    partstat,
  };
}

/** Un salon tel qu'une personne le voit. */
function toRoomView(
  room: RoomRow,
  role: RoomRole | null,
  event: IRoomEvent | null,
  peer: string | null,
): IRoomView {
  return {
    id: room.id,
    name: room.name,
    kind: room.kind,
    access: room.access,
    locked: room.locked,
    description: room.description ?? null,
    role,
    event,
    peer,
  };
}

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
    /** Ma réponse à chaque événement où l'on m'invite. */
    const answers = new Map<string, IRoomEvent["partstat"]>();
    if (userId !== null) {
      for (const member of await members.find({ userId }))
        roles.set(member.roomId, member.role);
      const wanted = new Set(roles.keys());
      // Une invitation DÉCLINÉE n'ouvre plus rien : son salon quitte la liste.
      const invited = (await attendees.find({ userId })).filter(
        (row) => row.partstat !== "declined",
      );
      for (const row of invited) answers.set(row.eventId, row.partstat);
      if (invited.length > 0)
        for (const event of await events.find({
          id: { $in: [...answers.keys()] },
        }))
          wanted.add(event.roomId);
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
    const peers = await this.#directPeers([...listed.values()], userId);
    return [...listed.values()].map((room) => {
      const event = headlineEvent(
        upcoming.filter((row) => row.roomId === room.id),
        now,
      );
      return toRoomView(
        room,
        roles.get(room.id) ?? null,
        event === null
          ? null
          : toRoomEvent(event, answers.get(event.id) ?? null),
        peers.get(room.id) ?? null,
      );
    });
  }

  /**
   * Le nom de L'AUTRE personne de chaque salon à deux de la liste — une seule
   * lecture `$in` des comptes, quel que soit le nombre de salons.
   */
  async #directPeers(
    listed: readonly RoomRow[],
    userId: string | null,
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (userId === null) return names;
    const peerOf = new Map<string, string>();
    for (const room of listed) {
      const peer = directPeer(room.name, userId);
      if (peer !== null) peerOf.set(room.id, peer);
    }
    if (peerOf.size === 0) return names;
    const accounts = await this.#accounts({ ids: [...peerOf.values()] });
    for (const [roomId, peer] of peerOf)
      names.set(
        roomId,
        accounts.find((a) => a.id === peer)?.identifier ?? "compte supprimé",
      );
    return names;
  }

  /**
   * Des comptes de l'application, par identité stable ou par identifiant de
   * connexion. Les comptes vivent dans la base de l'APPLICATION : la démo les
   * lit par `UserService`, quel que soit l'ORM (Drizzle ou Mongoose).
   */
  async #accounts(
    wanted: { ids: readonly string[] } | { identifiers: readonly string[] },
  ): Promise<IAccount[]> {
    const users = this.get<unknown>("users");
    if (!(users instanceof UserService)) return [];
    const found =
      "ids" in wanted
        ? await users.find({ id: { $in: [...wanted.ids] } })
        : await users.find({ identifier: { $in: [...wanted.identifiers] } });
    return found.map((user) => ({ id: user.id, identifier: user.identifier }));
  }

  /** Un salon par son identifiant, ou le refus qui le dit. */
  async #room(roomId: string): Promise<RoomRow> {
    const room = await this.#repos().rooms.findOne({ id: roomId });
    if (room === null) throw new RoomRefusal("not-found", "salon introuvable");
    return room;
  }

  /** Mon rôle dans un salon ; `null` si je n'en suis pas membre. */
  async #roleOf(roomId: string, userId: string): Promise<RoomRole | null> {
    const member = await this.#repos().members.findOne({ roomId, userId });
    return member?.role ?? null;
  }

  /**
   * La garde des formulaires d'un salon : il existe, ce n'est pas un salon à
   * deux, et je peux le gérer — relu EN BASE à chaque geste ; la page, qui
   * cache les boutons, ne décide jamais.
   */
  async #managed(roomId: string, userId: string): Promise<RoomRole> {
    const room = await this.#room(roomId);
    if (room.name.startsWith(DIRECT_PREFIX))
      throw new RoomRefusal(
        "forbidden",
        "un salon à deux ne s'ouvre pas à une troisième personne",
      );
    const role = await this.#roleOf(roomId, userId);
    if (role === null || !canManage(role))
      throw new RoomRefusal(
        "forbidden",
        "réservé au propriétaire du salon et à ses modérateurs",
      );
    return role;
  }

  // #region rooms-create
  /**
   * Crée un salon : la personne qui le crée en devient propriétaire. Deux
   * bornes, vérifiées en base : le nombre de salons qu'elle possède, et le
   * nom, unique. Deux créations simultanées du même nom passent toutes deux
   * la vérification : c'est la contrainte `UNIQUE` de la colonne qui tranche,
   * et son échec se relit en refus.
   *
   * @param ownerId - l'identité de la session, jamais un champ du client
   * @param draft - le salon demandé, déjà validé et normalisé
   * @throws RoomRefusal `conflict` — nom pris, ou quota atteint
   */
  async createRoom(
    ownerId: string,
    draft: IRoomDraft,
    now: number = Date.now(),
  ): Promise<IRoomView> {
    const { rooms, members } = this.#repos();
    if (
      (await members.count({ userId: ownerId, role: "owner" })) >=
      ROOMS_OWNED_MAX
    )
      throw new RoomRefusal(
        "conflict",
        `tu possèdes déjà ${ROOMS_OWNED_MAX} salons, le maximum de la démo`,
      );
    const taken = new RoomRefusal(
      "conflict",
      `le salon « ${draft.name} » existe déjà`,
    );
    if (await rooms.exists({ name: draft.name })) throw taken;
    let room: RoomRow;
    try {
      room = await rooms.create({
        name: draft.name,
        kind: "chat",
        access: draft.access,
        ownerId,
        description: draft.description ?? null,
        createdAt: now,
      });
    } catch (error) {
      if (await rooms.exists({ name: draft.name })) throw taken;
      throw error;
    }
    try {
      await members.create({
        roomId: room.id,
        userId: ownerId,
        role: "owner",
        joinedAt: now,
      });
    } catch (error) {
      // Un salon sans propriétaire ne se gère plus : on le retire.
      await rooms.deleteOne({ id: room.id });
      throw error;
    }
    pushRoomsChanged(ownerId);
    return toRoomView(room, "owner", null, null);
  }
  // #endregion

  // #region rooms-invite
  /**
   * Invite une personne, désignée par son identifiant EXACT : la démo ne
   * liste jamais les comptes. Le prix, assumé : un membre qui gère un salon
   * peut savoir si un identifiant existe.
   *
   * @param roomId - le salon
   * @param by - l'identité de qui invite
   * @param identifier - l'identifiant de connexion de l'invité
   * @param role - `member`, ou `moderator` si `by` est propriétaire
   * @throws RoomRefusal `forbidden`, `not-found` (salon, compte), `conflict` (déjà membre)
   */
  async invite(
    roomId: string,
    by: string,
    identifier: string,
    role: RoomRole,
  ): Promise<void> {
    if (!canAppoint(await this.#managed(roomId, by), role))
      throw new RoomRefusal(
        "forbidden",
        "seul le propriétaire nomme un modérateur",
      );
    const account = (await this.#accounts({ identifiers: [identifier] })).at(0);
    if (account === undefined)
      throw new RoomRefusal("not-found", `aucun compte « ${identifier} »`);
    if (await this.#repos().members.exists({ roomId, userId: account.id }))
      throw new RoomRefusal(
        "conflict",
        `${identifier} est déjà membre de ce salon`,
      );
    await this.addMember(roomId, account.id, role);
  }
  // #endregion

  /**
   * Planifie un événement dans un salon (RFC 5545) : l'organisateur est
   * `chair` et accepte d'office ; chaque invité reçoit une invitation
   * `needs-action`, et sa liste de salons change. L'invitation ouvre le salon
   * quinze minutes avant le début (`admissionOf`).
   *
   * @throws RoomRefusal `forbidden`, `not-found` (salon, comptes inconnus — tous nommés)
   */
  async planEvent(
    roomId: string,
    organizerId: string,
    draft: IEventDraft,
  ): Promise<IRoomEvent> {
    await this.#managed(roomId, organizerId);
    const { events, attendees } = this.#repos();
    const identifiers = [...new Set(draft.attendees)];
    const accounts =
      identifiers.length === 0 ? [] : await this.#accounts({ identifiers });
    const unknown = identifiers.filter(
      (identifier) => !accounts.some((a) => a.identifier === identifier),
    );
    if (unknown.length > 0)
      throw new RoomRefusal(
        "not-found",
        `aucun compte « ${unknown.join(" », « ")} »`,
      );
    const event = await events.create({
      roomId,
      organizerId,
      title: draft.title,
      start: draft.start,
      end: draft.end,
      timeZone: draft.timeZone,
      status: "confirmed",
    });
    const invited = accounts.filter((a) => a.id !== organizerId);
    try {
      await attendees.createMany([
        {
          eventId: event.id,
          userId: organizerId,
          role: "chair",
          partstat: "accepted",
        },
        ...invited.map((a) => ({
          eventId: event.id,
          userId: a.id,
          role: "req-participant" as const,
          partstat: "needs-action" as const,
        })),
      ]);
    } catch (error) {
      await events.deleteOne({ id: event.id });
      throw error;
    }
    // Tous les participants, organisateur compris : chaque liste change.
    pushRoomsChanged(organizerId);
    for (const a of invited) pushRoomsChanged(a.id);
    return toRoomEvent(event, "accepted");
  }

  /**
   * Répond à une invitation (iTIP `REPLY`). Décliner FERME la porte : une
   * admission acceptée est retenue sur la connexion, l'invité est donc
   * éjecté du salon où seule l'invitation le faisait entrer.
   *
   * @throws RoomRefusal `not-found` — événement inconnu, ou pas d'invitation
   */
  async reply(
    eventId: string,
    userId: string,
    partstat: "accepted" | "declined",
  ): Promise<void> {
    const { events, attendees, members } = this.#repos();
    const event = await events.findOne({ id: eventId });
    const answered =
      event === null
        ? null
        : await attendees.updateOne({ eventId, userId }, { partstat });
    if (event === null || answered === null)
      throw new RoomRefusal("not-found", "aucune invitation à cet événement");
    if (
      partstat === "declined" &&
      !(await members.exists({ roomId: event.roomId, userId }))
    ) {
      const room = await this.#repos().rooms.findOne({ id: event.roomId });
      if (room !== null && (room.access === "private" || room.locked))
        getRealtimeHub().evictUser(roomChannel(event.roomId), userId);
    }
    pushRoomsChanged(userId);
  }

  // #region rooms-direct
  /**
   * Ouvre le salon à deux de `me` et `peerId` — ou le CRÉE. Un `upsert` sur
   * le nom de la paire (`directKey`, colonne unique) : une seule requête,
   * pas de lecture puis d'écriture entre lesquelles un second clic se
   * glisserait. Les deux personnes en sont membres, et leurs deux listes
   * changent.
   *
   * @throws RoomRefusal `invalid` (soi-même), `not-found` (compte inconnu)
   */
  async openDirect(
    me: IAccount,
    peerId: string,
    now: number = Date.now(),
  ): Promise<IRoomView> {
    if (peerId === me.id)
      throw new RoomRefusal(
        "invalid",
        "un salon à deux se tient avec une autre personne",
      );
    const peer = (await this.#accounts({ ids: [peerId] })).at(0);
    if (peer === undefined) throw new RoomRefusal("not-found", "aucun compte");
    const name = directKey(me.id, peer.id);
    if (name.length > ROOM_NAME_MAX)
      throw new RoomRefusal(
        "invalid",
        "identifiants trop longs pour un salon à deux",
      );
    const { rooms, members } = this.#repos();
    const room = await rooms.upsert(
      { name },
      { access: "private" },
      { kind: "chat", ownerId: me.id, createdAt: now },
    );
    for (const userId of [me.id, peer.id]) {
      await members.upsert(
        { roomId: room.id, userId },
        { role: "member" },
        { joinedAt: now },
      );
      pushRoomsChanged(userId);
    }
    return toRoomView(room, "member", null, peer.identifier);
  }
  // #endregion

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
    pushRoomsChanged(userId);
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
    pushRoomsChanged(userId);
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
