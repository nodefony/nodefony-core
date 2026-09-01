import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  assertSchemasMatch,
  buildDerivedDatabase,
  groupIndexes,
  readInitialMigration,
  releaseDerivedDatabase,
  type IObservedSchema,
  type QueryFn,
} from "./migrations-parity";
import type { DrizzleOrm } from "../../nodefony/src/orm-core/index";

/**
 * Parité migrations ↔ DDL dérivé — **sqlite**, toujours exécutée (aucune infra).
 * Les mêmes assertions tournent sur postgres et mysql dans les fichiers e2e
 * frères : un écart y serait un bug du framework, pas du test.
 */

/**
 * Lit l'état observable d'une base sqlite.
 *
 * `PRAGMA table_info` donne le nom, le type, la nullabilité et l'appartenance à
 * la clé primaire ; `index_list` + `index_info` donnent les index, y compris les
 * auto-index créés par une contrainte `UNIQUE` — dont le nom diffère selon le
 * chemin, d'où la comparaison par colonnes couvertes.
 *
 * @param query - exécuteur de requêtes sur la base observée.
 * @returns l'état observable, comparable à celui de l'autre chemin.
 */
function introspectSqlite(query: QueryFn): IObservedSchema {
  const tables = query(
    `SELECT name FROM sqlite_master WHERE type = 'table' ` +
      `AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).map((r) => String(r.name));

  const columns: IObservedSchema["columns"] = {};
  const indexEntries: Array<{
    table: string;
    unique: boolean;
    columns: string[];
  }> = [];

  for (const table of tables) {
    columns[table] = {};
    for (const row of query(`PRAGMA table_info("${table}")`)) {
      const name = String(row.name);
      columns[table][name] = {
        name,
        type: String(row.type),
        notNull: Number(row.notnull) === 1,
        primaryKey: Number(row.pk) > 0,
      };
    }
    for (const idx of query(`PRAGMA index_list("${table}")`)) {
      const cols = query(`PRAGMA index_info("${String(idx.name)}")`)
        .sort((a, b) => Number(a.seqno) - Number(b.seqno))
        .map((c) => String(c.name));
      indexEntries.push({
        table,
        unique: Number(idx.unique) === 1,
        columns: cols,
      });
    }
  }
  return { tables, columns, indexes: groupIndexes(indexEntries) };
}

/** Enveloppe un handle better-sqlite3 en exécuteur de requêtes. */
const querier =
  (db: { prepare: (sql: string) => { all: () => unknown[] } }): QueryFn =>
  (sql) =>
    db.prepare(sql).all() as Record<string, unknown>[];

describe("Migrations ↔ DDL dérivé — parité (sqlite)", () => {
  const CONNECTOR = "parity_sqlite";
  let orm: DrizzleOrm;
  let migrated: IObservedSchema;
  let derived: IObservedSchema;
  let statements: string[];

  beforeAll(async () => {
    // Base A — la PRODUCTION : on applique le fichier de migration, rien d'autre.
    statements = readInitialMigration("sqlite");
    const migratedDb = new Database(":memory:");
    for (const statement of statements) {
      migratedDb.exec(statement);
    }
    migrated = introspectSqlite(querier(migratedDb));

    // Base B — le DÉVELOPPEMENT : l'adapter dérive le DDL des entités.
    orm = await buildDerivedDatabase(CONNECTOR, "sqlite", {
      filename: ":memory:",
    });
    const handle = orm.getNativeConnection() as unknown as {
      $client: { prepare: (sql: string) => { all: () => unknown[] } };
    };
    derived = introspectSqlite(querier(handle.$client));
  });

  afterAll(async () => {
    await releaseDerivedDatabase(orm, CONNECTOR);
  });

  it("les deux chemins construisent les MÊMES tables", () => {
    assert.equal(
      derived.tables.length,
      9,
      "le schéma du framework compte neuf tables — si ce nombre change, la " +
        "migration initiale doit être regénérée, pas ce test ajusté",
    );
    assert.deepEqual(migrated.tables, derived.tables);
  });

  it("colonnes, types, nullabilité, clé primaire et index : identiques", () => {
    assertSchemasMatch(migrated, derived, "sqlite");
  });

  it("la migration porte le marqueur de format et se découpe en instructions", () => {
    // `readInitialMigration` a déjà refusé un fichier sans marqueur ; ce cas
    // vérifie le DÉCOUPAGE, sans quoi une instruction collée à la suivante
    // s'appliquerait en une seule — ou pas du tout.
    assert.ok(
      statements.length >= 9,
      `au moins une instruction par table, obtenu ${statements.length}`,
    );
    assert.ok(
      statements.every((s) => !s.includes("--> statement-breakpoint")),
      "aucun séparateur ne doit subsister dans une instruction",
    );
    assert.equal(
      statements.filter((s) => s.startsWith("CREATE TABLE")).length,
      9,
      "neuf instructions CREATE TABLE",
    );
  });
});
