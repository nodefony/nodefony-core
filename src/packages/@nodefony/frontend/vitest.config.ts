import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * vitest + coverage-v8 pour @nodefony/frontend.
 *
 * Mirror simplifié de la config framework : ici les tests unit importent la
 * SOURCE pure (ViteConfigGenerator.ts → node:path + une classe d'erreur), pas
 * le dist Rollup de @nodefony/http → pas besoin d'aliaser un stub ORM.
 *
 * Compat mocha+chai sans réécriture :
 *  - `globals: true` → describe/it globaux.
 *  - `import "mocha"` aliasé vers un shim vide.
 *  - `expect` de chai importé explicitement (marche tel quel).
 *
 * Couverture d'intégration (ViteProcessSupervisor = process Vite séparé) :
 * volontairement NON instrumentée → split documenté (cf MEMORY.md du module).
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["nodefony/tests/unit/**/*.test.ts"],
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
    coverage: {
      provider: "v8",
      include: ["nodefony/**/*.ts"],
      exclude: ["nodefony/tests/**", "**/dist/**", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
  resolve: {
    alias: {},
  },
});
