import { defineConfig } from "vitest/config";
import { transformCache } from "../../../../vitest.perf.ts";

/**
 * vitest + coverage-v8 pour @nodefony/security.
 *
 * Standard coverage du repo (cf @nodefony/user / framework). Tests = `node:assert`
 * + describe/it en **globals** → `globals: true` suffit.
 */
export default defineConfig({
  test: {
    // 82 processus de travail étaient créés, ~7,99 s de démarrage chacun.
    // Mesuré 13,19 s → 4,73 s (-64 %), 1110 tests, 3 runs verts consécutifs ET
    // un run en ordre aléatoire vert.
    isolate: false,
    ...transformCache,
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "nodefony/**/*.ts"],
      // contracts/ = type-only → hors métrique runtime.
      exclude: ["nodefony/contracts/**", "**/*.d.ts", "**/dist/**"],
      // json-summary + lcov = fichiers lus par Studio (readCoverage : .coverage/
      // coverage-summary.json puis lcov.info) ; text-summary = console. Sans les
      // reporters fichiers, `npm run coverage` n'écrit rien → onglet Coverage vide.
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
});
