import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodePolyfills from "rollup-plugin-polyfill-node";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const external: string[] = [
  "nodefony",
  "asciify",
  "cli-color",
  "cli-table3",
  "clui",
  "commander",
  "@inquirer/prompts",
  "lodash",
  "lodash-es",
  "mime-types",
  "moment",
  "glob",
  "node-emoji",
  "node-fetch",
  "rxjs",
  "semver",
  "shelljs",
  "uuid",
  "twig",
  "ejs",
  "pm2",
  "pug",
  "rollup",
  "chokidar",
  "terser",
  "typedoc",
  "typedoc-plugin-markdown",
  "@rollup/plugin-typescript",
  "@rollup/plugin-node-resolve",
  "@rollup/plugin-commonjs",
  "@rollup/plugin-json",
  "@rollup/plugin-replace",
  "@rollup/plugin-terser",
  "@babel/parser",
  "@babel/traverse",
  "@babel/generator",
  "tslib",
];

const treeshakeOptions = defineConfig({
  treeshake: {
    moduleSideEffects: "no-external",
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
}).treeshake;

function onwarn(
  warning: { message: string; code?: string },
  warn: (w: typeof warning) => void,
): void {
  if (warning.message.includes("Circular dependency")) return;
  if (warning.code === "EVAL") return;
  // TS5055: declarationDir conflict when bin bundle loads the types just generated
  if (warning.message.includes("TS5055")) return;
  // TS5069: declarationDir hérité du tsconfig sur le bundle standalone (declaration:false)
  if (warning.message.includes("TS5069")) return;
  warn(warning);
}

// ─── 1. Node ESM (dist/node/) ─────────────────────────────────────────────────
function createNodePlugins(
  sourceMap: boolean,
  declarationDir: string | false,
): Plugin[] {
  return [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve(__dirname, "tsconfig.json"),
      sourceMap,
      rootDir: "./src",
      outDir: "./dist",
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined,
    }),
    commonjs({ extensions: [".js"] }),
    json(),
  ];
}

function createNodeConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    input: "src/index.ts",
    treeshake: treeshakeOptions,
    onwarn,
    output: {
      dir: "./dist",
      entryFileNames: "node/[name].js",
      format: "esm",
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: "src",
      externalLiveBindings: false,
      freeze: false,
    },
    external: (id) =>
      id !== "." &&
      external.some(
        (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
      ),
    plugins: createNodePlugins(!isProduction, "dist/types"),
  });
}

// ─── 2. Binary CLI (bin/nodefony) ─────────────────────────────────────────────
function createBinaryConfig(_isProduction: boolean): RollupOptions {
  return defineConfig({
    input: "src/bin/nodefony.ts",
    treeshake: treeshakeOptions,
    onwarn,
    output: {
      file: "./bin/nodefony",
      format: "esm",
      banner: "#!/usr/bin/env node",
      sourcemap: false,
      exports: "default",
    },
    external: (id) =>
      id !== "." &&
      external.some(
        (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
      ),
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      typescript({
        tsconfig: path.resolve(__dirname, "src/config/tsconfig.bin.json"),
      }),
      json(),
    ],
  });
}

// ─── 3. Client ESM (dist/client/) — import conditionnel "browser" ────────────
// Shim browser : `cli-color`, `node:util`, `node:events` → versions navigateur.
const browserShim: Plugin = {
  name: "nodefony-browser-shim",
  resolveId(source: string) {
    if (source === "cli-color")
      return path.resolve(__dirname, "src/client/shim/cli-color.ts");
    if (source === "node:util")
      return path.resolve(__dirname, "src/client/shim/util.ts");
    if (source === "node:events")
      return path.resolve(__dirname, "src/client/shim/events.ts");
    return null;
  },
};

function createClientConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    // Multi-entry : `index` (barrel browser `nodefony`) + `debugbar` (subpath
    // `nodefony/debugbar`) + `react` (subpath `nodefony/react`). preserveModules
    // → RealtimeClient partagé, émis 1× (0 duplication). Les subpaths ne sont
    // JAMAIS réexportés depuis client/index.ts.
    input: [
      "src/client/index.ts",
      "src/client/debugbar/index.ts",
      "src/client/react/index.ts",
    ],
    onwarn,
    // `react` = peerDep OPTIONNELLE du subpath `nodefony/react` → externe
    // (jamais bundlée ; c'est l'app qui fournit React).
    external: (id) =>
      id === "react" ||
      id === "react-dom" ||
      id.startsWith("react/") ||
      id.startsWith("react-dom/"),
    output: {
      dir: "./dist/client",
      entryFileNames: "[name].js",
      format: "esm",
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: "src",
    },
    plugins: [
      browserShim,
      nodePolyfills(),
      nodeResolve({ browser: true, preferBuiltins: false }),
      typescript({
        tsconfig: path.resolve(__dirname, "tsconfigClient.json"),
        declaration: true,
        declarationDir: "dist/client/types",
      }),
      json(),
    ],
  });
}

// ─── 4. Debug bar STANDALONE (dist/client/debugbar.standalone.js) ────────────
// Bundle mono-fichier (deps inlinées) du subpath `nodefony/debugbar` — pour
// l'inclure via un simple <script type="module"> sur une page rendue serveur
// (EJS/Twig/HTML statique), SANS Vite ni résolution d'imports relatifs.
function createDebugbarStandaloneConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    input: "src/client/debugbar/index.ts",
    onwarn,
    output: {
      file: "./dist/client/debugbar.standalone.js",
      format: "esm",
      sourcemap: !isProduction,
    },
    plugins: [
      browserShim,
      nodePolyfills(),
      nodeResolve({ browser: true, preferBuiltins: false }),
      typescript({
        tsconfig: path.resolve(__dirname, "tsconfigClient.json"),
        declaration: false,
      }),
      json(),
    ],
  });
}

export default (commandLineArgs: Record<string, unknown>): RollupOptions[] => {
  const isProduction = !commandLineArgs["watch"];
  return [
    createNodeConfig(isProduction),
    createBinaryConfig(isProduction),
    createClientConfig(isProduction),
    createDebugbarStandaloneConfig(isProduction),
  ];
};
