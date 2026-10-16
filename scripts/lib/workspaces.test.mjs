import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readWorkspaceManifests, workspaceDrift } from "./workspaces.mjs";

// Vécu : `npm query` rend l'arbre INSTALLÉ. Un module ajouté sans `npm install`
// derrière lui est sur le disque et absent de npm — le pack l'aurait oublié.
describe("workspaceDrift — le disque et l'arbre installé disent-ils la même chose ?", () => {
  it("rien à dire quand les deux listes coïncident, dans n'importe quel ordre", () => {
    expect(workspaceDrift(["b", "a"], ["a", "b"])).toBeNull();
  });

  it("🔴 un publiable du disque absent de npm est NOMMÉ", () => {
    expect(workspaceDrift(["a", "@nodefony/ai"], ["a"])).toEqual({
      notInstalled: ["@nodefony/ai"],
      notOnDisk: [],
    });
  });

  it("🔴 un publiable pour npm devenu privé sur le disque est NOMMÉ", () => {
    expect(workspaceDrift(["a"], ["a", "retire"])).toEqual({
      notInstalled: [],
      notOnDisk: ["retire"],
    });
  });
});

describe("readWorkspaceManifests — les fichiers, pas l'arbre installé", () => {
  const racine = mkdtempSync(path.join(os.tmpdir(), "nf-workspaces-"));
  afterAll(() => rmSync(racine, { recursive: true, force: true }));

  const poser = (rel, manifest) => {
    const dossier = path.join(racine, ...rel.split("/"));
    mkdirSync(dossier, { recursive: true });
    writeFileSync(path.join(dossier, "package.json"), JSON.stringify(manifest));
  };

  it("développe `dossier/*`, garde les chemins nommés, ignore un dossier sans manifeste", () => {
    poser(".", { workspaces: ["core", "packages/*"] });
    poser("core", { name: "nodefony" });
    poser("packages/a", { name: "@x/a", private: true });
    poser("packages/b", { name: "@x/b" });
    mkdirSync(path.join(racine, "packages", "vide"), { recursive: true });

    const lus = readWorkspaceManifests(racine);
    expect(lus.map((w) => w.location).sort()).toEqual([
      "core",
      "packages/a",
      "packages/b",
    ]);
    expect(
      lus
        .filter((w) => !w.manifest.private)
        .map((w) => w.manifest.name)
        .sort(),
    ).toEqual(["@x/b", "nodefony"]);
  });
});
