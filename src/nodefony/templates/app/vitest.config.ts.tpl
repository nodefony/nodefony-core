import { defineConfig } from "vitest/config";

/**
 * Config Vitest de l'app.
 *
 * ⚠️ Le bloc `oxc` est OBLIGATOIRE : Vitest transforme les tests via oxc/rolldown,
 * qui ne lit PAS le `experimentalDecorators` du tsconfig. Sans lui, les décorateurs
 * (@controller, @route, DI) sortiraient bruts et Node lèverait `SyntaxError` au
 * chargement. `emitDecoratorMetadata` est requis par l'injection de dépendances
 * (résolution des types constructeur via `design:paramtypes`).
 *
 * Deux suites :
 *   npm test          → tests unitaires (rapides, zéro serveur)
 *   npm run test:e2e  → build + boot RÉEL de l'app + requêtes HTTP/WS (gate RUN_E2E)
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
