import path, { resolve } from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import { createPathTransform } from "rollup-sourcemap-path-transform";
import { globSync } from "glob";

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
  // Obligatoire : le registre orm-core est un singleton process-wide. S'il était
  // bundlé ici, le module aurait sa PROPRE instance d'entityRegistry → l'entité
  // enregistrée ne serait pas vue par les ORM (résolus via le package partagé).
  "@nodefony/orm-core",
  // Idem orm-core : drizzle-orm doit rester partagé (1 seule copie process-wide).
  // Bundlé ici, les `sqliteTable(...)` du schéma dolibarr porteraient des Symbols
  // distincts → `getTableConfig()` de l'adapter Drizzle ne lirait pas la table
  // (dual-package hazard). Externalisé : Node résout l'unique copie de node_modules.
  "drizzle-orm",
  "@nodefony/security",
  "@nodefony/framework",
  // Obligatoire (même raison que orm-core) : `RealtimeHub` est un singleton
  // process-wide. Bundlé ici, TestM2mRealtimeController aurait sa PROPRE instance
  // de hub → l'authenticator WS câblé par le firewall (sur le hub canonique) ne
  // serait pas vu → handshake jwt anonyme → garde @IsGranted 403 (dual-package
  // hazard, vécu J8 : banc ws-isgranted-jwt en échec malgré code correct).
  "@nodefony/realtime",
  // Banc sécurité P6 (secure/) : UserService/BcryptEncoder/BaseUser doivent rester
  // la copie partagée process-wide (bundlés ici = classes dupliquées + le binaire
  // natif @node-rs/bcrypt tiré dans le bundle du module de test).
  "@nodefony/user",
  "tslib",
];

const nodefonyFiles = globSync("nodefony/**/*.ts", {
  ignore: ["**/*.d.ts", "**/*.spec.ts", "**/*.test.ts", "**/tests/**"],
});

const input = {
  index: "./index.ts",
  ...Object.fromEntries(
    nodefonyFiles.map((file) => [
      path.relative(".", file).replace(/\.ts$/, ""),
      // Préfixe `./` : évite node-resolve warning sur specifier "nodefony/...".
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
    dir: path.resolve(".", "dist"),
    entryFileNames: `[name].js`,
    exports: "auto",
    format: "es",
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
    input,
    ...sharedNodeOptions,
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: ".",
      sourcemapPathTransform,
    },
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
