import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import type { IPortableTable } from "../../nodefony/entity/colKit";
import type { ITableSpec } from "../../nodefony/entity/colKit.spec";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { readJournal } from "../../nodefony/src/migrator/adopt";
import {
  importSpecifier,
  writeKitConfig,
} from "../../nodefony/src/migrator/appSchema";
import {
  dataLoss,
  scanDestructive,
} from "../../nodefony/src/migrator/destructive";
import { DrizzleMigrator } from "../../nodefony/src/migrator/DrizzleMigrator";
import { runGenerate, sealGeneratedSql } from "../../nodefony/src/migrator/kit";
import { APP_SOURCE } from "../../nodefony/src/migrator/paths";
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
  columnsBeforeFiles,
  reviewGenerated,
} from "../../nodefony/src/migrator/review";
import { HISTORY_TABLE } from "../../nodefony/src/migrator/types";
import { DrizzleOrm } from "../../nodefony/src/orm-core/DrizzleOrm";
import { execRaw, REPO_ROOT } from "./kit-migration";
import { expectedDefault, witness, type Row } from "./schema-contract";
import {
  creationOrder,
  materializeSpecs,
  primaryKeyOf,
  type ISerializedSpec,
} from "./serialized-specs";

/**
 * Banc d'ÉVOLUTION d'un schéma : une base peuplée à la version de départ passe
 * à la version d'arrivée sans perdre une valeur qu'on n'a pas DÉCIDÉ de perdre.
 *
 * Les migrations sont produites par le MÊME code que `orm:generate` : génération
 * sous preuve positive (`runGenerate`), renommages déclarés
 * (`renameGeneration.ts`), scellement, puis la relecture de la commande
 * (`reviewGenerated` — recopie réparée, audit). L'application passe par
 * l'applicateur de `orm:migrate` (`DrizzleMigrator`), et son garde destructif
 * est relu sur le plan qu'il calcule (`scanDestructive`). Un banc qui ferait à
 * sa façon prouverait sa façon.
 *
 * Deux corpus le consomment : `erp-lite` (versionné, en CI) et un corpus réel
 * converti (`real-schema-evolution.e2e.test.ts`, opt-in).
 */

/** Options d'un run (un dialecte = un fichier consommateur). */
export interface ISchemaEvolutionRunOptions {
  dialect: SqlDialect;
  /** Préfixe des connecteurs du banc (`<préfixe>_v1`, `<préfixe>_v2`). */
  connector: string;
  /** Base serveur ; SQLite travaille sur un fichier du décor. */
  url?: string | undefined;
}

/** Une évolution : deux versions d'un schéma, et ce que l'auteur VOULAIT. */
export interface ISchemaEvolution {
  /** Nom court, sert au décor (`tmp/scratch/<nom>-evolution-<dialecte>-<pid>`). */
  readonly name: string;
  readonly from: readonly ISerializedSpec[];
  readonly to: readonly ISerializedSpec[];
  /** Renommages, au format de `orm:generate --rename`. */
  readonly renames: readonly string[];
  /**
   * Suppressions VOULUES, en noms de DÉPART : `table` ou `table.colonne`.
   * Elles passent par une génération À PART, avant celle des renommages : une
   * suppression et un ajout dans la même table se lisent comme un renommage
   * probable, et le produit prescrit alors deux générations.
   */
  readonly drops?: readonly string[];
  /**
   * L'état INTERMÉDIAIRE : la version de départ amputée de ses suppressions —
   * celui que la première des deux générations atteint. Requis avec `drops`.
   * Calculé par l'appelant (le banc le dérive de l'oracle) : une seule
   * implémentation de la règle, le garde de `orm:migrate` vérifie le résultat.
   */
  readonly between?: readonly ISerializedSpec[];
  /**
   * Le renommage qu'on RETIRE pour voir l'outil s'arrêter. Défaut : le premier
   * renommage de colonne.
   */
  readonly withheld?: string;
  /** Délai de chaque étape (un corpus réel compte des centaines de tables). */
  readonly timeout?: number;
}

