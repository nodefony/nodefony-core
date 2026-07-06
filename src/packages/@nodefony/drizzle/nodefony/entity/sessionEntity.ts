import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  createFrameworkTableFactory,
  type IFrameworkTableSpec,
} from "./colKit";

/** ORM cible du stockage de session (connecteur par défaut du module). */
export const SESSION_ORM = "default";

/** Nom logique de l'entité (clé de lookup `getRepository` / `entityRegistry`). */
export const SESSION_ENTITY_NAME = "session";

/**
 * Spec logique de la table de session — première entité déclinée via le
 * `colKit` (S1 du chantier multi-dialecte) : mêmes champs logiques que
 * l'entité session legacy (`session_id` PK, sacs `Attributes`/`flashBag`/
 * `metaBag` en JSON, `user`, horodatages epoch ms). Le kit traduit les types
 * par dialecte (JSON = `text mode:"json"` SQLite / `jsonb` PG ; epoch ms =
 * `integer` SQLite / `bigint` PG) en garantissant les MÊMES noms de colonnes —
 * le `SessionStorage` reste dialect-agnostique.
 */
const SESSION_TABLE_SPEC = {
  name: "session",
  columns: {
    session_id: { kind: "text", primaryKey: true },
    Attributes: { kind: "json" },
    flashBag: { kind: "json" },
    metaBag: { kind: "json" },
    user: { kind: "text" },
    createdAt: { kind: "epochMs", notNull: true },
    updatedAt: { kind: "epochMs", notNull: true },
  },
} satisfies IFrameworkTableSpec;

/**
 * Factory de la table de session pour un dialecte donné (mémoïsée — une
 * instance par dialecte). `sqlite` (défaut) et `postgres` sont portés ;
 * `mysql` jette (S4).
 */
export const createSessionTable =
  createFrameworkTableFactory(SESSION_TABLE_SPEC);

/**
 * Variante SQLite de la table de session (dialecte par défaut) — export
 * conservé pour l'usage direct/banc-test.
 */
export const sessionTable: SQLiteTable = createSessionTable("sqlite");

/** Forme plate d'une ligne de session telle que renvoyée par le repository. */
export interface SessionRow {
  session_id: string;
  Attributes: unknown;
  flashBag: unknown;
  metaBag: unknown;
  user: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Construit le descripteur d'entité session pour un ORM nommé.
 *
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) et la
 * variante de table suit le dialecte du connecteur → l'enregistrement est fait
 * par `registerStores.ts` à `onKernelRegister` (plus de décorateur `@entity`
 * figé au chargement du fichier, qui imposait la variante sqlite quel que soit
 * le dialecte configuré). À enregistrer **avant** `orm.connect()`.
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante de table).
 * @returns le descripteur {@link IEntity} de la table de session.
 */
export function createSessionEntity(
  orm: string,
  dialect: SqlDialect = "sqlite",
): IEntity[] {
  return [
    {
      orm,
      name: SESSION_ENTITY_NAME,
      // `module: "http"` → la table est regroupée sous @nodefony/http dans
      // l'ERD Studio (la session est une feature http, hébergée par l'ORM).
      module: "http",
      schema: createSessionTable(dialect),
    },
  ];
}

/**
 * Enregistre l'entité session dans le `entityRegistry` pour un ORM donné.
 * À appeler **avant** `orm.connect()` (l'adapter crée la table au connect).
 *
 * @param orm - clé de l'ORM cible.
 * @param dialect - dialecte SQL du connecteur (variante de table — défaut `sqlite`).
 */
export function registerSessionEntity(
  orm: string,
  dialect: SqlDialect = "sqlite",
): void {
  for (const entity of createSessionEntity(orm, dialect)) {
    entityRegistry.register(entity);
  }
}
