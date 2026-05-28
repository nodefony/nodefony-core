import { defineConfig } from "vitest/config";

/**
 * vitest pour @nodefony/mongoose (convention-frère @nodefony/orm-core).
 *
 * Le banc d'intégration orm-core↔mongoose tourne un `mongodb-memory-server`
 * (ReplSet = mongod réel, requis pour les transactions) → suite lente isolée
 * sous `tests/integration/`. Tests = `node:assert` + describe/it/beforeAll/
 * afterAll en **globals** (aucun import mocha) → `globals: true` suffit.
 *
 * `testTimeout` élargi : le 1ᵉʳ run télécharge le binaire mongod (memory-server).
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
