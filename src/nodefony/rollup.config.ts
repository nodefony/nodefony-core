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
  warn: (w: typeof warning) => void
): void {
  if (warning.message.includes("Circular dependency")) return;
  if (warning.code === "EVAL") return;
  // TS5055: declarationDir conflict when bin bundle loads the types just generated
  if (warning.message.includes("TS5055")) return;
  warn(warning);
}

// ─── 1. Node ESM (dist/node/) ─────────────────────────────────────────────────
function createNodePlugins(
  sourceMap: boolean,
  declarationDir: string | false
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
    external,
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
    external,
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
function createClientConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    input: "src/client/index.ts",
    onwarn,
    external: ["cli-color"],
    output: {
      dir: "./dist/client",
      entryFileNames: "[name].js",
      format: "esm",
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: "src",
    },
    plugins: [
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

export default (commandLineArgs: Record<string, unknown>): RollupOptions[] => {
  const isProduction = !commandLineArgs["watch"];
  return [
    createNodeConfig(isProduction),
    createBinaryConfig(isProduction),
    createClientConfig(isProduction),
  ];
};
