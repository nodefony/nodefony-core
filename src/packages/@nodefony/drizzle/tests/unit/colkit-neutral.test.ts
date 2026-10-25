import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * La DESCRIPTION d'une entité ne dépend d'aucun ORM (décision d'auteur, grappe
 * #680) : la grammaire, la dérivation des types de ligne, la validation et les
 * codecs sont un bien du framework, et Drizzle n'en est qu'un adaptateur.
 * Changer ou ajouter un ORM doit réécrire l'adaptateur, jamais ces fichiers.
 *
 * La règle tient par ce test, pas par la prose : chaque spécificateur importé
 * (statique, dynamique, ré-export) par la couche neutre doit appartenir à la
 * couche neutre elle-même.
 */

const ENTITY_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "nodefony",
  "entity",
);

/** La couche neutre, et ce qu'elle a le droit d'importer : elle-même. */
const NEUTRAL_FILES = ["colKit.spec.ts", "colKit.codecs.ts"];
const ALLOWED = new Set(["./colKit.spec", "./colKit.codecs"]);

/** Spécificateurs d'un source : `from "x"`, `import "x"`, `import("x")`. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const re of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const match of source.matchAll(re)) {
      if (match[1] !== undefined) {
        found.push(match[1]);
      }
    }
  }
  return found;
}

describe("colKit — la couche neutre n'importe aucun ORM", () => {
  it("le relevé des spécificateurs voit bien un import d'ORM (le test mord)", () => {
    assert.deepEqual(
      specifiersOf(
        'import type { X } from "drizzle-orm";\nexport * from "mongoose";\nconst m = await import("@nodefony/orm-core");',
      ).sort(),
      ["@nodefony/orm-core", "drizzle-orm", "mongoose"],
    );
  });

  for (const file of NEUTRAL_FILES) {
    it(`${file} n'importe que la couche neutre`, () => {
      const source = readFileSync(path.join(ENTITY_DIR, file), "utf8");
      const outside = specifiersOf(source).filter((spec) => !ALLOWED.has(spec));
      assert.deepEqual(
        outside,
        [],
        `${file} importe hors de la couche neutre : ${outside.join(", ")} — ` +
          "ce qui dépend d'un ORM va dans son adaptateur (colKit.ts et colKit.<dialecte>.ts).",
      );
    });
  }
});
