import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * vitest + coverage-v8 pour @nodefony/http (cf @nodefony/framework, même recette).
 * Suite UNIT (composants purs, sans serveur). globals + chai + reflect au setup +
 * alias stubs ORM. Intégration → vitest.integration.config.ts ; charge/mémoire →
 * vitest.load.config.ts. Cf mémoire feedback_test_framework_vitest.
 */
export default defineConfig({
  test: {
    globals: true,
    // Un worker par FICHIER coûtait la moitié de la suite (spawn + réévaluation du
    // graphe) : `vitest doctor` mesure −40 à −50 % avec des workers partagés, et
    // a rejoué la suite deux fois en ordre mélangé sans qu'un test dépende de
    // l'isolation. Un test qui s'en met à dépendre se voit : rétablir `true` ET
    // nommer le coupable, jamais l'inverse.
    isolate: false,
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
    alias: {
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
