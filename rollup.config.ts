// rollup.config.ts
import path, { resolve } from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import copy from "rollup-plugin-copy";

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
  "@nodefony/security",
  "@nodefony/framework",
  "@nodefony/sequelize",
  "cli-table3",
  "tslib",
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
    exports: "auto",
    format: "es",
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
    input: "index.ts",
    ...sharedNodeOptions,
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: "nodefony",
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
