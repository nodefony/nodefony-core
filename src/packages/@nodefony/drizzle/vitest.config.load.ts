import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../../vitest.oxc";

/**
 * vitest — suite de CHARGE / mémoire de @nodefony/drizzle (séparée de la
 * non-régression, équivalent de `.mocharc.load.json` retiré le 2026-05-28).
 *
 * Le test mémoire appelle `global.gc()` (mesure de fuite déterministe) → le pool
 * forké doit exposer le GC V8 via `--expose-gc`. Vitest isole les tests dans des
 * workers : on passe le flag au process fils.
 *
 * ⚠️ `execArgv` est une option de PREMIER NIVEAU depuis Vitest 4 — l'ancien
 * `poolOptions: { forks: { execArgv } }` n'est plus lu. Il ne provoque AUCUNE
 * erreur : le banc tourne, tous ses tests passent, et `globalThis.gc` vaut
 * simplement `undefined`. La sonde `heapMB()` cesse alors de forcer le ramassage
 * et mesure les déchets en attente au lieu du heap vivant — c'est-à-dire qu'elle
 * mesure autre chose que ce dont le seuil parle. Constaté en intégration
 * continue : « fuite mémoire suspectée : heapΔ 47.5MB (seuil 40MB) » sur un
 * dépôt sans fuite, et le seul indice était une ligne `DEPRECATED` dans la
 * sortie. Un flag de mesure qui ne s'applique plus est le pire mode de
 * défaillance d'un banc : il ne dit rien, et son verdict devient du bruit.
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
    execArgv: ["--expose-gc"],
  },
  // Le banc porte des décorateurs (`@entity`) : sans ce bloc, oxc les émet bruts
  // et Node lève `SyntaxError` À LA COLLECTE — banc muet, 0 test compté.
  oxc: oxcDecorators,
});
