import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Container, CONSOLE_DATA_RUN_PROFILE } from "nodefony";
import type { Module, Pdu } from "nodefony";
import { ormRegistry } from "@nodefony/orm-core";
import DrizzleService from "../../nodefony/service/DrizzleService";
import {
  defaultMigrationSources,
  FRAMEWORK_SOURCE,
  APP_SOURCE,
} from "../../nodefony/src/migrator/paths";
import { connectorVersionsMigrations } from "../../nodefony/src/migrator/resolve";
import { HISTORY_TABLE } from "../../nodefony/src/migrator/types";
import { reservedConnectorName } from "../../nodefony/src/migrator/refusals";
import {
  tablesOfConnector,
  writeCustomMigration,
} from "../../nodefony/src/migrator/appSchema";

/**
 * **Les migrations du framework et de l'application appartiennent au SEUL
 * connecteur du framework ; un secondaire n'a que les SIENNES
 * (`migrations/<connecteur>/<dialecte>`).**
 *
 * Constaté en déclarant le connecteur `mediasoup` de ce dépôt : au démarrage,
 * « 2 migration(s) appliquée(s) — framework/0000_framework_init,
 * app/0000_app_user » sur une base qui n'est pas celle du framework. Le dossier
 * `migrations/<dialecte>` ne porte aucune notion de connecteur : il décrit UNE
 * base. Un connecteur secondaire en `migrate` y créait des tables qui ne lui
 * appartiennent pas ; en développement, dès que l'application versionnait une
 * migration, il basculait même en `migrate` sans jamais en recevoir une.
 */

const require = createRequire(import.meta.url);
type Db = {
  prepare(sql: string): { all(): { name: string }[] };
  close(): void;
};
const Database = require("better-sqlite3") as new (f: string) => Db;

/** Tables d'un fichier sqlite, hors tables internes du moteur. */
function tables(file: string): string[] {
  const db = new Database(file);
  try {
    return db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name)
      .sort();
  } finally {
    db.close();
  }
}

