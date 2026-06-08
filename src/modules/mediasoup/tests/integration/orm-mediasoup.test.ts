import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "@nodefony/drizzle";
import { registerMediasoupEntities } from "../../nodefony/entity/schema";

/**
 * Banc d'intégration ORM sur le modèle `mediasoup` (Drizzle, `:memory:`).
 *
 * Couvre les cas « riches » de l'abstraction `@nodefony/orm-core` sur un modèle
 * métier réaliste : N-N via jonction (×2), auto-référence, FK nullable,
 * soft-delete, contrainte unique, colonnes JSON, eager-load portable,
 * transactions (commit/rollback). Les tests unitaires génériques restent dans
 * `@nodefony/orm-core` ; ici = scénarios sur un vrai modèle.
 */
const ORM = "mediasoup_test";
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

// ── Formes plates renvoyées par les repositories (champs assertés) ───────────
interface UserRow {
  id: string;
  identifier: string;
  roles: string[];
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
  end: unknown;
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
  kind: string;
  format: string;
  status: string;
  deletedAt?: number | null;
  metadata: unknown;
  room?: RoomRow;
  event?: EventRow | null;
}
interface TagRow {
  id: string;
  name: string;
  color: string;
}
interface EventTagRow {
  id: string;
  eventId: string;
  tagId: string;
  event?: EventRow;
  tag?: TagRow;
}

