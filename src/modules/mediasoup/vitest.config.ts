import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { transformCache } from "../../../scripts/test/vitest/perf.ts";
import { tmpGuard } from "../../../scripts/test/vitest/tmp-guard.ts";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Vitest du banc de test ORM `mediasoup` — remplace mocha (`.mocharc.json`).
 * Tests d'intégration de l'abstraction `@nodefony/orm-core` sur un modèle métier
 * réaliste (Drizzle sur SQLite `:memory:`). `node:assert/strict` +
 * globals (describe/it/before/after). `before`/`after` mocha aliasés dans le setup.
 */
export default defineConfig({
  test: {
    // Dossier temporaire propre à la passe, contrôlé et supprimé au teardown
    // (scripts/test/vitest/tmp-guard.ts) : un test qui ne nettoie pas fait échouer la passe.
    globalSetup: tmpGuard(),
    ...transformCache,
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20000,
    setupFiles: [r("./tests/vitest.setup.ts")],
    coverage: {
      provider: "v8",
      include: ["nodefony/**/*.ts"],
      exclude: ["tests/**", "**/dist/**", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
});
