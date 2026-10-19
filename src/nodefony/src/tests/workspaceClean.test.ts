/**
 * **Tout workspace qui BÂTIT sait se NETTOYER.**
 *
 * `npm run clean` (racine) délègue à `turbo run clean` : un workspace sans
 * script `clean` est sauté sans un mot, et son `dist/` survit à chaque
 * « clean && build ». Un fichier dont la source a disparu y reste alors pour
 * toujours — et part dans le tarball, puisque `files` publie `dist`. Vécu :
 * `@nodefony/devkit` publiait un contrôleur supprimé depuis deux mois.
 */
import { describe, it } from "vitest";
import { assert } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Racine du dépôt — ce fichier vit dans `src/nodefony/src/tests/`. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/**
 * Les `package.json` des workspaces : le cœur, les paquets, les modules.
 *
 * @returns chemins absolus des manifestes trouvés.
 */
function workspaceManifests(): string[] {
  const out = [path.join(REPO_ROOT, "src", "nodefony", "package.json")];
  for (const parent of [
    path.join(REPO_ROOT, "src", "packages", "@nodefony"),
    path.join(REPO_ROOT, "src", "modules"),
  ]) {
    for (const entry of readdirSync(parent)) {
      const manifest = path.join(parent, entry, "package.json");
      if (existsSync(manifest)) {
        out.push(manifest);
      }
    }
  }
  return out;
}

/**
 * Les workspaces qui bâtissent sans savoir se nettoyer.
 *
 * @param manifests - chemins des `package.json`.
 * @returns une entrée par workspace fautif, relative à la racine.
 */
export function findBuildWithoutClean(manifests: string[]): string[] {
  const findings: string[] = [];
  for (const manifest of manifests) {
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    if (scripts["build"] !== undefined && scripts["clean"] === undefined) {
      findings.push(path.relative(REPO_ROOT, path.dirname(manifest)));
    }
  }
  return findings;
}

describe("workspaces — qui bâtit sait se nettoyer", () => {
  const manifests = workspaceManifests();

  it("le balayage TROUVE la matière qu'il prétend juger", () => {
    assert.isAtLeast(manifests.length, 15, "le balayage est aveugle");
  });

  it("aucun workspace avec `build` sans `clean`", () => {
    assert.deepEqual(
      findBuildWithoutClean(manifests),
      [],
      "Ajouter `\"clean\": \"node --eval \\\"require('node:fs').rmSync('dist'," +
        '{recursive:true,force:true})\\""` — sans lui, `turbo run clean` saute ' +
        "le workspace et son dist garde des fichiers orphelins publiés.",
    );
  });
});
