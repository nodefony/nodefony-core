import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { DrizzleOrm } from "../../nodefony/src/orm-core/DrizzleOrm";
import {
  importSpecifier,
  writeKitConfig,
} from "../../nodefony/src/migrator/appSchema";
import { runGenerate } from "../../nodefony/src/migrator/kit";
import {
  PARENT,
  PARENT_ENTITY,
  VALUE,
  VALUE_ENTITY,
  type IParentRow,
  type IValueRow,
} from "./colkit-grammar";

/**
 * Banc d'ALLER-RETOUR du colKit : une table qui porte TOUTE la grammaire est
 * fabriquée par le kit, créée par le DDL dérivé, puis chaque valeur — bornes
 * comprises — est écrite et relue sur le vrai moteur. Le MÊME contrat tourne
 * sur SQLite, PostgreSQL et MySQL/MariaDB (`NF_MYSQL_URL` vise l'un ou l'autre ;
 * `npm run test:all -- --dialects` rejoue sur MySQL Community).
 *
 * Ce qu'il prouve, et que la compilation ne peut pas prouver :
 * - la valeur JavaScript relue est IDENTIQUE partout — y compris là où un
 *   moteur normalise (décimal à l'échelle, uuid en minuscules) ;
 * - ce qu'un moteur ne vérifie pas est refusé comme ailleurs (longueur en
 *   SQLite, longueur exacte d'un `char`, énumération, clé étrangère, jour qui
 *   n'existe pas, uuid malformé, décimal qui déborde) ;
 * - les actions `onDelete` des références se déclenchent.
 *
 * Les lignes passent par le DÉPÔT (`IRepository`), comme l'application : le
 * dépôt ne sait pas que la table vient du kit.
 */

/** Options d'un run du banc (un dialecte = un fichier consommateur). */
export interface IRoundtripRunOptions {
  dialect: SqlDialect;
  /** Nom du connecteur (unique par fichier). */
  connector: string;
  /** `{ url }` pour pg/mysql, `{ filename: ":memory:" }` pour sqlite. */
  connection: { url?: string | undefined; filename?: string };
  /**
   * Qui crée les tables : le DDL dérivé du développement, ou la migration que
   * `drizzle-kit` génère pour la production. Les DEUX chemins doivent rendre la
   * même base — c'est le même banc qui le prouve, au comportement près.
   */
  schema: "derived" | "migration";
}

/** SQL brut sur la connexion native (`run` better-sqlite3, `execute` pg/mysql2). */
interface ISqliteExecutor {
  run(query: SQL): unknown;
}
interface IServerExecutor {
  execute(query: SQL): Promise<unknown>;
}

async function execRaw(
  orm: DrizzleOrm,
  dialect: SqlDialect,
  statement: string,
): Promise<void> {
  if (dialect === "sqlite") {
    orm.getNativeConnection<ISqliteExecutor>().run(sql.raw(statement));
  } else {
    await orm
      .getNativeConnection<IServerExecutor>()
      .execute(sql.raw(statement));
  }
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);

/**
 * Génère la migration initiale des tables du banc avec `drizzle-kit`, comme
 * `orm:generate` le fait pour une application, et rend ses instructions.
 *
 * Le décor vit sous `tmp/scratch/` du DÉPÔT : la résolution de `drizzle-kit`
 * et de `drizzle-orm` remonte jusqu'à ses `node_modules`. Il est supprimé
 * après lecture.
 */
async function generateMigration(dialect: SqlDialect): Promise<string[]> {
  const decor = path.join(
    REPO_ROOT,
    "tmp",
    "scratch",
    `colkit-migration-${dialect}-${process.pid}`,
  );
  try {
    const schemaFile = path.join(decor, "schema.ts");
    const configFile = path.join(decor, "drizzle.config.ts");
    const outDir = path.join(decor, "migrations");
    const fixture = importSpecifier(
      schemaFile,
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "colkit-grammar.ts",
      ),
    );
    await fs.mkdir(decor, { recursive: true });
    await fs.writeFile(
      schemaFile,
      [
        `import { PARENT, VALUE } from "${fixture}";`,
        `export const nf_parent = PARENT.table("${dialect}");`,
        `export const nf_value = VALUE.table("${dialect}");`,
        "",
      ].join("\n"),
      "utf8",
    );
    await writeKitConfig({
      file: configFile,
      projectRoot: decor,
      schemaFile,
      outDir,
      dialect,
      excludedTables: [],
    });
    runGenerate({
      cwd: decor,
      configRel: path.relative(decor, configFile).split(path.sep).join("/"),
      name: "colkit",
      label: "le banc colKit",
    });
    const body = await fs.readFile(
      path.join(outDir, "0000_colkit.sql"),
      "utf8",
    );
    return body
      .split("--> statement-breakpoint")
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
  } finally {
    await fs.rm(decor, { recursive: true, force: true });
  }
}

