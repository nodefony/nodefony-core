import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../../vitest.oxc";
import { gateReporter, MONGO_GATE } from "../../../../vitest.gates";

/**
 * vitest pour @nodefony/mongoose (convention-frère @nodefony/orm-core).
 *
 * - `tests/unit/` : rapide, sans serveur (config Zod) ;
 * - `tests/integration/` : `mongodb-memory-server` (ReplSet = mongod réel, requis
 *   pour les transactions ; le banc session = standalone, hybride `NF_MONGO_TEST_URI`).
 *
 * Tests = `node:assert` + describe/it/beforeAll/afterAll en **globals** (aucun
 * import mocha) → `globals: true` suffit. `testTimeout` élargi : le 1ᵉʳ run
 * d'intégration télécharge le binaire mongod (memory-server).
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // UN SEUL mongod partagé pour TOUS les bancs d'intégration (provisionné 1×)
    // → supprime la contention du multi-spawn (4-6 mongod concurrents sous
    // `npm run test` racine/turbo = cause des échecs flaky). Skip propre si
    // l'infra manque (provide `mongoUri = null`).
    globalSetup: ["./tests/globalSetup.ts"],
    // Séquentiel : les fichiers tapent le MÊME serveur partagé → la
    // parallélisation entremêlerait collections + registres process-wide.
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
    // Dit à voix haute quand MongoDB n'a PAS été exercé : le repli
    // `mongodb-memory-server` skippe en silence quand il échoue, et une suite
    // verte ne prouve alors que la config Zod.
    //
    // La `proof` couvre précisément ce repli. La variable, elle, ne dit rien de
    // ce cas : sans elle un binaire éphémère prend le relais et les 168 cas
    // tournent quand même — mais s'il ne peut pas se télécharger, TOUS les bancs
    // d'intégration sautent (`describe.skipIf(!URI)`) et la suite reste verte en
    // n'ayant prouvé qu'un schéma Zod. Exiger qu'un banc de store ait
    // réellement PASSÉ est la seule affirmation que ce silence ne satisfait pas.
    reporters: [
      "default",
      gateReporter([
        {
          gate: MONGO_GATE,
          proof: "MongooseTokenStore — ITokenStore portable",
        },
      ]),
    ],
    coverage: {
      provider: "v8",
      // `all` = compter aussi les fichiers non importés (garde-fou honnête).
      all: true,
      include: ["index.ts", "nodefony/**/*.ts"],
      exclude: ["nodefony/interfaces/**", "**/*.d.ts", "**/dist/**"],
      // json-summary + lcov = fichiers lus par Studio (onglet Coverage) ; sans eux
      // `npm run coverage` n'écrit rien dans .coverage/ → onglet absent.
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
      // Plancher CI (≈ mesuré − 3 pts). À relever au fil des tests.
      thresholds: { lines: 72, statements: 72, functions: 66, branches: 58 },
    },
  },
  // Les bancs `@entity(...)` (advanced, orm-core-mongoose) portent des décorateurs :
  // sans ce bloc, oxc les émet bruts et Node lève `SyntaxError` À LA COLLECTE — le
  // fichier entier est muet sans qu'aucun test ne soit compté comme échoué.
  oxc: oxcDecorators,
});
