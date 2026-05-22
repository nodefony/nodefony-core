import assert from "node:assert/strict";
import { DataTypes } from "sequelize";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IEntity, IRepository } from "@nodefony/orm-core";
import { SequelizeOrm } from "@nodefony/sequelize";

/**
 * **Portabilité ORM** — rejoue le MÊME modèle logique `mediasoup` (8 entités +
 * relations) sur l'adapter **Sequelize** (sqlite `:memory:`), avec la **même API
 * repository** que la version Drizzle (`orm-mediasoup.test.ts`).
 *
 * Le **schéma** est volontairement réécrit en `DataTypes` Sequelize : `orm-core`
 * abstrait au niveau **repository**, pas du schéma (driver-spécifique par design).
 * La preuve de portabilité = mêmes noms d'entités, mêmes relations, mêmes
 * scénarios CRUD/jointure/tx qui passent — quel que soit le moteur.
 */
const ORM = "mediasoup_sequelize_test";
const ENTITIES = [
  "User",
  "Room",
  "RoomMember",
  "Calendar",
  "Event",
  "Recording",
  "Tag",
  "EventTag",
] as const;

interface UserRow {
  id: string;
  identifier: string;
}
interface RoomRow {
  id: string;
  name: string;
  type: string;
  access: string;
  secure: boolean;
}
interface RoomMemberRow {
  id: string;
  roomId: string;
  userId: string;
  role: string;
  room?: RoomRow;
  user?: UserRow;
}
interface CalendarRow {
  id: string;
  etag: string;
  summary: string;
  conferenceProperties: unknown;
  creatorId: string;
  creator?: UserRow;
}
interface EventRow {
  id: string;
  summary: string;
  start: unknown;
  status?: string;
  calendarId: string;
  roomId?: string | null;
  creatorId: string;
  parentEventId?: string | null;
  deletedAt?: number | null;
  calendar?: CalendarRow;
  room?: RoomRow;
  creator?: UserRow;
  parent?: EventRow | null;
}
interface RecordingRow {
  id: string;
  roomId: string;
  eventId?: string | null;
  format: string;
  deletedAt?: number | null;
  room?: RoomRow;
  event?: EventRow | null;
}
interface TagRow {
  id: string;
  name: string;
}
interface EventTagRow {
  id: string;
  eventId: string;
  tagId: string;
  event?: EventRow;
  tag?: TagRow;
}

/** PK UUID fraîche par entité (ne pas partager l'objet entre `define`). */
const pk = () => ({
  type: DataTypes.UUID,
  defaultValue: DataTypes.UUIDV4,
  primaryKey: true,
});

/**
 * Enregistre le modèle mediasoup en **schémas Sequelize** (DataTypes). Les
 * colonnes FK (`roomId`, `creatorId`…) sont ajoutées par les associations
 * (`belongsTo`) de l'adapter — comme le banc Sequelize de référence.
 */
