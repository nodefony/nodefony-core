/*
 *   Expressions du scaffold en temps LINÉAIRE (alertes CodeQL js/polynomial-redos).
 *
 *   Deux motifs dont les quantificateurs se disputaient les mêmes caractères
 *   (`\s*\n+`, `[^)]*` qui avale des `(`) coûtaient ~8 s sur 100 000
 *   caractères. Le seuil est large (une seconde) : la version linéaire rend en
 *   quelques millisecondes — l'écart ne dépend pas de la machine. Sous 30 000,
 *   l'ancienne version passait encore sous le seuil : le test ne mordait pas.
 */

import assert from "node:assert";
import { parseEntityFields } from "../cli/scaffold/entityFields";
import { wireKernelBootCall } from "../cli/scaffold/engine";
import { ScaffoldWriter } from "../cli/scaffold/writer";

const N = 100_000;
const BUDGET_MS = 1_000;

const elapsed = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

describe("scaffold — expressions en temps linéaire", () => {
  it("parseEntityFields : une suite de `(` sans `)` ne fait pas exploser le temps", () => {
    const ms = elapsed(() => {
      try {
        parseEntityFields(`a:${"(".repeat(N)}`);
      } catch {
        // le refus est attendu : seul le temps compte ici
      }
    });
    assert.ok(ms < BUDGET_MS, `${ms.toFixed(0)} ms pour ${N} « ( »`);
  });

  it("parseEntityFields : les virgules d'un `decimal(10,2)` restent hors de cause", () => {
    assert.doesNotThrow(() => parseEntityFields("price:decimal(10,2)"));
    assert.throws(
      () => parseEntityFields("title:string,body:text"),
      /ESPACES/u,
    );
  });

  it("wireKernelBootCall : une suite de sauts de ligne après `}` ne fait pas exploser le temps", () => {
    const file = "/virtuel/index.ts";
    const writer = new ScaffoldWriter();
    writer.write(
      file,
      `import { a } from "a";\nclass M {\n}${"\n".repeat(N)}x`,
    );
    const ms = elapsed(() => wireKernelBootCall(file, "f", "./f", writer));
    assert.ok(ms < BUDGET_MS, `${ms.toFixed(0)} ms pour ${N} sauts de ligne`);
  });

  it("wireKernelBootCall : des lignes blanches (espaces, tabulations, CRLF) avant `export default` sont acceptées", () => {
    const file = "/virtuel/index.ts";
    const writer = new ScaffoldWriter();
    writer.write(
      file,
      `import { a } from "a";\nclass M {\n}\n  \t\r\n\nexport default M;\n`,
    );
    assert.strictEqual(wireKernelBootCall(file, "f", "./f", writer), null);
    assert.match(
      writer.read(file),
      /onKernelBoot\(\)[\s\S]*f\(this\);[\s\S]*\n\}\n/u,
    );
  });
});
