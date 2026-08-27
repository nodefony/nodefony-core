import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { oxcDecorators } from "../../vitest.oxc";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Vitest du workspace core `nodefony` — remplace mocha (`.mocharc.cjs` +
 * `perf-skip.cjs`). Migration vers Vitest 4 (ESM-natif, esbuild) : aligne le core
 * sur le reste du repo et retire `mocha` du `node_modules` (avec lui les transitifs
 * vulnérables `diff` + `serialize-javascript`).
 *
 * Compat des tests mocha+chai EXISTANTS sans réécriture de masse :
 *  - `globals: true` → `describe`/`it`/`beforeEach`/`afterEach` globaux (comme mocha).
 *  - `import "mocha"` (et `import { describe, it } from "vitest"`) aliasé vers le shim
 *    `vitest-mocha-shim.mjs` (re-export des équivalents vitest).
 *  - `import { assert, expect } from "chai"` : chai (lib d'assertion) reste tel quel.
 *  - reflect-metadata (decorators), alias `before`/`after`→`beforeAll`/`afterAll` et
 *    le perf-skip OPT-IN (`NF_RUN_PERF=1`) sont portés dans `src/tests/vitest.setup.ts`.
 *
 * Decorators : requis pour le DI (`@injectable`/`@inject`) — cf `vitest.oxc.ts` (racine)
 * pour le pourquoi du bloc `oxc` ci-dessous.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["src/tests/**/*.test.ts"],
    setupFiles: [r("./src/tests/vitest.setup.ts")],
    // ⏱️ Plafond d'ATTENTE, pas seuil de mesure — la distinction décide si
    // l'allonger est honnête ou non. Aucun cas ici n'asserte une durée : ceux
    // qui dépassent attendent un travail DÉLÉGUÉ dont la latence appartient à
    // la machine — un process `prettier` externe, un `npm` réel. Vécu : verts en isolation,
    // rouges sous `npm test`, où turbo lance les 21 espaces de travail en
    // parallèle et sature ce qu'ils attendent. Le défaut de 5 s mesurait donc
    // la charge du moment. Un vrai blocage reste attrapé, très en deçà.
    // Svelte publie DEUX constructions derrière le même spécificateur, et
    // choisit par condition d'export : `browser` rend `mount()`, tout le reste
    // rend la construction serveur, où `mount()` LÈVE. Vitest exécute par le
    // pipeline SSR de Vite, donc il prend la seconde — et le banc Svelte
    // échouait sur « lifecycle_function_unavailable », ce qui ressemble à un
    // défaut de la liaison alors que c'est une résolution de module.
    //
    // Deux ancres EXACTES plutôt qu'une condition globale : `conditions:
    // ["browser"]` s'appliquerait à toutes les dépendances de toute la suite du
    // cœur, pour le besoin d'un seul fichier. Et des ancres par PRÉFIXE
    // détourneraient `svelte/internal/client` — celui qu'importent les fixtures
    // compilées, et qui n'a qu'une seule construction.
    alias: [
      {
        find: /^svelte$/,
        replacement: r("../../node_modules/svelte/src/index-client.js"),
      },
      {
        find: /^svelte\/reactivity$/,
        replacement: r(
          "../../node_modules/svelte/src/reactivity/index-client.js",
        ),
      },
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/tests/**", "src/bin/**", "**/dist/**", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
  // Le compilateur Svelte, pour le SEUL banc qui en a besoin
  // (`clientSvelte.test.ts` et sa fixture `.svelte`).
  //
  // Pourquoi une fixture COMPILÉE plutôt qu'un simulacre : les runes et les
  // effets de Svelte n'existent qu'APRÈS compilation. Un harnais qui les
  // imiterait mesurerait le harnais. Or ce que ce banc doit prouver — l'instant
  // où l'abonnement est pris, et celui où il est rendu — est décidé par le
  // système d'effets réel, pas par la liaison.
  //
  // Le plugin ne touche que les `.svelte` : les autres bancs ne le voient pas.
  plugins: [svelte({ compilerOptions: { dev: false } })],
  oxc: oxcDecorators,
  resolve: {
    alias: {},
  },
});
