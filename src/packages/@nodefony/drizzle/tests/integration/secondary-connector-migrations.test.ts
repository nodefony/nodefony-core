import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeCustomMigration } from "../../nodefony/src/migrator/appSchema";
import { DrizzleMigrator } from "../../nodefony/src/migrator/DrizzleMigrator";
import {
  connectorMigrationsDir,
  defaultMigrationSources,
} from "../../nodefony/src/migrator/paths";
import { connectorVersionsMigrations } from "../../nodefony/src/migrator/resolve";
import { HISTORY_TABLE } from "../../nodefony/src/migrator/types";
import type { SqlDialect } from "../../nodefony/config/config";
import { ciblesPour, tablesEnBase, type IBase } from "./migrate-cli-harness";

/**
 * **Un connecteur secondaire a SES migrations, appliquées à SA base.**
 *
 * `default` lit `migrations/<dialecte>`, `analytics` lit
 * `migrations/analytics/<dialecte>` : deux bases réelles côte à côte, chacune ne
 * reçoit que ce qui est écrit pour elle. Le migrateur est celui que lancent
 * `orm:migrate` et le démarrage — les sources viennent de la MÊME règle
 * (`defaultMigrationSources`), jamais d'un dossier composé par le banc.
 *
 * MySQL n'est pas exercé : le décor n'a qu'UNE base (l'utilisateur ne peut pas
 * en créer), deux connecteurs y verraient les mêmes tables et le banc ne
 * prouverait rien.
 */

/** Écrit une migration libre puis son SQL DANS le gabarit, comme `--custom` le demande. */
async function migration(
  outDir: string,
  dialect: SqlDialect,
  name: string,
  sql: string,
): Promise<void> {
  const { file } = await writeCustomMigration({ outDir, dialect, name });
  await fs.appendFile(file, `\n${sql}\n`, "utf8");
}

/** Ouvre le migrateur d'un connecteur sur sa base, sources par la règle du produit. */
async function migrator(
  dialect: SqlDialect,
  base: IBase,
  appDir: string,
  connector: string,
): Promise<DrizzleMigrator> {
  return new DrizzleMigrator({
    connector,
    dialect,
    ...(dialect === "sqlite"
      ? { filename: base.url.replace(/^sqlite:/, "") }
      : { url: base.url }),
    // Sans les migrations du framework : elles n'ajoutent rien à ce qui est
    // prouvé ici, et alourdiraient chaque base de neuf tables.
    sources: await defaultMigrationSources(appDir, {
      framework: false,
      connector,
    }),
  });
}

describe("migrations par connecteur — le dossier propre au connecteur", () => {
  let appDir: string;

  beforeEach(async () => {
    appDir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-connector-dir-"));
  });
  afterEach(async () => {
    await fs.rm(appDir, { recursive: true, force: true });
  });

  it("« default » garde la racine, un secondaire reçoit son sous-dossier, un nom de dialecte n'en a aucun", () => {
    assert.equal(connectorMigrationsDir(appDir, "default"), appDir);
    assert.equal(
      connectorMigrationsDir(appDir, "analytics"),
      path.join(appDir, "analytics"),
    );
    for (const reserved of ["sqlite", "postgres", "mysql", "meta"]) {
      assert.equal(
        connectorMigrationsDir(appDir, reserved),
        undefined,
        `« ${reserved} » désignerait un dossier de dialecte de « default »`,
      );
    }
  });

  it("🔴 les migrations d'« analytics » ne font pas croire à « default » qu'il versionne", async () => {
    await migration(
      path.join(appDir, "analytics", "sqlite"),
      "sqlite",
      "metriques",
      "CREATE TABLE metrics (id integer PRIMARY KEY);",
    );
    assert.equal(connectorVersionsMigrations("analytics", appDir), true);
    assert.equal(
      connectorVersionsMigrations("default", appDir),
      false,
      "la bascule `migrate` de « default » ne dépend que de SES fichiers",
    );
    assert.equal(connectorVersionsMigrations("reporting", appDir), false);
  });
});

for (const [defaut, secondaire] of [
  ...zip(ciblesPour("nf_conn_default"), ciblesPour("nf_conn_analytics")),
].filter(([c]) => c.dialect !== "mysql")) {
  const dialect = defaut.dialect;
  describe.skipIf(!defaut.actif)(
    `migrations par connecteur — deux bases côte à côte ${defaut.label}`,
    () => {
      let appDir: string;
      let bases: IBase[] = [];

      beforeEach(async () => {
        appDir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-connector-app-"));
        bases = [];
      });
      afterEach(async () => {
        for (const base of bases) await base.liberer();
        await fs.rm(appDir, { recursive: true, force: true });
      });

      it("chaque base reçoit SES migrations, et aucune de l'autre", async () => {
        const principale = await defaut.neuve();
        bases.push(principale);
        const analytique = await secondaire.neuve();
        bases.push(analytique);
        await migration(
          path.join(appDir, dialect),
          dialect,
          "articles",
          "CREATE TABLE posts (id integer PRIMARY KEY);",
        );
        await migration(
          path.join(appDir, "analytics", dialect),
          dialect,
          "metriques",
          "CREATE TABLE metrics (id integer PRIMARY KEY);",
        );

        const a = await migrator(dialect, principale, appDir, "default");
        const b = await migrator(dialect, analytique, appDir, "analytics");
        await a.migrate();
        await b.migrate();

        const ofDefault = (await tablesEnBase(principale, dialect)).filter(own);
        const ofAnalytics = (await tablesEnBase(analytique, dialect)).filter(
          own,
        );
        assert.deepEqual(ofDefault, ["posts"]);
        assert.deepEqual(ofAnalytics, ["metrics"]);
      });
    },
  );
}

/** Table posée par une migration — ni l'historique, ni une table interne de SQLite. */
function own(table: string): boolean {
  return table !== HISTORY_TABLE && !table.startsWith("sqlite_");
}

/** Associe deux listes rang par rang. */
function zip<A, B>(a: A[], b: B[]): [A, B][] {
  return a.map((x, i) => [x, b[i] as B]);
}
