import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import type { IPortableTable } from "../../nodefony/entity/colKit";
import type { ITableSpec } from "../../nodefony/entity/colKit.spec";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { readJournal } from "../../nodefony/src/migrator/adopt";
import { DrizzleMigrator } from "../../nodefony/src/migrator/DrizzleMigrator";
import { APP_SOURCE } from "../../nodefony/src/migrator/paths";
import { HISTORY_TABLE } from "../../nodefony/src/migrator/types";
import {
  importSpecifier,
  writeKitConfig,
} from "../../nodefony/src/migrator/appSchema";
import {
  auditMigrationSql,
  runGenerate,
  sealGeneratedSql,
} from "../../nodefony/src/migrator/kit";
import { repairRebuildCopy } from "../../nodefony/src/migrator/rebuildCopy";
import {
  completeRenames,
  prepareRenames,
  withRewrittenSnapshot,
} from "../../nodefony/src/migrator/renameGeneration";
import {
  parseRenames,
  type IRenamePlan,
} from "../../nodefony/src/migrator/renames";
import {
  columnFactsByTable,
  columnsByTable,
} from "../../nodefony/src/migrator/snapshotColumns";
import { DrizzleOrm } from "../../nodefony/src/orm-core/DrizzleOrm";
import { ERP_LITE, ERP_LITE_SPECS } from "./erp-lite";
import {
  ERP_LITE_V2,
  ERP_LITE_V2_RENAMES,
  ERP_LITE_V2_SPECS,
} from "./erp-lite-v2";
import { execRaw, REPO_ROOT } from "./kit-migration";
import {
  expectedDefault,
  runAllStatements,
  witness,
  type Row,
} from "./schema-contract";
import {
  creationOrder,
  primaryKeyOf,
  type ISerializedSpec,
} from "./serialized-specs";

/**
 * Banc d'ÉVOLUTION du corpus `erp-lite` : une base peuplée en v1 passe en v2
 * sans perdre une valeur.
 *
 * La migration v2 est produite par le MÊME code que `orm:generate --rename`
 * (`renameGeneration.ts`) : un banc qui renommerait à sa façon prouverait sa
 * façon. Le scellement, la réparation des recopies et l'audit destructif sont
 * ceux de la commande.
 *
 * Ce que le banc refuse : une suppression silencieuse. Sans la réponse d'un
 * renommage, l'outil doit s'arrêter en le DISANT ; avec, la migration ne doit
 * porter aucune instruction qui perd des données, et chaque valeur témoin
 * écrite en v1 doit se relire en v2, colonnes renommées comprises.
 */

/** Options d'un run (un dialecte = un fichier consommateur). */
export interface IEvolutionRunOptions {
  dialect: SqlDialect;
  /** Préfixe des connecteurs du banc (`<préfixe>_v1`, `<préfixe>_v2`). */
  connector: string;
  /** Base serveur ; SQLite travaille sur un fichier du décor. */
  url?: string | undefined;
}

function renamePlan(specs: readonly string[]): IRenamePlan {
  const parsed = parseRenames(specs);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.plan;
}

