import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { DrizzleOrm } from "../../nodefony/src/orm-core/DrizzleOrm";
import {
  ERP_LITE,
  creationOrder,
  primaryKeyOf,
  type ISerializedColumn,
  type ISerializedSpec,
} from "./erp-lite";
import { execRaw, generateKitMigration } from "./kit-migration";

/**
 * Banc du corpus `erp-lite` : un schéma écrit dans le style d'un vrai
 * progiciel né sur MySQL — clé composite, table sans clé, références vers une
 * clé entière, une clé chaîne et soi-même, montants `decimal(24,8)`, horodatage
 * recalculé, nom de table assez long pour que les contraintes qui en dérivent
 * dépassent 63 caractères.
 *
 * Il prouve, sur chaque moteur, et par les DEUX chemins de création (DDL dérivé
 * du développement, migration `drizzle-kit` de la production) :
 * - que les 14 tables se créent ;
 * - qu'une ligne témoin portant chaque colonne à sa borne se relit À
 *   L'IDENTIQUE, et qu'une ligne minimale reçoit ses défauts ;
 * - que les contraintes héritées du schéma d'origine tiennent : référence,
 *   unicité qui remplace une clé composite, horodatage recalculé à l'écriture.
 *
 * Le corpus réel complet (421 tables) se rejoue hors CI : skill
 * `nodefony-devkit-bench`, § « Banc de schéma réel ».
 */

/** Options d'un run du banc (un dialecte = un fichier consommateur). */
export interface IErpLiteRunOptions {
  dialect: SqlDialect;
  /** Nom du connecteur (unique par fichier). */
  connector: string;
  /** `{ url }` pour pg/mysql, `{ filename: ":memory:" }` pour sqlite. */
  connection: { url?: string | undefined; filename?: string };
  schema: "derived" | "migration";
}

type Row = Record<string, unknown>;

const FIXTURE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "erp-lite.ts",
);

/** Migration drizzle-kit des 14 tables, exportées à plat. */
function generateMigration(dialect: SqlDialect): Promise<string[]> {
  return generateKitMigration({
    dialect,
    name: "erplite",
    fixtureFile: FIXTURE_FILE,
    schemaLines: (fixture, d) => [
      `import { ERP_LITE } from "${fixture}";`,
      ...[...ERP_LITE.keys()].map(
        (name) =>
          `export const ${name} = ERP_LITE.get("${name}").table("${d}");`,
      ),
    ],
  });
}

/** Chaîne de `n` points de code : accent et emoji d'abord, puis `fill`. */
function codePoints(n: number, fill: string): string {
  return [fill, "é", "🚀", ...Array.from({ length: n }, () => fill)]
    .slice(0, n)
    .join("");
}

/** Plus grande valeur d'un `decimal(p,s)`, signée — écrite comme PostgreSQL la rend. */
function decimalBound(
  precision: number,
  scale: number,
  sign: "-" | "",
): string {
  const int = "9".repeat(precision - scale);
  return scale > 0 ? `${sign}${int}.${"9".repeat(scale)}` : `${sign}${int}`;
}

/** Un défaut décimal littéral (`"0"`) relu à l'échelle de sa colonne. */
function decimalAtScale(value: string, scale: number): string {
  const [int = "0", frac = ""] = value.split(".");
  return scale > 0 ? `${int}.${frac.padEnd(scale, "0")}` : int;
}

/**
 * Valeur témoin d'une colonne : chaque genre à sa borne. Deux jeux (`a`, `b`)
 * pour que deux lignes ne se heurtent à aucune unicité.
 */
function witness(c: ISerializedColumn, seed: "a" | "b"): unknown {
  const a = seed === "a";
  switch (c.kind) {
    case "string":
      return codePoints(c.length ?? 255, seed);
    case "char":
      return seed.repeat(c.length ?? 1);
    case "text":
      return `l'été 🚀 ${seed} `.repeat(600);
    case "int":
      return a ? 2_147_483_647 : -2_147_483_648;
    case "int64":
      return a ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER;
    case "float":
      return a ? 0.1 + 0.2 : -1.5;
    case "decimal":
      return decimalBound(c.precision ?? 10, c.scale ?? 0, a ? "-" : "");
    case "bool":
      return a;
    case "json":
      return a ? { k: ["é", 1, null], deep: { ok: true } } : [];
    case "date":
      return a ? "2024-02-29" : "1999-12-31";
    case "datetime":
      // 1969 (avant l'epoch) et 2041 (après 2038), à la milliseconde.
      return a ? new Date(-1) : new Date(2_240_524_800_123);
    default:
      throw new Error(`erp-lite : pas de témoin pour ${c.kind}`);
  }
}

/** Valeur que la base doit rendre pour une colonne laissée vide à l'insertion. */
function expectedDefault(c: ISerializedColumn): unknown {
  if (c.default === undefined) return null;
  if (c.kind === "decimal" && typeof c.default === "string") {
    return decimalAtScale(c.default, c.scale ?? 0);
  }
  return c.default;
}

/**
 * Une colonne qu'une insertion DOIT renseigner : obligatoire sans défaut, ou
 * clé qui n'est pas auto-incrémentée (une clé chaîne est NOT NULL d'office).
 */
function requiredOnInsert(c: ISerializedColumn): boolean {
  if (c.kind === "serial") return false;
  if (c.primaryKey === true) return true;
  return (
    c.notNull === true && c.default === undefined && c.defaultFn === undefined
  );
}

