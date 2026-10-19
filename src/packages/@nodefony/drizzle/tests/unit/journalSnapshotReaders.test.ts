import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJournal } from "../../nodefony/src/migrator/sources";
import {
  readJournal,
  readSnapshot,
  snapshotTables,
} from "../../nodefony/src/migrator/adopt";
import { writeCustomMigration } from "../../nodefony/src/migrator/appSchema";
import { MigrationVerdictError } from "../../nodefony/src/migrator/types";

/**
 * **Un journal ou un instantané ABÎMÉ se refuse en se nommant — il n'est
 * jamais pris pour un fichier absent (#572).**
 *
 * Le journal et les instantanés sont des fichiers du dépôt : édités à la main,
 * mal fusionnés, ils ne garantissent aucune forme. Avant ce garde, l'adoption
 * prenait un journal cassé pour un journal absent — `orm:migrate:baseline`
 * aurait posé un second historique par-dessus le premier —, la migration libre
 * réécrivait le journal sur une simple erreur de lecture, et un JSON `null`
 * finissait en `TypeError` sans contexte.
 */

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

let dir = "";
let outDir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "nf-drizzle-journal-"));
  outDir = path.join(dir, "sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function put(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

const journalFile = (): string => path.join(outDir, "meta", "_journal.json");
const snapshotFile = (): string =>
  path.join(outDir, "meta", "0000_snapshot.json");

function isUnknownFormat(e: unknown): boolean {
  return (
    e instanceof MigrationVerdictError &&
    e.verdict.code === "NF_MIGRATE_UNKNOWN_FORMAT"
  );
}

const VALID_JOURNAL = JSON.stringify({
  version: "7",
  dialect: "sqlite",
  entries: [
    { idx: 0, version: "6", when: 1, tag: "0000_init", breakpoints: true },
  ],
});

describe("parseJournal — le SEUL validateur de `_journal.json`", () => {
  it("garde les champs qu'il ne relit pas (dialect, when…) pour la réécriture", () => {
    const journal = parseJournal(VALID_JOURNAL, "j.json", "app");
    assert.deepEqual(
      JSON.parse(JSON.stringify(journal)),
      JSON.parse(VALID_JOURNAL),
    );
  });

  for (const [label, raw] of [
    ["un JSON cassé (conflit de fusion)", "<<<<<<< HEAD\n{"],
    ["un JSON `null`", "null"],
    ["un tableau", "[]"],
    ["des entries qui ne sont pas une liste", '{"version":"7","entries":{}}'],
    [
      "une entrée sans idx entier",
      '{"version":"7","entries":[{"tag":"0000_a"}]}',
    ],
    [
      "une entrée sans tag textuel",
      '{"version":"7","entries":[{"idx":0,"tag":3}]}',
    ],
    ["une entrée `null`", '{"version":"7","entries":[null]}'],
    ["une version inconnue", '{"version":"99","entries":[]}'],
  ] as const) {
    it(`refuse ${label} en le nommant`, () => {
      assert.throws(() => parseJournal(raw, "j.json", "app"), isUnknownFormat);
    });
  }
});

describe("adopt.readJournal — un journal abîmé n'est pas un journal absent", () => {
  it("rend null quand le journal n'existe pas", async () => {
    assert.equal(await readJournal(outDir), null);
  });

  it("REFUSE un journal cassé au lieu de le prendre pour absent", async () => {
    await put(journalFile(), "{ ceci n'est pas");
    await assert.rejects(() => readJournal(outDir), isUnknownFormat);
  });
});

describe("writeCustomMigration — jamais de journal réécrit par-dessus", () => {
  it("REFUSE un journal `null` sans rien écrire", async () => {
    await put(journalFile(), "null");
    await assert.rejects(
      () => writeCustomMigration({ outDir, dialect: "sqlite", name: "essai" }),
      isUnknownFormat,
    );
    assert.equal(await fs.readFile(journalFile(), "utf8"), "null");
    await assert.rejects(() => fs.stat(path.join(outDir, "0000_essai.sql")));
  });

  it("REFUSE un journal qu'il ne peut pas lire (autre chose qu'une absence)", async () => {
    // Un DOSSIER à la place du fichier : `EISDIR` sur les trois plateformes,
    // là où des droits POSIX n'existent pas sous Windows.
    await fs.mkdir(journalFile(), { recursive: true });
    await assert.rejects(
      () => writeCustomMigration({ outDir, dialect: "sqlite", name: "essai" }),
      (e: unknown) => e instanceof Error && "code" in e && e.code === "EISDIR",
    );
    // Refusé AVANT toute écriture : pris pour absent, le journal laissait
    // écrire la migration, et seule l'écriture du journal échouait ensuite.
    await assert.rejects(() => fs.stat(path.join(outDir, "0000_essai.sql")));
  });
});

describe("readSnapshot — l'instantané se valide sur ce qu'on en relit", () => {
  it("rend null quand l'instantané n'existe pas", async () => {
    assert.equal(await readSnapshot(snapshotFile()), null);
    assert.deepEqual(await snapshotTables(outDir), []);
  });

  for (const dialect of ["sqlite", "postgres", "mysql"] as const) {
    it(`accepte l'instantané réel du framework (${dialect})`, async () => {
      const file = path.join(
        PACKAGE_ROOT,
        "migrations",
        dialect,
        "meta",
        "0000_snapshot.json",
      );
      const doc = await readSnapshot(file);
      assert.ok(doc !== null && Object.keys(doc.tables ?? {}).length > 0);
    });
  }

  it("rend le nom porté par chaque table, à défaut sa clé", async () => {
    await put(
      snapshotFile(),
      JSON.stringify({ tables: { "public.a": { name: "a" }, b: {} } }),
    );
    assert.deepEqual(await snapshotTables(outDir), ["a", "b"]);
  });

  it("refuse un JSON cassé en nommant le fichier", async () => {
    await put(snapshotFile(), "{");
    await assert.rejects(
      () => readSnapshot(snapshotFile()),
      /0000_snapshot\.json.*n'est pas lisible/,
    );
  });

  for (const [label, doc] of [
    ["un JSON `null`", null],
    ["des tables en liste", { tables: [] }],
    ["une table `null`", { tables: { a: null } }],
    [
      "des colonnes d'index d'un autre type",
      { tables: { a: { indexes: { i: { columns: [1] } } } } },
    ],
    [
      "une colonne sans type textuel",
      { tables: { a: { columns: { c: { type: 3 } } } } },
    ],
    ["une séquence d'une autre forme", { sequences: { s: "x" } }],
  ] as const) {
    it(`refuse ${label}`, async () => {
      await put(snapshotFile(), JSON.stringify(doc));
      await assert.rejects(
        () => readSnapshot(snapshotFile()),
        /n'a pas la forme qu'écrit drizzle-kit/,
      );
    });
  }
});
