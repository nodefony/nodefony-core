import { defineConfig } from "vitest/config";
import { transformCache } from "../../../../vitest.perf";

/**
 * Vitest config — @nodefony/documentation.
 *
 * Tests unitaires des briques pures : parseur de frontmatter, scanner de docs
 * (allowlist anti-traversée), résolution des variables dynamiques. Pas de
 * serveur requis : on teste la logique de data plane, pas le HTTP.
 */
export default defineConfig({
  test: {
    ...transformCache,
    include: ["nodefony/tests/**/*.test.ts"],
    environment: "node",
  },
});
