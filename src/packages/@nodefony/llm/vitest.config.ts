import { defineConfig } from "vitest/config";
import { transformCache } from "../../../../scripts/test/vitest/perf.ts";
import { tmpGuard } from "../../../../scripts/test/vitest/tmp-guard.ts";

/**
 * vitest + coverage-v8 pour @nodefony/llm.
 *
 * Standard coverage du repo (cf @nodefony/redis / @nodefony/realtime). Tests
 * unitaires SANS backend réel : les fournisseurs (Claude, Ollama) sont exercés
 * par un `vi.spyOn(globalThis, "fetch")`, jamais par un appel sortant — la suite
 * doit rester verte hors ligne et sans clé d'API.
 */
export default defineConfig({
  test: {
    // Dossier temporaire propre à la passe, contrôlé et supprimé au teardown
    // (scripts/test/vitest/tmp-guard.ts) : un test qui ne nettoie pas fait échouer la passe.
    globalSetup: tmpGuard(),
    ...transformCache,
    globals: true,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "src/**/*.ts"],
      exclude: ["src/interfaces/**", "**/*.d.ts", "**/dist/**"],
      reporter: ["text", "text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
});
