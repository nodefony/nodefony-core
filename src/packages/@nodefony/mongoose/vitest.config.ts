import { defineConfig } from "vitest/config";

/**
 * vitest pour @nodefony/mongoose (convention-frère @nodefony/orm-core).
 *
 * - `tests/unit/` : rapide, sans serveur (config Zod) ;
 * - `tests/integration/` : `mongodb-memory-server` (ReplSet = mongod réel, requis
 *   pour les transactions ; le banc session = standalone, hybride `MONGO_TEST_URI`).
 *
 * Tests = `node:assert` + describe/it/beforeAll/afterAll en **globals** (aucun
 * import mocha) → `globals: true` suffit. `testTimeout` élargi : le 1ᵉʳ run
 * d'intégration télécharge le binaire mongod (memory-server).
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
    coverage: {
      provider: "v8",
      // `all` = compter aussi les fichiers non importés (garde-fou honnête).
      all: true,
      include: ["index.ts", "nodefony/**/*.ts"],
      exclude: ["nodefony/interfaces/**", "**/*.d.ts", "**/dist/**"],
      reporter: ["text", "text-summary"],
      reportsDirectory: ".coverage",
      // Plancher CI (≈ mesuré − 3 pts). À relever au fil des tests.
      thresholds: { lines: 72, statements: 72, functions: 66, branches: 58 },
    },
  },
});
