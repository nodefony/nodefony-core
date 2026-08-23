import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { oxcDecorators } from "../../vitest.oxc";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Vitest du workspace core `nodefony` — remplace mocha (`.mocharc.cjs` +
 * `perf-skip.cjs`). Migration vers Vitest 4 (ESM-natif, esbuild) : aligne le core
 * sur le reste du repo et retire `mocha` du `node_modules` (avec lui les transitifs
 * vulnérables `diff` + `serialize-javascript`).
 *
 * Compat des tests mocha+chai EXISTANTS sans réécriture de masse :
 *  - `globals: true` → `describe`/`it`/`beforeEach`/`afterEach` globaux (comme mocha).
 *  - `import "mocha"` (et `import { describe, it } from "vitest"`) aliasé vers le shim
 *    `vitest-mocha-shim.mjs` (re-export des équivalents vitest).
 *  - `import { assert, expect } from "chai"` : chai (lib d'assertion) reste tel quel.
 *  - reflect-metadata (decorators), alias `before`/`after`→`beforeAll`/`afterAll` et
 *    le perf-skip OPT-IN (`NF_RUN_PERF=1`) sont portés dans `src/tests/vitest.setup.ts`.
 *
 * Decorators : requis pour le DI (`@injectable`/`@inject`) — cf `vitest.oxc.ts` (racine)
 * pour le pourquoi du bloc `oxc` ci-dessous.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["src/tests/**/*.test.ts"],
    setupFiles: [r("./src/tests/vitest.setup.ts")],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/tests/**", "src/bin/**", "**/dist/**", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
  oxc: oxcDecorators,
  resolve: {
    alias: {},
  },
});
