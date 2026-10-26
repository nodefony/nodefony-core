import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { resolveDatabase } from "../cli/scaffold/engine";
import { testDatabaseUrl } from "../runtime/e2eDatabase";
import { e2eDatabases } from "../testing/index";

/*
 *   Les bases de TEST se décident à l'EXÉCUTION, sur la base que l'application
 *   configure — jamais à sa création.
 *
 *   Vécu au banc de portabilité : une application née en SQLite, passée sur
 *   PostgreSQL par son `.env`, gardait un décor e2e figé sur SQLite. Pointé vers
 *   le serveur, il ne vidait jamais la base (« le compte e2e-member existe
 *   déjà » au second run), et la suite de migrations comparait un moteur à
 *   l'autre.
 */
describe("e2eDatabases — le décor e2e suit la base configurée", () => {
  let root: string;
  const saved = { ...process.env };

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "nf-e2e-db-"));
    delete process.env.NF_DATABASE_URL;
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    process.env = { ...saved };
  });

  it("rien de configuré : SQLite local, sans base vierge", () => {
    const db = e2eDatabases(undefined, root);
    assert.equal(db.configured, null);
    assert.equal(
      db.e2e,
      `sqlite:${path.resolve(root, "var/databases/e2e.db")}`,
    );
    assert.equal(db.scratch, null);
  });

  it("le .env désigne PostgreSQL : <base>_e2e et <base>_e2e_scratch sur le même serveur", () => {
    writeFileSync(
      path.join(root, ".env"),
      "NF_DATABASE_URL=postgres://shop:secret@127.0.0.1:5432/shop\n",
    );
    const db = e2eDatabases(undefined, root);
    assert.equal(db.e2e, "postgres://shop:secret@127.0.0.1:5432/shop_e2e");
    assert.equal(
      db.scratch,
      "postgres://shop:secret@127.0.0.1:5432/shop_e2e_scratch",
    );
  });

  it("le .env gagne sur la base de la création ; le shell gagne sur le .env", () => {
    writeFileSync(
      path.join(root, ".env"),
      "NF_DATABASE_URL=mysql://u:p@127.0.0.1:3306/blog\n",
    );
    const created = "postgres://a:b@127.0.0.1:5432/blog";
    assert.equal(
      e2eDatabases(created, root).e2e,
      "mysql://u:p@127.0.0.1:3306/blog_e2e",
    );
    process.env.NF_DATABASE_URL = "sqlite:./var/app.db";
    assert.equal(e2eDatabases(created, root).scratch, null);
  });

  it("sans .env (un clone, la forge) : la base de la création", () => {
    const created = "postgres://a:b@127.0.0.1:5432/blog";
    assert.equal(
      e2eDatabases(created, root).e2e,
      "postgres://a:b@127.0.0.1:5432/blog_e2e",
    );
  });

  it("UNE règle de nommage : celle que create app écrit est celle que le décor relit", () => {
    for (const choice of ["postgres", "mysql", "mariadb", "mongodb"] as const) {
      const db = resolveDatabase(choice, "shop");
      assert.ok(db, choice);
      assert.equal(testDatabaseUrl(db.url, "e2e"), db.urlE2e, choice);
      assert.equal(testDatabaseUrl(db.url, "scratch"), db.urlScratch, choice);
      assert.equal(e2eDatabases(db.url, root).e2e, db.urlE2e, choice);
    }
  });

  it("la requête de l'URL est gardée, une URL sans base est refusée", () => {
    assert.equal(
      testDatabaseUrl(
        "mongodb://127.0.0.1:27017/shop?directConnection=true",
        "e2e",
      ),
      "mongodb://127.0.0.1:27017/shop_e2e?directConnection=true",
    );
    assert.throws(
      () => testDatabaseUrl("postgres://127.0.0.1:5432/", "e2e"),
      /aucune base/u,
    );
  });
});
