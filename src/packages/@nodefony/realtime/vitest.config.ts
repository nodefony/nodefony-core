import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../../vitest.oxc";
import { gateReporter, REDIS_GATE } from "../../../../vitest.gates";

/**
 * vitest + coverage-v8 pour @nodefony/realtime.
 *
 * Standard coverage du repo. Tests = `node:assert` + describe/it en **globals**.
 *
 * **`gateReporter` est ce qui rend ce module honnête.** Une bonne part de ce qui
 * compte ici ne s'exerce QUE contre un vrai Redis (fan-out cross-pod, cloisonnement
 * par namespace, injection depuis le bus) ou derrière un interrupteur de coût
 * (`RUN_CLUSTER_E2E`, `RUN_PERF`). Ces suites s'auto-skippent quand le décor manque
 * — et un skip compte comme un succès : la suite affichait « tout vert » sans avoir
 * touché une ligne de backplane. Le reporter nomme la cible non exercée et donne la
 * commande pour l'ouvrir.
 */
export default defineConfig({
  test: {
    globals: true,
    reporters: ["default", gateReporter([REDIS_GATE])],
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
  oxc: oxcDecorators,
});