function runErpLiteSuite(opts: IErpLiteRunOptions): void {
  const { dialect, connector } = opts;
  const order = creationOrder();
  let orm: DrizzleOrm;
  /** Lignes témoins écrites, par table (clé primaire comprise). */
  const written = new Map<string, Row>();
  /** Lignes minimales écrites, par table — les parents des lignes minimales. */
  const minimal = new Map<string, Row>();
  const repo = (name: string): IRepository<Row> => orm.getRepository<Row>(name);

  /** Écrit une ligne, rend la ligne créée. */
  async function insert(spec: ISerializedSpec, seed: "a" | "b"): Promise<Row> {
    const data: Row = {};
    for (const [key, c] of Object.entries(spec.columns)) {
      if (c.kind === "serial") continue;
      const isMinimal = seed === "b";
      const needed = requiredOnInsert(c);
      if (isMinimal && !needed) continue;
      if (c.kind === "ref") {
        if (c.target === "self") continue;
        const parent = (seed === "a" ? written : minimal).get(c.target ?? "");
        assert.ok(
          parent,
          `${spec.name}.${key} : parent ${c.target} écrit avant`,
        );
        const target = order.find((s) => s.name === c.target);
        assert.ok(target);
        data[key] = parent[primaryKeyOf(target)];
        continue;
      }
      data[key] = witness(c, seed);
    }
    return repo(spec.name).create(data);
  }

  beforeAll(async () => {
    const migration =
      opts.schema === "migration" ? await generateMigration(dialect) : [];
    const portable = opts.schema === "derived";
    for (const [name, table] of ERP_LITE) {
      entityRegistry.register({
        connector,
        name,
        schema: portable ? table : table.table(dialect),
      });
    }
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect();
    // Repartir de tables NEUVES, enfants d'abord : une base serveur est
    // persistante, et une table d'un run précédent ne serait pas recréée.
    for (const spec of [...order].reverse()) {
      await execRaw(
        orm,
        dialect,
        `DROP TABLE IF EXISTS ${spec.name}${dialect === "postgres" ? " CASCADE" : ""}`,
      );
    }
    if (opts.schema === "migration") {
      for (const statement of migration) {
        await execRaw(orm, dialect, statement);
      }
    } else {
      await orm.disconnect();
      await orm.connect();
    }
  });

  afterAll(async () => {
    await orm.disconnect();
    for (const name of ERP_LITE.keys()) {
      entityRegistry.unregister(name, connector);
    }
    ormRegistry.unregister(connector);
  });

  it("une ligne témoin par table, chaque colonne à sa borne, relue À L'IDENTIQUE", async () => {
    for (const spec of order) {
      const pk = primaryKeyOf(spec);
      const created = await insert(spec, "a");
      const read = await repo(spec.name).findOne({ [pk]: created[pk] });
      assert.ok(read, `${spec.name} : ligne relue`);
      const expected: Row = { ...created };
      for (const [key, c] of Object.entries(spec.columns)) {
        if (c.kind === "ref" && c.target === "self") expected[key] = null;
      }
      assert.deepEqual(read, expected, `${spec.name} : relecture`);
      written.set(spec.name, read);
    }
  });

  it("une ligne minimale reçoit les défauts du schéma d'origine", async () => {
    const t0 = Date.now();
    for (const spec of order) {
      const pk = primaryKeyOf(spec);
      const created = await insert(spec, "b");
      const read = await repo(spec.name).findOne({ [pk]: created[pk] });
      assert.ok(read, `${spec.name} : ligne relue`);
      minimal.set(spec.name, read);
      for (const [key, c] of Object.entries(spec.columns)) {
        if (c.kind === "serial" || c.kind === "ref") continue;
        const needed = requiredOnInsert(c);
        if (needed) continue;
        const where = `${spec.name}.${key}`;
        if (c.defaultFn === "now") {
          const at: unknown = read[key];
          assert.ok(at instanceof Date, `${where} : instant posé`);
          assert.ok(at.getTime() >= t0 - 1000, `${where} : posé maintenant`);
        } else {
          assert.deepEqual(read[key], expectedDefault(c), `${where} : défaut`);
        }
      }
    }
  });

  it("l'horodatage recalculé avance à chaque écriture", async () => {
    const invoice = written.get("erp_invoice");
    assert.ok(invoice);
    assert.equal(invoice.tms instanceof Date && invoice.tms.getTime(), -1);
    const updated = await repo("erp_invoice").updateOne(
      { rowid: invoice.rowid },
      { close_code: "paid" },
    );
    assert.ok(updated?.tms instanceof Date);
    assert.ok(updated.tms.getTime() > Date.now() - 60_000, "tms recalculé");
  });

  it("une référence vers une ligne absente est refusée par le serveur", async () => {
    await assert.rejects(
      repo("erp_invoice_line").create({ fk_invoice: 2_000_000_000 }),
    );
  });

  it("la clé composite d'origine, devenue index unique, refuse le doublon", async () => {
    const category = written.get("erp_category");
    const product = written.get("erp_product");
    assert.ok(category && product);
    const pair = { fk_category: category.rowid, fk_product: product.rowid };
    const existing = await repo("erp_category_product").findOne(pair);
    assert.ok(existing, "la paire témoin existe");
    await assert.rejects(repo("erp_category_product").create(pair));
  });
}

/**
 * Déroule le banc sur un dialecte, dans son PROPRE `describe`. À appeler DANS un
 * `describe` (éventuellement `describe.skipIf(!url)`) du fichier consommateur.
 */
export function runErpLite(opts: IErpLiteRunOptions): void {
  describe(`tables créées par ${opts.schema === "derived" ? "le DDL dérivé" : "la migration drizzle-kit"}`, () => {
    runErpLiteSuite(opts);
  });
}
