import { randomUUID } from "node:crypto";
import { defineEntity } from "@nodefony/orm-core";
import type { IEntityDefinition } from "@nodefony/orm-core";
import { defineTable } from "@nodefony/drizzle";
import type { RowOf } from "@nodefony/drizzle";

/**
 * Les salons du chat en base — le modèle d'une salle de conférence
 * (salle, membres, événements planifiés, invités), écrit pour servir aussi
 * plus tard à une conférence (`kind: "conference"`).
 *
 * Guide pour un agent : des descriptions PORTABLES (`defineTable`) — une
 * table par moteur se déduit au démarrage. Elles vivent sur le connecteur
 * `demo`, une base SQLite à la démo (`nodefony/config/config.ts`,
 * `demoDrizzleOverride`), jamais la base de l'application. Les comptes, eux,
 * vivent dans la base de l'application : `ownerId`, `userId`, `organizerId`
 * sont des identifiants STABLES de compte (`this.user.id`), sans clé
 * étrangère — une base ne peut pas en viser une autre. Les noms d'entité
 * sont préfixés `Demo` : une autre partie de l'application peut avoir sa
 * propre `Room`. Les champs d'événement suivent iCalendar (RFC 5545 :
 * `VEVENT`, `STATUS`, `ATTENDEE` avec son `ROLE` et son `PARTSTAT`).
 * Doc : `@nodefony/orm-core/docs/tutorial-entity.md`.
 */

/** Une salle : son nom, sa nature, qui peut y entrer. */
export const roomTable = defineTable({
  name: "room",
  columns: {
    id: { kind: "text", primaryKey: true, defaultFn: () => randomUUID() },
    name: { kind: "string", length: 80, notNull: true, unique: true },
    kind: { kind: "enum", values: ["chat", "conference"], notNull: true },
    access: { kind: "enum", values: ["public", "private"], notNull: true },
    /** Plus personne n'entre, sauf les membres. */
    locked: { kind: "bool", notNull: true, default: false },
    /** Salle d'attente : un modérateur admet chaque arrivant (pas encore appliqué). */
    waitingRoom: { kind: "bool", notNull: true, default: false },
    ownerId: { kind: "text", notNull: true },
    description: { kind: "string", length: 280 },
    createdAt: { kind: "int64", notNull: true },
  },
  indexes: [],
});

// #region rooms-tables
/** Un membre d'une salle, et son rôle. */
export const roomMemberTable = defineTable({
  name: "room_member",
  columns: {
    id: { kind: "text", primaryKey: true, defaultFn: () => randomUUID() },
    roomId: { kind: "text", notNull: true },
    userId: { kind: "text", notNull: true },
    role: {
      kind: "enum",
      values: ["owner", "moderator", "member"],
      notNull: true,
    },
    joinedAt: { kind: "int64", notNull: true },
  },
  indexes: [
    {
      name: "room_member_room_user_uq",
      on: ["roomId", "userId"],
      unique: true,
    },
    { name: "room_member_user_idx", on: ["userId"] },
  ],
});

// #endregion

/** Un événement planifié dans une salle (iCalendar `VEVENT`). */
export const eventTable = defineTable({
  name: "event",
  columns: {
    /** L'UID iCalendar : stable, exportable en `.ics`. */
    id: { kind: "text", primaryKey: true, defaultFn: () => randomUUID() },
    roomId: { kind: "text", notNull: true },
    organizerId: { kind: "text", notNull: true },
    title: { kind: "string", length: 120, notNull: true },
    description: { kind: "string", length: 1000 },
    /** Début et fin, en ms UTC. */
    start: { kind: "int64", notNull: true },
    end: { kind: "int64", notNull: true },
    /** Fuseau de l'organisateur (IANA), pour l'affichage et l'export. */
    timeZone: { kind: "string", length: 64, notNull: true },
    status: {
      kind: "enum",
      values: ["tentative", "confirmed", "cancelled"],
      notNull: true,
    },
    /** Règle de récurrence RRULE (RFC 5545 §3.3.10), gardée telle quelle, pas encore interprétée. */
    recurrence: { kind: "string", length: 500 },
  },
  indexes: [{ name: "event_room_idx", on: ["roomId"] }],
});

/** Un invité d'un événement (iCalendar `ATTENDEE`). */
export const eventAttendeeTable = defineTable({
  name: "event_attendee",
  columns: {
    id: { kind: "text", primaryKey: true, defaultFn: () => randomUUID() },
    eventId: { kind: "text", notNull: true },
    userId: { kind: "text", notNull: true },
    role: {
      kind: "enum",
      values: ["chair", "req-participant", "opt-participant"],
      notNull: true,
    },
    partstat: {
      kind: "enum",
      values: ["needs-action", "accepted", "declined", "tentative"],
      notNull: true,
    },
  },
  indexes: [
    {
      name: "event_attendee_event_user_uq",
      on: ["eventId", "userId"],
      unique: true,
    },
    { name: "event_attendee_user_idx", on: ["userId"] },
  ],
});

/** Une salle telle que la base la rend. */
export type RoomRow = RowOf<typeof roomTable.spec>;
/** Un membre tel que la base le rend. */
export type RoomMemberRow = RowOf<typeof roomMemberTable.spec>;
/** Un événement tel que la base le rend. */
export type EventRow = RowOf<typeof eventTable.spec>;
/** Un invité tel que la base le rend. */
export type EventAttendeeRow = RowOf<typeof eventAttendeeTable.spec>;

/** Les noms logiques des entités (clés de `getRepository`). */
export const ROOM_ENTITY = "DemoRoom";
export const ROOM_MEMBER_ENTITY = "DemoRoomMember";
export const EVENT_ENTITY = "DemoEvent";
export const EVENT_ATTENDEE_ENTITY = "DemoEventAttendee";

/**
 * Les quatre entités, SANS connecteur : `@entities(roomEntities, { connector:
 * DEMO_CONNECTOR })` sur `DemoModule` les lie au connecteur `demo`.
 */
export const roomEntities: IEntityDefinition[] = [
  defineEntity({ name: ROOM_ENTITY, module: "demo", schema: roomTable }),
  defineEntity({
    name: ROOM_MEMBER_ENTITY,
    module: "demo",
    schema: roomMemberTable,
  }),
  defineEntity({ name: EVENT_ENTITY, module: "demo", schema: eventTable }),
  defineEntity({
    name: EVENT_ATTENDEE_ENTITY,
    module: "demo",
    schema: eventAttendeeTable,
  }),
];
