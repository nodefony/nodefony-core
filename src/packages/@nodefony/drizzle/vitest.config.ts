import { defineConfig } from "vitest/config";

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
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
