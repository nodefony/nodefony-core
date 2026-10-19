import { defineConfig } from "vitest/config";
import { tmpGuard } from "./tmp-guard.ts";

/**
 * Config des suites lancées depuis la RACINE (`test:tooling`, `test:release`,
 * `test:pilotage`…) : les réglages par défaut de vitest, plus la garde des
 * dossiers temporaires et le cache de transformation ÉTEINT — rien d'autre.
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
  },
});
