import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../../vitest.oxc";

/**
 * vitest pour @nodefony/drizzle — suite d'intégration (convention-frère orm-core).
 *
 * Banc orm-core↔drizzle + jointures complexes sur `better-sqlite3` `:memory:`
 * (driver natif). Tests = `node:assert` + describe/it/beforeAll/afterAll en
 * **globals** (aucun import mocha) → `globals: true` suffit.
 *
 * La suite de CHARGE (`tests/load/`, expose-gc) est séparée dans
 * `vitest.config.load.ts` (`npm run test:load`) — non lancée en non-régression.
 *
 * Migré de Mocha (`.mocharc.json` supprimé) le 2026-05-28 : Vitest = runner
 * canonique du repo (cf feedback_test_framework_vitest), Mocha = legacy.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // FICHIERS SÉRIALISÉS — non négociable tant que les bancs PG/MySQL visent la
    // MÊME base réelle. Plusieurs fichiers portent des connecteurs distincts
    // (`tokens_pg`, `token_pagination_pg`…) mais retombent sur la même table
    // physique (`access_token`) : en parallèle, la purge de l'un efface le seed
    // de l'autre et son `COUNT` compte les lignes du voisin → vert en isolation,
    // rouge en suite, le pire des symptômes (on soupçonne le code, le coupable
    // est le banc). Les autres modules s'isolent par base (`mongoTestUri`) ou par
    // index (`redisTestUrl`) ; ici l'utilisateur applicatif n'a pas le droit de
    // créer une base sous MySQL/MariaDB (`ERROR 1044`), donc on sérialise —
    // UNE règle qui vaut pour les 3 dialectes et protège d'office tout banc
    // futur. Coût mesuré : ~62 s au lieu de ~21 s sur la suite complète.
    fileParallelism: false,
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
      thresholds: { lines: 75, statements: 75, functions: 75, branches: 57 },
    },
  },
  oxc: oxcDecorators,
});
