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

/**
 * Salle WebRTC. ENUM rendus en `text` + valeur par défaut JS.
 * PK = `id` UUID (le legacy utilisait `name` comme PK, mais l'abstraction orm-core
 * **exige une PK `id`** pour les relations/eager-load — `localKey`/`targetKey` y sont
 * figés). `name` reste une **clé métier unique**.
 */
export const roomTable = sqliteTable("Room", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull().unique(),
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
  conferenceProperties: text("conferenceProperties", {
    mode: "json",
  }).$defaultFn(() => ({ allowedConferenceSolutionTypes: ["MEETING"] })),
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
  // Auto-référence : instance d'un événement récurrent → son maître (nullable).
  parentEventId: text("parentEventId"),
  // Soft-delete : timestamp de suppression logique (NULL = actif).
  deletedAt: integer("deletedAt"),
});

/**
 * Enregistrement média d'une `Room` (sortie d'un worker ffmpeg/gstreamer).
 * Cas de test : **1-N** (Room→Recording), **FK nullable** (eventId), **soft-delete**,
 * colonne **JSON** (metadata), pseudo-**ENUM** (kind/status en text).
 */
export const recordingTable = sqliteTable("Recording", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  roomId: text("roomId").notNull(),
  eventId: text("eventId"),
  kind: text("kind")
    .notNull()
    .$defaultFn(() => "video"),
  format: text("format")
    .notNull()
    .$defaultFn(() => "webm"),
  status: text("status")
    .notNull()
    .$defaultFn(() => "recording"),
  durationMs: integer("durationMs"),
  sizeBytes: integer("sizeBytes"),
  path: text("path"),
  metadata: text("metadata", { mode: "json" }).$defaultFn(() => ({})),
  startedAt: integer("startedAt")
    .notNull()
    .$defaultFn(() => Date.now()),
  endedAt: integer("endedAt"),
  deletedAt: integer("deletedAt"),
});

/** Étiquette réutilisable (N-N avec `Event` via `EventTag`). `name` **unique**. */
export const tagTable = sqliteTable("Tag", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull().unique(),
  color: text("color")
    .notNull()
    .$defaultFn(() => "#888888"),
});

/** Jonction `Event`↔`Tag` (2ᵉ relation N-N explicite du modèle). */
export const eventTagTable = sqliteTable("EventTag", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  eventId: text("eventId").notNull(),
  tagId: text("tagId").notNull(),
});

/**
 * Enregistre les entités `mediasoup` dans le `entityRegistry` pour un ORM donné.
 * À appeler **avant** `orm.connect()` (l'adapter résout les relations au connect
 * et exige que toutes les cibles soient déjà enregistrées sur le même ORM).
 *
 * @param connector - nom de la connexion cible (ex. `"mediasoup"`).
 */
export function registerMediasoupEntities(connector: string): void {
  const entities: IEntity[] = [
    // User réutilise la table du contrat @nodefony/user (même schéma que le défaut).
    { connector, module: MODULE, name: "User", schema: userTable },
    { connector, module: MODULE, name: "Room", schema: roomTable },
    {
      connector,
      module: MODULE,
      name: "RoomMember",
      schema: roomMemberTable,
      relations: [
        {
          type: "many-to-one",
          target: "Room",
          field: "room",
          foreignKey: "roomId",
        },
        {
          type: "many-to-one",
          target: "User",
          field: "user",
          foreignKey: "userId",
        },
      ],
    },
    {
      connector,
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
      connector,
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
        {
          type: "many-to-one",
          target: "Room",
          field: "room",
          foreignKey: "roomId",
        },
        {
          type: "many-to-one",
          target: "User",
          field: "creator",
          foreignKey: "creatorId",
        },
        // Auto-référence : un événement récurrent pointe vers son maître.
        {
          type: "many-to-one",
          target: "Event",
          field: "parent",
          foreignKey: "parentEventId",
        },
      ],
    },
    {
      connector,
      module: MODULE,
      name: "Recording",
      schema: recordingTable,
      relations: [
        {
          type: "many-to-one",
          target: "Room",
          field: "room",
          foreignKey: "roomId",
        },
        // FK nullable : un enregistrement peut être ad-hoc (sans Event planifié).
        {
          type: "many-to-one",
          target: "Event",
          field: "event",
          foreignKey: "eventId",
        },
      ],
    },
    { connector, module: MODULE, name: "Tag", schema: tagTable },
    {
      connector,
      module: MODULE,
      name: "EventTag",
      schema: eventTagTable,
      relations: [
        {
          type: "many-to-one",
          target: "Event",
          field: "event",
          foreignKey: "eventId",
        },
        {
          type: "many-to-one",
          target: "Tag",
          field: "tag",
          foreignKey: "tagId",
        },
      ],
    },
  ];
  for (const entity of entities) {
    entityRegistry.register(entity);
  }
}
