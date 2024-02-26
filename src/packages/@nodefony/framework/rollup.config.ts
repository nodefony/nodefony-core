// rollup.config.ts
import path from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
//import commonjs from "@rollup/plugin-commonjs";
//import copy from "rollup-plugin-copy";

const external: string[] = [
  "nodefony",
  "@nodefony/http",
  "@nodefony/sequelize",
  "@nodefony/security",
  "bluebird",
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
      //sourcemap: !isProduction,
      //preserveModules: !isProduction,
      //preserveModulesRoot: "nodefony",
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
