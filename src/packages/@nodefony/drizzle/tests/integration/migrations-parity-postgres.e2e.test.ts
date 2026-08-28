import assert from "node:assert/strict";
import {
  assertSchemasMatch,
  buildDerivedDatabase,
  groupIndexes,
  readInitialMigration,
  releaseDerivedDatabase,
  type IObservedSchema,
} from "./migrations-parity";
import type { DrizzleOrm } from "../../nodefony/src/orm-core/index";

/**
 * Parité migrations ↔ DDL dérivé — **PostgreSQL**.
 *
 * GATE : ne tourne qu'avec `NF_PG_URL` :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 *
 * Les deux chemins montent leur propre SCHÉMA — jamais `public`, que les autres
 * suites utilisent et que vitest fait tourner en parallèle. Un test qui
 * s'installerait dans un schéma partagé rendrait un verdict qui dépend de ses
 * voisins.
 */
const PG_URL = process.env.NF_PG_URL;
const MIGRATED = "nf_parity_migrated";
const DERIVED = "nf_parity_derived";

describe.skipIf(!PG_URL)("Migrations ↔ DDL dérivé — parité (postgres)", () => {
  const CONNECTOR = "parity_postgres";
  let orm: DrizzleOrm;
  let client: { query: (sql: string) => Promise<{ rows: unknown[] }> };
  let close: () => Promise<void>;
  let migrated: IObservedSchema;
  let derived: IObservedSchema;

  /**
   * Lit l'état observable d'un schéma PostgreSQL.
   *
   * @param schema - schéma introspecté.
   * @returns colonnes et index, sous la forme comparable du harness.
   */
  const introspect = async (schema: string): Promise<IObservedSchema> => {
    const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
      (await client.query(sql)).rows as Record<string, unknown>[];

    const tables = (
      await rows(
        `SELECT table_name FROM information_schema.tables ` +
          `WHERE table_schema = '${schema}' AND table_type = 'BASE TABLE' ` +
          `ORDER BY table_name`,
      )
    ).map((r) => String(r.table_name));

    const columns: IObservedSchema["columns"] = {};
    // `data_type` rend le type SQL normalisé (« bigint », « character varying »),
    // identique quel que soit le chemin qui a créé la colonne — c'est ce qu'on
    // veut comparer, pas l'écriture du DDL.
    const colRows = await rows(
      `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, ` +
        `  COALESCE(k.is_pk, false) AS is_pk ` +
        `FROM information_schema.columns c ` +
        `LEFT JOIN ( ` +
        `  SELECT kcu.table_name, kcu.column_name, true AS is_pk ` +
        `  FROM information_schema.table_constraints tc ` +
        `  JOIN information_schema.key_column_usage kcu ` +
        `    ON kcu.constraint_name = tc.constraint_name ` +
        `   AND kcu.table_schema = tc.table_schema ` +
        `  WHERE tc.table_schema = '${schema}' ` +
        `    AND tc.constraint_type = 'PRIMARY KEY' ` +
        `) k ON k.table_name = c.table_name AND k.column_name = c.column_name ` +
        `WHERE c.table_schema = '${schema}'`,
    );
    for (const row of colRows) {
      const table = String(row.table_name);
      const name = String(row.column_name);
      (columns[table] ??= {})[name] = {
        name,
        type: String(row.data_type),
        notNull: String(row.is_nullable) === "NO",
        primaryKey: row.is_pk === true,
      };
    }

    // `pg_index` donne les colonnes couvertes DANS L'ORDRE, unicité comprise —
    // y compris l'index créé implicitement par une contrainte UNIQUE, dont le nom
    // diffère selon le chemin.
    const idxRows = await rows(
      `SELECT t.relname AS table_name, i.indisunique AS is_unique, ` +
        `  ARRAY( SELECT pg_get_indexdef(i.indexrelid, k + 1, true) ` +
        `         FROM generate_subscripts(i.indkey, 1) AS k ` +
        `         ORDER BY k ) AS cols ` +
        `FROM pg_index i ` +
        `JOIN pg_class t ON t.oid = i.indrelid ` +
        `JOIN pg_namespace n ON n.oid = t.relnamespace ` +
        `WHERE n.nspname = '${schema}'`,
    );
    return {
      tables,
      columns,
      indexes: groupIndexes(
        idxRows.map((r) => ({
          table: String(r.table_name),
          unique: r.is_unique === true,
          columns: (r.cols as string[]).map((c) => c.replace(/^"|"$/g, "")),
        })),
      ),
    };
  };

  beforeAll(async () => {
    const { Client } = await import("pg");
    const admin = new Client({ connectionString: PG_URL });
    await admin.connect();
    client = admin as unknown as typeof client;
    close = () => admin.end();

    for (const schema of [MIGRATED, DERIVED]) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.query(`CREATE SCHEMA ${schema}`);
    }

    // Base A — la PRODUCTION : le fichier de migration, appliqué tel quel.
    await admin.query(`SET search_path TO ${MIGRATED}`);
    for (const statement of readInitialMigration("postgres")) {
      await admin.query(statement);
    }
    await admin.query(`SET search_path TO public`);
    migrated = await introspect(MIGRATED);

    // Base B — le DÉVELOPPEMENT : l'adapter dérive le DDL. Le schéma cible passe
    // par l'option de connexion PostgreSQL `-c search_path=…`, seule façon de le
    // fixer sans toucher au code de l'adapter.
    const url = new URL(PG_URL as string);
    url.searchParams.set("options", `-c search_path=${DERIVED}`);
    orm = await buildDerivedDatabase(CONNECTOR, "postgres", {
      url: url.toString(),
    });
    derived = await introspect(DERIVED);
  });

  afterAll(async () => {
    await releaseDerivedDatabase(orm, CONNECTOR);
    for (const schema of [MIGRATED, DERIVED]) {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await close();
  });

  it("les deux chemins construisent les MÊMES tables", () => {
    assert.equal(derived.tables.length, 10, "dix tables au schéma framework");
    assert.deepEqual(migrated.tables, derived.tables);
  });

  it("colonnes, types, nullabilité, clé primaire et index : identiques", () => {
    assertSchemasMatch(migrated, derived, "postgres");
  });

  it("les horodatages sont en bigint — un integer déborderait", () => {
    // 2 038 est une date, pas une hypothèse : un epoch en millisecondes ne tient
    // pas dans 32 bits, et le dépassement ne se voit qu'une fois la valeur
    // écrite.
    const ts = migrated.columns["audit_event"]?.ts;
    assert.equal(ts?.type, "bigint", "audit_event.ts doit être bigint");
  });
});
