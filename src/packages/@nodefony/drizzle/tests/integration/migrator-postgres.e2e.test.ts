import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DrizzleMigrator,
  HISTORY_TABLE,
  MigrationVerdictError,
  openMigrationDriver,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import {
  appendMigration,
  removeSource,
  writeSource,
} from "./migrator-fixtures";

/**
 * Applicateur de migrations — les preuves que **seul un serveur réel** donne.
 *
 * SQLite n'a ni verrou consultatif ni concurrence de connexions : y éprouver le
 * verrou ne prouverait rien, et c'est précisément là que la corruption se
 * produit. Ce banc exerce donc PostgreSQL : exclusion mutuelle entre deux
 * applicateurs, absence de verrou zombie quand le détenteur est tué, état net
 * après un échec à mi-course, et table d'historique non qualifiée.
 *
 * GATE : ne tourne qu'avec `NF_PG_URL` :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 */
const PG_URL = process.env.NF_PG_URL;
const SCHEMA = "nf_migrator";

/**
 * URL du banc, ancrée sur un schéma dédié.
 *
 * Jamais `public` : les autres suites y travaillent, et un banc qui s'installe
 * dans un schéma partagé rend un verdict qui dépend de ses voisins.
 *
 * @returns l'URL avec son `search_path`.
 */
function schemaUrl(): string {
  const url = new URL(PG_URL as string);
  url.searchParams.set("options", `-c search_path=${SCHEMA}`);
  return url.toString();
}

describe.skipIf(!PG_URL)("Applicateur de migrations (postgres)", () => {
  let root: string;
  let sources: IMigrationSource[];

  /**
   * Construit un applicateur sur le schéma du banc.
   *
   * @param lockTimeoutMs - délai d'attente du verrou.
   * @returns l'applicateur.
   */
  const migrator = (lockTimeoutMs = 15_000): DrizzleMigrator =>
    new DrizzleMigrator({
      connector: "banc_pg",
      dialect: "postgres",
      url: schemaUrl(),
      sources,
      lockTimeoutMs,
    });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nf-migrator-pg-"));
    const dir = await writeSource(
      "postgres",
      [
        {
          tag: "0000_init",
          statements: [
            `CREATE TABLE nf_widget (id text PRIMARY KEY, label text)`,
          ],
        },
      ],
      path.join(root, "framework"),
    );
    sources = [{ name: "framework", dir, rank: 0 }];

    const admin = await openMigrationDriver({
      dialect: "postgres",
      url: PG_URL as string,
    });
    try {
      await admin.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await admin.exec(`CREATE SCHEMA ${SCHEMA}`);
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

  it("pose la table d'historique dans le schéma du `search_path`, jamais dans `public`", async () => {
    await migrator().migrate();
    const admin = await openMigrationDriver({
      dialect: "postgres",
      url: PG_URL as string,
    });
    try {
      const rows = await admin.query<{ table_schema: string }>(
        `SELECT table_schema FROM information_schema.tables WHERE table_name = ?`,
        [HISTORY_TABLE],
      );
      // Une seule, et dans NOTRE schéma : un nom qualifié en dur aurait exclu à
      // vie l'isolation par schéma sur une base mutualisée.
      assert.deepEqual(
        rows.map((r) => r.table_schema),
        [SCHEMA],
      );
    } finally {
      await admin.close();
    }
  });

  it("deux applicateurs concurrents : UN SEUL applique, l'autre attend puis constate", async () => {
    // Sans verrou, les deux passeraient la validation sur une base vide et
    // exécuteraient le même `CREATE TABLE` : l'un des deux lèverait.
    const [a, b] = await Promise.all([
      migrator().migrate(),
      migrator().migrate(),
    ]);
    const counts = [a.applied.length, b.applied.length].sort();
    assert.deepEqual(counts, [0, 1], "exactement un des deux applique");

    const admin = await openMigrationDriver({
      dialect: "postgres",
      url: schemaUrl(),
    });
    try {
      const rows = await admin.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${HISTORY_TABLE}`,
      );
      assert.equal(Number(rows[0]?.n), 1, "une seule ligne d'historique");
    } finally {
      await admin.close();
    }
  });

  it("ne laisse AUCUN verrou zombie quand le détenteur est tué", async () => {
    const holder = await openMigrationDriver({
      dialect: "postgres",
      url: schemaUrl(),
    });
    await holder.lock(5_000);
    const pid = Number(
      (await holder.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`))[0]
        ?.pid,
    );

    // Le job est tué en plein vol — OOM, éviction, machine coupée. Aucune
    // libération n'a lieu côté client : c'est le serveur qui doit rendre le
    // verrou à la mort de la session. C'est l'argument qui a fait écarter une
    // table de verrou, qu'il aurait fallu déverrouiller à la main.
    // D'ABORD : constater que le verrou est bien TENU. Sans cette assertion,
    // le test passerait tout aussi bien avec un verrou débranché — il ne
    // prouverait alors que le chemin nominal.
    await assert.rejects(
      async () => migrator(1_000).migrate(),
      (e: unknown) => {
        assert.match(String((e as Error).message), /Verrou de migration/);
        return true;
      },
    );

    const killer = await openMigrationDriver({
      dialect: "postgres",
      url: PG_URL as string,
    });
    try {
      await killer.query(`SELECT pg_terminate_backend(?::int)`, [pid]);
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

  it("laisse un état NET après un échec à mi-course, et trace le marqueur", async () => {
    await appendMigration(sources[0]!.dir, "postgres", {
      tag: "0001_casse",
      statements: [
        `CREATE TABLE nf_gadget (id text PRIMARY KEY)`,
        `CREATE TABLE ceci n'est pas du SQL`,
      ],
    });

    await assert.rejects(async () => migrator().migrate());

    const admin = await openMigrationDriver({
      dialect: "postgres",
      url: schemaUrl(),
    });
    try {
      // Le DDL PostgreSQL est transactionnel : la migration fautive est annulée
      // ENTIÈREMENT — sa première table n'existe pas.
      assert.equal(await admin.tableExists("nf_gadget"), false);
      // …et pourtant sa trace subsiste : écrite HORS de la transaction annulée,
      // sinon elle aurait disparu avec elle et le prochain passage ne saurait
      // rien de ce qui s'est passé.
      const rows = await admin.query<{ tag: string; error: string }>(
        `SELECT tag, error FROM ${HISTORY_TABLE} WHERE success = false`,
      );
      assert.deepEqual(
        rows.map((r) => r.tag),
        ["0001_casse"],
      );
      assert.ok((rows[0]?.error ?? "").length > 0);
    } finally {
      await admin.close();
    }

    await assert.rejects(
      async () => migrator().migrate(),
      (e: unknown) => {
        assert.ok(e instanceof MigrationVerdictError);
        assert.equal(e.verdict.code, "NF_MIGRATE_FAILED_MARKER");
        return true;
      },
    );
  });
});
