// rollup.config.ts
import path, { resolve } from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
//@ts-ignore
import { createPathTransform } from "rollup-sourcemap-path-transform";
//import commonjs from "@rollup/plugin-commonjs";
//import copy from "rollup-plugin-copy";

const sourcemapPathTransform = createPathTransform({
  prefixes: {
    "*src/": `${resolve(".", "nodefony", "src")}/`,
    "*service/": `${resolve(".", "nodefony", "service")}/`,
    "*controller/": `${resolve(".", "nodefony", "controller")}/`,
    "*entity/": `${resolve(".", "nodefony", "entity")}/`,
    "*command/": `${resolve(".", "nodefony", "command")}/`,
    //"*nodefony/": `${resolve(".", "src")}/`,
  },
});

const external: string[] = [
  "nodefony",
  "@nodefony/http",
  "@nodefony/sequelize",
  "@nodefony/mongoose",
  "@nodefony/framework",
  "bcrypt",
  "csrf",
  "jsonwebtoken",
  "passport",
  "passport-github2",
  "passport-google-oauth20",
  "passport-http",
  "passport-jwt",
  "passport-ldapauth",
  "passport-local",
  "passport-oauth2",
  "tslib",
];

const sharedNodeOptions = defineConfig({
  treeshake: {
    moduleSideEffects: "no-external",
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
  output: {
    dir: resolve(".", "dist"),
    entryFileNames: `[name].js`, //`[name].js`,
    //chunkFileNames: "node/chunks/dep-[hash].js",
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
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve("tsconfig.json"),
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined,
    }),
    json(),
    // commonjs({
    //   extensions: [".js"],
    //   //ignoreDynamicRequires: true
    //   dynamicRequireTargets: [],
    // }),
    //copy({
    //  targets: [],
    //}),
  ];
  if (isProduction) {
    //tab.push(terser());
  }
  return tab;
}

function createNodeConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    //input,
    input: resolve(".", "index.ts"),
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
