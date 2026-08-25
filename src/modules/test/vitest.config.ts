import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../vitest.oxc";

/**
 * vitest pour le module `test`.
 *
 * **Ce fichier existe parce que le module n'en avait pas.** Son script `test`
 * était `node -e "console.log('test')"` : rien ne pouvait s'exécuter ici, et
 * les suites présentes sur le poste ne l'avaient jamais été une seule fois.
 *
 * ⚠️ `--passWithNoTests` (côté script npm) n'est PAS une commodité, c'est une
 * contrainte de LICENCE. Les bancs du gros schéma Dolibarr vivent sous
 * `nodefony/entity/dolibarr/`, que `.gitignore` exclut sciemment : ce schéma est
 * dérivé GPLv3 et le dépôt est publié sous CeCILL-B. Ce dossier est donc ABSENT
 * de tout clone — sans ce drapeau, `vitest` y sort en code 1 (« No test files
 * found ») et rendrait `npm test` rouge partout sauf sur la machine qui possède
 * la fixture. C'est très exactement le rouge que ce `.gitignore` raconte avoir
 * déjà coûté deux mois.
 *
 * Pour la même raison, aucun `gateReporter` ici : il ne peut pas réclamer la
 * preuve de cas qui, par construction, ne sont pas dans le dépôt.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["nodefony/**/*.test.ts"],
    // Le banc de charge sème ~2 000 sociétés et leurs factures avant le premier
    // cas : le défaut de 5 s tombe pendant l'amorçage, pas pendant la mesure.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
  oxc: oxcDecorators,
});
