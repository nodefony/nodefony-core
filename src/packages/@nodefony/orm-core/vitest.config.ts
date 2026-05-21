import { defineConfig } from "vitest/config";

/**
 * vitest + coverage-v8 pour @nodefony/orm-core.
 *
 * Standard coverage du repo (cf @nodefony/framework / http) : vitest mappe le
 * coverage du source TS de façon fiable, là où monocart+mocha+tsx sous-mappe
 * (`mcr --require` bascule en CJS — cf mémoire feedback_coverage_modules).
 *
 * Tests = `node:assert` + describe/it/afterEach en **globals** (aucun import
 * mocha) → `globals: true` suffit, pas de shim ni de setup. Décorateurs orm-core
 * = WeakMap (PAS reflect-metadata) → pas de reflect au setup.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "nodefony/**/*.ts"],
      // interfaces/ = contrats type-only (effacés à la compilation) → hors métrique runtime.
      exclude: ["nodefony/interfaces/**", "**/*.d.ts", "**/dist/**"],
      reporter: ["text", "text-summary"],
      reportsDirectory: ".coverage",
    },
  },
});
