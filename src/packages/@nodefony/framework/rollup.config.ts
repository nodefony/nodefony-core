// rollup.config.ts
import path, { resolve } from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
//import commonjs from "@rollup/plugin-commonjs";
//import copy from "rollup-plugin-copy";
//@ts-ignore
import { createPathTransform } from "rollup-sourcemap-path-transform";

const sourcemapPathTransform = createPathTransform({
  prefixes: {
    "*src/": `${resolve(".", "nodefony", "src")}/`,
    "*config/": `${resolve(".", "nodefony", "config")}/`,
    "*decorators/": `${resolve(".", "nodefony", "decorators")}/`,
    "*service/": `${resolve(".", "nodefony", "service")}/`,
    "*controller/": `${resolve(".", "nodefony", "controller")}/`,
    "*entity/": `${resolve(".", "nodefony", "entity")}/`,
    "*command/": `${resolve(".", "nodefony", "command")}/`,
  },
});

const external: string[] = [
  "nodefony",
  "@nodefony/http",
  "@nodefony/sequelize",
  "@nodefony/security",
  "bluebird",
  "twig",
  "ejs",
  "tslib",
];

const sharedNodeOptions = defineConfig({
  treeshake: {
    moduleSideEffects: "no-external",
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
  output: {
    dir: path.resolve(".", "dist"),
    entryFileNames: `[name].js`,
    exports: "auto",
    format: "es",
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
    nodeResolve({
      preferBuiltins: true,
    }),
    typescript({
      rootDir: path.resolve("."),
      tsconfig: path.resolve(".", "tsconfig.json"),
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined,
    }),
    //commonjs(),
    json(),
  ];
  if (isProduction) {
    //tab.push(terser());
  }
  return tab;
}

function createNodeConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    //input,
    input: path.resolve(".", "index.ts"),
    ...sharedNodeOptions,
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
      preserveModules: !isProduction,
      preserveModulesRoot: "nodefony",
      sourcemapPathTransform,
    },
    external,
    plugins: [...createNodePlugins(isProduction, true, "dist/types")],
  });
}

export default (commandLineArgs: any): RollupOptions => {
  const isDev = commandLineArgs.watch;
  const isProduction = !isDev;
  return createNodeConfig(isProduction);
};
