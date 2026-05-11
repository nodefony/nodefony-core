// rollup.config.ts
import path from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

const external: string[] = [
  "nodefony",
  "@nodefony/http",
  "@nodefony/security",
  "@nodefony/framework",
  "@nodefony/sequelize",
  "@nodefony/mongoose",
  "@nodefony/redis",
  "@nodefony/test",
  "@nodefony/user",
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
  const plugins: Plugin[] = [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve("tsconfig.json"),
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined,
    }),
    commonjs({ extensions: [".js"] }),
    json(),
  ];
  if (isProduction) {
    // tab.push(terser());
  }
  return plugins;
}

function createNodeConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
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

export default (commandLineArgs: Record<string, unknown>): RollupOptions => {
  const isProduction = !commandLineArgs["watch"];
  return createNodeConfig(isProduction);
};
