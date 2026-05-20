import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
 *  - @nodefony/sequelize|mongoose aliasés vers les stubs (crash kernel.path).
 */
export default defineConfig({
  test: {
    globals: true,
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
  resolve: {
    alias: {
      mocha: r("./nodefony/tests/vitest-mocha-shim.mjs"),
      "@nodefony/sequelize": r("./nodefony/tests/stubs/sequelize.ts"),
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
