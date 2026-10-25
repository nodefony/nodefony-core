import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Equal } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MySqlColumn, MySqlTable } from "drizzle-orm/mysql-core";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { defineTable, jsonType } from "../../nodefony/entity/colKit";
import type { InsertOf, RowOf } from "../../nodefony/entity/colKit";

/**
 * colKit — le TYPAGE des tables portables, prouvé par la COMPILATION.
 *
 * Ce fichier ne prouve rien à l'exécution : chaque `Expect<Equal<…>>` est une
 * égalité STRICTE (l'`Equal` de Drizzle) que `tsgo -p tsconfig.tests.json`
 * vérifie, et chaque `@ts-expect-error` est un refus attendu — s'il cessait
 * d'être une erreur, la directive deviendrait inutile et le typecheck
 * échouerait (TS2578). Les deux sens sont donc gardés : ce que le kit doit
 * typer exactement, et ce qu'il doit refuser.
 *
 * Couvert par `npm run typecheck` du module.
 */

type Expect<T extends true> = T;

/** Clés OBLIGATOIRES d'un type d'insertion. */
type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K;
}[keyof T];

const Author = defineTable({
  name: "typing_author",
  columns: {
    id: { kind: "serial", primaryKey: true },
    name: { kind: "string", length: 80, notNull: true },
  },
});

const Article = defineTable({
  name: "typing_article",
  columns: {
    id: { kind: "uuid", primaryKey: true, defaultFn: () => randomUUID() },
    title: { kind: "string", length: 120, notNull: true },
    code: { kind: "char", length: 2 },
    body: { kind: "text" },
    note: { kind: "text" },
    views: { kind: "int", notNull: true, defaultFn: () => 0 },
    total: { kind: "int64" },
    ratio: { kind: "float" },
    price: { kind: "decimal", precision: 12, scale: 2, notNull: true },
    live: { kind: "bool", notNull: true },
    tags: { kind: "json" },
    roles: {
      kind: "json",
      type: jsonType<string[]>(),
      notNull: true,
      defaultFn: () => [],
    },
    releasedOn: { kind: "date" },
    publishedAt: { kind: "datetime" },
    updatedAt: {
      kind: "datetime",
      notNull: true,
      onUpdateFn: () => new Date(),
    },
    status: { kind: "enum", values: ["draft", "live"], notNull: true },
    author: {
      kind: "ref",
      target: () => Author,
      notNull: true,
      onDelete: "restrict",
    },
    parent: { kind: "ref", target: "self", onDelete: "set null" },
  },
  indexes: [{ name: "typing_article_body_idx", on: ["body"] }],
});

type ArticleSpec = typeof Article.spec;

/** La ligne que le générateur écrivait À LA MAIN — le kit doit la retrouver seul. */
interface IHandWrittenRow {
  id: string;
  title: string;
  code: string | null;
  body: string | null;
  note: string | null;
  views: number;
  total: number | null;
  ratio: number | null;
  price: string;
  live: boolean;
  tags: unknown;
  roles: string[];
  releasedOn: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  status: "draft" | "live";
  author: number;
  parent: string | null;
}

const sqlite = Article.table("sqlite");
const pg = Article.table("postgres");
const mysql = Article.table("mysql");

// ── La ligne dérivée de la spec, sans Drizzle ────────────────────────────────
export type RowIsHandWritten = Expect<
  Equal<
    RowOf<ArticleSpec>,
    { [K in keyof IHandWrittenRow]: IHandWrittenRow[K] }
  >
>;
export type InsertRequired = Expect<
  Equal<
    RequiredKeys<InsertOf<ArticleSpec>>,
    "title" | "price" | "live" | "status" | "author"
  >
>;
export type SerialOptionalOnInsert = Expect<
  Equal<InsertOf<typeof Author.spec>, { id?: number | undefined; name: string }>
>;

// ── … égale à ce que Drizzle infère sur CHAQUE dialecte ─────────────────────
export type SelectSqlite = Expect<
  Equal<typeof sqlite.$inferSelect, RowOf<ArticleSpec>>
>;
export type SelectPg = Expect<
  Equal<typeof pg.$inferSelect, RowOf<ArticleSpec>>
>;
export type SelectMysql = Expect<
  Equal<typeof mysql.$inferSelect, RowOf<ArticleSpec>>
>;
export type InsertSqlite = Expect<
  Equal<typeof sqlite.$inferInsert, InsertOf<ArticleSpec>>
>;
export type InsertPg = Expect<
  Equal<typeof pg.$inferInsert, InsertOf<ArticleSpec>>
>;
export type InsertMysql = Expect<
  Equal<typeof mysql.$inferInsert, InsertOf<ArticleSpec>>
>;
const authorPg = Author.table("postgres");
export type AuthorSelectPg = Expect<
  Equal<typeof authorPg.$inferSelect, RowOf<typeof Author.spec>>
>;

// ── Les colonnes sont celles du BON dialecte, avec le bon type de valeur ────
export type ColumnsSqlite = Expect<
  typeof sqlite.title extends SQLiteColumn ? true : false
>;
export type ColumnsPg = Expect<typeof pg.title extends PgColumn ? true : false>;
export type ColumnsMysql = Expect<
  typeof mysql.title extends MySqlColumn ? true : false
>;
export type PriceIsString = Expect<
  Equal<(typeof pg.price)["_"]["data"], string>
>;
export type StatusIsUnion = Expect<
  Equal<(typeof mysql.status)["_"]["data"], "draft" | "live">
>;
export type RefTakesKeyType = Expect<
  Equal<(typeof sqlite.author)["_"]["data"], number>
>;
export type SelfRefTakesKeyType = Expect<
  Equal<(typeof pg.parent)["_"]["data"], string>
