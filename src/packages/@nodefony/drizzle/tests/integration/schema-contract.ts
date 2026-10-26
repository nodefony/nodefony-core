import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import type { IPortableTable } from "../../nodefony/entity/colKit";
import {
  boundedForeignKeyName,
  boundedUniqueName,
} from "../../nodefony/entity/colKit.shared";
import { columnName } from "../../nodefony/entity/colKit.spec";
import type { ITableSpec } from "../../nodefony/entity/colKit.spec";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { DrizzleOrm } from "../../nodefony/src/orm-core/DrizzleOrm";
import {
  creationOrder,
  primaryKeyOf,
  type ISerializedColumn,
  type ISerializedSpec,
} from "./serialized-specs";
import { execRaw, generateKitMigration } from "./kit-migration";

/**
 * Contrat d'un SCHÉMA écrit par d'autres, sur un moteur : ce que le kit de
 * colonnes doit tenir quel que soit le corpus — le synthétique `erp-lite` de la
 * CI comme le corpus réel du banc de schéma (`real-schema.e2e.test.ts`).
 *
 * Il prouve, par les DEUX chemins de création (DDL dérivé du développement,
 * migration `drizzle-kit` de la production) :
 * - que toutes les tables se créent ;
 * - qu'une ligne témoin portant chaque colonne à sa borne se relit À
 *   L'IDENTIQUE, et qu'une ligne minimale reçoit ses défauts — chaque table
 *   en écart NOMMÉE, jamais la première seule.
 *
 * Les cas propres à un corpus (ses tables, ses requêtes) passent par
 * `specific` : ce fichier ne nomme aucune table.
 */

/** Options d'un run du banc (un dialecte = un fichier consommateur). */
export interface ISchemaRunOptions {
  dialect: SqlDialect;
  /** Nom du connecteur (unique par fichier). */
  connector: string;
  /** `{ url }` pour pg/mysql, `{ filename: ":memory:" }` pour sqlite. */
  connection: { url?: string | undefined; filename?: string };
  schema: "derived" | "migration";
  /** Délai de la préparation (ms) — un corpus de centaines de tables dépasse le défaut. */
  timeout?: number;
}

/** Un corpus : ses descriptions, ses tables, et le fichier que relit `drizzle-kit`. */
export interface ISchemaCorpus {
  /** Nom court, pour le dossier de la migration générée. */
  readonly name: string;
  readonly specs: readonly ISerializedSpec[];
  readonly tables: ReadonlyMap<string, IPortableTable<ITableSpec>>;
  /** Fichier qui exporte `tables`, relu par `drizzle-kit` (CommonJS). */
  readonly fixtureFile: string;
  /** Nom sous lequel ce fichier exporte `tables`. */
  readonly tablesExport: string;
}

/** Une ligne lue ou écrite par le banc. */
export type Row = Record<string, unknown>;

/** Ce que le contrat prête aux cas propres d'un corpus. */
export interface ISchemaSuiteContext {
  readonly dialect: SqlDialect;
  /** L'ORM connecté — lu au moment du cas, jamais à la déclaration. */
  orm(): DrizzleOrm;
  repo(name: string): IRepository<Row>;
  /** Lignes témoins écrites par le contrat, par table. */
  readonly written: ReadonlyMap<string, Row>;
}

/** Migration drizzle-kit du corpus, ses tables exportées à plat. */
function generateMigration(
  corpus: ISchemaCorpus,
  dialect: SqlDialect,
): Promise<string[]> {
  const exported = corpus.tablesExport;
  return generateKitMigration({
    dialect,
    name: corpus.name,
    fixtureFile: corpus.fixtureFile,
    schemaLines: (fixture, d) => [
      `import { ${exported} } from "${fixture}";`,
      ...[...corpus.tables.keys()].map(
        (name) =>
          `export const ${name} = ${exported}.get("${name}").table("${d}");`,
      ),
    ],
  });
}

/**
 * La table que vise une instruction de migration (`CREATE TABLE x`,
 * `ALTER TABLE x`, `CREATE INDEX … ON x`), pour nommer un refus.
 */
