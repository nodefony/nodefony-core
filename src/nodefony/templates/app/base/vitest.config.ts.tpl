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
 * Deux suites, deux configs :
 *   npm test          → tests unitaires (rapides, zéro serveur) — CETTE config
 *   npm run test:e2e  → build + boot RÉEL de l'app + HTTP/WS (vitest.e2e.config.ts)
 *
 * Les e2e sont SORTIS du glob par défaut, pas « skippés » : un rapport qui
 * affiche des tests skipped et sort vert fait croire qu'ils ont prouvé quelque
 * chose. Ici `npm test` ne montre QUE ce qu'il a réellement exécuté.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/e2e.test.ts",
      // Tout fichier `*.e2e.test.ts` — `create entity` en ajoute un par
      // ressource. Sans cette ligne, `npm test` les lancerait sans serveur et
      // échouerait sur des `fetch` refusés, pour une raison sans rapport avec
      // le code testé.
      "tests/**/*.e2e.test.ts",
    ],
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
