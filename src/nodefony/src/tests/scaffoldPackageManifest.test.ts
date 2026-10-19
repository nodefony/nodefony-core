import { afterAll, assert, beforeAll, describe, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  declareWorkspaceDependency,
  ensureWorkspaces,
} from "../cli/scaffold/engine";
import {
  dependencyNames,
  ensureObjectField,
  parsePackageManifest,
} from "../cli/scaffold/packageManifest";
import { ScaffoldWriter } from "../cli/scaffold/writer";

// #572 — le `package.json` lu par le scaffold appartient à l'utilisateur : sa
// forme se VÉRIFIE (racine objet, erreur qui nomme le fichier), et une
// réécriture garde tout ce que le moteur ne connaît pas.

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nf-manifest-"));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Un projet jetable portant ce `package.json`, rendu tel quel. */
function project(name: string, manifest: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), manifest);
  return dir;
}

describe("packageManifest — lecture du package.json par le scaffold", () => {
  it("un JSON illisible lève en nommant le fichier", () => {
    const file = path.join("app", "package.json");
    assert.throws(
      () => parsePackageManifest('{ "name": ', file),
      `${file} : JSON illisible`,
    );
  });

  it("une racine qui n'est pas un objet est refusée", () => {
    for (const text of ["[]", '"app"', "null", "42"]) {
      assert.throws(
        () => parsePackageManifest(text, "package.json"),
        "package.json : le manifeste n'est pas un objet JSON",
      );
    }
  });

  it("un bloc de dépendances mal formé ne déclare rien, sans lever", () => {
    const manifest = parsePackageManifest(
      JSON.stringify({
        dependencies: "zod",
        devDependencies: { vitest: "^4" },
        peerDependencies: ["nodefony"],
      }),
      "package.json",
    );
    assert.deepEqual([...dependencyNames(manifest)], ["vitest"]);
  });

  it("compléter un champ qui n'est pas un objet est refusé, pas écrasé", () => {
    const manifest = parsePackageManifest(
      JSON.stringify({ scripts: "build" }),
      "package.json",
    );
    assert.throws(
      () => ensureObjectField(manifest, "scripts"),
      "package.json : le champ « scripts » n'est pas un objet",
    );
    assert.strictEqual(manifest.data["scripts"], "build");
  });
});

describe("packageManifest — réécriture par le moteur", () => {
  it("declareWorkspaceDependency garde les champs inconnus et leur ordre", () => {
    const original = {
      name: "app",
      private: true,
      nodefony: { contribute: "./contribute.js" },
      dependencies: { zod: "^4.0.0" },
      overrides: { semver: "7.7.2" },
    };
    const dir = project("keep", `${JSON.stringify(original, null, 2)}\n`);
    const writer = new ScaffoldWriter();
    assert.isTrue(declareWorkspaceDependency(dir, "@app/blog", writer));
    const written: unknown = JSON.parse(
      writer.read(path.join(dir, "package.json")),
    );
    assert.deepEqual(written, {
      ...original,
      dependencies: { zod: "^4.0.0", "@app/blog": "workspace:*" },
    });
    assert.deepEqual(Object.keys(written as object), Object.keys(original));
  });

  it("ensureWorkspaces sur un manifeste cassé nomme le fichier", () => {
    const dir = project("broken", '{ "name": "app",\n');
    assert.throws(
      () => ensureWorkspaces(dir, new ScaffoldWriter(), "npm"),
      `${path.join(dir, "package.json")} : JSON illisible`,
    );
  });

  it("ensureWorkspaces refuse la forme objet au lieu de la réécrire", () => {
    const dir = project(
      "yarn-object",
      JSON.stringify({ name: "app", workspaces: { packages: ["libs/*"] } }),
    );
    const writer = new ScaffoldWriter();
    assert.throws(
      () => ensureWorkspaces(dir, writer, "npm"),
      "« workspaces » n'est pas un tableau",
    );
    assert.strictEqual(writer.size, 0);
  });
});
