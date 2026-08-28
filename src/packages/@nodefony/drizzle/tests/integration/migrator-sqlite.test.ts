import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DrizzleMigrator,
  HISTORY_TABLE,
  MigrationVerdictError,
  SqliteMigrationDriver,
  defaultMigrationSources,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import {
  appendMigration,
  removeSource,
  writeMigration,
  writeSource,
} from "./migrator-fixtures";

/**
 * Applicateur de migrations — banc de comportement sur SQLite.
 *
 * SQLite porte tout ce qui ne dépend PAS du dialecte : identité ensembliste,
 * dérive, ordre, échec puis réparation, adoption, idempotence, amorçage de la
 * table d'historique, sources absentes. Ce qui diverge par dialecte — verrou
 * entre process, DDL non transactionnel — se prouve sur un serveur RÉEL, dans
 * les bancs PostgreSQL et MySQL : l'éprouver ici ne prouverait rien, puisque
 * SQLite n'a ni verrou consultatif ni concurrence de process.
 */
describe("Applicateur de migrations (sqlite)", () => {
  let root: string;
  let dbFile: string;
  let sources: IMigrationSource[];

  /**
   * Construit un applicateur sur la base et les sources du banc courant.
   *
   * @param over - sources de remplacement (bancs multi-sources).
   * @returns l'applicateur.
   */
  const migrator = (over?: IMigrationSource[]): DrizzleMigrator =>
    new DrizzleMigrator({
      connector: "banc",
      dialect: "sqlite",
      filename: dbFile,
      sources: over ?? sources,
    });

  /**
   * Ouvre la base du banc pour l'inspecter directement.
   *
   * @returns un pilote sur la même base, à fermer par l'appelant.
   */
  const open = (): SqliteMigrationDriver => new SqliteMigrationDriver(dbFile);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nf-migrator-db-"));
    dbFile = path.join(root, "banc.db");
    const dir = await writeSource(
      "sqlite",
      [
        {
          tag: "0000_init",
          statements: ["CREATE TABLE widget (id TEXT PRIMARY KEY, label TEXT)"],
        },
      ],
      path.join(root, "framework"),
    );
    sources = [{ name: "framework", dir, rank: 0 }];
  });

  afterEach(async () => {
    await removeSource(root);
  });

  it("applique ce qui manque, et rien de plus au second passage", async () => {
    const first = await migrator().migrate();
    assert.equal(first.applied.length, 1);
    assert.equal(first.applied[0]?.tag, "0000_init");

    // Idempotence : rejouer après une coupure ne doit rien exiger de l'appelant.
    const second = await migrator().migrate();
    assert.deepEqual(second.applied, []);

    const plan = await migrator().status();
    assert.equal(plan.applied.length, 1);
    assert.deepEqual(plan.pending, []);
    assert.equal(plan.baselineRequired, false);
  });

  it("stocke une empreinte préfixée de son algorithme", async () => {
    await migrator().migrate();
    const driver = open();
    try {
      const rows = await driver.query<{ hash: string; success: number }>(
        `SELECT hash, success FROM ${HISTORY_TABLE}`,
      );
      // À la chaîne près : le préfixe est la SEULE porte de sortie pour changer
      // un jour d'algorithme en reconnaissant les lignes déjà écrites.
      assert.match(rows[0]?.hash ?? "", /^sha256:[0-9a-f]{64}$/);
      assert.equal(rows[0]?.success, 1);
    } finally {
      await driver.close();
    }
  });

  it("refuse une migration appliquée dont le fichier a changé", async () => {
    await migrator().migrate();
    await writeMigration(path.join(sources[0]!.dir, "sqlite"), {
      tag: "0000_init",
      statements: [
        "CREATE TABLE widget (id TEXT PRIMARY KEY, label TEXT, extra TEXT)",
      ],
    });

    const plan = await migrator().status();
    assert.equal(plan.drifted.length, 1);
    assert.equal(plan.drifted[0]?.tag, "0000_init");

    await assert.rejects(
      async () => migrator().migrate(),
      (e: unknown) => {
        assert.ok(e instanceof MigrationVerdictError);
        assert.equal(e.verdict.code, "NF_MIGRATE_HASH_MISMATCH");
        assert.equal(e.verdict.connector, "banc");
        assert.equal(e.verdict.tag, "0000_init");
        assert.ok(
          e.verdict.nextActions[0]?.command.includes("--update-hashes"),
        );
        return true;
      },
    );
  });

  it("ne voit PAS une dérive quand seules les fins de ligne changent", async () => {
    await migrator().migrate();
    // Exactement le même SQL, réécrit en CRLF — ce que produit un checkout
    // Windows sous `core.autocrlf`. Sans normalisation, TOUTE machine Windows
    // déclencherait un arrêt sur dérive permanent, pour un non-changement.
    await writeMigration(path.join(sources[0]!.dir, "sqlite"), {
      tag: "0000_init",
      statements: ["CREATE TABLE widget (id TEXT PRIMARY KEY, label TEXT)"],
      crlf: true,
    });

    const plan = await migrator().status();
    assert.deepEqual(plan.drifted, []);
    const run = await migrator().migrate();
    assert.deepEqual(run.applied, []);
  });

  it("refuse un fichier dont le format n'est pas celui qu'il sait lire", async () => {
    await appendMigration(sources[0]!.dir, "sqlite", {
      tag: "0001_futur",
      statements: ["CREATE TABLE gadget (id TEXT PRIMARY KEY)"],
      marker: "-- nodefony:migration format=2",
    });

    await assert.rejects(
      async () => migrator().migrate(),
      (e: unknown) => {
        assert.ok(e instanceof MigrationVerdictError);
        assert.equal(e.verdict.code, "NF_MIGRATE_UNKNOWN_FORMAT");
        // Le refus NOMME le fichier : sans son chemin, il n'est pas actionnable.
        assert.ok(String(e.verdict.facts.file).endsWith("0001_futur.sql"));
        return true;
      },
    );
    // Rien n'a été appliqué : le refus précède toute écriture.
    const driver = open();
    try {
      assert.equal(await driver.tableExists("widget"), false);
    } finally {
      await driver.close();
    }
  });

  it("refuse une migration qui se range avant la dernière appliquée de sa source", async () => {
    await appendMigration(sources[0]!.dir, "sqlite", {
      tag: "0001_suite",
      statements: ["CREATE TABLE gadget (id TEXT PRIMARY KEY)"],
    });
    await migrator().migrate();

    // Un collègue livre une migration à l'index 0.5 — impossible en journal,
    // donc on l'insère à un index INFÉRIEUR au dernier appliqué.
    await appendMigration(
      sources[0]!.dir,
      "sqlite",
      {
        tag: "0000b_intercalee",
        statements: ["CREATE TABLE tardif (id TEXT PRIMARY KEY)"],
      },
      0,
    );

    await assert.rejects(
      async () => migrator().migrate(),
      (e: unknown) => {
        assert.ok(e instanceof MigrationVerdictError);
        assert.equal(e.verdict.code, "NF_MIGRATE_OUT_OF_ORDER");
        assert.equal(e.verdict.tag, "0000b_intercalee");
        return true;
      },
    );

    // …et l'assumer explicitement la fait passer.
    const run = await migrator().migrate({ outOfOrder: true });
    assert.deepEqual(
      run.applied.map((a) => a.tag),
      ["0000b_intercalee"],
    );
  });

  it("applique une source dans le PASSÉ d'une autre — l'identité, pas l'horodatage", async () => {
    const appDir = await writeSource(
      "sqlite",
      [
        {
          tag: "0000_app",
          statements: ["CREATE TABLE facture (id TEXT PRIMARY KEY)"],
        },
        {
          tag: "0001_app",
          statements: ["CREATE TABLE ligne (id TEXT PRIMARY KEY)"],
        },
      ],
      path.join(root, "app"),
    );
    const registry: IMigrationSource[] = [
      ...sources,
      { name: "app", dir: appDir, rank: 1_000_000 },
    ];
    await migrator(registry).migrate();

    // La mise à jour du framework apporte une migration dont l'index (1) est
    // INFÉRIEUR à celui de la dernière migration d'app déjà appliquée. Un
    // applicateur à repère haut la sauterait en silence.
    await appendMigration(sources[0]!.dir, "sqlite", {
      tag: "0001_framework_suite",
      statements: ["CREATE TABLE jeton (id TEXT PRIMARY KEY)"],
    });
    const run = await migrator(registry).migrate();
    assert.deepEqual(
      run.applied.map((a) => `${a.source}/${a.tag}`),
      ["framework/0001_framework_suite"],
    );
    const driver = open();
    try {
      assert.equal(await driver.tableExists("jeton"), true);
    } finally {
      await driver.close();
    }
  });

  it("laisse un état net après un échec, trace le marqueur, et se répare", async () => {
    await appendMigration(sources[0]!.dir, "sqlite", {
      tag: "0001_casse",
      statements: [
        "CREATE TABLE bon (id TEXT PRIMARY KEY)",
        "CREATE TABLE ceci n'est pas du SQL",
      ],
    });

    await assert.rejects(async () => migrator().migrate());

    const driver = open();
    try {
      // DDL transactionnel : la migration fautive est annulée ENTIÈREMENT.
      assert.equal(await driver.tableExists("bon"), false);
      // …mais sa trace subsiste, écrite HORS de la transaction annulée.
      const rows = await driver.query<{ tag: string; error: string }>(
        `SELECT tag, error FROM ${HISTORY_TABLE} WHERE success = 0`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.tag, "0001_casse");
      assert.ok((rows[0]?.error ?? "").length > 0);
    } finally {
      await driver.close();
    }

    // Une reprise aveugle est refusée : c'est la réparation qui tranche.
    await assert.rejects(
      async () => migrator().migrate(),
      (e: unknown) => {
        assert.ok(e instanceof MigrationVerdictError);
        assert.equal(e.verdict.code, "NF_MIGRATE_FAILED_MARKER");
        return true;
      },
    );

    const repaired = await migrator().repair();
    assert.deepEqual(
      repaired.cleared.map((r) => r.tag),
      ["0001_casse"],
    );

    // Le SQL corrigé passe ensuite sans rien d'autre à faire.
    await writeMigration(path.join(sources[0]!.dir, "sqlite"), {
      tag: "0001_casse",
      statements: ["CREATE TABLE bon (id TEXT PRIMARY KEY)"],
    });
    const run = await migrator().migrate();
    assert.deepEqual(
      run.applied.map((a) => a.tag),
      ["0001_casse"],
    );
  });

  it("exige une adoption explicite sur une base déjà peuplée", async () => {
    // Une base d'avant les migrations : les tables existent, l'historique non.
    const seed = open();
    try {
      await seed.exec("CREATE TABLE widget (id TEXT PRIMARY KEY, label TEXT)");
    } finally {
      await seed.close();
    }

    await assert.rejects(
      async () => migrator().migrate(),
      (e: unknown) => {
        assert.ok(e instanceof MigrationVerdictError);
        assert.equal(e.verdict.code, "NF_MIGRATE_BASELINE_REQUIRED");
        assert.ok(e.verdict.nextActions[0]?.command.includes("baseline"));
        return true;
      },
    );

    const adopted = await migrator().baseline();
    assert.deepEqual(
      adopted.map((a) => a.tag),
      ["0000_init"],
    );
    // Rejouer l'adoption n'inscrit que ce qui manque — donc rien.
    assert.deepEqual(await migrator().baseline(), []);
    // Et la migration suivante s'applique normalement.
    await appendMigration(sources[0]!.dir, "sqlite", {
      tag: "0001_suite",
      statements: ["CREATE TABLE gadget (id TEXT PRIMARY KEY)"],
    });
    const run = await migrator().migrate();
    assert.deepEqual(
      run.applied.map((a) => a.tag),
      ["0001_suite"],
    );
  });

  it("ignore une source désinstallée sans bloquer les autres", async () => {
    const moduleDir = await writeSource(
      "sqlite",
      [
        {
          tag: "0000_module",
          statements: ["CREATE TABLE brique (id TEXT PRIMARY KEY)"],
        },
      ],
      path.join(root, "module"),
    );
    const withModule: IMigrationSource[] = [
      ...sources,
      { name: "vendor-cms", dir: moduleDir, rank: 10 },
    ];
    await migrator(withModule).migrate();

    // Le module est désinstallé : sa source disparaît du REGISTRE, et ses
    // lignes restent en base. Sans la règle, elles bloqueraient tout `migrate`
    // ultérieur — pour toujours.
    await appendMigration(sources[0]!.dir, "sqlite", {
      tag: "0001_suite",
      statements: ["CREATE TABLE gadget (id TEXT PRIMARY KEY)"],
    });
    const plan = await migrator().status();
    assert.deepEqual(plan.ignoredSources, ["vendor-cms"]);
    const run = await migrator().migrate();
    assert.deepEqual(
      run.applied.map((a) => a.tag),
      ["0001_suite"],
    );
  });

  it("refuse une migration appliquée dont le fichier a disparu, sauf demande explicite", async () => {
    await appendMigration(sources[0]!.dir, "sqlite", {
      tag: "0001_suite",
      statements: ["CREATE TABLE gadget (id TEXT PRIMARY KEY)"],
    });
    await migrator().migrate();

    // Le fichier est retiré du dossier, sa source restant installée.
    const dir = path.join(sources[0]!.dir, "sqlite");
    await fs.rm(path.join(dir, "0001_suite.sql"));
    const journalPath = path.join(dir, "meta", "_journal.json");
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.filter((e) => e.tag !== "0001_suite");
    await fs.writeFile(journalPath, JSON.stringify(journal, null, 2));

    await assert.rejects(
      async () => migrator().migrate(),
      (e: unknown) => {
        assert.ok(e instanceof MigrationVerdictError);
        assert.equal(e.verdict.code, "NF_MIGRATE_MISSING_FILE");
        return true;
      },
    );
    const run = await migrator().migrate({ ignoreMissing: true });
    assert.deepEqual(run.applied, []);
  });

  it("relit une table d'historique écrite par une version antérieure", async () => {
    await migrator().migrate();

    // Une version ultérieure a ajouté une colonne à la table d'historique.
    // Un applicateur qui ferait `SELECT *` ou une insertion positionnelle
    // casserait ici — c'est ce qui rend l'évolution inoffensive.
    const driver = open();
    try {
      await driver.exec(
        `ALTER TABLE ${HISTORY_TABLE} ADD COLUMN installed_rank INTEGER`,
      );
    } finally {
      await driver.close();
    }

    await appendMigration(sources[0]!.dir, "sqlite", {
      tag: "0001_suite",
      statements: ["CREATE TABLE gadget (id TEXT PRIMARY KEY)"],
    });
    const run = await migrator().migrate();
    assert.deepEqual(
      run.applied.map((a) => a.tag),
      ["0001_suite"],
    );
  });

  it("amorce la table d'historique sur une base qui n'en a pas", async () => {
    const before = open();
    try {
      assert.equal(await before.tableExists(HISTORY_TABLE), false);
    } finally {
      await before.close();
    }
    // `status()` est en LECTURE SEULE : une sonde qui écrit n'est plus une sonde.
    const plan = await migrator().status();
    assert.equal(plan.pending.length, 1);
    const after = open();
    try {
      assert.equal(await after.tableExists(HISTORY_TABLE), false);
    } finally {
      await after.close();
    }
  });

  it("applique les migrations RÉELLEMENT livrées par le paquet", async () => {
    // Les cas précédents éprouvent l'applicateur sur du SQL minuscule, dont on
    // contrôle tout. Celui-ci ferme la boucle avec #96 : le registre par défaut
    // résout le dossier LIVRÉ, et le fichier généré par drizzle-kit s'applique
    // tel quel. Sans lui, on aurait prouvé l'applicateur, jamais la chaîne.
    const real = new DrizzleMigrator({
      connector: "reel",
      dialect: "sqlite",
      filename: dbFile,
      sources: await defaultMigrationSources(),
    });
    const run = await real.migrate();
    assert.deepEqual(
      run.applied.map((a) => `${a.source}/${a.tag}`),
      ["framework/0000_framework_init"],
    );

    const driver = open();
    try {
      const rows = await driver.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name <> ? ` +
          `AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        [HISTORY_TABLE],
      );
      assert.equal(rows.length, 10, "les dix tables du schéma framework");
    } finally {
      await driver.close();
    }
    assert.deepEqual((await real.status()).pending, []);
  });

  /**
   * #109 — un module data-only ne doit pas recevoir les tables du framework.
   *
   * `frameworkEntities: false` dit « aucune entité ni fabrique framework », et
   * le démarrage en mode dérivé l'honore : les entités ne sont pas enregistrées,
   * donc rien n'est créé. Les migrations, elles, l'ignoraient — la même
   * application fabriquait DEUX bases différentes selon qu'elle démarrait en
   * développement ou qu'on la migrait en production, sans que rien le signale
   * (le verdict de divergence ignore par construction ce que la base a en TROP).
   */
  it("un module data-only ne reçoit AUCUNE table du framework", async () => {
    const sources = await defaultMigrationSources(undefined, {
      framework: false,
    });
    assert.deepEqual(sources, [], "aucune source à appliquer");

    const dataOnly = new DrizzleMigrator({
      connector: "data-only",
      dialect: "sqlite",
      filename: dbFile,
      sources,
    });
    const run = await dataOnly.migrate();
    assert.deepEqual(run.applied, [], "rien n'est appliqué");

    const driver = open();
    try {
      const rows = await driver.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name <> ? ` +
          `AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        [HISTORY_TABLE],
      );
      assert.deepEqual(
        rows.map((r) => r.name),
        [],
        "aucune table du framework ne doit exister",
      );
    } finally {
      await driver.close();
    }
  });

  it("le défaut reste INCHANGÉ — ne rien dire, c'est vouloir le framework", async () => {
    // La garde ne doit pas devenir un piège pour qui n'a rien demandé : sans
    // l'option, et avec `framework: true`, le registre est celui d'avant.
    const implicite = await defaultMigrationSources();
    const explicite = await defaultMigrationSources(undefined, {
      framework: true,
    });
    assert.deepEqual(implicite, explicite);
    assert.deepEqual(
      implicite.map((s) => s.name),
      ["framework"],
    );
  });
});
