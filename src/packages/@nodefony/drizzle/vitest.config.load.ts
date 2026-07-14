import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../../vitest.oxc";

/**
 * vitest — suite de CHARGE / mémoire de @nodefony/drizzle (séparée de la
 * non-régression, équivalent de `.mocharc.load.json` retiré le 2026-05-28).
 *
 * Le test mémoire appelle `global.gc()` (mesure de fuite déterministe) → le pool
 * forké doit exposer le GC V8 via `--expose-gc`. Vitest isole les tests dans des
 * workers : on passe le flag au pool `forks`.
 *
 * `npm run test:load` (PAS lancé en non-régression — suite lourde, cf doctrine
 * perf opt-in feedback_perf_tests_optin).
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/load/**/*.test.ts"],
    testTimeout: 180000,
    hookTimeout: 180000,
    pool: "forks",
    poolOptions: {
      forks: { execArgv: ["--expose-gc"] },
    },
  },
  // Le banc porte des décorateurs (`@entity`) : sans ce bloc, oxc les émet bruts
  // et Node lève `SyntaxError` À LA COLLECTE — banc muet, 0 test compté.
  oxc: oxcDecorators,
});
