import { defineConfig } from "vitest/config";

/**
 * Vitest config — @nodefony/documentation.
 *
 * Tests unitaires des briques pures : parseur de frontmatter, scanner de docs
 * (allowlist anti-traversée), résolution des variables dynamiques. Pas de
 * serveur requis : on teste la logique de data plane, pas le HTTP.
 */
export default defineConfig({
  test: {
    include: ["nodefony/tests/**/*.test.ts"],
    environment: "node",
  },
});
