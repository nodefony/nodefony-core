import { defineConfig } from "vitest/config";

/**
 * vitest + coverage-v8 pour @nodefony/realtime.
 *
 * Standard coverage du repo (cf @nodefony/user / @nodefony/orm-core). Tests =
 * `node:assert` + describe/it en **globals**. Pas de shim mocha. Pas encore de
 * tests dans ce module (les tests de RealtimeHub / RealtimeController /
 * ClusterBackplane sont rapatriés depuis @nodefony/framework en P13.0).
 */
export default defineConfig({
  test: {
    globals: true,
    include: [
      "nodefony/tests/unit/**/*.test.ts",
      "nodefony/tests/integration/**/*.test.ts",
    ],
    // Les tests e2e cluster IPC fork des process enfants via tsx + IPC : laisser
    // une marge confortable (defaut 5s trop court avec setTimeout 150ms × N).
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["index.ts", "nodefony/**/*.ts"],
      exclude: ["nodefony/interfaces/**", "**/*.d.ts", "**/dist/**"],
      reporter: ["text", "text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
});
