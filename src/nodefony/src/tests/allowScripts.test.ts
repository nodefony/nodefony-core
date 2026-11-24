/*
 *   #874 — `allowScripts` : une règle, deux lecteurs. Le gabarit la rend à la
 *   naissance d'une application npm ; `nodefony upgrade` y complète une
 *   application née avant qu'une entrée existe, sans jamais toucher une entrée
 *   présente. Vécu : une application née en beta.6 gardait à chaque
 *   installation l'avertissement d'npm sur `esbuild` et `fsevents`.
 */
import { afterAll, assert, describe, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { version } from "../../package.json";
import {
  appAllowScripts,
  missingAllowScripts,
} from "../cli/scaffold/allowScripts";
import { runScaffold } from "../cli/scaffold/engine";
import { isPlainObject } from "../runtime/isPlainObject";
import { isUpgradePending, renderUpgrade, runUpgrade } from "../cli/upgrade";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-allow-"));
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const readJson = (file: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isPlainObject(parsed)) throw new Error(`${file} : pas un objet JSON`);
  return parsed;
};

/** Le `package.json` d'une application npm née en beta.6. */
const bornInBeta6 = (): Record<string, unknown> => ({
  name: "ancienne",
  private: true,
  type: "module",
  allowScripts: { "better-sqlite3": true },
  scripts: { build: "rolldown -c rolldown.config.ts" },
  dependencies: { nodefony: "^10.0.0-beta.6", "better-sqlite3": "13.0.3" },
  devDependencies: { "drizzle-kit": "0.31.0" },
});

describe("allowScripts — la règle", () => {
  it("le gabarit déclare toujours esbuild et fsevents, better-sqlite3 s'il est déclaré", () => {
    assert.deepEqual(
      appAllowScripts(() => false).map((e) => e.name),
      ["esbuild", "fsevents"],
    );
    assert.deepEqual(
      appAllowScripts((name) => name === "better-sqlite3").map((e) => e.name),
      ["better-sqlite3", "esbuild", "fsevents"],
    );
  });

  it("app née en beta.6 : ajoute esbuild et fsevents, garde better-sqlite3 à true", () => {
    const data = bornInBeta6();
    assert.deepEqual(missingAllowScripts(data, false), [
      { name: "esbuild", allow: false },
      { name: "fsevents", allow: false },
    ]);
    // Simulation : rien n'est écrit.
    assert.deepEqual(data.allowScripts, { "better-sqlite3": true });
    missingAllowScripts(data, true);
    assert.deepEqual(data.allowScripts, {
      "better-sqlite3": true,
      esbuild: false,
      fsevents: false,
    });
    assert.deepEqual(missingAllowScripts(data, false), []);
  });

  it("une entrée PRÉSENTE n'est jamais modifiée, quelle que soit sa valeur", () => {
    const data: Record<string, unknown> = {
      ...bornInBeta6(),
      allowScripts: { esbuild: true },
    };
    assert.deepEqual(
      missingAllowScripts(data, true).map((e) => e.name),
      ["better-sqlite3", "fsevents"],
    );
    assert.deepEqual(data.allowScripts, {
      esbuild: true,
      "better-sqlite3": false,
      fsevents: false,
    });
  });

  it("bloc absent : créé juste avant `scripts`, à la place du gabarit", () => {
    const data: Record<string, unknown> = bornInBeta6();
    delete data.allowScripts;
    missingAllowScripts(data, true);
    assert.deepEqual(Object.keys(data), [
      "name",
      "private",
      "type",
      "allowScripts",
      "scripts",
      "dependencies",
      "devDependencies",
    ]);
  });

  it("bloc qui n'est pas un objet : rien n'est rendu ni écrit", () => {
    const data = { ...bornInBeta6(), allowScripts: "oui" };
    assert.deepEqual(missingAllowScripts(data, true), []);
    assert.strictEqual(data.allowScripts, "oui");
  });
});

describe("allowScripts — le gabarit rend la même règle", () => {
  const cases = [
    { preset: "complete", database: "sqlite" },
    { preset: "complete", database: "postgres" },
    { preset: "complete", database: "mongodb" },
    { preset: "complete", database: "postgres", demo: true },
    { preset: "complete", database: "mongodb", demo: true },
    { preset: "minimal" },
  ];
  for (const answers of cases) {
    const label = Object.values(answers).join(" ");
    it(`npm ${label} : le bloc rendu = la règle lue sur les dépendances rendues`, () => {
      const dest = path.join(tmp, label.replaceAll(" ", "-"));
      runScaffold(
        {
          type: "app",
          answers: { name: "app", packageManager: "npm", ...answers },
          dir: dest,
          force: false,
        },
        version,
      );
      const pkg = readJson(path.join(dest, "package.json"));
      const declares = (name: string): boolean =>
        ["dependencies", "devDependencies"].some((block) => {
          const record = pkg[block];
          return isPlainObject(record) && Object.hasOwn(record, name);
        });
      assert.deepEqual(
        pkg.allowScripts,
        Object.fromEntries(
          appAllowScripts(declares).map((e) => [e.name, e.allow]),
        ),
      );
      // Une application qui vient de naître n'est pas en retard.
      assert.deepEqual(missingAllowScripts(pkg, false), []);
    });
  }
});

describe("allowScripts — nodefony upgrade", () => {
  /** Une application posée sur disque, avec le verrou de son gestionnaire. */
  const app = (name: string, lockfile: string): string => {
    const root = path.join(tmp, name);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify(bornInBeta6(), null, 2)}\n`,
    );
    fs.writeFileSync(path.join(root, lockfile), "");
    return root;
  };

  it("--check nomme les entrées manquantes sans écrire, et les compte en retard", async () => {
    const root = app("check", "package-lock.json");
    const before = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const report = await runUpgrade(root, true);
    assert.deepEqual(
      report.allowScripts?.map((e) => e.name),
      ["esbuild", "fsevents"],
    );
    assert.isTrue(isUpgradePending(report));
    const text = renderUpgrade(report);
    assert.match(text, /allowScripts\s+2 entrée\(s\) à ajouter/u);
    assert.match(text, /\+ esbuild : false/u);
    assert.strictEqual(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
      before,
    );
  });

  it("le geste ajoute les deux entrées, garde better-sqlite3, puis se tait", async () => {
    const root = app("apply", "package-lock.json");
    const report = await runUpgrade(root, false);
    assert.match(
      renderUpgrade(report),
      /allowScripts\s+2 entrée\(s\) ajoutée\(s\)/u,
    );
    const pkg = readJson(path.join(root, "package.json"));
    assert.deepEqual(pkg.allowScripts, {
      "better-sqlite3": true,
      esbuild: false,
      fsevents: false,
    });
    const again = await runUpgrade(root, true);
    assert.deepEqual(again.allowScripts, []);
    assert.match(renderUpgrade(again), /allowScripts\s+à jour/u);
  });

  it("hors npm : le champ n'est lu par personne — ni écrit, ni rendu", async () => {
    const root = app("yarn", "yarn.lock");
    const report = await runUpgrade(root, false);
    assert.isNull(report.allowScripts);
    assert.notMatch(renderUpgrade(report), /allowScripts/u);
    assert.deepEqual(readJson(path.join(root, "package.json")).allowScripts, {
      "better-sqlite3": true,
    });
  });
});
