import { describe, it } from "vitest";
import { assert } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Le sous-chemin `nodefony/syslog` — les règles de LECTURE des journaux, hors
 * du point d'entrée navigateur.
 *
 * `nodefony/client` est téléchargé par toute page ; ces règles ne servent qu'aux
 * visualiseurs (console d'administration, barre de débogage). Les y laisser
 * coûtait 1,4 Ko gzip à chaque application, et avait fait relever son budget.
 * Un ré-export ajouté par commodité les y ramènerait sans qu'aucun type ni
 * aucun test fonctionnel ne le voie : seul le budget de taille rougirait, plus
 * tard et sans nommer la cause.
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..");

const READING_RULES = [
  "pduProtocol",
  "pduFlowStep",
  "FLOW_STEPS",
  "accessStatusFamily",
  "consoleRequestIds",
  "parseAccessLine",
  "pduIsConsoleRequest",
  "pduIsConsoleTraffic",
  "pduIsModuleExcluded",
  "frameIndexOf",
] as const;

describe("nodefony/syslog — les règles de lecture des journaux, à part", () => {
  it("exports le déclare, et le build le produit", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string>> };
    const entry = pkg.exports["./syslog"];
    assert.isDefined(entry, "sous-chemin ./syslog absent d'exports");
    assert.strictEqual(entry.default, "./dist/client/client/syslog/index.js");
    assert.strictEqual(
      entry.types,
      "./dist/client/types/src/client/syslog/index.d.ts",
    );
    const config = readFileSync(path.join(ROOT, "rolldown.config.ts"), "utf8");
    assert.include(
      config,
      `"src/client/syslog/index.ts"`,
      "entrée absente du build client : le sous-chemin publié pointerait dans le vide",
    );
  });

  it("le sous-chemin porte les dix règles", async () => {
    const syslog: Record<string, unknown> =
      await import("../client/syslog/index");
    for (const name of READING_RULES) {
      assert.property(syslog, name, `${name} absent de nodefony/syslog`);
    }
  });

  it("nodefony/client ne les porte plus — chaque page les paierait", async () => {
    const client: Record<string, unknown> = await import("../client/index");
    for (const name of READING_RULES) {
      assert.notProperty(
        client,
        name,
        `${name} ré-exporté par nodefony/client : il retourne dans le bundle de toute page`,
      );
    }
  });

  it("le serveur les lit toujours depuis nodefony", async () => {
    const node: Record<string, unknown> = await import("../index");
    for (const name of READING_RULES) {
      assert.property(node, name, `${name} absent du point d'entrée serveur`);
    }
  });
});