export function statementTarget(statement: string): string {
  const match =
    /\b(?:TABLE|ON)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([\w$]+)[`"]?/iu.exec(
      statement,
    );
  return match?.[1] ?? statement.slice(0, 60);
}

/**
 * Exécute TOUTES les instructions d'une migration et rend chaque refus, nommé
 * par sa table : s'arrêter au premier cachait les suivants — une table par
 * passe du banc de schéma réel.
 */
export async function runAllStatements(
  statements: readonly string[],
  exec: (statement: string) => Promise<unknown>,
): Promise<string[]> {
  const refused: string[] = [];
  for (const statement of statements) {
    try {
      await exec(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      refused.push(`${statementTarget(statement)} : ${message}`);
    }
  }
  return refused;
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

function runSchemaSuite(
  opts: ISchemaRunOptions,
  corpus: ISchemaCorpus,
  specific?: (ctx: ISchemaSuiteContext) => void,
): void {
  const { dialect, connector } = opts;
  const order = creationOrder(corpus.specs);
  let orm: DrizzleOrm;
  /** Lignes témoins écrites, par table (clé primaire comprise). */
  const written = new Map<string, Row>();
  /** Lignes minimales écrites, par table — les parents des lignes minimales. */
  const minimal = new Map<string, Row>();
  /** Instructions de la migration drizzle-kit (étage « migration » seulement). */
  let migration: readonly string[] = [];
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
    migration =
      opts.schema === "migration"
        ? await generateMigration(corpus, dialect)
        : [];
    const portable = opts.schema === "derived";
    for (const [name, table] of corpus.tables) {
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
      const refused = await runAllStatements(migration, (statement) =>
        execRaw(orm, dialect, statement),
      );
      assert.deepEqual(
        refused,
        [],
        `${refused.length} instruction(s) de la migration refusée(s) :\n- ${refused.join("\n- ")}`,
      );
    } else {
      await orm.disconnect();
      await orm.connect();
    }
  }, opts.timeout);

  afterAll(async () => {
    await orm.disconnect();
    for (const name of corpus.tables.keys()) {
      entityRegistry.unregister(name, connector);
    }
    ormRegistry.unregister(connector);
  });

  /**
   * Déroule `check` sur chaque table et rend TOUS les écarts : sur un corpus de
   * centaines de tables, s'arrêter à la première masquerait les suivantes.
   */
  async function eachTable(
    check: (spec: ISerializedSpec) => Promise<void>,
  ): Promise<string[]> {
    const failures: string[] = [];
    for (const spec of order) {
      try {
        await check(spec);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${spec.name} : ${message.split("\n")[0]}`);
      }
    }
    return failures;
  }

  it("une ligne témoin par table, chaque colonne à sa borne, relue À L'IDENTIQUE", async () => {
    const failures = await eachTable(async (spec) => {
      const pk = primaryKeyOf(spec);
      const created = await insert(spec, "a");
      const read = await repo(spec.name).findOne({ [pk]: created[pk] });
      assert.ok(read, "ligne relue");
      const expected: Row = { ...created };
      for (const [key, c] of Object.entries(spec.columns)) {
        if (c.kind === "ref" && c.target === "self") expected[key] = null;
      }
      assert.deepEqual(read, expected, "relecture");
      written.set(spec.name, read);
    });
    assert.deepEqual(failures, [], `${failures.length} table(s) en écart`);
  });

  it("une ligne minimale reçoit les défauts du schéma d'origine", async () => {
    const t0 = Date.now();
    const failures = await eachTable(async (spec) => {
      const pk = primaryKeyOf(spec);
      const created = await insert(spec, "b");
      const read = await repo(spec.name).findOne({ [pk]: created[pk] });
      assert.ok(read, "ligne relue");
      minimal.set(spec.name, read);
      for (const [key, c] of Object.entries(spec.columns)) {
        if (c.kind === "serial" || c.kind === "ref") continue;
        const needed = requiredOnInsert(c);
        if (needed) continue;
        if (c.defaultFn === "now") {
          const at: unknown = read[key];
          assert.ok(at instanceof Date, `${key} : instant posé`);
          assert.ok(at.getTime() >= t0 - 1000, `${key} : posé maintenant`);
        } else {
          assert.deepEqual(read[key], expectedDefault(c), `${key} : défaut`);
        }
      }
    });
    assert.deepEqual(failures, [], `${failures.length} table(s) en écart`);
  });

  it("chaque référence du schéma ressort de describeEntity avec sa cible (graphe d'entités)", async () => {
    const failures = await eachTable(async (spec) => {
      const described = new Map(
        orm.describeEntity(spec.name).map((c) => [c.name, c]),
      );
      for (const [key, c] of Object.entries(spec.columns)) {
        if (c.kind !== "ref") continue;
        const target =
          c.target === "self" ? spec : order.find((s) => s.name === c.target);
        assert.ok(target, `${key} : cible ${c.target} dans le corpus`);
        assert.deepEqual(
          described.get(key)?.references,
          { entity: target.name, column: primaryKeyOf(target) },
          key,
        );
      }
    });
    assert.deepEqual(failures, [], `${failures.length} table(s) en écart`);
  });

  // Le nom que le kit CALCULE doit être celui que drizzle-kit ÉCRIT : un nom
  // donné ne dépend plus de la convention de l'outil, que Drizzle 1 change pour
  // les noms qu'on ne lui donne pas. SQLite n'écrit pas le nom d'une clé étrangère.
  it.skipIf(opts.schema !== "migration")(
    "chaque unicité et chaque clé étrangère porte, dans la migration, le nom que le kit lui DONNE",
    () => {
      const text = migration.join("\n");
      const quote = dialect === "postgres" ? '"' : "`";
      const missing: string[] = [];
      let checked = 0;
      for (const { spec } of corpus.tables.values()) {
        for (const [key, column] of Object.entries(spec.columns)) {
          const names: string[] = [];
          if (column.kind !== "serial" && column.unique) {
            names.push(boundedUniqueName(spec.name, columnName(key, column)));
          }
          if (column.kind === "ref" && dialect !== "sqlite") {
            names.push(boundedForeignKeyName(spec, key, column));
          }
          for (const name of names) {
            checked++;
            if (!text.includes(`${quote}${name}${quote}`)) {
              missing.push(`${spec.name}.${key} : ${name}`);
            }
          }
        }
      }
      assert.ok(checked > 0, "le corpus ne nomme aucune contrainte");
      assert.deepEqual(missing, [], `${missing.length} nom(s) absent(s)`);
    },
  );

  specific?.({
    dialect,
    orm: () => orm,
    repo,
    written,
  });
}

/**
 * Déroule le contrat d'un corpus sur un dialecte, dans son PROPRE `describe`.
 * À appeler DANS un `describe` (éventuellement `describe.skipIf(!url)`) du
 * fichier consommateur.
 *
 * @param opts - dialecte, connecteur, chemin de création.
 * @param corpus - les descriptions et leurs tables.
 * @param specific - les cas propres au corpus, après les cas communs.
 */
export function runSchemaContract(
  opts: ISchemaRunOptions,
  corpus: ISchemaCorpus,
  specific?: (ctx: ISchemaSuiteContext) => void,
): void {
  describe(`tables créées par ${opts.schema === "derived" ? "le DDL dérivé" : "la migration drizzle-kit"}`, () => {
    runSchemaSuite(opts, corpus, specific);
  });
}