function runRoundtripSuite(opts: IRoundtripRunOptions): void {
  const { dialect, connector } = opts;
  const label = `${dialect}, ${opts.schema === "derived" ? "DDL dérivé" : "migration drizzle-kit"}`;
  let orm: DrizzleOrm;
  let parents: IRepository<IParentRow>;
  let values: IRepository<IValueRow>;

  beforeAll(async () => {
    const migration =
      opts.schema === "migration" ? await generateMigration(dialect) : [];
    // Les DEUX façons de déclarer une entité : la description PORTABLE, que
    // l'ORM décline pour son dialecte (DDL dérivé), et la table native déjà
    // déclinée (migration) — le même banc les juge l'une et l'autre.
    const portable = opts.schema === "derived";
    entityRegistry.register({
      connector,
      name: PARENT_ENTITY,
      schema: portable ? PARENT : PARENT.table(dialect),
    });
    entityRegistry.register({
      connector,
      name: VALUE_ENTITY,
      schema: portable ? VALUE : VALUE.table(dialect),
    });
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect();
    // Repartir de tables NEUVES : une base serveur est persistante, et une table
    // d'un run précédent ne serait pas modifiée par le DDL de ce code.
    await execRaw(orm, dialect, `DROP TABLE IF EXISTS ${VALUE_ENTITY}`);
    await execRaw(orm, dialect, `DROP TABLE IF EXISTS ${PARENT_ENTITY}`);
    if (opts.schema === "migration") {
      for (const statement of migration) {
        await execRaw(orm, dialect, statement);
      }
    } else {
      // Le DDL dérivé est émis à la connexion : se reconnecter le rejoue. Une
      // base SQLite en mémoire ne survit pas à la déconnexion — elle repart vide.
      await orm.disconnect();
      await orm.connect();
    }
    parents = orm.getRepository<IParentRow>(PARENT_ENTITY);
    values = orm.getRepository<IValueRow>(VALUE_ENTITY);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(VALUE_ENTITY, connector);
    entityRegistry.unregister(PARENT_ENTITY, connector);
    ormRegistry.unregister(connector);
  });

  /** Écrit une ligne et la relit par sa clé. */
  async function roundtrip(data: Partial<IValueRow>): Promise<IValueRow> {
    const created = await values.create(data);
    const read = await values.findOne({ id: created.id });
    assert.ok(read, "ligne relue");
    return read;
  }

  describe(`aller-retour des valeurs (${label})`, () => {
    it("string(n) : n caractères, accents et emoji (UTF-8 sur 4 octets) compris", async () => {
      const title = `${"é".repeat(118)}🚀x`;
      assert.equal(Array.from(title).length, 120); // points de code, ce que comptent les moteurs
      assert.equal((await roundtrip({ title })).title, title);
    });

    it("char(n) : exactement n caractères", async () => {
      assert.equal((await roundtrip({ code: "AB" })).code, "AB");
    });

    it("text : 10 000 caractères", async () => {
      const body = "lorem ipsum ".repeat(834).slice(0, 10_000);
      assert.equal((await roundtrip({ body })).body, body);
    });

    it("int : bornes 32 bits signées", async () => {
      assert.equal(
        (await roundtrip({ small: 2_147_483_647 })).small,
        2_147_483_647,
      );
      assert.equal(
        (await roundtrip({ small: -2_147_483_648 })).small,
        -2_147_483_648,
      );
    });

    it("int64 : au-delà de 2³¹ et jusqu'à 2⁵³−1, exact", async () => {
      for (const big of [
        2 ** 31 + 1,
        Number.MAX_SAFE_INTEGER,
        -Number.MAX_SAFE_INTEGER,
      ]) {
        assert.equal((await roundtrip({ big })).big, big);
      }
    });

    it("float : double IEEE 754 relu au bit près", async () => {
      assert.equal((await roundtrip({ ratio: 0.1 + 0.2 })).ratio, 0.1 + 0.2);
    });

    it("decimal(p,s) : relu à l'échelle, arrondi au plus proche, comme PostgreSQL", async () => {
      const cases: Array<[string, string]> = [
        ["12.5", "12.50"],
        ["12.50", "12.50"],
        ["-0.125", "-0.13"],
        ["0.004", "0.00"],
        ["9999999999.99", "9999999999.99"],
        ["1e2", "100.00"],
      ];
      for (const [written, expected] of cases) {
        assert.equal(
          (await roundtrip({ price: written })).price,
          expected,
          written,
        );
      }
    });

    it("bool", async () => {
      assert.equal((await roundtrip({ live: true })).live, true);
      assert.equal((await roundtrip({ live: false })).live, false);
    });

    it("json : objet imbriqué, tableau, accents et emoji", async () => {
      const doc = { a: [1, "deux", { trois: true }], é: "🚀", vide: {} };
      assert.deepEqual((await roundtrip({ doc })).doc, doc);
    });

    it("date : jour calendaire, 29 février d'une année bissextile", async () => {
      assert.equal((await roundtrip({ day: "2024-02-29" })).day, "2024-02-29");
    });

    it("datetime : avant 1970 et après 2038, à la milliseconde", async () => {
      for (const at of [
        new Date("1969-07-20T20:17:40.123Z"),
        new Date("2040-01-01T00:00:00.999Z"),
      ]) {
        assert.equal((await roundtrip({ at })).at?.getTime(), at.getTime());
      }
    });

    it("uuid : forme canonique en minuscules, relue ET cherchée comme PostgreSQL", async () => {
      const upper = "ABCDEF12-3456-4789-ABCD-EF1234567890";
      const row = await roundtrip({ ref: upper });
      assert.equal(row.ref, upper.toLowerCase());
      assert.equal((await values.findOne({ ref: upper }))?.id, row.id);
    });

    it("enum : valeur admise", async () => {
      assert.equal((await roundtrip({ status: "live" })).status, "live");
    });

    it("défaut littéral : posé côté JS quand la colonne est omise", async () => {
      const row = await roundtrip({});
      assert.equal(row.rank, 7);
      assert.equal(row.active, true);
      assert.equal(row.tier, "free");
      assert.equal(row.motto, "l'été 🚀");
      // Un objet par ligne : modifier l'un ne touche pas le défaut suivant.
      row.tags.push("x");
      assert.deepEqual(row.tags, ["x"]);
      assert.deepEqual((await roundtrip({})).tags, []);
    });

    if (opts.schema === "migration") {
      it("défaut littéral : DEFAULT SQL dans la migration — une ligne écrite SANS l'ORM le reçoit", async () => {
        const id = "0b9e5b8e-6c8f-4b4e-9f3a-2d7c1a4e5f60";
        await execRaw(
          orm,
          dialect,
          `INSERT INTO ${VALUE_ENTITY} (id) VALUES ('${id}')`,
        );
        const row = await values.findOne({ id });
        assert.ok(row, "ligne relue");
        assert.equal(row.rank, 7);
        assert.equal(row.active, true);
        assert.equal(row.tier, "free");
        assert.equal(row.motto, "l'été 🚀");
        assert.deepEqual(row.tags, []);
      });
    }

    it("NULL : toute colonne nullable relue null", async () => {
      const row = await roundtrip({});
      const nullable: Array<keyof IValueRow> = [
        "title",
        "price",
        "doc",
        "day",
        "at",
        "ref",
        "status",
      ];
      for (const key of nullable) {
        assert.equal(row[key], null, key);
      }
    });
  });

  describe(`refus — même verdict que les autres moteurs (${label})`, () => {
    const refused: Array<[string, Partial<IValueRow>]> = [
      ["string(120) à 121 caractères", { title: "x".repeat(121) }],
      ["char(2) plus court", { code: "A" }],
      ["char(2) plus long", { code: "ABC" }],
      ["enum hors liste", { status: "archived" }],
      ["décimal qui déborde la précision", { price: "99999999999.99" }],
      ["décimal malformé", { price: "douze" }],
      ["jour qui n'existe pas", { day: "2023-02-29" }],
      ["uuid malformé", { ref: "pas-un-uuid" }],
      ["clé étrangère inconnue", { parentId: 2_000_000_000 }],
    ];
    for (const [label, data] of refused) {
      it(label, async () => {
        await assert.rejects(values.create(data));
      });
    }
  });

  describe(`références (${label})`, () => {
    it("serial : clé attribuée par la base, croissante", async () => {
      const first = await parents.create({ label: "un" });
      const second = await parents.create({ label: "deux" });
      assert.equal(typeof first.id, "number");
      assert.ok(second.id > first.id);
    });

    it("onDelete cascade : supprimer le parent supprime l'enfant", async () => {
      const parent = await parents.create({ label: "cascade" });
      const child = await values.create({ parentId: parent.id });
      assert.equal(await parents.deleteOne({ id: parent.id }), true);
      assert.equal(await values.findOne({ id: child.id }), null);
    });

    it("relation vers soi + onDelete set null", async () => {
      const first = await values.create({ title: "premier" });
      const second = await values.create({ previous: first.id });
      assert.equal(
        (await values.findOne({ id: second.id }))?.previous,
        first.id,
      );
      assert.equal(await values.deleteOne({ id: first.id }), true);
      assert.equal((await values.findOne({ id: second.id }))?.previous, null);
    });
  });
}

/**
 * Déroule le banc sur un dialecte, dans son PROPRE `describe` : deux modes
 * (`derived`, `migration`) appelés depuis le même fichier ne partagent ni leurs
 * crochets `beforeAll` ni leurs tables. À appeler DANS un `describe`
 * (éventuellement `describe.skipIf(!url)`) du fichier consommateur.
 */
export function runColKitRoundtrip(opts: IRoundtripRunOptions): void {
  describe(`tables créées par ${opts.schema === "derived" ? "le DDL dérivé" : "la migration drizzle-kit"}`, () => {
    runRoundtripSuite(opts);
  });
}
