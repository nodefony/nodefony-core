import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DrizzleMigrator,
  MigrationVerdictError,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import { composeReport } from "../../nodefony/src/migrator/status";
import { drizzleConfigSchema } from "../../nodefony/config/config";
import { removeSource, writeMigration, writeSource } from "./migrator-fixtures";

/**
 * #196 — un geste n'est proposé que si l'on a CONSTATÉ qu'il s'applique.
 *
 * Le défaut : face à une empreinte qui a changé, le rapport prescrivait
 * `git checkout -- migrations/` sans rien vérifier. Le cas réel : le fichier
 * était livré par un module (pas dans `migrations/`), et il avait changé DANS
 * git — l'arbre était propre. Le geste ne pouvait rien faire, et le bon remède
 * arrivait en second.
 *
 * Le banc monte un VRAI dépôt git : la règle est un constat auprès de git, un
 * décor simulé ne prouverait que la simulation.
 */

/** Lance git dans le dépôt du banc, sans dépendre de la config du poste. */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=banc",
      "-c",
      "user.email=banc@example.test",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

describe("#196 — restaurer un fichier de migration seulement si git le constate", () => {
  let root: string;
  let sources: IMigrationSource[];

  const migrator = (): DrizzleMigrator =>
    new DrizzleMigrator({
      connector: "banc",
      dialect: "sqlite",
      filename: path.join(root, "var", "banc.db"),
      sources,
    });

  /**
   * Le rapport par le SEUL assembleur (`composeReport`) — celui de
   * `orm:migrate:status` et du plan d'administration : c'est SON câblage
   * du constat qui est éprouvé, pas une recomposition du test.
   */
  const report = async () => {
    const m = migrator();
    return composeReport(
      await m.status(),
      {
        kind: "ready",
        connector: "banc",
        dialect: "sqlite",
        target: {
          dialect: "sqlite",
          filename: path.join(root, "var", "banc.db"),
        },
        fromMigrateUrl: false,
        ddl: "none",
      },
      drizzleConfigSchema.parse({ migrations: { divergence: "off" } }),
      null,
      m,
    );
  };

  /** Les gestes du refus de `orm:migrate`. */
  const refusal = async (): Promise<string[]> => {
    try {
      await migrator().migrate();
    } catch (e) {
      assert.ok(e instanceof MigrationVerdictError);
      assert.equal(e.verdict.code, "NF_MIGRATE_HASH_MISMATCH");
      return e.verdict.nextActions.map((a) => a.command);
    }
    return assert.fail("la dérive devait être refusée");
  };

  /** Fichier de l'application, chemin tel qu'on le tape depuis la racine. */
  const APP_FILE = "migrations/sqlite/0000_app_note.sql";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nf-drift-remedy-"));
    await fs.mkdir(path.join(root, "var"));
    // Une migration livrée par un MODULE (hors du dossier de l'application)…
    const framework = await writeSource(
      "sqlite",
      [
        {
          tag: "0000_framework_init",
          statements: ["CREATE TABLE widget (id TEXT PRIMARY KEY)"],
        },
      ],
      path.join(root, "vendor", "framework"),
    );
    // … et une de l'APPLICATION, sous `<racine>/migrations`.
    const app = await writeSource(
      "sqlite",
      [
        {
          tag: "0000_app_note",
          statements: ["CREATE TABLE note (id TEXT PRIMARY KEY)"],
        },
      ],
      path.join(root, "migrations"),
    );
    sources = [
      { name: "framework", dir: framework, rank: 0 },
      { name: "app", dir: app, rank: 1_000_000 },
    ];
    git(root, "init", "-q");
    await fs.writeFile(path.join(root, ".gitignore"), "var/\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "décor");
    await migrator().migrate();
  });

  afterEach(async () => {
    await removeSource(root);
  });

  it("🔴 fichier de l'application modifié localement → la restauration vient en tête, et ELLE MARCHE", async () => {
    await writeMigration(path.join(root, "migrations", "sqlite"), {
      tag: "0000_app_note",
      statements: ["CREATE TABLE note (id TEXT PRIMARY KEY, corps TEXT)"],
    });

    const r = await report();
    assert.equal(r.verdict, "drift");
    assert.equal(r.nextActions[0]?.command, `git checkout -- ${APP_FILE}`);
    assert.deepEqual(r.nextActions[0]?.args, ["checkout", "--", APP_FILE]);
    assert.match(r.nextActions[1]?.command ?? "", /--update-hashes/);

    // Le refus de l'applicateur dit la MÊME chose : un seul composeur.
    const gestes = await refusal();
    assert.equal(gestes[0], `git checkout -- ${APP_FILE}`);
    assert.equal(
      gestes[1],
      "nodefony orm:migrate:repair --connector banc --update-hashes",
    );

    // La preuve qui compte : suivre le geste ÉTEINT la dérive.
    git(root, ...(r.nextActions[0]?.args ?? []));
    assert.equal((await migrator().status()).drifted.length, 0);
  });

  it("🔴 fichier livré par un module, changé DANS git, arbre propre → la restauration n'est PAS proposée", async () => {
    // Le cas du ticket : une mise à jour a changé le fichier livré ; rien
    // n'est modifié localement, restaurer ne ferait rien.
    await writeMigration(path.join(root, "vendor", "framework", "sqlite"), {
      tag: "0000_framework_init",
      statements: ["CREATE TABLE widget (id TEXT PRIMARY KEY, label TEXT)"],
    });
    git(root, "commit", "-q", "-am", "mise à jour du module");
    assert.equal(git(root, "status", "--porcelain"), "", "arbre propre");

    const r = await report();
    assert.equal(r.verdict, "drift");
    const commandes = r.nextActions.map((a) => a.command);
    assert.ok(
      !commandes.some((c) => c.startsWith("git ")),
      `aucun geste git ne s'applique : ${commandes.join(" | ")}`,
    );
    assert.equal(
      commandes[0],
      "nodefony orm:migrate:repair --connector banc --update-hashes",
    );
    // Et le rapport dit d'où vient le fichier.
    assert.match(r.summary, /livré par la source « framework »/);

    const gestes = await refusal();
    assert.ok(!gestes.some((c) => c.startsWith("git ")), gestes.join(" | "));
  });

  it("une modification déjà INDEXÉE n'est pas restaurable par `git checkout --` → pas proposé", async () => {
    // `git checkout --` repart de l'index : si l'index porte la modification,
    // le geste ne change rien au disque.
    await writeMigration(path.join(root, "migrations", "sqlite"), {
      tag: "0000_app_note",
      statements: ["CREATE TABLE note (id TEXT PRIMARY KEY, corps TEXT)"],
    });
    git(root, "add", APP_FILE);

    const r = await report();
    assert.ok(
      !r.nextActions.some((a) => a.command.startsWith("git ")),
      r.nextActions.map((a) => a.command).join(" | "),
    );
  });

  it("hors dépôt git (conteneur déployé) → rien n'est constaté, rien n'est proposé", async () => {
    await fs.rm(path.join(root, ".git"), { recursive: true, force: true });
    await writeMigration(path.join(root, "migrations", "sqlite"), {
      tag: "0000_app_note",
      statements: ["CREATE TABLE note (id TEXT PRIMARY KEY, corps TEXT)"],
    });

    const r = await report();
    assert.equal(r.verdict, "drift");
    assert.match(r.nextActions[0]?.command ?? "", /--update-hashes/);
    assert.ok(!r.nextActions.some((a) => a.command.startsWith("git ")));
  });
});
