import { defineConfig } from "vitest/config";

/**
 * vitest pour @nodefony/sequelize (convention-frère @nodefony/orm-core / mongoose).
 *
 * Banc d'intégration orm-core↔sequelize sur SQLite `:memory:` (driver natif, pas
 * de serveur externe). Tests = `node:assert` + describe/it/beforeAll/afterAll en
 * **globals** (aucun import mocha) → `globals: true` suffit.
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
