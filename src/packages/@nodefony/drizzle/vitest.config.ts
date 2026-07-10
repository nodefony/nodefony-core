import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../../vitest.oxc";

/**
 * vitest pour @nodefony/drizzle — suite d'intégration (convention-frère orm-core).
 *
 * Banc orm-core↔drizzle + jointures complexes sur `better-sqlite3` `:memory:`
 * (driver natif). Tests = `node:assert` + describe/it/beforeAll/afterAll en
 * **globals** (aucun import mocha) → `globals: true` suffit.
 *
 * La suite de CHARGE (`tests/load/`, expose-gc) est séparée dans
 * `vitest.config.load.ts` (`npm run test:load`) — non lancée en non-régression.
 *
 * Migré de Mocha (`.mocharc.json` supprimé) le 2026-05-28 : Vitest = runner
 * canonique du repo (cf feedback_test_framework_vitest), Mocha = legacy.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: "v8",
      // `all` = compter aussi les fichiers non importés (garde-fou honnête).
      all: true,
      include: ["index.ts", "nodefony/**/*.ts"],
      exclude: ["nodefony/interfaces/**", "**/*.d.ts", "**/dist/**"],
      // json-summary + lcov = fichiers lus par Studio (onglet Coverage) ; sans eux
      // `npm run coverage` n'écrit rien dans .coverage/ → onglet absent.
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
      // Plancher CI (≈ mesuré − 3 pts). À relever au fil des tests.
      thresholds: { lines: 75, statements: 75, functions: 75, branches: 57 },
    },
  },
  oxc: oxcDecorators,
});
