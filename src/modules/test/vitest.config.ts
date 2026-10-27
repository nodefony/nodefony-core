import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../scripts/test/vitest/oxc.ts";
import { transformCache } from "../../../scripts/test/vitest/perf.ts";
import { tmpGuard } from "../../../scripts/test/vitest/tmp-guard.ts";

/**
 * vitest pour le module `test`.
 *
 * **Ce fichier existe parce que le module n'en avait pas.** Son script `test`
 * était `node -e "console.log('test')"` : rien ne pouvait s'exécuter ici, et
 * les suites présentes sur le poste ne l'avaient jamais été une seule fois.
 *
 * ⚠️ `--passWithNoTests` (côté script npm) n'est PAS une commodité, c'est une
 * contrainte de LICENCE. Le corpus du banc ORM vit sous
 * `nodefony/entity/benchCorpus/`, que `.gitignore` exclut sciemment : ce schéma est
 * dérivé GPLv3 et le dépôt est publié sous Apache 2.0. Ce dossier est donc ABSENT
 * de tout clone — un test qui y vivrait ne tournerait que sur la machine qui
 * possède le corpus, et une suite réduite à lui sortirait en code 1 (« No test
 * files found ») partout ailleurs. C'est très exactement le rouge que ce
 * `.gitignore` raconte avoir déjà coûté deux mois.
 *
 * Pour la même raison, aucun `gateReporter` ici : il ne peut pas réclamer la
 * preuve de cas qui, par construction, ne sont pas dans le dépôt.
 */
export default defineConfig({
  test: {
    // Dossier temporaire propre à la passe, contrôlé et supprimé au teardown
    // (scripts/test/vitest/tmp-guard.ts) : un test qui ne nettoie pas fait échouer la passe.
    globalSetup: tmpGuard(),
    ...transformCache,
    globals: true,
    include: ["nodefony/**/*.test.ts"],
    // Le banc de charge sème ~2 000 sociétés et leurs factures avant le premier
    // cas : le défaut de 5 s tombe pendant l'amorçage, pas pendant la mesure.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
  oxc: oxcDecorators,
});
