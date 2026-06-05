// rollup.config.ts
import path, { resolve } from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import { createPathTransform } from "rollup-sourcemap-path-transform";
//import commonjs from "@rollup/plugin-commonjs";
//import copy from "rollup-plugin-copy";
import { globSync } from "glob";

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
  "@nodefony/framework",
  "cli-color",
  "cookie",
  "@fastify/busboy",
  "bluebird",
  "mime",
  "ms",
  "qs",
  "serve-static",
  "ws",
  "node-forge",
  "http-terminator",
  "mime-types",
  "uuid",
  "xml2js",
  "tslib",
  "zod",
];

// Génère dynamiquement les entrées avec glob
const nodefonyFiles = globSync("nodefony/**/*.ts", {
  ignore: ["**/*.d.ts", "**/*.spec.ts", "**/*.test.ts", "**/tests/**"],
});

const input = {
  index: "./index.ts",
  ...Object.fromEntries(
    nodefonyFiles.map((file) => [
      // ⬇️ Utilise la racine du projet (.) au lieu de "nodefony"
      path.relative(".", file).replace(/\.ts$/, ""),
      // Préfixe `./` : sans ça, node-resolve interprète "nodefony/foo.ts"
      // comme un specifier de package (lookup exports) → warning.
      "./" + file,
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
    dir: resolve(".", "dist"),
    entryFileNames: `[name].js`, //`[name].js`,
    //chunkFileNames: "node/chunks/dep-[hash].js",
    exports: "auto",
    format: "es",
  },
  onwarn(warning, warn) {
    // EMPTY_BUNDLE : fichier types-only (interfaces) sous preserveModules → chunk JS vide (bénin).
    if (warning.code === "EMPTY_BUNDLE") return;
    if (warning.message.includes("Circular dependency")) return;
    // TS5055 : watch mode régénère les .d.ts inclus comme input via tsconfig.
    if (warning.message.includes("TS5055")) return;
    warn(warning);
  },
});

function createNodePlugins(
  isProduction: boolean,
  sourceMap: boolean,
  declarationDir: string | false,
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
    input,
    ...sharedNodeOptions,
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: ".",
      sourcemapPathTransform,
    },
    // Externals : exact-match — sinon "nodefony" externalise tout chunk
    // commençant par "nodefony/" (preserveModules nomme par chemin relatif).
    external: (id) =>
      id !== "." &&
      external.some(
        (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
      ),
    plugins: [...createNodePlugins(isProduction, !isProduction, "dist/types")],
  });
}

export default (commandLineArgs: any): RollupOptions => {
  const isDev = commandLineArgs.watch;
  const isProduction = !isDev;
  return createNodeConfig(isProduction);
};
