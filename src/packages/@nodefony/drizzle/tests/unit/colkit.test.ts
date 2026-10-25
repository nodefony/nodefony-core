import assert from "node:assert/strict";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  getTableConfig as getPgTableConfig,
  PgDialect,
} from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  getTableConfig as getMysqlTableConfig,
  MySqlDialect,
} from "drizzle-orm/mysql-core";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import {
  assertTableSpec,
  defineTable,
  jsonType,
} from "../../nodefony/entity/colKit";
import {
  createSessionTable,
  sessionTable,
} from "../../nodefony/entity/sessionEntity";

/**
 * colKit — kit de colonnes portable. Vérifie l'invariant central (mêmes NOMS de
 * colonnes sur tous les dialectes), la traduction de chaque genre logique par
 * dialecte, les contraintes déclarées (CHECK, FK, index), les modificateurs et
 * les gardes fail-loud. La valeur relue sur les vrais moteurs est prouvée par
 * le banc d'aller-retour (`tests/integration/colkit-roundtrip-*`) ; le typage
 * par `colkit-typing.test.ts`.
 */

/** Spec des genres historiques des entités framework (DDL figé par les migrations). */
const FRAMEWORK = defineTable({
  name: "colkit_probe",
  columns: {
    id: { kind: "text", primaryKey: true },
    label: { kind: "text", notNull: true },
    slug: { kind: "text", unique: true },
    payload: { kind: "json" },
    enabled: { kind: "bool", notNull: true },
    hits: { kind: "int", notNull: true },
    signals: { kind: "int64", notNull: true },
    phase: { kind: "enum", values: ["draft", "live"], notNull: true },
    expiresAt: { kind: "int64", notNull: true },
    seenAt: { kind: "datetime" },
  },
  indexes: [
    { name: "colkit_probe_expiresAt_idx", on: ["expiresAt"] },
    { name: "colkit_probe_slug_uidx", on: ["slug"], unique: true },
  ],
});

/** Table visée par une référence entière (clé `serial`). */
const PARENT = defineTable({
  name: "colkit_parent",
  columns: { id: { kind: "serial", primaryKey: true } },
});

/** Spec couvrant le reste de la grammaire, références comprises. */
const GRAMMAR = defineTable({
  name: "colkit_grammar",
  columns: {
    id: { kind: "uuid", primaryKey: true },
    title: { kind: "string", length: 120, notNull: true },
    nick: { kind: "string" },
    code: { kind: "char", length: 2 },
    body: { kind: "text" },
    price: { kind: "decimal", precision: 12, scale: 2 },
    ratio: { kind: "float" },
    day: { kind: "date" },
    flags: { kind: "json", type: jsonType<string[]>() },
    parentId: { kind: "ref", target: () => PARENT, onDelete: "cascade" },
    previous: { kind: "ref", target: "self", onDelete: "set null" },
  },
});

/** Types SQL par nom de colonne (introspection du dialecte demandé). */
function sqliteTypes(table: SQLiteTable): Record<string, string> {
  return Object.fromEntries(
    getTableConfig(table).columns.map((c) => [c.name, c.getSQLType()]),
  );
}
function pgTypes(table: PgTable): Record<string, string> {
  return Object.fromEntries(
    getPgTableConfig(table).columns.map((c) => [c.name, c.getSQLType()]),
  );
}
function mysqlTypes(table: MySqlTable): Record<string, string> {
  return Object.fromEntries(
    getMysqlTableConfig(table).columns.map((c) => [c.name, c.getSQLType()]),
  );
}

/** Contraintes CHECK rendues en SQL, par nom. */
function checksOf(
  checks: readonly { name: string; value: SQL }[],
  render: (value: SQL) => { sql: string; params: unknown[] },
): Record<string, string> {
  return Object.fromEntries(
    checks.map((ck) => {
      const query = render(ck.value);
      assert.equal(
        query.params.length,
        0,
        `CHECK ${ck.name} sans paramètre lié`,
      );
      return [ck.name, query.sql];
    }),
  );
}

