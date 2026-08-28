import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DrizzleMigrator,
  HISTORY_TABLE,
  MigrationVerdictError,
  MYSQL_LOCK_NAME_SQL,
  openMigrationDriver,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import {
  appendMigration,
  removeSource,
  writeSource,
} from "./migrator-fixtures";

/**
 * Applicateur de migrations — MySQL / MariaDB, là où le DDL n'est **pas**
 * transactionnel.
 *
 * C'est la divergence de dialecte la plus lourde de conséquences : un échec à
 * mi-course y laisse un état PARTIEL que personne ne peut annuler. D'où le
 * marqueur d'échec persistant, et l'interdiction de toute reprise aveugle —
 * c'est la réparation, après inspection humaine, qui tranche.
 *
 * GATE : ne tourne qu'avec `NF_MYSQL_URL` :
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony npm test
 */
const MYSQL_URL = process.env.NF_MYSQL_URL;

/** Tables créées par ce banc — nettoyées avant chaque cas. */
const BANC_TABLES = ["nf_mig_widget", "nf_mig_gadget", HISTORY_TABLE];

describe.skipIf(!MYSQL_URL)("Applicateur de migrations (mysql)", () => {
  let root: string;
  let sources: IMigrationSource[];

  /**
   * Construit un applicateur sur la base du banc.
   *
   * @param lockTimeoutMs - délai d'attente du verrou.
   * @returns l'applicateur.
   */
  const migrator = (lockTimeoutMs = 15_000): DrizzleMigrator =>
    new DrizzleMigrator({
      connector: "banc_mysql",
      dialect: "mysql",
      url: MYSQL_URL as string,
      sources,
      lockTimeoutMs,
    });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nf-migrator-my-"));
    const dir = await writeSource(
      "mysql",
      [
        {
          tag: "0000_init",
          statements: [
            "CREATE TABLE nf_mig_widget (id varchar(64) NOT NULL, label text, PRIMARY KEY (id))",
          ],
        },
      ],
      path.join(root, "framework"),
    );
    sources = [{ name: "framework", dir, rank: 0 }];

    // L'utilisateur applicatif n'a pas le droit de créer une base ici
    // (`ERROR 1044`) : l'isolation se fait donc par NETTOYAGE des tables du
    // banc, et la suite du module tourne fichier par fichier.
    const admin = await openMigrationDriver({
      dialect: "mysql",
      url: MYSQL_URL as string,
    });
    try {
      for (const table of BANC_TABLES) {
        await admin.exec(`DROP TABLE IF EXISTS ${table}`);
      }
    } finally {
      await admin.close();
    }
  });

  afterEach(async () => {
    await removeSource(root);
  });

  it("applique sur un serveur réel, puis n'a plus rien à faire", async () => {
    const run = await migrator().migrate();
    assert.deepEqual(
      run.applied.map((a) => a.tag),
      ["0000_init"],
    );
    assert.deepEqual((await migrator().migrate()).applied, []);
  });

  it("deux applicateurs concurrents : UN SEUL applique", async () => {
    const [a, b] = await Promise.all([
      migrator().migrate(),
      migrator().migrate(),
    ]);
    assert.deepEqual(
      [a.applied.length, b.applied.length].sort(),
      [0, 1],
      "exactement un des deux applique",
    );
    const admin = await openMigrationDriver({
      dialect: "mysql",
      url: MYSQL_URL as string,
    });
    try {
      const rows = await admin.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${HISTORY_TABLE}`,
      );
      assert.equal(Number(rows[0]?.n), 1, "une seule ligne d'historique");
    } finally {
      await admin.close();
    }
  });

  it("ne laisse AUCUN verrou zombie quand le détenteur est tué", async () => {
    const holder = await openMigrationDriver({
      dialect: "mysql",
      url: MYSQL_URL as string,
    });
    await holder.lock(5_000);
    const id = Number(
      (await holder.query<{ id: number }>(`SELECT CONNECTION_ID() AS id`))[0]
        ?.id,
    );

    // Le verrou est bien TENU — sans cette assertion, le cas passerait aussi
    // avec un verrou débranché, et ne prouverait que le chemin nominal.
    await assert.rejects(
      async () => migrator(1_000).migrate(),
      (e: unknown) => {
        assert.match(String((e as Error).message), /Verrou de migration/);
        return true;
      },
    );

    // Le job est tué en plein vol. `GET_LOCK` s'auto-libère à la mort de la
    // session : rien à déverrouiller à la main, jamais.
    const killer = await openMigrationDriver({
      dialect: "mysql",
      url: MYSQL_URL as string,
    });
    try {
      await killer.exec(`KILL ${id}`);
    } finally {
      await killer.close();
    }
    await holder.close().catch(() => undefined);

    const run = await migrator(5_000).migrate();
    assert.deepEqual(
      run.applied.map((a) => a.tag),
      ["0000_init"],
    );
  });

  it("qualifie le verrou par la base — deux bases ne se sérialisent pas", async () => {
    const a = await openMigrationDriver({
      dialect: "mysql",
      url: MYSQL_URL as string,
    });
    const b = await openMigrationDriver({
      dialect: "mysql",
      url: MYSQL_URL as string,
    });
    try {
      // 1. Le serveur compose bien le nom avec la base COURANTE.
      const rows = await a.query<{ name: string; db: string }>(
        `SELECT ${MYSQL_LOCK_NAME_SQL} AS name, DATABASE() AS db`,
      );
      const name = String(rows[0]?.name);
      const db = String(rows[0]?.db);
      assert.equal(name, `nodefony:migrations:${db}`);
      assert.ok(name.length <= 64, "le nom tient dans la limite du serveur");

      // 2. Le nom qu'une AUTRE base produirait est obtenu SIMULTANÉMENT —
      // `GET_LOCK` étant global au serveur, c'est bien la qualification qui
      // empêche deux applications sans rapport de se sérialiser en silence.
      // Ce qui n'est PAS prouvé ici : le cas sur deux bases réelles, que
      // l'utilisateur applicatif n'a pas le droit de créer (`ERROR 1044`).
      const mine = await a.query<{ got: number }>(
        `SELECT GET_LOCK(?, 1) AS got`,
        [name],
      );
      assert.equal(Number(mine[0]?.got), 1);
      const other = await b.query<{ got: number }>(
        `SELECT GET_LOCK(?, 1) AS got`,
        [`nodefony:migrations:une_autre_base`],
      );
      assert.equal(Number(other[0]?.got), 1, "un autre nom n'est pas bloqué");
      // …et le MÊME nom, lui, l'est bien.
      const same = await b.query<{ got: number }>(
        `SELECT GET_LOCK(?, 1) AS got`,
        [name],
      );
      assert.equal(Number(same[0]?.got), 0, "le même nom exclut");
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("laisse un état PARTIEL après un échec — le DDL n'est pas transactionnel", async () => {
    await appendMigration(sources[0]!.dir, "mysql", {
      tag: "0001_casse",
      statements: [
        "CREATE TABLE nf_mig_gadget (id varchar(64) NOT NULL, PRIMARY KEY (id))",
        "CREATE TABLE ceci n'est pas du SQL",
      ],
    });

    await assert.rejects(async () => migrator().migrate());

    const admin = await openMigrationDriver({
      dialect: "mysql",
      url: MYSQL_URL as string,
    });
    try {
      // 🔴 La première table EXISTE : MySQL valide implicitement chaque DDL.
      // C'est la réalité du dialecte, pas un défaut de l'applicateur — et c'est
      // exactement pourquoi une reprise aveugle serait dangereuse.
      assert.equal(await admin.tableExists("nf_mig_gadget"), true);
      const rows = await admin.query<{
        tag: string;
        error: string;
        finished_at: number | null;
      }>(
        `SELECT tag, error, finished_at FROM ${HISTORY_TABLE} WHERE success = 0`,
      );
      assert.deepEqual(
        rows.map((r) => r.tag),
        ["0001_casse"],
      );
      assert.ok((rows[0]?.error ?? "").length > 0, "l'échec est tracé");
    } finally {
      await admin.close();
    }

    // Reprise refusée : c'est la réparation, après inspection, qui tranche.
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
  });
});
