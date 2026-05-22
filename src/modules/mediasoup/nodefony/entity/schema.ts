/**
 * Schémas ORM **Drizzle** du modèle `mediasoup` (banc test ORM).
 *
 * Modèle fidèle au legacy `nodefony-mediasoup` (Room / Calendar / Event + User),
 * adapté schema-as-code Drizzle. But : peupler un **ERD distinct** dans Studio
 * (connecteur `mediasoup`) et servir de **banc d'intégration ORM** réaliste
 * (relations multiples, JSON, UUID, jonction N-N explicite). Aucune logique métier,
 * aucun front : uniquement les tables + leurs relations déclaratives.
 *
 * Notes Drizzle :
 *  - défauts en `$defaultFn` (JS-level) — le DDL dérivé n'émet pas de `DEFAULT` SQL,
 *    donc une colonne `NOT NULL` sans valeur casserait l'INSERT (même contrainte que `userTable`) ;
 *  - **pas de `many-to-many`** : l'adapter Drizzle le rejette → la relation N-N
 *    `Room`↔`User` est modélisée explicitement par la table de jonction `RoomMember`
 *    (la bonne pratique SQL, et ça se voit dans l'ERD).
 */
import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import { userTable } from "@nodefony/drizzle";

/** Module propriétaire — regroupe les entités dans l'ERD Studio. */
const MODULE = "mediasoup";

/** Salle WebRTC. PK = nom (legacy). ENUM rendus en `text` + valeur par défaut JS. */
export const roomTable = sqliteTable("Room", {
  name: text("name").primaryKey(),
  type: text("type")
    .notNull()
    .$defaultFn(() => "WEBRTC"),
  access: text("access")
    .notNull()
    .$defaultFn(() => "private"),
  description: text("description"),
  password: text("password"),
  secure: integer("secure", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => false),
  locked: integer("locked", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => false),
  waitingConnect: integer("waitingConnect", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => false),
  stickyCookie: text("stickyCookie"),
});

/** Jonction `Room`↔`User` (membres) = la relation N-N matérialisée. */
export const roomMemberTable = sqliteTable("RoomMember", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  roomId: text("roomId").notNull(),
  userId: text("userId").notNull(),
  role: text("role")
    .notNull()
    .$defaultFn(() => "member"),
  joinedAt: integer("joinedAt")
    .notNull()
    .$defaultFn(() => Date.now()),
});

/** Calendrier (modèle Google Calendar). `etag` UUID unique, propriétés JSON. */
export const calendarTable = sqliteTable("Calendar", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  etag: text("etag")
    .notNull()
    .unique()
    .$defaultFn(() => randomUUID()),
  kind: text("kind")
    .notNull()
    .$defaultFn(() => "calendar#calendar"),
  summary: text("summary").notNull(),
  location: text("location"),
  description: text("description"),
  timeZone: text("timeZone"),
  isPrimary: integer("isPrimary", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => false),
  hidden: integer("hidden", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => false),
  conferenceProperties: text("conferenceProperties", { mode: "json" }).$defaultFn(
    () => ({ allowedConferenceSolutionTypes: ["MEETING"] }),
  ),
  defaultReminders: text("defaultReminders", { mode: "json" }).$defaultFn(
    () => [],
  ),
  creatorId: text("creatorId").notNull(),
});

/** Événement de calendrier (modèle Google Calendar). start/end/recurrence JSON. */
export const eventTable = sqliteTable("Event", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  kind: text("kind")
    .notNull()
    .$defaultFn(() => "calendar#event"),
  eventType: text("eventType"),
  summary: text("summary").notNull(),
  location: text("location"),
  description: text("description"),
  status: text("status"),
  organizer: text("organizer", { mode: "json" }),
  start: text("start", { mode: "json" }),
  end: text("end", { mode: "json" }),
  timezone: text("timezone")
    .notNull()
    .$defaultFn(() => "Europe/Paris"),
  recurrence: text("recurrence", { mode: "json" }).$defaultFn(() => []),
  attendees: text("attendees", { mode: "json" }).$defaultFn(() => []),
  visibility: text("visibility")
    .notNull()
    .$defaultFn(() => "default"),
  locked: integer("locked", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => false),
  calendarId: text("calendarId").notNull(),
  roomId: text("roomId"),
  creatorId: text("creatorId").notNull(),
});

/**
 * Enregistre les entités `mediasoup` dans le `entityRegistry` pour un ORM donné.
 * À appeler **avant** `orm.connect()` (l'adapter résout les relations au connect
 * et exige que toutes les cibles soient déjà enregistrées sur le même ORM).
 *
 * @param orm - clé du connecteur cible (ex. `"mediasoup"`).
 */
export function registerMediasoupEntities(orm: string): void {
  const entities: IEntity[] = [
    // User réutilise la table du contrat @nodefony/user (même schéma que le défaut).
    { orm, module: MODULE, name: "User", schema: userTable },
    { orm, module: MODULE, name: "Room", schema: roomTable },
    {
      orm,
      module: MODULE,
      name: "RoomMember",
      schema: roomMemberTable,
      relations: [
        { type: "many-to-one", target: "Room", field: "room", foreignKey: "roomId" },
        { type: "many-to-one", target: "User", field: "user", foreignKey: "userId" },
      ],
    },
    {
      orm,
      module: MODULE,
      name: "Calendar",
      schema: calendarTable,
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
      module: MODULE,
      name: "Event",
      schema: eventTable,
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
      ],
    },
  ];
  for (const entity of entities) {
    entityRegistry.register(entity);
  }
}
