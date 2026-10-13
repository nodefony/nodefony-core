import { describe, it } from "vitest";
import { assert } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Le sous-chemin `nodefony/project-root` — une PROMESSE publique, et une
 * promesse de LÉGÈRETÉ.
 *
 * Les scripts des skills livrés l'importent pour trouver la racine de
 * l'application : importer `nodefony` entier coûtait jusqu'à plusieurs secondes
 * à froid, payées à chaque appel d'un agent. Le sous-chemin ne vaut donc que
 * tant que son fichier reste sans dépendance : un `import` du cœur ajouté ici le
 * ramènerait au prix du paquet entier, sans qu'aucun type ni aucun test
 * fonctionnel ne le voie.
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SOURCE = path.join(ROOT, "src", "cli", "projectRoot.ts");

describe("nodefony/project-root — publié, et léger", () => {
  it("exports le déclare, vers le fichier bâti de src/cli/projectRoot.ts", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string>> };
    const entry = pkg.exports["./project-root"];
    assert.isDefined(entry, "sous-chemin ./project-root absent d'exports");
    assert.strictEqual(entry.import, "./dist/node/cli/projectRoot.js");
    assert.strictEqual(entry.default, "./dist/node/cli/projectRoot.js");
    assert.strictEqual(entry.types, "./dist/types/cli/projectRoot.d.ts");
  });

  it("son fichier n'importe QUE des modules node: — sinon il n'est plus léger", () => {
    const source = readFileSync(SOURCE, "utf8");
    const specifiers = [
      ...source.matchAll(
        /^\s*(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/gmu,
      ),
    ].map((m) => m[1] ?? "");
    assert.isAbove(
      specifiers.length,
      0,
      "aucun import lu — la sonde est aveugle",
    );
    for (const specifier of specifiers) {
      assert.match(
        specifier,
        /^node:/u,
        `${specifier} importé par projectRoot.ts : le sous-chemin léger ne l'est plus`,
      );
    }
  });
});