function registerSequelizeEntities(orm: string): void {
  const entities: IEntity[] = [
    {
      orm,
      module: "mediasoup",
      name: "User",
      schema: {
        id: pk(),
        identifier: { type: DataTypes.STRING, allowNull: false, unique: true },
        roles: { type: DataTypes.JSON, defaultValue: [] },
      },
    },
    {
      orm,
      module: "mediasoup",
      name: "Room",
      schema: {
        id: pk(),
        name: { type: DataTypes.STRING, allowNull: false, unique: true },
        type: { type: DataTypes.STRING, allowNull: false, defaultValue: "WEBRTC" },
        access: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "private",
        },
        secure: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        locked: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
      },
    },
    {
      orm,
      module: "mediasoup",
      name: "RoomMember",
      schema: {
        id: pk(),
        role: { type: DataTypes.STRING, allowNull: false, defaultValue: "member" },
        joinedAt: { type: DataTypes.BIGINT },
      },
      relations: [
        { type: "many-to-one", target: "Room", field: "room", foreignKey: "roomId" },
        { type: "many-to-one", target: "User", field: "user", foreignKey: "userId" },
      ],
    },
    {
      orm,
      module: "mediasoup",
      name: "Calendar",
      schema: {
        id: pk(),
        etag: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          unique: true,
        },
        summary: { type: DataTypes.STRING, allowNull: false },
        kind: { type: DataTypes.STRING, defaultValue: "calendar#calendar" },
        conferenceProperties: {
          type: DataTypes.JSON,
          defaultValue: { allowedConferenceSolutionTypes: ["MEETING"] },
        },
        isPrimary: { type: DataTypes.BOOLEAN, defaultValue: false },
      },
      relations: [
        {
          type: "many-to-one",
          target: "User",
          field: "creator",
          foreignKey: "creatorId",
        },
      ],
    },
    {
      orm,
      module: "mediasoup",
      name: "Event",
      schema: {
        id: pk(),
        summary: { type: DataTypes.STRING, allowNull: false },
        start: { type: DataTypes.JSON },
        end: { type: DataTypes.JSON },
        status: { type: DataTypes.STRING },
        timezone: { type: DataTypes.STRING, defaultValue: "Europe/Paris" },
        visibility: { type: DataTypes.STRING, defaultValue: "default" },
        deletedAt: { type: DataTypes.BIGINT, allowNull: true },
      },
      relations: [
        {
          type: "many-to-one",
          target: "Calendar",
          field: "calendar",
          foreignKey: "calendarId",
        },
        { type: "many-to-one", target: "Room", field: "room", foreignKey: "roomId" },
        {
          type: "many-to-one",
          target: "User",
          field: "creator",
          foreignKey: "creatorId",
        },
        {
          type: "many-to-one",
          target: "Event",
          field: "parent",
          foreignKey: "parentEventId",
        },
      ],
    },
    {
      orm,
      module: "mediasoup",
      name: "Recording",
      schema: {
        id: pk(),
        kind: { type: DataTypes.STRING, allowNull: false, defaultValue: "video" },
        format: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "webm",
        },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "recording",
        },
        metadata: { type: DataTypes.JSON, defaultValue: {} },
        deletedAt: { type: DataTypes.BIGINT, allowNull: true },
      },
      relations: [
        { type: "many-to-one", target: "Room", field: "room", foreignKey: "roomId" },
        {
          type: "many-to-one",
          target: "Event",
          field: "event",
          foreignKey: "eventId",
        },
      ],
    },
    {
      orm,
      module: "mediasoup",
      name: "Tag",
      schema: {
        id: pk(),
        name: { type: DataTypes.STRING, allowNull: false, unique: true },
        color: { type: DataTypes.STRING, defaultValue: "#888888" },
      },
    },
    {
      orm,
      module: "mediasoup",
      name: "EventTag",
      schema: { id: pk() },
      relations: [
        {
          type: "many-to-one",
          target: "Event",
          field: "event",
          foreignKey: "eventId",
        },
        { type: "many-to-one", target: "Tag", field: "tag", foreignKey: "tagId" },
      ],
    },
  ];
  for (const entity of entities) {
    entityRegistry.register(entity);
  }
}