/** Ce qu'un consommateur peut éprouver APRÈS le banc (lignes v1, dépôts v2). */
export interface ISchemaEvolutionContext {
  /** Lignes témoins écrites en v1, par table v1. */
  readonly written: ReadonlyMap<string, Row>;
  /** Le dépôt d'une table de la version d'arrivée. */
  repo(name: string): IRepository<Row>;
}

function renamePlan(specs: readonly string[]): IRenamePlan {
  const parsed = parseRenames(specs);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.plan;
}

/** Un identifiant entier dans une instruction — `llx_user` ne mord pas sur `llx_user_rights`. */
function hasIdentifier(statement: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "u").test(statement);
}

/** L'instruction désigne-t-elle cette suppression (`table` ou `table.colonne`) ? */
function names(statement: string, drop: string): boolean {
  const [table, column] = drop.split(".");
  return (
    table !== undefined &&
    hasIdentifier(statement, table) &&
    (column === undefined || hasIdentifier(statement, column))
  );
}

/**
 * Déroule le banc d'évolution sur un dialecte. À appeler DANS un `describe`
 * (éventuellement `describe.skipIf(!url)`) du fichier consommateur.
 *
 * @returns le contexte, lisible par des `it` posés APRÈS l'appel.
 */
export function runSchemaEvolution(
  opts: ISchemaEvolutionRunOptions,
  evolution: ISchemaEvolution,
): ISchemaEvolutionContext {
  const { dialect } = opts;
  const timeout = evolution.timeout ?? 300_000;
  const plan = renamePlan(evolution.renames);
  const tableTo = new Map(plan.tables.map((t) => [t.from, t.to]));
  const columnTo = new Map(
    plan.columns.map((c) => [`${c.table}.${c.from}`, c.to]),
  );
  const drops = new Set(evolution.drops ?? []);
  const withheld =
    evolution.withheld ??
    evolution.renames.find((r) => r.split("=")[0]?.includes(".")) ??
    evolution.renames[0];
  const fromTables = materializeSpecs(evolution.from);
  const toTables = materializeSpecs(evolution.to);
  const decor = path.join(
    REPO_ROOT,
    "tmp",
    "scratch",
    `${evolution.name}-evolution-${dialect}-${process.pid}`,
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
  /** Tags écrits pour passer de v1 à v2 (suppressions, puis renommages). */
  const evolutionTags: string[] = [];
  let orm: DrizzleOrm | null = null;
  const written = new Map<string, Row>();

  async function tags(): Promise<string[]> {
    return ((await readJournal(outDir))?.entries ?? []).map((e) => e.tag);
  }

  /**
   * Écrit le module de schéma d'une version et lance l'outil, comme la
   * commande. Les descriptions y sont en LITTÉRAL : `drizzle-kit` relit le
   * fichier en CommonJS (ni `fs`, ni `import.meta`).
   */
  async function generate(
    name: string,
    specs: readonly ISerializedSpec[],
  ): Promise<void> {
    const schemaFile = path.join(decor, `schema.${name}.ts`);
    const configFile = path.join(decor, `drizzle.${name}.config.ts`);
    const materializer = importSpecifier(
      schemaFile,
      path.join(import.meta.dirname, "serialized-specs.ts"),
    );
    await fs.writeFile(
      schemaFile,
      [
        `import { materializeSpecs } from "${materializer}";`,
        `const TABLES = materializeSpecs(${JSON.stringify(specs)});`,
        "function tableOf(name: string) {",
        "  const table = TABLES.get(name);",
        "  if (!table) throw new Error(`table ${name} absente`);",
        `  return table.table("${dialect}");`,
        "}",
        // `drizzle-kit` ne collecte que les tables exportées À PLAT.
        ...specs.map(
          (s) => `export const ${s.name} = tableOf(${JSON.stringify(s.name)});`,
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
      label: `le banc d'évolution ${evolution.name} ${name}`,
    });
  }

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
   * Ordre de suppression sur l'UNION des versions : la base partagée peut être
   * dans N'IMPORTE lequel des états (un autre banc du corpus y laisse la v1),
   * et une table de la seule v1 — renommée, supprimée — référence souvent une
   * table commune. Supprimer d'abord les tables de l'arrivée butait alors sur
   * `erp_invoice_line → erp_invoice` (MySQL ; PostgreSQL passait par
   * `CASCADE`). Une table commune porte les références de TOUTES ses versions.
   */
  function dropOrder(): string[] {
    const merged = new Map<string, ISerializedSpec>();
    for (const [version, specs] of [
      evolution.from,
      evolution.between ?? [],
      evolution.to,
    ].entries()) {
      for (const s of specs) {
        const seen = merged.get(s.name);
        const columns = Object.fromEntries(
          Object.entries(s.columns).map(([k, c]) => [`${version}:${k}`, c]),
        );
        merged.set(s.name, {
          ...s,
          columns: seen ? { ...seen.columns, ...columns } : columns,
        });
      }
    }
    return creationOrder([...merged.values()])
      .reverse()
      .map((s) => s.name);
  }

  /**
   * Supprime toutes les tables des versions, enfants d'abord (`dropOrder`), et
   * l'historique. Pas de `FOREIGN_KEY_CHECKS = 0` : c'est un réglage de
   * SESSION MySQL, et un réservoir ne garantit pas la même connexion d'une
   * instruction à l'autre.
   */
  async function dropAll(opened: DrizzleOrm): Promise<void> {
    for (const name of [...dropOrder(), HISTORY_TABLE]) {
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

  /** La table de départ d'une table d'arrivée (renommage inverse). */
  const fromNameOf = new Map(plan.tables.map((t) => [t.to, t.from]));

  /**
   * Les colonnes de valeur qui DEVIENNENT une référence : leur témoin v1 doit
   * viser une ligne existante, sinon la contrainte posée par la v2 refuse la
   * base — l'auteur du schéma purge les orphelins avant (instruction de
   * DONNÉES, hors du banc), le banc écrit des lignes déjà cohérentes.
   */
  function becomingRefs(): { table: string; column: string; target: string }[] {
    const out: { table: string; column: string; target: string }[] = [];
    for (const spec of evolution.from) {
      const toName = tableTo.get(spec.name) ?? spec.name;
      const toSpec = evolution.to.find((s) => s.name === toName);
      if (!toSpec) continue;
      for (const [key, c] of Object.entries(spec.columns)) {
        if (c.kind === "ref") continue;
        const next = toSpec.columns[columnTo.get(`${toName}.${key}`) ?? key];
        if (next?.kind !== "ref" || next.target === undefined) continue;
        if (next.target === "self") continue;
        out.push({
          table: spec.name,
          column: key,
          target: fromNameOf.get(next.target) ?? next.target,
        });
      }
    }
    return out;
  }

  beforeAll(async () => {
    await fs.rm(decor, { recursive: true, force: true });
    await fs.mkdir(decor, { recursive: true });
    await generate("v1", evolution.from);
    sealGeneratedSql(outDir);
  }, timeout);

  afterAll(async () => {
    // La base est PARTAGÉE avec les autres bancs du corpus : ce banc y laisse
    // sinon ses tables v2, et le suivant bute sur une référence ou sur un nom
    // d'index (global en PostgreSQL). Ménage même après un échec.
    orm ??= await connect(v2, toTables);
    await dropAll(orm);
    await release(v2, toTables);
    await fs.rm(decor, { recursive: true, force: true });
  }, timeout);

  // Sans suppression voulue, pas de test : un saut compterait comme un vert.
  if (drops.size > 0) {
    it(
      "les suppressions VOULUES passent par leur propre génération, qui les annonce destructives",
      async () => {
        const before = await tags();
        assert.ok(evolution.between, "état intermédiaire fourni avec drops");
        await generate("drops", evolution.between);
        const added = (await tags()).filter((t) => !before.includes(t));
        assert.equal(added.length, 1, "une migration de suppressions");
        sealGeneratedSql(outDir);
        const review = await reviewGenerated({ outDir, tags: added, dialect });
        assert.ok(
          review.destructive.length > 0,
          "orm:generate refuserait sans --allow-destructive",
        );
        evolutionTags.push(...added);
      },
      timeout,
    );
  }

  // Sans renommage à retenir, pas de test : un saut compterait comme un vert.
  if (withheld !== undefined) {
    it(
      "🔴 sans la réponse d'un renommage, l'outil s'ARRÊTE en le disant — et l'instantané revient intact",
      async () => {
        const before = await tags();
        const snapshot = path.join(
          outDir,
          "meta",
          `${String(before.length - 1).padStart(4, "0")}_snapshot.json`,
        );
        const content = await fs.readFile(snapshot, "utf8");
        const partial = renamePlan(
          evolution.renames.filter((r) => r !== withheld),
        );
        const prepared = await prepareRenames(outDir, partial, dialect);
        assert.ok(!Array.isArray(prepared), JSON.stringify(prepared));
        await assert.rejects(
          withRewrittenSnapshot(prepared, () =>
            generate("v2_partiel", evolution.to),
          ),
          (e: unknown) =>
            e instanceof Error && /RENOMMAGE probable/u.test(e.message),
        );
        assert.deepEqual(await tags(), before, "rien n'est inscrit");
        assert.equal(
          await fs.readFile(snapshot, "utf8"),
          content,
          "l'instantané versionné est restitué octet pour octet",
        );
      },
      timeout,
    );
  }

  it(
    evolution.renames.length > 0
      ? "avec les réponses, la migration porte les RENAME en tête et AUCUNE instruction qui perd des données"
      : "la migration d'arrivée ne porte AUCUNE instruction qui perd des données",
    async () => {
      const before = await tags();
      let tagsV2: readonly string[];
      let startState: unknown;
      let renameStatements: readonly string[] = [];
      if (evolution.renames.length === 0) {
        await generate("v2", evolution.to);
        tagsV2 = (await tags()).filter((t) => !before.includes(t));
        sealGeneratedSql(outDir);
      } else {
        const prepared = await prepareRenames(outDir, plan, dialect);
        assert.ok(!Array.isArray(prepared), JSON.stringify(prepared));
        await withRewrittenSnapshot(prepared, () =>
          generate("v2", evolution.to),
        );
        const added = (await tags()).filter((t) => !before.includes(t));
        const done = await completeRenames(
          outDir,
          dialect,
          "v2",
          added,
          prepared,
        );
        assert.deepEqual(done.missing, []);
        tagsV2 = done.tags;
        startState = prepared.applied.doc;
        renameStatements = prepared.applied.statements;
        sealGeneratedSql(outDir);
      }
      assert.equal(tagsV2.length, 1, "une migration vers la version d'arrivée");
      const review = await reviewGenerated({
        outDir,
        tags: tagsV2,
        dialect,
        startState,
      });
      const [file] = review.files;
      assert.ok(file);
      const statements = file.sql
        .split("--> statement-breakpoint")
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 0);
      assert.deepEqual(
        statements
          .slice(0, renameStatements.length)
          .map((s) => s.replace(/^--[^\n]*\n/u, "")),
        renameStatements,
        "les renommages ouvrent la migration",
      );
      assert.deepEqual(
        review.destructive.map((r) => r.id),
        [],
        file.sql,
      );
      assert.doesNotMatch(file.sql, /\bDROP\s+COLUMN\b/iu, file.sql);
      evolutionTags.push(...tagsV2);
    },
    timeout,
  );

  it(
    "une génération de plus n'écrit RIEN : l'instantané d'arrivée décrit bien la v2",
    async () => {
      const before = await tags();
      await generate("v3", evolution.to);
      assert.deepEqual(await tags(), before);
    },
    timeout,
  );

  it(
    "🔴 une base PEUPLÉE en v1 passe en v2 : chaque valeur témoin se relit, colonnes renommées comprises",
    async () => {
      assert.ok(evolutionTags.length > 0, "la v2 a été générée");
      orm = await connect(v1, fromTables);
      // Repartir de tables NEUVES : une base serveur est persistante.
      await dropAll(orm);
      // La base LIVRÉE en v1 : l'applicateur de `orm:migrate`, sur un dossier
      // dont le journal s'arrête à la v1.
      await migrator(await deliveredV1()).migrate();
      for (const spec of creationOrder(evolution.from)) {
        const data: Row = {};
        for (const [key, c] of Object.entries(spec.columns)) {
          if (c.kind === "serial") continue;
          if (c.kind === "ref") {
            if (c.target === "self") continue;
            const target = evolution.from.find((s) => s.name === c.target);
            assert.ok(target);
            data[key] = written.get(target.name)?.[primaryKeyOf(target)];
            continue;
          }
          data[key] = witness(c, "a");
        }
        written.set(spec.name, await repo(spec.name).create(data));
      }
      for (const ref of becomingRefs()) {
        const target = evolution.from.find((s) => s.name === ref.target);
        const row = written.get(ref.table);
        const spec = evolution.from.find((s) => s.name === ref.table);
        assert.ok(target && row && spec, `${ref.table}.${ref.column}`);
        const pk = primaryKeyOf(spec);
        const updated = await repo(ref.table).updateOne(
          { [pk]: row[pk] },
          { [ref.column]: written.get(target.name)?.[primaryKeyOf(target)] },
        );
        assert.ok(updated, `${ref.table}.${ref.column} vise ${ref.target}`);
        written.set(ref.table, updated);
      }
      await release(v1, fromTables);

      // Le garde de `orm:migrate`, sur le plan que l'applicateur calcule : il
      // NOMME chaque suppression voulue, et rien d'autre.
      // Une colonne qu'une recréation ne recopie pas n'est PAS dans l'instruction
      // (c'est précisément son absence) : c'est la trouvaille qui la nomme.
      const pending = await migrator(migrations).status();
      const losses = dataLoss(
        scanDestructive(
          pending.pending,
          await columnsBeforeFiles(pending.pending),
        ),
      );
      assert.deepEqual(
        [...drops].filter(
          (d) => !losses.some((f) => names(`${f.what}\n${f.statement}`, d)),
        ),
        [],
        `suppressions voulues que le garde ne nomme pas :\n${losses.map((f) => f.statement).join("\n")}`,
      );
      assert.deepEqual(
        losses
          .filter(
            (f) =>
              ![...drops].some((d) => names(`${f.what}\n${f.statement}`, d)),
          )
          .map((f) => f.statement),
        [],
        "une perte que personne n'a décidée",
      );

      // L'évolution, par l'applicateur, sur la base peuplée : seules les
      // migrations d'évolution sont en attente.
      const run = await migrator(migrations).migrate();
      assert.deepEqual(
        run.applied.map((m) => m.tag),
        evolutionTags,
        "seule l'évolution s'applique",
      );
      orm = await connect(v2, toTables);

      const lost: string[] = [];
      for (const spec of creationOrder(evolution.from)) {
        if (drops.has(spec.name)) continue;
        const before = written.get(spec.name);
        assert.ok(before);
        const table = tableTo.get(spec.name) ?? spec.name;
        const toSpec = evolution.to.find((s) => s.name === table);
        assert.ok(toSpec, `${table} existe en v2`);
        const pk = primaryKeyOf(spec);
        const read = await repo(table).findOne({ [pk]: before[pk] });
        if (read === null) {
          lost.push(`${table} : ligne témoin introuvable`);
          continue;
        }
        const kept = new Set<string>();
        for (const [key, value] of Object.entries(before)) {
          if (drops.has(`${spec.name}.${key}`)) continue;
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
        for (const [key, c] of Object.entries(toSpec.columns)) {
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
    },
    timeout,
  );

  return { written, repo };
}
