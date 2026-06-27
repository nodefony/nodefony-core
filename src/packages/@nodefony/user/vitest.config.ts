import { defineConfig } from "vitest/config";

/**
 * vitest + coverage-v8 pour @nodefony/user.
 *
 * Standard coverage du repo (cf @nodefony/framework / http). Tests = `node:assert`
 * + describe/it en **globals** → `globals: true` suffit (pas de shim mocha, pas de
 * setup reflect-metadata : ce module n'a pas de décorateurs).
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "nodefony/**/*.ts"],
      // contracts/ = type-only (IUser, IPasswordEncoder…) → hors métrique runtime.
      exclude: ["nodefony/contracts/**", "**/*.d.ts", "**/dist/**"],
      // json-summary + lcov = fichiers lus par Studio (onglet Coverage) ; sans eux
      // `npm run coverage` n'écrit rien dans .coverage/ → onglet absent.
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
});