describe("portabilité : modèle mediasoup sur Sequelize", () => {
  let orm: SequelizeOrm;
  let users: IRepository<UserRow>;
  let rooms: IRepository<RoomRow>;
  let members: IRepository<RoomMemberRow>;
  let calendars: IRepository<CalendarRow>;
  let events: IRepository<EventRow>;
  let recordings: IRepository<RecordingRow>;
  let tags: IRepository<TagRow>;
  let eventTags: IRepository<EventTagRow>;

  before(async () => {
    registerSequelizeEntities(ORM);
    orm = new SequelizeOrm(ORM, {
      dialect: "sqlite",
      storage: ":memory:",
      logging: false,
    });
    await orm.connect();
    users = orm.getRepository<UserRow>("User");
    rooms = orm.getRepository<RoomRow>("Room");
    members = orm.getRepository<RoomMemberRow>("RoomMember");
    calendars = orm.getRepository<CalendarRow>("Calendar");
    events = orm.getRepository<EventRow>("Event");
    recordings = orm.getRepository<RecordingRow>("Recording");
    tags = orm.getRepository<TagRow>("Tag");
    eventTags = orm.getRepository<EventTagRow>("EventTag");
  });

  after(async () => {
    await orm.disconnect();
    for (const name of ENTITIES) {
      entityRegistry.unregister(name, ORM);
    }
    ormRegistry.unregister(ORM);
  });

  it("se connecte + 8 entités (même modèle, moteur Sequelize)", () => {
    assert.equal(orm.isConnected(), true);
    assert.equal(entityRegistry.list().filter((e) => e.orm === ORM).length, 8);
  });

  it("Room : défauts ENUM + name unique", async () => {
    const r = await rooms.create({ name: "general" });
    assert.match(r.id, /[0-9a-f-]{36}/);
    assert.equal(r.type, "WEBRTC");
    assert.equal(r.access, "private");
    assert.equal(r.secure, false);
    await assert.rejects(rooms.create({ name: "general" })); // unique
  });

  it("Calendar : JSON conferenceProperties + N-1 creator (eager-load)", async () => {
    const creator = await users.create({ identifier: "alice" });
    const cal = await calendars.create({
      summary: "Équipe",
      creatorId: creator.id,
    });
    assert.match(cal.etag, /[0-9a-f-]{36}/);
    assert.deepEqual(cal.conferenceProperties, {
      allowedConferenceSolutionTypes: ["MEETING"],
    });
    const withCreator = await calendars.findOne(
      { id: cal.id },
      { relations: ["creator"] },
    );
    assert.equal(withCreator?.creator?.identifier, "alice");
  });

  it("N-N RoomMember : jonction Room↔User + eager-load", async () => {
    const room = await rooms.create({ name: "salle-vip" });
    const u1 = await users.create({ identifier: "bob" });
    const u2 = await users.create({ identifier: "carol" });
    await members.create({ roomId: room.id, userId: u1.id, role: "host" });
    await members.create({ roomId: room.id, userId: u2.id });
    assert.equal((await members.find({ roomId: room.id })).length, 2);
    const host = await members.findOne(
      { roomId: room.id, userId: u1.id },
      { relations: ["room", "user"] },
    );
    assert.equal(host?.room?.name, "salle-vip");
    assert.equal(host?.user?.identifier, "bob");
  });

  it("Event : 3 FK + JSON start + eager-load", async () => {
    const creator = await users.create({ identifier: "dave" });
    const cal = await calendars.create({ summary: "Cal", creatorId: creator.id });
    const room = await rooms.create({ name: "salle-event" });
    const ev = await events.create({
      summary: "Standup",
      calendarId: cal.id,
      roomId: room.id,
      creatorId: creator.id,
      start: { dateTime: 1700000000000, timeZone: "Europe/Paris" },
    });
    assert.deepEqual(ev.start, {
      dateTime: 1700000000000,
      timeZone: "Europe/Paris",
    });
    const full = await events.findOne(
      { id: ev.id },
      { relations: ["calendar", "room", "creator"] },
    );
    assert.equal(full?.calendar?.summary, "Cal");
    assert.equal(full?.room?.name, "salle-event");
    assert.equal(full?.creator?.identifier, "dave");
  });

  it("Event : auto-référence parentEventId + eager-load parent", async () => {
    const creator = await users.create({ identifier: "erin" });
    const cal = await calendars.create({ summary: "Rec", creatorId: creator.id });
    const master = await events.create({
      summary: "Daily (maître)",
      calendarId: cal.id,
      creatorId: creator.id,
    });
    const instance = await events.create({
      summary: "Daily 2026-05-22",
      calendarId: cal.id,
      creatorId: creator.id,
      parentEventId: master.id,
    });
    const withParent = await events.findOne(
      { id: instance.id },
      { relations: ["parent"] },
    );
    assert.equal(withParent?.parent?.id, master.id);
  });

  it("Recording : FK eventId NULLABLE + eager-load", async () => {
    const creator = await users.create({ identifier: "frank" });
    const cal = await calendars.create({ summary: "C", creatorId: creator.id });
    const room = await rooms.create({ name: "salle-rec" });
    const ev = await events.create({
      summary: "Réunion",
      calendarId: cal.id,
      creatorId: creator.id,
      roomId: room.id,
    });
    await recordings.create({ roomId: room.id, eventId: ev.id });
    await recordings.create({ roomId: room.id }); // ad-hoc : eventId NULL
    const all = await recordings.find({ roomId: room.id });
    assert.equal(all.length, 2);
    assert.equal(all.some((r) => (r.eventId ?? null) === null), true);
    const planned = await recordings.findOne(
      { roomId: room.id, eventId: ev.id },
      { relations: ["room", "event"] },
    );
    assert.equal(planned?.room?.name, "salle-rec");
    assert.equal(planned?.event?.summary, "Réunion");
    assert.equal(planned?.format, "webm");
  });

  it("Recording : soft-delete (deletedAt) — ligne conservée", async () => {
    const room = await rooms.create({ name: "salle-soft" });
    const rec = await recordings.create({ roomId: room.id });
    assert.equal(rec.deletedAt ?? null, null);
    await recordings.update({ id: rec.id }, { deletedAt: Date.now() });
    const after = await recordings.findOne({ id: rec.id });
    assert.ok(after, "ligne toujours présente (suppression logique)");
    assert.ok(after?.deletedAt, "deletedAt renseigné");
  });

  it("Tag : UNIQUE name + N-N EventTag", async () => {
    const creator = await users.create({ identifier: "gina" });
    const cal = await calendars.create({ summary: "C2", creatorId: creator.id });
    const ev = await events.create({
      summary: "Tagué",
      calendarId: cal.id,
      creatorId: creator.id,
    });
    const t1 = await tags.create({ name: "urgent" });
    const t2 = await tags.create({ name: "interne" });
    await assert.rejects(tags.create({ name: "urgent" })); // unique
    await eventTags.create({ eventId: ev.id, tagId: t1.id });
    await eventTags.create({ eventId: ev.id, tagId: t2.id });
    assert.equal((await eventTags.find({ eventId: ev.id })).length, 2);
    const link = await eventTags.findOne(
      { eventId: ev.id, tagId: t1.id },
      { relations: ["event", "tag"] },
    );
    assert.equal(link?.event?.summary, "Tagué");
    assert.equal(link?.tag?.name, "urgent");
  });

  it("Opérateurs riches : events par statut ($in) + summary ($like)", async () => {
    const creator = await users.create({ identifier: "hugo" });
    const cal = await calendars.create({ summary: "Ops", creatorId: creator.id });
    const base = { calendarId: cal.id, creatorId: creator.id };
    await events.create({ ...base, summary: "ops-confirmed", status: "confirmed" });
    await events.create({ ...base, summary: "ops-tentative", status: "tentative" });
    await events.create({ ...base, summary: "ops-cancelled", status: "cancelled" });
    const active = await events.find({
      creatorId: creator.id,
      status: { $in: ["confirmed", "tentative"] },
    });
    assert.equal(active.length, 2);
    const byLike = await events.find({
      creatorId: creator.id,
      summary: { $like: "ops-conf%" },
    });
    assert.equal(byLike.length, 1);
  });

  it("Transaction : commit persiste, rollback annule", async () => {
    const creator = await users.create({ identifier: "iris" });
    const cal = await calendars.create({ summary: "Tx", creatorId: creator.id });
    const room = await rooms.create({ name: "salle-tx" });
    await orm.transaction(async (tx) => {
      const ev = await events
        .withTransaction(tx)
        .create({ summary: "tx-ok", calendarId: cal.id, creatorId: creator.id });
      await recordings
        .withTransaction(tx)
        .create({ roomId: room.id, eventId: ev.id });
    });
    assert.equal((await events.find({ summary: "tx-ok" })).length, 1);
    await assert.rejects(
      orm.transaction(async (tx) => {
        await events
          .withTransaction(tx)
          .create({ summary: "tx-ko", calendarId: cal.id, creatorId: creator.id });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await events.findOne({ summary: "tx-ko" }), null);
  });
});