describe("colKit — tables portables", () => {
  describe("genres historiques (DDL des entités framework)", () => {
    it("sqlite : types natifs", () => {
      assert.deepEqual(sqliteTypes(FRAMEWORK.table("sqlite")), {
        id: "text",
        label: "text",
        slug: "text",
        payload: "text", // json = text mode:"json"
        enabled: "integer", // bool = integer mode:"boolean"
        hits: "integer",
        // INTEGER SQLite est déjà 64-bit — int et int64 s'y confondent.
        signals: "integer",
        phase: "text", // enum = text + CHECK
        expiresAt: "integer",
        seenAt: "integer", // datetime = epoch ms, relu Date
      });
    });

    it("postgres : jsonb / bigint / boolean / timestamptz(3)", () => {
      const types = pgTypes(FRAMEWORK.table("postgres"));
      assert.equal(types.payload, "jsonb");
      assert.equal(types.enabled, "boolean");
      assert.equal(types.hits, "integer");
      // `integer` PG est SIGNÉ 32-bit → int64 = bigint.
      assert.equal(types.signals, "bigint");
      assert.equal(types.phase, "text"); // pas un type ENUM natif
      assert.equal(types.expiresAt, "bigint");
      assert.equal(types.seenAt, "timestamp (3) with time zone");
    });

    it("mysql : enum en varchar(64), text indexable en varchar(512)", () => {
      const types = mysqlTypes(FRAMEWORK.table("mysql"));
      assert.equal(types.payload, "json");
      assert.equal(types.enabled, "boolean");
      assert.equal(types.hits, "int");
      assert.equal(types.signals, "bigint");
      assert.equal(types.phase, "varchar(64)");
      assert.equal(types.seenAt, "datetime(3)"); // pas timestamp : borne 2038
      assert.equal(types.id, "varchar(512)"); // PK
      assert.equal(types.slug, "varchar(512)"); // UNIQUE + index
      assert.equal(types.label, "text"); // ni clé ni index
    });

    it("pk / notNull / unique et index, sur les trois dialectes", () => {
      for (const { columns, indexes } of [
        getTableConfig(FRAMEWORK.table("sqlite")),
        getPgTableConfig(FRAMEWORK.table("postgres")),
        getMysqlTableConfig(FRAMEWORK.table("mysql")),
      ]) {
        const byName = new Map(columns.map((c) => [c.name, c]));
        assert.equal(byName.get("id")?.primary, true);
        assert.equal(byName.get("label")?.notNull, true);
        assert.equal(byName.get("slug")?.isUnique, true);
        assert.equal(byName.get("payload")?.notNull, false);
        assert.equal(indexes.length, 2);
        assert.equal(
          indexes.find((ix) => ix.config.name === "colkit_probe_slug_uidx")
            ?.config.unique,
          true,
        );
      }
    });
  });

  describe("grammaire complète", () => {
    it("sqlite : tout ce qui doit rester exact va en TEXT", () => {
      assert.deepEqual(sqliteTypes(GRAMMAR.table("sqlite")), {
        id: "text",
        title: "text(120)",
        nick: "text(255)",
        code: "text",
        body: "text",
        price: "text", // PAS numeric : l'affinité NUMERIC perd « 12.50 »
        ratio: "real",
        day: "text",
        flags: "text",
        parentId: "integer", // type de la clé visée (serial)
        previous: "text", // type de la clé visée (uuid)
      });
    });

    it("postgres : types natifs", () => {
      assert.deepEqual(pgTypes(GRAMMAR.table("postgres")), {
        id: "uuid",
        title: "varchar(120)",
        nick: "varchar(255)",
        code: "char(2)",
        body: "text",
        price: "numeric(12, 2)",
        ratio: "double precision",
        day: "date",
        flags: "jsonb",
        parentId: "integer",
        previous: "uuid",
      });
    });

    it("mysql : types natifs, uuid en varchar(36)", () => {
      assert.deepEqual(mysqlTypes(GRAMMAR.table("mysql")), {
        id: "varchar(36)",
        title: "varchar(120)",
        nick: "varchar(255)",
        code: "char(2)",
        body: "text",
        price: "decimal(12,2)",
        ratio: "double",
        day: "date",
        flags: "json",
        parentId: "int",
        previous: "varchar(36)",
      });
    });

    it("serial : clé auto-incrémentée sur les trois dialectes", () => {
      const sqlite = getTableConfig(PARENT.table("sqlite")).columns[0];
      assert.equal(sqlite?.getSQLType(), "integer");
      assert.equal(sqlite?.primary, true);
      assert.equal(pgTypes(PARENT.table("postgres")).id, "serial");
      const mysql = getMysqlTableConfig(PARENT.table("mysql")).columns[0];
      assert.equal(mysql?.getSQLType(), "int");
      assert.ok(mysql !== undefined && "autoIncrement" in mysql);
      assert.equal(mysql.autoIncrement, true);
      assert.equal(mysql?.primary, true);
    });

    it("références : une clé étrangère par ref, onDelete porté, vers soi compris", () => {
      for (const { foreignKeys } of [
        getTableConfig(GRAMMAR.table("sqlite")),
        getPgTableConfig(GRAMMAR.table("postgres")),
        getMysqlTableConfig(GRAMMAR.table("mysql")),
      ]) {
        const fks = foreignKeys.map((fk) => {
          const ref = fk.reference();
          return [
            ref.columns[0]?.name,
            ref.foreignColumns[0]?.name,
            fk.onDelete,
          ];
        });
        assert.deepEqual(
          fks.sort(),
          [
            ["parentId", "id", "cascade"],
            ["previous", "id", "set null"],
          ].sort(),
        );
      }
    });

    it("CHECK : longueur d'un string en SQLite, longueur exacte d'un char partout", () => {
      assert.deepEqual(
        checksOf(getTableConfig(GRAMMAR.table("sqlite")).checks, (v) =>
          new SQLiteSyncDialect().sqlToQuery(v),
        ),
        {
          colkit_grammar_title_len: `length("title") <= 120`,
          colkit_grammar_nick_len: `length("nick") <= 255`,
          colkit_grammar_code_len: `length(rtrim("code", ' ')) = 2`,
        },
      );
      assert.deepEqual(
        checksOf(getPgTableConfig(GRAMMAR.table("postgres")).checks, (v) =>
          new PgDialect().sqlToQuery(v),
        ),
        { colkit_grammar_code_len: `char_length("code") = 2` },
      );
      assert.deepEqual(
        checksOf(getMysqlTableConfig(GRAMMAR.table("mysql")).checks, (v) =>
          new MySqlDialect().sqlToQuery(v),
        ),
        { colkit_grammar_code_len: "char_length(`code`) = 2" },
      );
    });

    it("vector : natif PostgreSQL, refusé ailleurs en le nommant", () => {
      const embedded = defineTable({
        name: "colkit_vector",
        columns: {
          id: { kind: "uuid", primaryKey: true },
          embedding: { kind: "vector", dimensions: 3 },
        },
      });
      assert.equal(pgTypes(embedded.table("postgres")).embedding, "vector(3)");
      assert.throws(
        () => embedded.table("sqlite"),
        /"embedding" is a vector\(3\)/,
      );
      assert.throws(
        () => embedded.table("mysql"),
        /"embedding" is a vector\(3\)/,
      );
    });
  });

  describe("invariant multi-dialecte", () => {
    it("MÊMES noms de colonnes sur les TROIS dialectes, ceux de la spec", () => {
      for (const def of [FRAMEWORK, GRAMMAR]) {
        const names = Object.keys(def.spec.columns).sort();
        assert.deepEqual(
          Object.keys(sqliteTypes(def.table("sqlite"))).sort(),
          names,
        );
        assert.deepEqual(
          Object.keys(pgTypes(def.table("postgres"))).sort(),
          names,
        );
        assert.deepEqual(
          Object.keys(mysqlTypes(def.table("mysql"))).sort(),
          names,
        );
      }
    });

    it("session PG : sacs JSON en jsonb, horodatages en bigint", () => {
      const types = pgTypes(createSessionTable("postgres"));
      assert.equal(types.Attributes, "jsonb");
      assert.equal(types.createdAt, "bigint");
    });
  });

  describe("défauts JS-level ($defaultFn / $onUpdateFn) — comportement réel", () => {
    it("insert sans la colonne → defaultFn posé ; update → onUpdateFn régénéré", async () => {
      const table = defineTable({
        name: "colkit_defaults",
        columns: {
          id: { kind: "text", primaryKey: true },
          state: { kind: "text", notNull: true, defaultFn: () => "fresh" },
          rev: {
            kind: "int",
            notNull: true,
            defaultFn: () => 1,
            onUpdateFn: () => 99,
          },
        },
      }).table("sqlite");
      const client = new BetterSqlite3(":memory:");
      try {
        const db = drizzle(client);
        client.exec(
          `CREATE TABLE "colkit_defaults" ("id" text PRIMARY KEY, "state" text NOT NULL, "rev" integer NOT NULL)`,
        );
        const inserted = await db.insert(table).values({ id: "a" }).returning();
        assert.equal(inserted[0]?.state, "fresh");
        assert.equal(inserted[0]?.rev, 1);
        const updated = await db
          .update(table)
          .set({ state: "moved" })
          .returning();
        assert.equal(updated[0]?.state, "moved");
        assert.equal(updated[0]?.rev, 99, "onUpdateFn régénéré à l'UPDATE");
      } finally {
        client.close();
      }
    });

    it("datetime : round-trip `Date` réel (stocké ms, relu Date) — sqlite", async () => {
      const table = defineTable({
        name: "colkit_datetime",
        columns: {
          id: { kind: "text", primaryKey: true },
          bornAt: { kind: "datetime", notNull: true },
        },
      }).table("sqlite");
      const client = new BetterSqlite3(":memory:");
      try {
        const db = drizzle(client);
        client.exec(
          `CREATE TABLE "colkit_datetime" ("id" text PRIMARY KEY, "bornAt" integer NOT NULL)`,
        );
        const at = new Date(1_700_000_000_123);
        await db.insert(table).values({ id: "d1", bornAt: at });
        const rows = await db.select().from(table);
        assert.ok(rows[0]?.bornAt instanceof Date);
        assert.equal(rows[0].bornAt.getTime(), at.getTime());
      } finally {
        client.close();
      }
    });
  });

  describe("colonnes énumérées — la contrainte CHECK est DÉCLARÉE", () => {
    it("même prédicat sur les trois dialectes, nommé <table>_<col>_check", () => {
      const expected = {
        colkit_probe_phase_check: `"phase" IN ('draft', 'live')`,
      };
      assert.deepEqual(
        checksOf(getTableConfig(FRAMEWORK.table("sqlite")).checks, (v) =>
          new SQLiteSyncDialect().sqlToQuery(v),
        ),
        expected,
      );
      assert.deepEqual(
        checksOf(getPgTableConfig(FRAMEWORK.table("postgres")).checks, (v) =>
          new PgDialect().sqlToQuery(v),
        ),
        expected,
      );
      assert.deepEqual(
        checksOf(getMysqlTableConfig(FRAMEWORK.table("mysql")).checks, (v) =>
          new MySqlDialect().sqlToQuery(v),
        ),
        { colkit_probe_phase_check: "`phase` IN ('draft', 'live')" },
      );
    });

    it("une apostrophe dans une valeur est doublée, jamais concaténée nue", () => {
      const { checks } = getTableConfig(
        defineTable({
          name: "colkit_quote",
          columns: {
            id: { kind: "text", primaryKey: true },
            mood: { kind: "enum", values: ["l'un", "autre"], notNull: true },
          },
        }).table("sqlite"),
      );
      assert.deepEqual(
        checksOf(checks, (v) => new SQLiteSyncDialect().sqlToQuery(v)),
        { colkit_quote_mood_check: `"mood" IN ('l''un', 'autre')` },
      );
    });
  });

  describe("gardes fail-loud (à la déclaration)", () => {
    const cases: Array<
      [string, Parameters<typeof assertTableSpec>[0], RegExp]
    > = [
      [
        "index sur une colonne inconnue",
        {
          name: "t",
          columns: { id: { kind: "text", primaryKey: true } },
          indexes: [{ name: "bad_idx", on: ["missing"] }],
        },
        /index "bad_idx" references unknown column "missing"/,
      ],
      [
        "deux clés primaires",
        {
          name: "t",
          columns: {
            a: { kind: "text", primaryKey: true },
            b: { kind: "uuid", primaryKey: true },
          },
        },
        /declares 2 primary keys/,
      ],
      [
        "défaut littéral ET calculé sur la même colonne",
        {
          name: "t",
          columns: {
            id: { kind: "text", primaryKey: true },
            rank: { kind: "int", default: 1, defaultFn: () => 2 },
          },
        },
        /column "rank" declares both default and defaultFn/,
      ],
      [
        "valeur d'enum plus longue que la colonne MySQL",
        {
          name: "t",
          columns: { e: { kind: "enum", values: ["x".repeat(65)] } },
        },
        /exceeds 64 characters/,
      ],
      [
        "valeur d'enum répétée",
        { name: "t", columns: { e: { kind: "enum", values: ["a", "a"] } } },
        /repeats a value/,
      ],
      [
        "échelle plus grande que la précision",
        {
          name: "t",
          columns: { p: { kind: "decimal", precision: 4, scale: 5 } },
        },
        /invalid decimal\(4, 5\)/,
      ],
      [
        "char de longueur nulle",
        { name: "t", columns: { c: { kind: "char", length: 0 } } },
        /invalid char length 0/,
      ],
      [
        "vecteur sans dimension",
        { name: "t", columns: { v: { kind: "vector", dimensions: 0 } } },
        /invalid vector dimensions 0/,
      ],
    ];
    for (const [label, spec, message] of cases) {
      it(`${label} → refus nommé`, () => {
        assert.throws(() => assertTableSpec(spec), message);
        assert.throws(() => defineTable(spec), message);
      });
    }

    it("clé primaire entière non auto-incrémentée → refus nommé (refusée aussi au type)", () => {
      const declare = (): void =>
        assertTableSpec({
          name: "t",
          columns: {
            // @ts-expect-error une clé est une chaîne, un uuid ou un serial
            id: { kind: "int", primaryKey: true },
          },
        });
      assert.throws(declare, /"id" is a int primary key/);
    });

    it("référence vers une table sans clé primaire → refus à la fabrication", () => {
      const keyless = defineTable({
        name: "keyless",
        columns: { note: { kind: "text" } },
      });
      const broken = defineTable({
        name: "broken",
        columns: { other: { kind: "ref", target: () => keyless } },
      });
      assert.throws(
        () => broken.table("postgres"),
        /"keyless": no primary key/,
      );
    });
  });

  describe("nom stocké (`column`) — la propriété reste, la base suit sa convention", () => {
    const STORED = defineTable({
      name: "colkit_stored",
      columns: {
        id: { kind: "uuid", primaryKey: true, column: "row_id" },
        fullName: {
          kind: "string",
          length: 20,
          notNull: true,
          column: "full_name",
        },
        isoCode: { kind: "char", length: 2, column: "iso_code" },
        state: { kind: "enum", values: ["a", "b"], column: "row_state" },
        createdAt: { kind: "datetime", notNull: true, column: "created_at" },
        parentId: { kind: "ref", target: "self", column: "parent_id" },
      },
      indexes: [{ name: "colkit_stored_full_name_idx", on: ["fullName"] }],
    });
    const STORED_NAMES = [
      "row_id",
      "full_name",
      "iso_code",
      "row_state",
      "created_at",
      "parent_id",
    ];

    it("les trois dialectes nomment la colonne en base par son nom stocké", () => {
      for (const config of [
        getTableConfig(STORED.table("sqlite")),
        getPgTableConfig(STORED.table("postgres")),
        getMysqlTableConfig(STORED.table("mysql")),
      ]) {
        assert.deepEqual(
          config.columns.map((c) => c.name),
          STORED_NAMES,
        );
        assert.deepEqual(
          config.indexes.map((ix) =>
            ix.config.columns.map((c) => ("name" in c ? c.name : "")),
          ),
          [["full_name"]],
        );
        assert.deepEqual(
          config.foreignKeys.map((fk) =>
            fk.reference().columns.map((c) => c.name),
          ),
          [["parent_id"]],
        );
      }
    });

    it("la table garde les PROPRIÉTÉS — c'est elles que le code lit", () => {
      assert.deepEqual(
        Object.keys(STORED.table("postgres")).filter((k) =>
          Object.hasOwn(STORED.spec.columns, k),
        ),
        Object.keys(STORED.spec.columns),
      );
    });

    it("les CHECK visent le nom stocké, jamais la propriété", () => {
      assert.deepEqual(
        checksOf(getTableConfig(STORED.table("sqlite")).checks, (v) =>
          new SQLiteSyncDialect().sqlToQuery(v),
        ),
        {
          colkit_stored_row_state_check: `"row_state" IN ('a', 'b')`,
          colkit_stored_full_name_len: `length("full_name") <= 20`,
          colkit_stored_iso_code_len: `length(rtrim("iso_code", ' ')) = 2`,
        },
      );
      assert.deepEqual(
        Object.keys(
          checksOf(getPgTableConfig(STORED.table("postgres")).checks, (v) =>
            new PgDialect().sqlToQuery(v),
          ),
        ),
        ["colkit_stored_iso_code_len", "colkit_stored_row_state_check"],
      );
    });

    it("une ligne écrite par propriété se relit par propriété (SQLite réel)", () => {
      const client = new BetterSqlite3(":memory:");
      client.exec(
        `CREATE TABLE colkit_stored (row_id text PRIMARY KEY, full_name text NOT NULL, ` +
          `iso_code text, row_state text, created_at integer NOT NULL, parent_id text)`,
      );
      const db = drizzle(client);
      const table = STORED.table("sqlite");
      const at = new Date("2026-01-02T03:04:05.006Z");
      db.insert(table)
        .values({
          id: "00000000-0000-4000-8000-000000000001",
          fullName: "Ada",
          isoCode: "FR",
          state: "a",
          createdAt: at,
        })
        .run();
      const [row] = db.select().from(table).all();
      assert.equal(row?.fullName, "Ada");
      assert.equal(row?.createdAt.getTime(), at.getTime());
      client.close();
    });

    it("refuse un nom stocké qui n'est pas un identifiant SQL simple", () => {
      assert.throws(
        () =>
          assertTableSpec({
            name: "t",
            columns: {
              id: { kind: "text", primaryKey: true, column: 'x"; DROP' },
            },
          }),
        /column "id" has an invalid stored name/,
      );
    });

    it("refuse deux propriétés stockées sous le même nom", () => {
      assert.throws(
        () =>
          assertTableSpec({
            name: "t",
            columns: {
              id: { kind: "text", primaryKey: true },
              createdAt: { kind: "datetime", column: "created_at" },
              created_at: { kind: "datetime" },
            },
          }),
        /columns "createdAt" and "created_at" are both stored as "created_at"/,
      );
    });
  });

  describe("mémoïsation", () => {
    it("une seule instance de table par dialecte", () => {
      assert.equal(FRAMEWORK.table("sqlite"), FRAMEWORK.table("sqlite"));
      assert.equal(FRAMEWORK.table("postgres"), FRAMEWORK.table("postgres"));
      assert.notEqual(FRAMEWORK.table("sqlite"), FRAMEWORK.table("postgres"));
    });

    it("l'export sessionTable EST la variante sqlite de la fabrique", () => {
      assert.equal(sessionTable, createSessionTable("sqlite"));
    });
  });
});
