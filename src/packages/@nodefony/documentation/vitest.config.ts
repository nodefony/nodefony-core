import { defineConfig } from "vitest/config";
import { transformCache } from "../../../../vitest.perf.ts";
import { tmpGuard } from "../../../../vitest.tmp-guard.ts";

/**
 * Vitest config — @nodefony/documentation.
 *
 * Tests unitaires des briques pures : parseur de frontmatter, scanner de docs
 * (allowlist anti-traversée), résolution des variables dynamiques. Pas de
 * serveur requis : on teste la logique de data plane, pas le HTTP.
 */
export default defineConfig({
  test: {
    // Dossier temporaire propre à la passe, contrôlé et supprimé au teardown
    // (vitest.tmp-guard.ts) : un test qui ne nettoie pas fait échouer la passe.
    globalSetup: tmpGuard(),
    ...transformCache,
    include: ["nodefony/tests/**/*.test.ts"],
    environment: "node",
  },
});
