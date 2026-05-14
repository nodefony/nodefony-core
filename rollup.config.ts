import { defineConfig } from "rollup";
import type { Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import path from "node:path";
import { globSync } from "glob";

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

// Génère dynamiquement les entrées avec glob
const nodefonyFiles = globSync("nodefony/**/*.ts", {
  ignore: ["**/*.d.ts", "**/*.spec.ts"], // Exclut les fichiers de déclaration et de test
});

const input = {
  index: "index.ts",
  ...Object.fromEntries(
    nodefonyFiles.map((file) => [
      // Génère un nom de chunk basé sur le chemin relatif
      path.relative("nodefony", file).replace(/\.ts$/, ""),
      file,
    ]),
  ),
};

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
  declarationDir: string | false,
): Plugin[] {
  const plugins: Plugin[] = [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve("tsconfig.json"),
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined,
    }),
    json(),
  ];
  if (isProduction) {
    // tab.push(terser());
  }
  return plugins;
}

function createNodeConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    input,
    ...sharedNodeOptions,
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: ".",
    },
    external,
    plugins: [...createNodePlugins(isProduction, true, "dist/types")],
  });
}

export default (commandLineArgs: Record<string, unknown>): RollupOptions => {
  const isProduction = !commandLineArgs["watch"];
  return createNodeConfig(isProduction);
};
