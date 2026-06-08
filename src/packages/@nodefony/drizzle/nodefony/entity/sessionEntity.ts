import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entity } from "@nodefony/orm-core";

/** ORM cible du stockage de session (connecteur par défaut du module). */
export const SESSION_ORM = "default";

/**
 * Table Drizzle de stockage des sessions (schema-as-code).
 *
 * Équivalent portable de l'entité session legacy : mêmes champs
 * logiques (`session_id` PK, `context`, sacs `Attributes`/`flashBag`/`metaBag`
 * en JSON, `user`, horodatages). Les colonnes JSON utilisent le mode `json` de
 * Drizzle (sérialisation/désérialisation automatique).
 */
export const sessionTable = sqliteTable("session", {
  session_id: text("session_id").primaryKey(),
  context: text("context").notNull(),
  Attributes: text("Attributes", { mode: "json" }),
  flashBag: text("flashBag", { mode: "json" }),
  metaBag: text("metaBag", { mode: "json" }),
  user: text("user"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
});

/** Forme plate d'une ligne de session telle que renvoyée par le repository. */
export interface SessionRow {
  session_id: string;
  context: string;
  Attributes: unknown;
  flashBag: unknown;
  metaBag: unknown;
  user: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Entité session enregistrée dans le `entityRegistry` pour le connecteur
 * `default` — `DrizzleOrm` crée la table à la connexion (au boot).
 */
@entity({ orm: SESSION_ORM, name: "session", schema: sessionTable })
class SessionEntity {}

export default SessionEntity;
