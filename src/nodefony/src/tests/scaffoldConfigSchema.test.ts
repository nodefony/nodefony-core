/**
 * **Une application générée publie le schéma de SA configuration.**
 *
 * Ce dépôt le fait (`index.ts` racine : `override configSchema()`), le gabarit
 * ne le faisait pas : sur une app fraîche, `npx nodefony inspect schema app`
 * rendait `[]`, et les clés de l'application — `servers`, `domain`, `log`,
 * celles que la documentation désigne comme la confusion la plus facile —
 * étaient indécouvrables là où elles servent (#297).
 *
 * Lit l'application RENDUE, pas le gabarit.
 */
import { assert } from "chai";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { version } from "../../package.json";
import { runScaffold } from "../cli/scaffold/engine";

describe("create app — l'application publie le schéma de sa configuration (#297)", () => {
  for (const preset of ["complete", "minimal"] as const) {
    it(`preset ${preset} : index.ts surcharge configSchema() avec le schéma de l'app`, () => {
      const dir = mkdtempSync(path.join(tmpdir(), "nf-schema-"));
      try {
        runScaffold(
          {
            type: "app",
            answers: { name: "schema", preset },
            dir,
            force: false,
          },
          version,
        );
        const index = readFileSync(path.join(dir, "index.ts"), "utf8");
        assert.match(
          index,
          /override configSchema\(\): unknown \{\s*return appConfigJsonSchema\(\);/u,
          "la surcharge, avec le schéma de l'app fourni par le framework",
        );
        assert.match(
          index,
          /import \{[^}]*\bappConfigJsonSchema\b[^}]*\} from "nodefony"/u,
          "importé du framework, jamais recopié",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
