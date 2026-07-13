import { defineConfig } from "vitest/config";

/**
 * Config Vitest du module.
 *
 * ⚠️ Le bloc `oxc` est OBLIGATOIRE : Vitest transforme les tests via oxc/rolldown,
 * qui ne lit PAS le `experimentalDecorators` du tsconfig. Sans lui, les décorateurs
 * (@controller, @route, @services, DI) sortiraient bruts et Node lèverait
 * `SyntaxError` au chargement. `emitDecoratorMetadata` est requis par l'injection
 * de dépendances (résolution des types constructeur via `design:paramtypes`).
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
