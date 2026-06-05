import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Vitest — suite d'INTÉGRATION @nodefony/frontend (séparée des unit : spawn de
 * vrais process Vite + build réels → lente). Remplace mocha
 * (`.mocharc.integration.json`, ex `test:integration`).
 *
 * `testTimeout`/`hookTimeout` généreux (60 s) car build/spawn Vite réels (porte
 * les ex-`this.timeout(60_000)`/`(45_000)` mocha). `chai` + hooks `before`/`after`
 * mocha conservés via le setup partagé `vitest.setup.ts` ; `import "mocha"` shimé.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["nodefony/tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
  },
  resolve: {
    alias: {},
  },
});
