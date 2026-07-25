import { defineConfig } from "vitest/config";

/**
 * Config Vitest des tests E2E — la SEULE porte vers les tests à boot réel
 * (exclus de `vitest.config.ts`). L'invoquer, c'est vouloir un boot réel :
 * `npm run test:e2e` (le build précède — un serveur spawné valide le DIST).
 *
 * L'application est démarrée UNE fois par `tests/e2e.setup.ts`, pas par chaque
 * fichier : `create entity` ajoute un fichier E2E par ressource, et un
 * démarrage par fichier rendrait la suite inutilisable.
 *
 * `fileParallelism: false` : tous les fichiers parlent au MÊME serveur. En
 * parallèle, deux fichiers qui créent puis comptent des enregistrements se
 * verraient mutuellement — les listes paginées deviendraient instables.
 *
 * Timeouts larges : un `nodefony production --detach --wait` compile puis
 * sonde la readiness — c'est un vrai démarrage, pas un test unitaire.
 */
export default defineConfig({
  test: {
    include: ["tests/e2e.test.ts", "tests/**/*.e2e.test.ts"],
    globalSetup: ["tests/e2e.setup.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
