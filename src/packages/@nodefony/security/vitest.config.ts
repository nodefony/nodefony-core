import { defineConfig } from "vitest/config";

/**
 * vitest + coverage-v8 pour @nodefony/security.
 *
 * Standard coverage du repo (cf @nodefony/user / framework). Tests = `node:assert`
 * + describe/it en **globals** → `globals: true` suffit.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "nodefony/**/*.ts"],
      // contracts/ = type-only → hors métrique runtime.
      exclude: ["nodefony/contracts/**", "**/*.d.ts", "**/dist/**"],
      // json-summary + lcov = fichiers lus par Studio (readCoverage : .coverage/
      // coverage-summary.json puis lcov.info) ; text-summary = console. Sans les
      // reporters fichiers, `npm run coverage` n'écrit rien → onglet Coverage vide.
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
});
