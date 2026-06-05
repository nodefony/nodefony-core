import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Vitest — suite d'INTÉGRATION @nodefony/framework (HTTP réel : Controller,
 * data plane admin, décorateurs). Séparée des unit. Remplace mocha
 * (`.mocharc.integration.json` + loaders ts-node `fix-reflect`/`mock-sequelize`).
 *
 * `testTimeout` 10 s (porte les ex-`this.timeout(TIMEOUT)`). reflect-metadata +
 * hooks `before`/`after` mocha via le setup partagé ; `@nodefony/sequelize|mongoose`
 * stubés (anti crash `kernel.path`) ; `import "mocha"` shimé.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["nodefony/tests/integration/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
  },
  resolve: {
    alias: {
      "@nodefony/sequelize": r("./nodefony/tests/stubs/sequelize.ts"),
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
