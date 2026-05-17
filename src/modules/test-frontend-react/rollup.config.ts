// rollup.config.ts — @nodefony/test-frontend-react (backend bundle only)
import path, { resolve } from "node:path";
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import { createPathTransform } from "rollup-sourcemap-path-transform";
import { globSync } from "glob";

const sourcemapPathTransform = createPathTransform({
  prefixes: {
    "*config/": `${resolve(".", "nodefony", "config")}/`,
    "*controller/": `${resolve(".", "nodefony", "controller")}/`,
  },
});

const external: string[] = [
  "nodefony",
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/frontend",
  "tslib",
];

const nodefonyFiles = globSync("nodefony/**/*.ts", {
  ignore: ["**/*.d.ts", "**/tests/**"],
});

const input = {
  index: "./index.ts",
  ...Object.fromEntries(
    nodefonyFiles.map((file) => [
      path.relative(".", file).replace(/\.ts$/, ""),
      "./" + file,
    ]),
  ),
};

function createNodePlugins(sourceMap: boolean): Plugin[] {
  return [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve("tsconfig.json"),
      sourceMap,
      declaration: false,
    }),
    json(),
  ];
}

export default (commandLineArgs: Record<string, unknown>): RollupOptions => {
  const isDev = Boolean(commandLineArgs.watch);
  return defineConfig({
    input,
    treeshake: {
      moduleSideEffects: "no-external",
      propertyReadSideEffects: false,
    },
    output: {
      dir: resolve(".", "dist"),
      entryFileNames: `[name].js`,
      format: "es",
      sourcemap: isDev,
      preserveModules: true,
      preserveModulesRoot: ".",
      sourcemapPathTransform,
    },
    onwarn(warning, warn) {
      if (warning.message.includes("Circular dependency")) return;
      warn(warning);
    },
    external: (id) =>
      id !== "." &&
      external.some(
        (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
      ),
    plugins: createNodePlugins(isDev),
  });
};