/** Les instructions d'un fichier de migration scellé. */
function statementsOf(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

/**
 * Déroule le banc d'évolution sur un dialecte. À appeler DANS un `describe`
 * (éventuellement `describe.skipIf(!url)`) du fichier consommateur.
 */
export function runErpLiteEvolution(opts: IEvolutionRunOptions): void {
  const { dialect } = opts;
  const plan = renamePlan(ERP_LITE_V2_RENAMES);
  const tableTo = new Map(plan.tables.map((t) => [t.from, t.to]));
  const columnTo = new Map(
    plan.columns.map((c) => [`${c.table}.${c.from}`, c.to]),
  );
  const decor = path.join(
    REPO_ROOT,
    "tmp",
    "scratch",
    `erp-lite-evolution-${dialect}-${process.pid}`,
  );
  // `<migrations>/<dialecte>` : la forme d'une application, que l'applicateur
  // lit par source (il ajoute lui-même le sous-dossier du dialecte).
  const migrations = path.join(decor, "migrations");
  const outDir = path.join(migrations, dialect);
  const connection =
    dialect === "sqlite"
      ? { filename: path.join(decor, "evolution.db") }
      : { url: opts.url };
  const v1 = `${opts.connector}_v1`;
  const v2 = `${opts.connector}_v2`;
  let v2Sql = "";
  let v2Destructive: string[] = [];
  let orm: DrizzleOrm | null = null;
  /** Lignes témoins écrites en v1, par table v1. */
  const written = new Map<string, Row>();

  async function tags(): Promise<string[]> {
    return ((await readJournal(outDir))?.entries ?? []).map((e) => e.tag);
  }

  /** Écrit le module de schéma d'une version et lance l'outil, comme la commande. */
  async function generate(
    name: string,
    fixtureFile: string,
    exportName: string,
    specs: readonly ISerializedSpec[],
  ): Promise<void> {
    const schemaFile = path.join(decor, `schema.${name}.ts`);
    const configFile = path.join(decor, `drizzle.${name}.config.ts`);
    const fixture = importSpecifier(schemaFile, fixtureFile);
    await fs.writeFile(
      schemaFile,
      [
        `import { ${exportName} } from "${fixture}";`,
        ...specs.map(
          (s) =>
            `export const ${s.name} = ${exportName}.get("${s.name}").table("${dialect}");`,
        ),
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
      name,
      label: `le banc erp-lite ${name}`,
    });
  }

  const v1File = path.join(import.meta.dirname, "erp-lite.ts");
  const v2File = path.join(import.meta.dirname, "erp-lite-v2.ts");

  async function connect(
    name: string,
    tables: ReadonlyMap<string, IPortableTable<ITableSpec>>,
  ): Promise<DrizzleOrm> {
    for (const [table, portable] of tables) {
      entityRegistry.register({
        connector: name,
        name: table,
        schema: portable.table(dialect),
      });
    }
    // La connexion ne touche PAS au schéma : il appartient aux migrations.
    const opened = new DrizzleOrm(name, {
      dialect,
      ...connection,
      deriveSchema: false,
    });
    await opened.connect();
    return opened;
  }

  async function release(
    name: string,
    tables: ReadonlyMap<string, unknown>,
  ): Promise<void> {
    await orm?.disconnect();
    orm = null;
    for (const table of tables.keys()) entityRegistry.unregister(table, name);
    ormRegistry.unregister(name);
  }

  /** L'applicateur de `orm:migrate`, sur une source `app`. */
  const migrator = (dir: string): DrizzleMigrator =>
    new DrizzleMigrator({
      connector: opts.connector,
      dialect,
      ...connection,
      sources: [{ name: APP_SOURCE, dir, rank: 1 }],
    });

  /**
   * L'état LIVRÉ en v1 : une copie du dossier dont le journal s'arrête à la
   * première migration — ce qu'une base de production a reçu avant la v2.
   */
  async function deliveredV1(): Promise<string> {
    const dir = path.join(decor, "livre-v1");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.cp(migrations, dir, { recursive: true });
    const journalFile = path.join(dir, dialect, "meta", "_journal.json");
    const journal = await readJournal(path.join(dir, dialect));
    assert.ok(journal);
    await fs.writeFile(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
      "utf8",
    );
    return dir;
  }

  /**
   * Supprime toutes les tables des deux versions, enfants d'abord, et
   * l'historique. Pas de `FOREIGN_KEY_CHECKS = 0` : c'est un réglage de
   * SESSION MySQL, et un réservoir ne garantit pas la même connexion d'une
   * instruction à l'autre.
   */
  async function dropAll(opened: DrizzleOrm): Promise<void> {
    const v2Names = new Set(ERP_LITE_V2_SPECS.map((s) => s.name));
    const union = [
      ...ERP_LITE_V2_SPECS,
      ...ERP_LITE_SPECS.filter((s) => !v2Names.has(s.name)),
    ];
    for (const name of [
      ...creationOrder(union)
        .reverse()
        .map((s) => s.name),
      HISTORY_TABLE,
    ]) {
      await execRaw(
        opened,
        dialect,
        `DROP TABLE IF EXISTS ${name}${dialect === "postgres" ? " CASCADE" : ""}`,
      );
    }
  }

  const repo = (name: string): IRepository<Row> => {
    assert.ok(orm, "connexion ouverte");
    return orm.getRepository<Row>(name);
  };

  beforeAll(async () => {
    await fs.rm(decor, { recursive: true, force: true });
    await fs.mkdir(decor, { recursive: true });
    await generate("v1", v1File, "ERP_LITE", ERP_LITE_SPECS);
    sealGeneratedSql(outDir);
  }, 300_000);

  afterAll(async () => {
    // La base est PARTAGÉE avec les autres bancs du corpus : ce banc y laisse
    // sinon ses tables v2, et le suivant bute sur une référence ou sur un nom
    // d'index (global en PostgreSQL). Ménage même après un échec.
    orm ??= await connect(v2, ERP_LITE_V2);
    await dropAll(orm);
    await release(v2, ERP_LITE_V2);
    await fs.rm(decor, { recursive: true, force: true });
  });

  it("🔴 sans la réponse d'un renommage, l'outil s'ARRÊTE en le disant — et l'instantané revient intact", async () => {
    const snapshot = path.join(outDir, "meta", "0000_snapshot.json");
    const before = await fs.readFile(snapshot, "utf8");
    // On retire UNE réponse : celle de `erp_user.lastname`.
    const partial = renamePlan(
      ERP_LITE_V2_RENAMES.filter((r) => !r.startsWith("erp_user.")),
    );
    const prepared = await prepareRenames(outDir, partial, dialect);
    assert.ok(!Array.isArray(prepared), JSON.stringify(prepared));
    await assert.rejects(
      withRewrittenSnapshot(prepared, () =>
        generate("v2_partiel", v2File, "ERP_LITE_V2", ERP_LITE_V2_SPECS),
      ),
      (e: unknown) =>
        e instanceof Error && /RENOMMAGE probable/u.test(e.message),
    );
    assert.deepEqual(await tags(), ["0000_v1"], "rien n'est inscrit");
    assert.equal(
      await fs.readFile(snapshot, "utf8"),
      before,
      "l'instantané versionné est restitué octet pour octet",
    );
  }, 300_000);

  it("avec les réponses, la v2 porte les RENAME en tête et AUCUNE instruction qui perd des données", async () => {
    const before = await tags();
    const prepared = await prepareRenames(outDir, plan, dialect);
    assert.ok(!Array.isArray(prepared), JSON.stringify(prepared));
    await withRewrittenSnapshot(prepared, () =>
      generate("v2", v2File, "ERP_LITE_V2", ERP_LITE_V2_SPECS),
    );
    const added = (await tags()).filter((t) => !before.includes(t));
    const done = await completeRenames(outDir, dialect, "v2", added, prepared);
    assert.deepEqual(done.missing, []);
    assert.equal(done.tags.length, 1);
    sealGeneratedSql(outDir);
    const file = path.join(outDir, `${done.tags[0]}.sql`);
    const repaired = repairRebuildCopy(
      await fs.readFile(file, "utf8"),
      columnsByTable(prepared.applied.doc),
    );
    await fs.writeFile(file, repaired.sql, "utf8");
    v2Sql = repaired.sql;
    v2Destructive = auditMigrationSql(
      v2Sql,
      dialect,
      columnFactsByTable(prepared.applied.doc),
    ).destructive.map((r) => r.id);
    const statements = statementsOf(v2Sql);
    assert.deepEqual(
      statements
        .slice(0, prepared.applied.statements.length)
        .map((s) => s.replace(/^--[^\n]*\n/u, "")),
      prepared.applied.statements,
      "les renommages ouvrent la migration",
    );
    assert.deepEqual(v2Destructive, [], v2Sql);
    assert.doesNotMatch(v2Sql, /\bDROP\s+COLUMN\b/iu, v2Sql);
  }, 300_000);

  it("une génération de plus n'écrit RIEN : l'instantané d'arrivée décrit bien la v2", async () => {
    const before = await tags();
    await generate("v3", v2File, "ERP_LITE_V2", ERP_LITE_V2_SPECS);
    assert.deepEqual(await tags(), before);
  }, 300_000);

  it("🔴 une base PEUPLÉE en v1 passe en v2 : chaque valeur témoin se relit, colonnes renommées comprises", async () => {
    assert.ok(v2Sql.length > 0, "la v2 a été générée");
    orm = await connect(v1, ERP_LITE);
    // Repartir de tables NEUVES : une base serveur est persistante.
    await dropAll(orm);
    // La base LIVRÉE en v1 : l'applicateur de `orm:migrate`, sur un dossier
    // dont le journal s'arrête à la v1.
    await migrator(await deliveredV1()).migrate();
    for (const spec of creationOrder(ERP_LITE_SPECS)) {
      const data: Row = {};
      for (const [key, c] of Object.entries(spec.columns)) {
        if (c.kind === "serial") continue;
        if (c.kind === "ref") {
          if (c.target === "self") continue;
          const target = ERP_LITE_SPECS.find((s) => s.name === c.target);
          assert.ok(target);
          data[key] = written.get(target.name)?.[primaryKeyOf(target)];
          continue;
        }
        data[key] = witness(c, "a");
      }
      written.set(spec.name, await repo(spec.name).create(data));
    }
    await release(v1, ERP_LITE);

    // La v2, par l'applicateur, sur la base peuplée : seule `0001_v2` est en
    // attente — la v1 est déjà à l'historique, sous la même source.
    const run = await migrator(migrations).migrate();
    assert.deepEqual(
      run.applied.map((m) => m.tag),
      ["0001_v2"],
      "seule la v2 s'applique",
    );
    orm = await connect(v2, ERP_LITE_V2);

    const lost: string[] = [];
    for (const spec of creationOrder(ERP_LITE_SPECS)) {
      const before = written.get(spec.name);
      assert.ok(before);
      const table = tableTo.get(spec.name) ?? spec.name;
      const v2Spec = ERP_LITE_V2_SPECS.find((s) => s.name === table);
      assert.ok(v2Spec, `${table} existe en v2`);
      const pk = primaryKeyOf(spec);
      const read = await repo(table).findOne({ [pk]: before[pk] });
      if (read === null) {
        lost.push(`${table} : ligne témoin introuvable`);
        continue;
      }
      const kept = new Set<string>();
      for (const [key, value] of Object.entries(before)) {
        const column = columnTo.get(`${table}.${key}`) ?? key;
        kept.add(column);
        // Un horodatage recalculé à l'écriture n'est pas une valeur témoin.
        if (spec.columns[key]?.onUpdateFn !== undefined) continue;
        try {
          assert.deepEqual(read[column], value);
        } catch {
          lost.push(
            `${table}.${column} : ${JSON.stringify(value)} → ${JSON.stringify(read[column])}`,
          );
        }
      }
      // Ce que la v2 AJOUTE à une table peuplée reçoit son défaut.
      for (const [key, c] of Object.entries(v2Spec.columns)) {
        if (kept.has(key)) continue;
        try {
          assert.deepEqual(read[key], expectedDefault(c));
        } catch {
          lost.push(
            `${table}.${key} (neuve) : ${JSON.stringify(read[key])} au lieu de ${JSON.stringify(expectedDefault(c))}`,
          );
        }
      }
    }
    assert.deepEqual(
      lost,
      [],
      `${lost.length} écart(s) :\n- ${lost.join("\n- ")}`,
    );
  }, 300_000);

  it("la table NEUVE référence des lignes écrites avant la migration", async () => {
    const invoice = written.get("erp_invoice");
    const user = written.get("erp_user");
    assert.ok(invoice && user, "lignes v1 écrites");
    const contact = await repo("erp_invoice_contact").create({
      fk_invoice: invoice.rowid,
      fk_user: user.rowid,
    });
    assert.equal(contact.role, "BILLING");
    const later = await repo("erp_invoice").updateOne(
      { rowid: invoice.rowid },
      { fk_user_valid: user.rowid },
    );
    assert.equal(later?.fk_user_valid, user.rowid);
  });
}
