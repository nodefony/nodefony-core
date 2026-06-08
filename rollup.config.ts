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
  "@nodefony/mongoose",
  "@nodefony/redis",
  "@nodefony/test",
  "@nodefony/user",
  // ORM (orm-core + driver Drizzle) : l'app déclare ses entités → import côté app.
  // Externalisés pour ne pas bundler le driver natif `better-sqlite3`.
  "@nodefony/drizzle",
  "@nodefony/orm-core",
  "drizzle-orm",
  "tslib",
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
    dir: "./dist",
    entryFileNames: `[name].js`,
    exports: "auto",
    format: "es",
    externalLiveBindings: false,
    freeze: false,
  },
  onwarn(warning, warn) {
    if (warning.message.includes("Circular dependency")) return;
    if (warning.message.includes("TS5055")) return;
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
    // Externals : exact-match uniquement.
    // L'array brut (["nodefony", ...]) matche par préfixe → "nodefony/config/config"
    // est faussement externalisé et déclenche "Could not resolve" sur les chunks
    // internes (preserveModules nomme les chunks par leur chemin relatif).
    external: (id) =>
      id !== "." &&
      external.some(
        (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
      ),
    plugins: [...createNodePlugins(isProduction, !isProduction, "dist/types")],
  });
}

export default (commandLineArgs: Record<string, unknown>): RollupOptions => {
  const isProduction = !commandLineArgs["watch"];
  return createNodeConfig(isProduction);
};
