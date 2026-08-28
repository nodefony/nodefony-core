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
import {
  buildFrameworkTable,
  createFrameworkTableFactory,
  type IFrameworkTableSpec,
} from "../../nodefony/entity/colKit";
import {
  createSessionTable,
  sessionTable,
} from "../../nodefony/entity/sessionEntity";

/**
 * colKit — kit de colonnes des entités framework (S1 multi-dialecte).
 * Vérifie l'invariant central du chantier (mêmes NOMS de colonnes sur tous les
 * dialectes), la traduction des types logiques par dialecte, les modificateurs
 * (pk/notNull/unique/$defaultFn/$onUpdateFn) et les gardes fail-loud.
 */

/** Spec de référence couvrant tous les kinds + modificateurs + index. */
const SPEC = {
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
    expiresAt: { kind: "epochMs", notNull: true },
    seenAt: { kind: "dateMs" },
  },
  indexes: [
    { name: "colkit_probe_expiresAt_idx", on: ["expiresAt"] },
    { name: "colkit_probe_slug_uidx", on: ["slug"], unique: true },
  ],
} satisfies IFrameworkTableSpec;

/** Colonnes indexées par nom (introspection du dialecte demandé). */
function sqliteCols(table: SQLiteTable) {
  const { columns } = getTableConfig(table);
  return new Map(columns.map((c) => [c.name, c]));
}
function pgCols(table: PgTable) {
  const { columns } = getPgTableConfig(table);
  return new Map(columns.map((c) => [c.name, c]));
}
function mysqlCols(table: MySqlTable) {
  const { columns } = getMysqlTableConfig(table);
  return new Map(columns.map((c) => [c.name, c]));
}

