import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { oxcDecorators } from "../../scripts/test/vitest/oxc.ts";
import { transformCache } from "../../scripts/test/vitest/perf.ts";
import {
  gateReporter,
  LOKI_GATE,
  OPENSEARCH_GATE,
} from "../../scripts/test/vitest/gates.ts";
import { tmpGuard } from "../../scripts/test/vitest/tmp-guard.ts";

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
 *  - `import { assert, expect } from "vitest"` : le chai EMBARQUÉ par vitest (pas de
 *    dépendance `chai` directe).
 *  - reflect-metadata (decorators), alias `before`/`after`→`beforeAll`/`afterAll` et
 *    le perf-skip OPT-IN (`NF_RUN_PERF=1`) sont portés dans `src/tests/vitest.setup.ts`.
 *
 * Decorators : requis pour le DI (`@injectable`/`@inject`) — cf `scripts/test/vitest/oxc.ts` (racine)
 * pour le pourquoi du bloc `oxc` ci-dessous.
 */
export default defineConfig({
  test: {
    // Dossier temporaire propre à la passe, contrôlé et supprimé au teardown
    // (scripts/test/vitest/tmp-guard.ts) : un test qui ne nettoie pas fait échouer la passe.
    globalSetup: tmpGuard(
      r("./src/tests/nodeDist.global.ts"),
      r("./src/tests/symbolsGraph.global.ts"),
    ),
    ...transformCache,
    globals: true,
    // Les DEUX serveurs de logs que le cœur sait alimenter — et que rien
    // n'exigeait.
    //
    // `LogBackplaneE2E.test.ts` se saute sans ses URL et rend `0` : quatre cas
    // muets comptés comme verts. Deux passes de la forge nommaient pourtant
    // `NF_LOKI_TEST_URL` et `NF_OPENSEARCH_TEST_URL` dans `NF_GATES_ALLOW`,
    // c'est-à-dire ÉCARTAIENT une attente que personne n'avait déclarée : ce
    // fichier n'avait aucun `reporters`, donc aucun rapporteur de gates. Un
    // renoncement écrit contre une exigence absente ne garde rien.
    //
    // `proof` porte sur le nom COMPLET d'un cas PASSÉ (`fullName`), pas sur la
    // présence de la variable : c'est ce qui distingue « le décor était là » de
    // « le décor a SERVI ». Les motifs sont les titres des deux suites.
    //
    // Conséquence assumée : toute passe du cœur qui ne lève pas ces serveurs
    // doit ÉNONCER l'absence (`NF_GATES_ALLOW`), et l'échec est bloquant sous
    // `CI`. Le décor lui-même vit dans `orm.yml`, tâche « Backplane de logs ».
    //
    // L'écran sous pseudo-terminal n'est exigé que du lot `test:boot`
    // (`NF_RUN_CLI_BOOT`) : c'est lui qui démarre de vrais `nodefony development`.
    // La passe unitaire ne le réclame pas — un renoncement écrit contre une
    // exigence absente ne garde rien. Le décor est une CAPACITÉ (`script`, qui
    // fournit le terminal sous Linux et macOS), constatée par le banc : une
    // plateforme qui ne l'a pas l'énonce (`NF_GATES_ALLOW=pty`). Fonction, pas
    // liste : lue en FIN de passe.
    reporters: [
      "default",
      gateReporter(() => [
        { gate: LOKI_GATE, proof: "Loki réel" },
        { gate: OPENSEARCH_GATE, proof: "OpenSearch réel" },
        ...(process.env.NF_RUN_CLI_BOOT === "1"
          ? [
              {
                label: "Écran de développement sous pseudo-terminal",
                capability: "pty",
                proof: "sous pseudo-terminal",
              },
            ]
          : []),
      ]),
    ],
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
