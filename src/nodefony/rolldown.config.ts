/**
 * rolldown.config.ts — build du core `nodefony` (4 bundles).
 *
 * Seul bundler du dépôt : le DevSupervisor rebuild par `rolldown -c`, comme
 * `npm run build`.
 *
 * Les `.d.ts` ne sont PAS générés ici : `tsgo -p tsconfig.declarations.json`
 * (node) et `tsgo -p tsconfigClient.json` (client) — voir scripts package.json.
 * Les décorateurs legacy sont lus par rolldown depuis le tsconfig de chaque
 * bundle (option `tsconfig`).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "rolldown";
import type { RolldownOptions, Plugin } from "rolldown";
// SOURCE relative (pas le subpath `nodefony/bundler`) : le core ne peut pas
// importer son propre dist avant de l'avoir buildé (clean build).
import {
  nodefonyExternalMatcher,
  nodefonyTreeshake,
} from "./src/bundler/index";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const external: string[] = [
  "nodefony",
  "rolldown",
  "figlet",
  "cli-table3",
  "commander",
  "@inquirer/prompts",
  "mime-types",
  "semver",
  "reflect-metadata",
  "eta",
  "chokidar",
  "tslib",
  "zod",
];

// ─── 1. Node ESM (dist/node/) ─────────────────────────────────────────────────
// `src/bundler/index.ts` = entrée SÉPARÉE (subpath `nodefony/bundler`) : jamais
// réexportée par `src/index.ts` — elle importe `rolldown` (peerDep optionnelle),
// le barrel principal ne doit pas le tirer.
const nodeConfig: RolldownOptions = defineConfig({
  input: ["src/index.ts", "src/bundler/index.ts", "src/testing/index.ts"],
  platform: "node",
  tsconfig: "tsconfig.json",
  external: nodefonyExternalMatcher(external),
  treeshake: nodefonyTreeshake,
  output: {
    dir: "dist",
    entryFileNames: "node/[name].js",
    format: "esm",
    sourcemap: false,
    preserveModules: true,
    preserveModulesRoot: "src",
  },
});

// ─── 2. Binary CLI (bin/nodefony) ─────────────────────────────────────────────
const binConfig: RolldownOptions = defineConfig({
  input: "src/bin/nodefony.ts",
  platform: "node",
  tsconfig: "src/config/tsconfig.bin.json",
  external: nodefonyExternalMatcher(external),
  treeshake: nodefonyTreeshake,
  output: {
    file: "bin/nodefony",
    format: "esm",
    banner: "#!/usr/bin/env node",
    exports: "default",
    sourcemap: false,
  },
});

// ─── 3. Client ESM (dist/client/) — import conditionnel "browser" ────────────
// Shim browser : `node:util` (dont `styleText` pour la façade couleur),
// `node:events` → versions navigateur. Conservé tel quel de Rollup (API plugin
// compatible) ; `rollup-plugin-polyfill-node` devient inutile (platform browser).
const browserShim: Plugin = {
  name: "nodefony-browser-shim",
  resolveId(source: string) {
    if (source === "node:util")
      return path.resolve(__dirname, "src/client/shim/util.ts");
    if (source === "node:events")
      return path.resolve(__dirname, "src/client/shim/events.ts");
    return null;
  },
};

// `react`, `vue` et `@angular/*` = peerDeps OPTIONNELLES des subpaths
// `nodefony/react`, `nodefony/vue` et `nodefony/angular` → externes (jamais
// bundlées ; c'est l'app qui les fournit). Une seule copie de chaque runtime
// doit vivre dans la page : bundler la nôtre donnerait deux runtimes réactifs
// qui ne se voient pas l'un l'autre — et, pour Angular, deux injecteurs.
const clientExternal = (id: string): boolean =>
  id === "react" ||
  id === "react-dom" ||
  id.startsWith("react/") ||
  id.startsWith("react-dom/") ||
  id === "vue" ||
  id.startsWith("vue/") ||
  id.startsWith("@angular/");

const clientConfig: RolldownOptions = defineConfig({
  // Multi-entry : `index` (barrel browser `nodefony`) + `debugbar` + `react` +
  // `vue` + `angular` + `roles` (subpaths). preserveModules → RealtimeClient
  // partagé émis 1×. Les subpaths ne sont JAMAIS réexportés depuis
  // client/index.ts.
  input: [
    "src/client/index.ts",
    "src/client/debugbar/index.ts",
    "src/client/react/index.ts",
    "src/client/vue/index.ts",
    "src/client/angular/index.ts",
    "src/client/roles/index.ts",
  ],
  platform: "browser",
  tsconfig: "tsconfigClient.json",
  external: clientExternal,
  output: {
    dir: "dist/client",
    entryFileNames: "[name].js",
    format: "esm",
    sourcemap: false,
    preserveModules: true,
    preserveModulesRoot: "src",
  },
  plugins: [browserShim],
});

// ─── 4. Debug bar STANDALONE (dist/client/debugbar.standalone.js) ────────────
// Bundle mono-fichier (deps inlinées) du subpath `nodefony/debugbar` — pour
// l'inclure via un simple <script type="module"> sur une page rendue serveur,
// SANS Vite ni résolution d'imports relatifs.
const debugbarStandaloneConfig: RolldownOptions = defineConfig({
  input: "src/client/debugbar/index.ts",
  platform: "browser",
  tsconfig: "tsconfigClient.json",
  output: {
    file: "dist/client/debugbar.standalone.js",
    format: "esm",
    sourcemap: false,
  },
  plugins: [browserShim],
});

export default [nodeConfig, binConfig, clientConfig, debugbarStandaloneConfig];
