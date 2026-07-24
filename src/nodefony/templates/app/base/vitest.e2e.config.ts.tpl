import { defineConfig } from "vitest/config";

/**
 * Config Vitest des tests E2E — la SEULE porte vers `tests/e2e.test.ts`
 * (exclu de `vitest.config.ts`). L'invoquer, c'est vouloir un boot réel :
 * `npm run test:e2e` (le build précède — un serveur spawné valide le DIST).
 *
 * Timeouts larges : un `nodefony production --detach --wait` compile puis
 * sonde la readiness — c'est un vrai démarrage, pas un test unitaire.
 */
export default defineConfig({
  test: {
    include: ["tests/e2e.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