describe("migrations — le connecteur secondaire ne reçoit que les siennes", () => {
  let root: string;
  let service: DrizzleService | null = null;

  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "nf-secondary-"));
  });
  afterAll(async () => {
    // Fermer les bases AVANT d'effacer leur dossier : sous Windows, un fichier
    // sqlite ouvert ne se supprime pas (EPERM) — `unregister` ne ferme rien.
    await service?.disconnectAll();
    ormRegistry.unregister("default");
    ormRegistry.unregister("analytics");
    rmSync(root, { recursive: true, force: true });
  });

  it("les sources : complètes pour « default », son SEUL dossier pour un secondaire", async () => {
    const dir = path.join(root, "migrations");
    const principal = await defaultMigrationSources(dir, {
      connector: "default",
    });
    assert.deepEqual(
      principal.map((s) => s.name),
      [FRAMEWORK_SOURCE, APP_SOURCE],
    );
    const secondaire = await defaultMigrationSources(dir, {
      connector: "analytics",
    });
    assert.deepEqual(
      secondaire.map((s) => [s.name, s.dir]),
      [[APP_SOURCE, path.join(dir, "analytics")]],
      "ni le framework, ni la racine de l'application",
    );
    assert.deepEqual(
      await defaultMigrationSources(dir, { connector: "postgres" }),
      [],
      "un nom de dialecte n'a pas de dossier propre",
    );
  });

  it("la bascule `auto` → `migrate` ne concerne pas un secondaire", () => {
    // Le dossier du dépôt versionne des migrations : c'est lui qui a fait
    // basculer le connecteur `mediasoup`.
    const dir = path.resolve(import.meta.dirname, "../../migrations");
    assert.equal(connectorVersionsMigrations("default", dir), true);
    assert.equal(connectorVersionsMigrations("analytics", dir), false);
  });

  it("🔴 au démarrage, en `migrate` : « default » reçoit le schéma du framework, « analytics » rien", async () => {
    const principal = path.join(root, "default.db");
    const secondaire = path.join(root, "analytics.db");
    const container = new Container();
    const kernel = {
      path: root,
      runProfile: { ...CONSOLE_DATA_RUN_PROFILE },
      once: (): void => {},
      resolveRuntimeEnv: (): string => "development",
      setReadiness: (): void => {},
    };
    container.set("kernel", kernel);
    let hook: (() => Promise<void>) | null = null;
    const module = {
      container,
      kernel,
      options: {},
      config: {
        connectors: {
          default: { dialect: "sqlite", filename: principal, ddl: "migrate" },
          analytics: {
            dialect: "sqlite",
            filename: secondaire,
            ddl: "migrate",
          },
        },
      },
      hookKernel: (event: string, cb: () => Promise<void>): unknown => {
        if (event === "onBoot") hook = cb;
        return module;
      },
    };
    service = new DrizzleService(module as unknown as Module);
    const journal: string[] = [];
    service.syslog?.on("onLog", (pdu: Pdu) => {
      journal.push(String(pdu.payload));
    });
    assert.ok(hook, "le service n'a posé aucun hook onBoot");
    await (hook as unknown as () => Promise<void>)();

    const cadre = tables(principal).filter((t) => t !== HISTORY_TABLE);
    assert.ok(
      cadre.length > 0,
      "« default » doit recevoir les migrations du framework — sinon le reste ne prouve rien",
    );
    const intrus = tables(secondaire).filter((t) => cadre.includes(t));
    assert.deepEqual(
      intrus,
      [],
      `tables du framework créées sur « analytics » : ${intrus.join(", ")}`,
    );
    assert.ok(
      !journal.some(
        (l) =>
          l.includes("« analytics »") &&
          l.includes("migration(s) appliquée(s)"),
      ),
      `« analytics » annonce des migrations appliquées : ${JSON.stringify(journal)}`,
    );
    // …et le choix `migrate`, devenu sans effet, est ÉNONCÉ plutôt que tu.
    assert.ok(
      journal.some(
        (l) =>
          l.includes("« analytics »") &&
          l.includes("sans migration à appliquer"),
      ),
      `l'avertissement manque : ${JSON.stringify(journal)}`,
    );
  });

  it("🔴 au démarrage, un secondaire qui VERSIONNE ses migrations les reçoit — et elles seules", async () => {
    await service?.disconnectAll();
    ormRegistry.unregister("default");
    ormRegistry.unregister("analytics");
    const appRoot = mkdtempSync(path.join(os.tmpdir(), "nf-secondary-own-"));
    try {
      const { file } = await writeCustomMigration({
        outDir: path.join(appRoot, "migrations", "analytics", "sqlite"),
        dialect: "sqlite",
        name: "metriques",
      });
      await fs.appendFile(
        file,
        "\nCREATE TABLE metrics (id integer PRIMARY KEY);\n",
      );
      const principal = path.join(appRoot, "default.db");
      const secondaire = path.join(appRoot, "analytics.db");
      const container = new Container();
      const kernel = {
        path: appRoot,
        runProfile: { ...CONSOLE_DATA_RUN_PROFILE },
        once: (): void => {},
        resolveRuntimeEnv: (): string => "development",
        setReadiness: (): void => {},
      };
      container.set("kernel", kernel);
      let hook: (() => Promise<void>) | null = null;
      const module = {
        container,
        kernel,
        options: {},
        config: {
          connectors: {
            default: { dialect: "sqlite", filename: principal, ddl: "migrate" },
            // `migrate` ÉCRIT : sous `NODE_ENV=test` la bascule automatique est
            // éteinte par construction — elle est prouvée à part, par
            // `connectorVersionsMigrations` sur le dossier du connecteur.
            analytics: {
              dialect: "sqlite",
              filename: secondaire,
              ddl: "migrate",
            },
          },
        },
        hookKernel: (event: string, cb: () => Promise<void>): unknown => {
          if (event === "onBoot") hook = cb;
          return module;
        },
      };
      service = new DrizzleService(module as unknown as Module);
      const journal: string[] = [];
      service.syslog?.on("onLog", (pdu: Pdu) => {
        journal.push(String(pdu.payload));
      });
      await (hook as unknown as () => Promise<void>)();

      const own = (t: string): boolean =>
        t !== HISTORY_TABLE && !t.startsWith("sqlite_");
      assert.deepEqual(tables(secondaire).filter(own), ["metrics"]);
      assert.ok(
        !tables(principal).includes("metrics"),
        "la migration d'« analytics » a été appliquée à « default »",
      );
      assert.ok(
        !journal.some(
          (l) =>
            l.includes("« analytics »") &&
            l.includes("sans migration à appliquer"),
        ),
        `avertissement à tort : ${JSON.stringify(journal)}`,
      );
    } finally {
      await service?.disconnectAll();
      service = null;
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it("un connecteur nommé comme un dossier de dialecte est REFUSÉ, en nommant la collision", () => {
    const refus = reservedConnectorName("postgres");
    assert.equal(refus.code, "NF_MIGRATE_SECONDARY_CONNECTOR");
    assert.equal(refus.exitCode, 2);
    assert.match(refus.summary, /« postgres »/);
    assert.match(refus.summary, /Rien n'a été écrit/);
    assert.match(refus.meaning, /« default »/);
  });
});

describe("tablesOfConnector — une migration ne décrit que SA base", () => {
  const tables = [
    { tableName: "posts" },
    { tableName: "metrics" },
    { tableName: "shared" },
    { tableName: "loose" },
  ];
  const owners = new Map<string, Set<string>>([
    ["posts", new Set(["default"])],
    ["metrics", new Set(["analytics"])],
    ["shared", new Set(["default", "analytics"])],
  ]);

  it("chaque connecteur reçoit ses tables ; une table sans entité reste à « default »", () => {
    const names = (c: string): string[] =>
      tablesOfConnector(tables, c, owners).map((t) => t.tableName);
    assert.deepEqual(names("default"), ["posts", "shared", "loose"]);
    assert.deepEqual(names("analytics"), ["metrics", "shared"]);
    assert.deepEqual(names("reporting"), []);
  });
});
