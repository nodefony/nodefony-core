import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * vitest + coverage-v8 pour @nodefony/http (cf @nodefony/framework, même recette).
 * Suite UNIT (composants purs, sans serveur). globals + chai + reflect au setup +
 * alias stubs ORM. Intégration → vitest.integration.config.ts ; charge/mémoire →
 * vitest.load.config.ts. Cf mémoire feedback_test_framework_vitest.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["nodefony/tests/unit/**/*.test.ts"],
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
    coverage: {
      provider: "v8",
      include: ["nodefony/**/*.ts"],
      exclude: ["nodefony/tests/**", "**/dist/**", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
  resolve: {
    alias: {
      "@nodefony/sequelize": r("./nodefony/tests/stubs/sequelize.ts"),
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
