import { describe, it } from "vitest";
import { assert } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Le sous-chemin `nodefony/held` — le protocole teneur ⇄ hôte (ADR-0030), publié
 * pour qu'un hôte de service (Vite, demain un serveur d'inférence) le charge SEUL.
 *
 * Un hôte est lancé à chaque démarrage et à chaque relance de son service :
 * importer `nodefony` entier y coûtait ~330 ms, le module feuille ~1 ms (mesuré).
 * Le sous-chemin ne vaut que tant que son fichier n'importe RIEN — un seul
 * `import` le ramènerait au prix du paquet, sans qu'aucun type ni aucun test
 * fonctionnel ne le voie.
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DEV = path.join(ROOT, "src", "service", "dev");

/** Les spécificateurs importés ou réexportés par un fichier source. */
function specifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [
    ...source.matchAll(
      /^\s*(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/gmu,
    ),
  ].map((m) => m[1] ?? "");
}

describe("nodefony/held — publié, et feuille", () => {
  it("exports le déclare, vers le fichier bâti de src/service/dev/heldChannel.ts", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string>> };
    const entry = pkg.exports["./held"];
    assert.isDefined(entry, "sous-chemin ./held absent d'exports");
    assert.strictEqual(entry.import, "./dist/node/service/dev/heldChannel.js");
    assert.strictEqual(entry.default, "./dist/node/service/dev/heldChannel.js");
    assert.strictEqual(
      entry.types,
      "./dist/types/service/dev/heldChannel.d.ts",
    );
  });

  it("son fichier n'importe RIEN — sinon il n'est plus léger", () => {
    // Témoin : la même sonde lit bien les imports du teneur, qui en a.
    assert.isAbove(
      specifiers(path.join(DEV, "HostHolder.ts")).length,
      0,
      "aucun import lu dans HostHolder.ts — la sonde est aveugle",
    );
    assert.deepStrictEqual(
      specifiers(path.join(DEV, "heldChannel.ts")),
      [],
      "heldChannel.ts importe : le sous-chemin léger ne l'est plus",
    );
  });
});