describe("colKit — buildFrameworkTable (S1 multi-dialecte)", () => {
  describe("variante sqlite", () => {
    const table = buildFrameworkTable("sqlite", SPEC);

    it("traduit les kinds vers les types natifs SQLite", () => {
      const cols = sqliteCols(table);
      assert.equal(cols.get("id")?.getSQLType(), "text");
      assert.equal(cols.get("payload")?.getSQLType(), "text"); // json = text mode:"json"
      assert.equal(cols.get("enabled")?.getSQLType(), "integer"); // bool = integer mode:"boolean"
      assert.equal(cols.get("hits")?.getSQLType(), "integer");
      // INTEGER SQLite est déjà 64-bit — int et int64 s'y confondent, la
      // distinction ne se voit que sur les deux autres dialectes.
      assert.equal(cols.get("signals")?.getSQLType(), "integer");
      assert.equal(cols.get("phase")?.getSQLType(), "text"); // enum = text + CHECK
      assert.equal(cols.get("expiresAt")?.getSQLType(), "integer"); // epoch ms 64-bit
      // dateMs = integer ms epoch, exposé `Date` par le mode timestamp_ms.
      assert.equal(cols.get("seenAt")?.getSQLType(), "integer");
    });

    it("applique pk / notNull / unique", () => {
      const cols = sqliteCols(table);
      assert.equal(cols.get("id")?.primary, true);
      assert.equal(cols.get("label")?.notNull, true);
      assert.equal(cols.get("slug")?.isUnique, true);
      assert.equal(cols.get("payload")?.notNull, false); // nullable par défaut
    });

    it("déclare les index (lus par drizzle-kit en prod)", () => {
      const { indexes } = getTableConfig(table);
      assert.equal(indexes.length, 2);
      const unique = indexes.find(
        (ix) => ix.config.name === "colkit_probe_slug_uidx",
      );
      assert.equal(unique?.config.unique, true);
    });
  });

  describe("variante postgres", () => {
    const table = buildFrameworkTable("postgres", SPEC);

    it("traduit les kinds vers les types natifs PG (jsonb / bigint / boolean)", () => {
      const cols = pgCols(table);
      assert.equal(cols.get("id")?.getSQLType(), "text");
      assert.equal(cols.get("payload")?.getSQLType(), "jsonb");
      assert.equal(cols.get("enabled")?.getSQLType(), "boolean");
      assert.equal(cols.get("hits")?.getSQLType(), "integer");
      // `int` PG est SIGNÉ 32-bit (2 147 483 647) → int64 = bigint.
      assert.equal(cols.get("signals")?.getSQLType(), "bigint");
      assert.equal(cols.get("phase")?.getSQLType(), "text"); // pas un type ENUM natif
      // epoch ms ≈ 1.7e12 déborde `integer` PG 32-bit → bigint obligatoire.
      assert.equal(cols.get("expiresAt")?.getSQLType(), "bigint");
      // dateMs = timestamptz(3) PG (même type JS `Date` que la variante SQLite).
      assert.match(
        cols.get("seenAt")?.getSQLType() ?? "",
        /^timestamp.*with time zone$/,
      );
    });

    it("applique pk / notNull / unique", () => {
      const cols = pgCols(table);
      assert.equal(cols.get("id")?.primary, true);
      assert.equal(cols.get("label")?.notNull, true);
      assert.equal(cols.get("slug")?.isUnique, true);
    });

    it("déclare les index", () => {
      const { indexes } = getPgTableConfig(table);
      assert.equal(indexes.length, 2);
    });
  });

  describe("variante mysql (S4)", () => {
    const table = buildFrameworkTable("mysql", SPEC);

    it("traduit les kinds vers les types natifs MySQL (json / bigint / datetime)", () => {
      const cols = mysqlCols(table);
      assert.equal(cols.get("payload")?.getSQLType(), "json");
      assert.equal(cols.get("enabled")?.getSQLType(), "boolean");
      assert.equal(cols.get("hits")?.getSQLType(), "int");
      assert.equal(cols.get("signals")?.getSQLType(), "bigint"); // int64
      // Un enum est TOUJOURS varchar en MySQL, indexé ou non : court par
      // nature, et TEXT interdirait de l'indexer plus tard.
      assert.equal(cols.get("phase")?.getSQLType(), "varchar(64)");
      // epoch ms déborde `int` MySQL 32-bit → bigint, comme PG.
      assert.equal(cols.get("expiresAt")?.getSQLType(), "bigint");
      // dateMs = datetime(3) (pas timestamp : borné 2038 + timezone session).
      assert.equal(cols.get("seenAt")?.getSQLType(), "datetime(3)");
    });

    it("text PK/UNIQUE/indexé → varchar(512) (TEXT non indexable InnoDB), text sinon", () => {
      const cols = mysqlCols(table);
      assert.equal(cols.get("id")?.getSQLType(), "varchar(512)"); // PK
      assert.equal(cols.get("slug")?.getSQLType(), "varchar(512)"); // UNIQUE + index
      assert.equal(cols.get("label")?.getSQLType(), "text"); // ni PK ni indexée
    });

    it("applique pk / notNull / unique + déclare les index", () => {
      const cols = mysqlCols(table);
      assert.equal(cols.get("id")?.primary, true);
      assert.equal(cols.get("label")?.notNull, true);
      assert.equal(cols.get("slug")?.isUnique, true);
      const { indexes } = getMysqlTableConfig(table);
      assert.equal(indexes.length, 2);
      const unique = indexes.find(
        (ix) => ix.config.name === "colkit_probe_slug_uidx",
      );
      assert.equal(unique?.config.unique, true);
    });
  });

  describe("invariant multi-dialecte", () => {
    it("MÊMES noms de colonnes sur les TROIS dialectes (stores dialect-agnostiques)", () => {
      const sqlite = [
        ...sqliteCols(buildFrameworkTable("sqlite", SPEC)).keys(),
      ];
      const pg = [...pgCols(buildFrameworkTable("postgres", SPEC)).keys()];
      const mysql = [...mysqlCols(buildFrameworkTable("mysql", SPEC)).keys()];
      assert.deepEqual(sqlite.sort(), pg.sort());
      assert.deepEqual(sqlite.sort(), mysql.sort());
      assert.deepEqual(
        sqlite.sort(),
        Object.keys(SPEC.columns).sort(),
        "les noms viennent de la spec, à l'identique",
      );
    });

    it("session : la factory produit les deux variantes avec les mêmes noms", () => {
      const sqliteNames = [...sqliteCols(createSessionTable("sqlite")).keys()];
      const pgNames = [...pgCols(createSessionTable("postgres")).keys()];
      assert.deepEqual(sqliteNames.sort(), pgNames.sort());
      assert.ok(sqliteNames.includes("session_id"));
    });

    it("session PG : sacs JSON en jsonb, horodatages en bigint", () => {
      const cols = pgCols(createSessionTable("postgres"));
      assert.equal(cols.get("Attributes")?.getSQLType(), "jsonb");
      assert.equal(cols.get("createdAt")?.getSQLType(), "bigint");
      assert.equal(cols.get("session_id")?.primary, true);
    });
  });

  describe("défauts JS-level ($defaultFn / $onUpdateFn) — comportement réel", () => {
    it("insert sans la colonne → defaultFn posé ; update → onUpdateFn régénéré", async () => {
      const spec = {
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
      } satisfies IFrameworkTableSpec;
      const table = buildFrameworkTable("sqlite", spec);
      const client = new BetterSqlite3(":memory:");
      try {
        const db = drizzle(client);
        const { columns } = getTableConfig(table);
        const ddl = columns
          .map(
            (c) =>
              `"${c.name}" ${c.getSQLType()}` +
              (c.primary ? " PRIMARY KEY" : "") +
              (c.notNull ? " NOT NULL" : ""),
          )
          .join(", ");
        client.exec(`CREATE TABLE "colkit_defaults" (${ddl})`);
        const inserted = (await db
          .insert(table)
          .values({ id: "a" })
          .returning()) as Array<Record<string, unknown>>;
        assert.equal(inserted[0]?.state, "fresh");
        assert.equal(inserted[0]?.rev, 1);
        const updated = (await db
          .update(table)
          .set({ state: "moved" })
          .returning()) as Array<Record<string, unknown>>;
        assert.equal(updated[0]?.state, "moved");
        assert.equal(updated[0]?.rev, 99, "onUpdateFn régénéré à l'UPDATE");
      } finally {
        client.close();
      }
    });

    it("kind dateMs : round-trip `Date` réel (stocké ms, relu Date) — sqlite", async () => {
      const spec = {
        name: "colkit_datems",
        columns: {
          id: { kind: "text", primaryKey: true },
          bornAt: { kind: "dateMs", notNull: true },
        },
      } satisfies IFrameworkTableSpec;
      const table = buildFrameworkTable("sqlite", spec);
      const client = new BetterSqlite3(":memory:");
      try {
        const db = drizzle(client);
        client.exec(
          `CREATE TABLE "colkit_datems" ("id" text PRIMARY KEY, "bornAt" integer NOT NULL)`,
        );
        const at = new Date(1_700_000_000_123);
        await db.insert(table).values({ id: "d1", bornAt: at });
        const rows = (await db.select().from(table)) as Array<
          Record<string, unknown>
        >;
        const bornAt = rows[0]?.bornAt;
        assert.ok(bornAt instanceof Date);
        assert.equal(
          bornAt.getTime(),
          at.getTime(),
          "précision milliseconde conservée",
        );
      } finally {
        client.close();
      }
    });
  });

  describe("colonnes énumérées — la contrainte CHECK est DÉCLARÉE", () => {
    it("sqlite : une contrainte nommée <table>_<col>_check, sans paramètre lié", () => {
      const { checks } = getTableConfig(buildFrameworkTable("sqlite", SPEC));
      assert.equal(checks.length, 1);
      assert.equal(checks[0]?.name, "colkit_probe_phase_check");
      const query = new SQLiteSyncDialect().sqlToQuery(checks[0]!.value);
      assert.equal(query.sql, `"phase" IN ('draft', 'live')`);
      assert.equal(
        query.params.length,
        0,
        "un CHECK ne peut porter aucun paramètre lié : une définition de " +
          "table n'a pas d'endroit où en fournir la valeur",
      );
    });

    it("postgres : même contrainte, même quoting SQL standard", () => {
      const { checks } = getPgTableConfig(
        buildFrameworkTable("postgres", SPEC),
      );
      assert.equal(checks.length, 1);
      const query = new PgDialect().sqlToQuery(checks[0]!.value);
      assert.equal(query.sql, `"phase" IN ('draft', 'live')`);
      assert.equal(query.params.length, 0);
    });

    it("mysql : identifiants en accents graves (cmd.exe des SGBD)", () => {
      const { checks } = getMysqlTableConfig(
        buildFrameworkTable("mysql", SPEC),
      );
      assert.equal(checks.length, 1);
      const query = new MySqlDialect().sqlToQuery(checks[0]!.value);
      assert.equal(query.sql, "`phase` IN ('draft', 'live')");
      assert.equal(query.params.length, 0);
    });

    it("une apostrophe dans une valeur est doublée, jamais concaténée nue", () => {
      const spec = {
        name: "colkit_quote",
        columns: {
          id: { kind: "text", primaryKey: true },
          mood: { kind: "enum", values: ["l'un", "autre"], notNull: true },
        },
      } satisfies IFrameworkTableSpec;
      const { checks } = getTableConfig(buildFrameworkTable("sqlite", spec));
      const query = new SQLiteSyncDialect().sqlToQuery(checks[0]!.value);
      assert.equal(query.sql, `"mood" IN ('l''un', 'autre')`);
    });

    it("une table SANS index mais AVEC un enum déclare quand même sa contrainte", () => {
      const spec = {
        name: "colkit_noindex",
        columns: {
          id: { kind: "text", primaryKey: true },
          state: { kind: "enum", values: ["on"], notNull: true },
        },
      } satisfies IFrameworkTableSpec;
      const { checks, indexes } = getTableConfig(
        buildFrameworkTable("sqlite", spec),
      );
      assert.equal(indexes.length, 0);
      assert.equal(checks.length, 1, "le CHECK ne dépend pas des index");
    });
  });

  describe("gardes fail-loud", () => {
    it("index sur une colonne inconnue → erreur nommant colonne et index", () => {
      const broken = {
        name: "colkit_broken",
        columns: { id: { kind: "text", primaryKey: true } },
        indexes: [{ name: "bad_idx", on: ["missing"] }],
      } satisfies IFrameworkTableSpec;
      assert.throws(
        () => buildFrameworkTable("sqlite", broken),
        /unknown column "missing"/,
      );
    });
  });

  describe("createFrameworkTableFactory", () => {
    it("mémoïse : une seule instance de table par dialecte", () => {
      const factory = createFrameworkTableFactory(SPEC);
      assert.equal(factory("sqlite"), factory("sqlite"));
      assert.equal(factory("postgres"), factory("postgres"));
      assert.notEqual(
        factory("sqlite") as unknown,
        factory("postgres") as unknown,
      );
    });

    it("défaut = sqlite ; l'export sessionTable EST la variante sqlite de la factory", () => {
      const factory = createFrameworkTableFactory(SPEC);
      assert.equal(factory(), factory("sqlite"));
      assert.equal(sessionTable, createSessionTable("sqlite"));
    });
  });
});
