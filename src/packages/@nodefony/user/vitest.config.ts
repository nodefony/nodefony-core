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
    // ⏱️ Plafond d'ATTENTE, pas seuil de mesure — la distinction décide si
    // l'allonger est honnête ou non. Aucun cas ici n'asserte une durée : ceux
    // qui dépassent attendent un travail DÉLÉGUÉ dont la latence appartient à
    // la machine — le pool de threads que bcrypt natif occupe. Vécu : verts en isolation,
    // rouges sous `npm test`, où turbo lance les 21 espaces de travail en
    // parallèle et sature ce qu'ils attendent. Le défaut de 5 s mesurait donc
    // la charge du moment. Un vrai blocage reste attrapé, très en deçà.
    testTimeout: 30000,
    hookTimeout: 30000,
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
