import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  connectorMigrationsDir,
  connectorVersionsMigrations,
  isReservedConnectorName,
  versionsMigrations,
  type IMigrationsDirEntry,
} from "../kernel/migrationsLayout";

/**
 * La règle que lisent le démarrage (module Drizzle) ET `create entity` : si
 * elle se trompe, l'un annonce une table que l'autre ne crée pas. Éprouvée sur
 * le disque, puis sur une lecture injectée — celle du générateur, qui voit
 * aussi les fichiers qu'il n'a pas encore écrits.
 */
describe("migrationsLayout — quand les migrations d'un connecteur font foi", () => {
  let root = "";
  let dir = "";
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "nf-migrations-layout-"));
    dir = path.join(root, "migrations");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const sql = (...rel: string[]): void => {
    const file = path.join(dir, ...rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "SELECT 1;\n");
  };

  it("dossier absent, vide, ou journal `meta/` seul → rien ne fait foi", () => {
    assert.equal(versionsMigrations(dir), false);
    mkdirSync(dir);
    assert.equal(versionsMigrations(dir), false);
    mkdirSync(path.join(dir, "meta"));
    writeFileSync(path.join(dir, "meta", "0000.sql"), "");
    assert.equal(
      versionsMigrations(dir),
      false,
      "`meta/` n'est pas un dialecte",
    );
    assert.equal(versionsMigrations(undefined), false);
  });

  it("un `.sql` à la racine ou sous un dossier de dialecte → les migrations font foi", () => {
    sql("sqlite", "0000_init.sql");
    assert.equal(versionsMigrations(dir), true);
    rmSync(dir, { recursive: true });
    sql("0000_init.sql");
    assert.equal(versionsMigrations(dir), true);
  });

  it("le connecteur du framework lit la racine ; un secondaire, SON sous-dossier seulement", () => {
    sql("sqlite", "0000_init.sql");
    assert.equal(connectorVersionsMigrations("default", dir), true);
    assert.equal(
      connectorVersionsMigrations("analytics", dir),
      false,
      "les migrations de la racine décrivent la base du framework",
    );
    sql("analytics", "sqlite", "0000_hits.sql");
    assert.equal(connectorVersionsMigrations("analytics", dir), true);
    assert.equal(
      connectorMigrationsDir(dir, "analytics"),
      path.join(dir, "analytics"),
    );
  });

  it("un secondaire nommé comme un dossier de dialecte n'a pas de dossier propre", () => {
    sql("postgres", "0000_init.sql");
    assert.equal(isReservedConnectorName("postgres"), true);
    assert.equal(isReservedConnectorName("default"), false);
    assert.equal(connectorMigrationsDir(dir, "postgres"), undefined);
    assert.equal(
      connectorVersionsMigrations("postgres", dir),
      false,
      "il lirait les migrations de `default` comme les siennes",
    );
  });

  it("une lecture INJECTÉE (fichiers en attente du générateur) est jugée par la même règle", () => {
    const pending: Record<string, IMigrationsDirEntry[]> = {
      [dir]: [{ name: "sqlite", isDirectory: true }],
      [path.join(dir, "sqlite")]: [
        { name: "0000_init.sql", isDirectory: false },
      ],
    };
    const list = (d: string): IMigrationsDirEntry[] => {
      const entries = pending[d];
      if (!entries) throw new Error(`ENOENT ${d}`);
      return entries;
    };
    assert.equal(connectorVersionsMigrations("default", dir, list), true);
    assert.equal(
      connectorVersionsMigrations("analytics", dir, list),
      false,
      "une lecture qui lève vaut « rien de versionné »",
    );
  });
});
