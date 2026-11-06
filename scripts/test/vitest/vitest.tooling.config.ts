import { defineConfig } from "vitest/config";
import { tmpGuard } from "./tmp-guard.ts";

/**
 * Config des suites lancées depuis la RACINE (`test:tooling`, `test:release`,
 * `test:pilotage`…) : les réglages par défaut de vitest, plus la garde des
 * dossiers temporaires, le cache de transformation ÉTEINT et un délai par test
 * à la mesure des processus lancés — rien d'autre.
 *
 * Nommée et passée par `--config`, jamais `vitest.config.ts` : un nom par défaut
 * serait lu en silence par toute commande vitest lancée à la racine.
 *
 *  npm run test:tooling             // et les six autres scripts `test:*` lancés depuis la racine
 *
 * @usage npm run test:tooling             // et les six autres scripts test:* lancés depuis la racine
 */
export default defineConfig({
  test: {
    globalSetup: tmpGuard(),
    // Écrit, jamais laissé au défaut : vitest 5 ACTIVE ce cache, à la RACINE
    // (`node_modules/.vitest-cache`), partagé avec les suites lancées en même
    // temps — un nettoyage concurrent y a fait échouer un démarrage (ENOTEMPTY).
    fsModuleCache: false,
    // Ces suites éprouvent des SCRIPTS : beaucoup de cas lancent un processus
    // Node ou un shell. Sous la charge d'une passe parallèle, ce démarrage seul
    // dépasse le défaut de 5 s — des tests verts isolément tombaient en
    // `Test timed out` (bench-out, deps-gate, long-run-lock, site-versions).
    // Un seul délai pour la famille, plutôt qu'un réglage recopié par fichier.
    testTimeout: 20_000,
  },
});
