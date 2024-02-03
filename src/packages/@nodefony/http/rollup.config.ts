// rollup.config.ts
import path from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import copy from "rollup-plugin-copy";

const external: string[] = [
  "nodefony",
  "cli-color",
  "cookie",
  "formidable",
  "memcached",
  "mime",
  "mkdirp",
  "ms",
  "node-fetch",
  "qs",
  "serve-static",
  "sockjs",
  "websocket",
  "node-forge",
  "http-terminator",
  "mime-types",
  "uuid",
  "xml2js",
];

const sharedNodeOptions = defineConfig({
  treeshake: {
    moduleSideEffects: "no-external",
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
  output: {
    dir: "./dist",
    entryFileNames: `[name].js`,
    //chunkFileNames: "node/chunks/dep-[hash].js",
    exports: "auto",
    format: "esm",
    externalLiveBindings: false,
    freeze: false,
  },
  onwarn(warning, warn) {
    if (warning.message.includes("Circular dependency")) {
      return;
    }
    warn(warning);
  },
});

function createNodePlugins(
  isProduction: boolean,
  sourceMap: boolean,
  declarationDir: string | false
): Plugin[] {
  const tab = [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve("tsconfig.json"),
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined,
    }),
    commonjs({
      extensions: [".js"],
      //ignoreDynamicRequires: true
      dynamicRequireTargets: [],
    }),
    json(),
    copy({
      targets: [],
    }),
  ];
  if (isProduction) {
    //tab.push(terser());
  }
  return tab;
}

function createNodeConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    //input,
    input: "./index.ts",
    ...sharedNodeOptions,
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
      //preserveModules: true,
      //preserveModulesRoot: "src",
    },
    external,
    plugins: [...createNodePlugins(isProduction, true, "dist/types")],
  });
}

export default (commandLineArgs: any): RollupOptions[] => {
  const isDev = commandLineArgs.watch;
  const isProduction = !isDev;
  return defineConfig([
    //envConfig,
    createNodeConfig(isProduction),
  ]);
};
