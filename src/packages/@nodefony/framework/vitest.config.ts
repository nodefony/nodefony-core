import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { oxcDecorators } from "../../../../vitest.oxc";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * POC vitest+coverage-v8 pour @nodefony/framework.
 *
 * But : prouver que vitest (ESM-natif, Vite/esbuild) mappe le coverage du
 * source MÊME quand les tests importent le dist Rollup de @nodefony/http —
 * là où monocart+mocha+tsx échoue (cf mémoire feedback_coverage_modules :
 * `mcr --require` bascule en CJS → specs dist non enregistrées).
 *
 * Compat tests mocha+chai existants sans réécriture :
 *  - `globals: true` → describe/it/before/after/beforeEach/afterEach globaux.
 *  - `import "mocha"` aliasé vers un shim vide.
 *  - `import { expect } from "chai"` : chai marche tel quel (alias global vitest
 *    expect non utilisé puisque l'expect chai est importé explicitement).
 *  - reflect-metadata chargé au setup (decorators).
 *  - @nodefony/mongoose aliasé vers le stub (crash kernel.path).
 */
export default defineConfig({
  test: {
    globals: true,
    // Un worker par FICHIER coûtait la moitié de la suite (spawn + réévaluation du
    // graphe) : `vitest doctor` mesure −40 à −50 % avec des workers partagés, et
    // a rejoué la suite deux fois en ordre mélangé sans qu'un test dépende de
    // l'isolation. Un test qui s'en met à dépendre se voit : rétablir `true` ET
    // nommer le coupable, jamais l'inverse.
    isolate: false,
    include: ["nodefony/tests/unit/**/*.test.ts"],
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
    coverage: {
      provider: "v8",
      include: ["nodefony/**/*.ts"],
      exclude: ["nodefony/tests/**", "**/dist/**", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
  oxc: oxcDecorators,
  resolve: {
    alias: {
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