>;
export type RolesTyped = Expect<
  Equal<(typeof sqlite.roles)["_"]["data"], string[]>
>;
export type DayIsString = Expect<
  Equal<(typeof mysql.releasedOn)["_"]["data"], string>
>;
export type InstantIsDate = Expect<
  Equal<(typeof pg.publishedAt)["_"]["data"], Date>
>;
// MySQL : un `text` indexé devient `varchar` (InnoDB), un `text` libre reste `text`.
export type MysqlIndexedText = Expect<
  Equal<(typeof mysql.body)["_"]["columnType"], "MySqlVarChar">
>;
export type MysqlFreeText = Expect<
  Equal<(typeof mysql.note)["_"]["columnType"], "MySqlText">
>;

// ── Une spec calculée (non littérale) rend la table LARGE, pas un type faux ──
const computed = defineTable({
  name: "typing_computed",
  columns: Object.fromEntries([["id", { kind: "text", primaryKey: true }]]),
});
const computedLite = computed.table("sqlite");
export type WideSqlite = Expect<Equal<typeof computedLite, SQLiteTable>>;

const Embedded = defineTable({
  name: "typing_vector",
  columns: {
    id: { kind: "uuid", primaryKey: true },
    embedding: { kind: "vector", dimensions: 3, notNull: true },
  },
});

function _typeOnly(
  dbLite: BetterSQLite3Database,
  dbPg: NodePgDatabase,
  dbMy: MySql2Database,
  wide: SQLiteTable | PgTable | MySqlTable,
): void {
  // ── Nominal : requêtes et insertions typées, sans conversion ───────────────
  dbLite.select().from(sqlite).where(eq(sqlite.status, "live"));
  dbPg.select().from(pg).where(eq(pg.price, "12.50"));
  dbMy.select().from(mysql).where(eq(mysql.views, 3));
  const values = {
    title: "t",
    price: "1.00",
    live: true,
    status: "draft",
    author: 1,
  } satisfies InsertOf<ArticleSpec>;
  dbLite.insert(sqlite).values(values);
  dbPg.insert(pg).values(values);
  dbMy.insert(mysql).values(values);

  // ── Un vecteur : natif PostgreSQL, `never` ailleurs (appel jamais exécuté) ──
  const vectorPg = Embedded.table("postgres");
  const vectorLite = Embedded.table("sqlite");
  const vectorMy = Embedded.table("mysql");
  type _VectorPg = Expect<
    Equal<(typeof vectorPg.embedding)["_"]["data"], number[]>
  >;
  type _VectorLite = Expect<Equal<typeof vectorLite, never>>;
  type _VectorMy = Expect<Equal<typeof vectorMy, never>>;

  // ── Ce que le kit REFUSE ───────────────────────────────────────────────────
  // @ts-expect-error un décimal est une CHAÎNE : le comparer à un nombre est refusé
  eq(pg.price, 12.5);
  // @ts-expect-error une valeur hors énumération est refusée
  eq(sqlite.status, "archived");
  // @ts-expect-error une colonne NOT NULL sans défaut manque à l'insertion
  dbPg.insert(pg).values({ title: "t" });
  // @ts-expect-error un vecteur n'a pas de table SQLite
  void Embedded.table("sqlite").id;
  // @ts-expect-error l'union large (ancien colKit) perd ses colonnes au type
  void wide.title;

  defineTable({
    name: "typing_bad_default",
    columns: {
      id: { kind: "uuid", primaryKey: true },
      // @ts-expect-error un défaut JavaScript du mauvais type est refusé
      price: { kind: "decimal", precision: 10, scale: 2, defaultFn: () => 0 },
    },
  });

  defineTable({
    name: "typing_bad_key",
    columns: {
      // @ts-expect-error un entier n'est pas une clé primaire (serial, ou une chaîne)
      id: { kind: "int", primaryKey: true },
    },
  });
}

describe("colKit — typage des tables portables (compile-only)", () => {
  it("la preuve est la compilation", () => {
    // `tsgo -p tsconfig.tests.json` porte la preuve ; ce corps ne fait que
    // garder la fonction de typage référencée.
    expect(typeof _typeOnly).toBe("function");
  });
});

// ── Défaut LITTÉRAL (`default`) : facultatif à l'insertion, comme `defaultFn` ──
const Defaulted = defineTable({
  name: "typing_defaulted",
  columns: {
    id: { kind: "serial", primaryKey: true },
    rank: { kind: "int", notNull: true, default: 7, column: "row_rank" },
    tier: {
      kind: "enum",
      values: ["free", "pro"],
      notNull: true,
      default: "free",
    },
  },
});
type DefaultedSpec = typeof Defaulted.spec;
const defaultedSqlite = Defaulted.table("sqlite");
const defaultedPg = Defaulted.table("postgres");
const defaultedMysql = Defaulted.table("mysql");

export type LiteralDefaultOptionalOnInsert = Expect<
  Equal<RequiredKeys<InsertOf<DefaultedSpec>>, never>
>;
export type LiteralDefaultSqlite = Expect<
  Equal<typeof defaultedSqlite.$inferInsert, InsertOf<DefaultedSpec>>
>;
export type LiteralDefaultPg = Expect<
  Equal<typeof defaultedPg.$inferInsert, InsertOf<DefaultedSpec>>
>;
export type LiteralDefaultMysql = Expect<
  Equal<typeof defaultedMysql.$inferInsert, InsertOf<DefaultedSpec>>
>;

defineTable({
  name: "typing_bad_default",
  columns: {
    id: { kind: "serial", primaryKey: true },
    // @ts-expect-error — le défaut d'un entier est un nombre
    rank: { kind: "int", default: "sept" },
  },
});