describe("orm-core ↔ modèle mediasoup (banc Drizzle)", () => {
  let orm: DrizzleOrm;
  let users: IRepository<UserRow>;
  let rooms: IRepository<RoomRow>;
  let members: IRepository<RoomMemberRow>;
  let calendars: IRepository<CalendarRow>;
  let events: IRepository<EventRow>;
  let recordings: IRepository<RecordingRow>;
  let tags: IRepository<TagRow>;
  let eventTags: IRepository<EventTagRow>;

  before(async () => {
    registerMediasoupEntities(ORM);
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
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

  it("se connecte + 8 entités enregistrées pour cet ORM", () => {
    assert.equal(orm.isConnected(), true);
    assert.equal(ormRegistry.get(ORM), orm);
    const own = entityRegistry.list().filter((e) => e.orm === ORM);
    assert.equal(own.length, 8);
  });

  it("Room : PK id UUID + name unique + défauts ENUM ($defaultFn)", async () => {
    const r = await rooms.create({ name: "general" });
    assert.match(r.id, /[0-9a-f-]{36}/);
    assert.equal(r.name, "general");
    assert.equal(r.type, "WEBRTC"); // ENUM défaut
    assert.equal(r.access, "private"); // ENUM défaut
    assert.equal(r.secure, false); // boolean défaut
    // name unique : un doublon doit échouer.
    await assert.rejects(rooms.create({ name: "general" }));
  });

  it("Calendar : etag UUID + colonne JSON (round-trip) + N-1 creator (eager-load)", async () => {
    const creator = await users.create({ identifier: "alice" });
    const cal = await calendars.create({
      summary: "Équipe",
      creatorId: creator.id,
    });
    assert.match(cal.etag, /[0-9a-f-]{36}/);
    // JSON par défaut désérialisé en objet.
    assert.deepEqual(cal.conferenceProperties, {
      allowedConferenceSolutionTypes: ["MEETING"],
    });
    // eager-load many-to-one.
    const withCreator = await calendars.findOne(
      { id: cal.id },
      { relations: ["creator"] },
    );
    assert.equal(withCreator?.creator?.identifier, "alice");
  });

  it("N-N RoomMember : jonction Room↔User + eager-load room/user", async () => {
    const room = await rooms.create({ name: "salle-vip" });
    const u1 = await users.create({ identifier: "bob" });
    const u2 = await users.create({ identifier: "carol" });
    await members.create({ roomId: room.id, userId: u1.id, role: "host" });
    await members.create({ roomId: room.id, userId: u2.id });

    const inRoom = await members.find({ roomId: room.id });
    assert.equal(inRoom.length, 2);

    const host = await members.findOne(
      { roomId: room.id, userId: u1.id },
      { relations: ["room", "user"] },
    );
    assert.equal(host?.role, "host");
    assert.equal(host?.room?.name, "salle-vip");
    assert.equal(host?.user?.identifier, "bob");
  });

  it("Event : 3 FK + JSON start/end + eager-load calendar/room/creator", async () => {
    const creator = await users.create({ identifier: "dave" });
    const cal = await calendars.create({
      summary: "Cal",
      creatorId: creator.id,
    });
    const room = await rooms.create({ name: "salle-event" });
    const ev = await events.create({
      summary: "Standup",
      calendarId: cal.id,
      roomId: room.id,
      creatorId: creator.id,
      start: { dateTime: 1700000000000, timeZone: "Europe/Paris" },
      end: { dateTime: 1700003600000, timeZone: "Europe/Paris" },
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

  it("Event : auto-référence parentEventId (récurrence) + eager-load parent", async () => {
    const creator = await users.create({ identifier: "erin" });
    const cal = await calendars.create({
      summary: "Rec",
      creatorId: creator.id,
    });
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
    assert.equal(withParent?.parent?.summary, "Daily (maître)");
  });

  it("Recording : 1-N Room + FK eventId NULLABLE + eager-load", async () => {
    const creator = await users.create({ identifier: "frank" });
    const cal = await calendars.create({ summary: "C", creatorId: creator.id });
    const room = await rooms.create({ name: "salle-rec" });
    const ev = await events.create({
      summary: "Réunion",
      calendarId: cal.id,
      creatorId: creator.id,
      roomId: room.id,
    });
    // Un enregistrement planifié (eventId) + un ad-hoc (eventId NULL).
    await recordings.create({ roomId: room.id, eventId: ev.id, kind: "video" });
    await recordings.create({ roomId: room.id }); // ad-hoc : eventId nullable

    const all = await recordings.find({ roomId: room.id });
    assert.equal(all.length, 2);
    assert.equal(
      all.some((r) => r.eventId === null),
      true,
    ); // FK nullable OK

    const planned = await recordings.findOne(
      { roomId: room.id, eventId: ev.id },
      { relations: ["room", "event"] },
    );
    assert.equal(planned?.room?.name, "salle-rec");
    assert.equal(planned?.event?.summary, "Réunion");
    assert.equal(planned?.format, "webm"); // défaut $defaultFn
  });

  it("Recording : soft-delete (deletedAt) — suppression logique, ligne conservée", async () => {
    const room = await rooms.create({ name: "salle-soft" });
    const rec = await recordings.create({ roomId: room.id });
    assert.equal(rec.deletedAt ?? null, null); // actif

    const ts = Date.now();
    await recordings.updateOne({ id: rec.id }, { deletedAt: ts });

    const after = await recordings.findOne({ id: rec.id });
    assert.ok(after, "la ligne existe toujours (pas de delete physique)");
    assert.equal(after?.deletedAt, ts); // marquée supprimée
  });

  it("Tag : contrainte UNIQUE sur name + N-N EventTag", async () => {
    const creator = await users.create({ identifier: "gina" });
    const cal = await calendars.create({
      summary: "C2",
      creatorId: creator.id,
    });
    const ev = await events.create({
      summary: "Tagué",
      calendarId: cal.id,
      creatorId: creator.id,
    });
    const t1 = await tags.create({ name: "urgent", color: "#f00" });
    const t2 = await tags.create({ name: "interne" });
    // name unique : doublon rejeté.
    await assert.rejects(tags.create({ name: "urgent" }));

    await eventTags.create({ eventId: ev.id, tagId: t1.id });
    await eventTags.create({ eventId: ev.id, tagId: t2.id });
    const links = await eventTags.find({ eventId: ev.id });
    assert.equal(links.length, 2);

    const link = await eventTags.findOne(
      { eventId: ev.id, tagId: t1.id },
      { relations: ["event", "tag"] },
    );
    assert.equal(link?.event?.summary, "Tagué");
    assert.equal(link?.tag?.name, "urgent");
  });

  it("Opérateurs riches : filtrer les events par statut ($in) et summary ($like)", async () => {
    const creator = await users.create({ identifier: "hugo" });
    const cal = await calendars.create({
      summary: "Ops",
      creatorId: creator.id,
    });
    const base = { calendarId: cal.id, creatorId: creator.id };
    await events.create({
      ...base,
      summary: "ops-confirmed",
      status: "confirmed",
    });
    await events.create({
      ...base,
      summary: "ops-tentative",
      status: "tentative",
    });
    await events.create({
      ...base,
      summary: "ops-cancelled",
      status: "cancelled",
    });

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
    assert.equal(byLike[0].summary, "ops-confirmed");
  });

  it("Transaction : commit persiste, rollback annule (Event + Recording atomiques)", async () => {
    const creator = await users.create({ identifier: "iris" });
    const cal = await calendars.create({
      summary: "Tx",
      creatorId: creator.id,
    });
    const room = await rooms.create({ name: "salle-tx" });

    // commit
    await orm.transaction(async (tx) => {
      const ev = await events
        .withTransaction(tx)
        .create({
          summary: "tx-ok",
          calendarId: cal.id,
          creatorId: creator.id,
        });
      await recordings
        .withTransaction(tx)
        .create({ roomId: room.id, eventId: ev.id });
    });
    assert.equal((await events.find({ summary: "tx-ok" })).length, 1);

    // rollback
    await assert.rejects(
      orm.transaction(async (tx) => {
        await events
          .withTransaction(tx)
          .create({
            summary: "tx-ko",
            calendarId: cal.id,
            creatorId: creator.id,
          });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await events.findOne({ summary: "tx-ko" }), null);
  });
});
