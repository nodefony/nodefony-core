import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * vitest + coverage-v8 pour @nodefony/http (cf @nodefony/framework, même recette).
 * Tests mocha+chai inchangés : globals + shim `import "mocha"` + chai gardé +
 * reflect au setup + alias stubs ORM. vitest mappe le coverage là où monocart
 * échoue (--require CJS). Cf mémoire feedback_coverage_modules.
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
      mocha: r("./nodefony/tests/vitest-mocha-shim.mjs"),
      "@nodefony/sequelize": r("./nodefony/tests/stubs/sequelize.ts"),
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
