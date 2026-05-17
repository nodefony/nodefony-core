import { defineConfig, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const external: string[] = [
  "nodefony",
  "@anthropic-ai/sdk",
  "openai",
  "tslib",
];

export default (commandLineArgs: Record<string, unknown>): RollupOptions => {
  const isProduction = !commandLineArgs["watch"];
  return defineConfig({
    input: "index.ts",
    treeshake: {
      moduleSideEffects: "no-external",
      propertyReadSideEffects: false,
    },
    output: {
      dir: "./dist",
      format: "esm",
      sourcemap: !isProduction,
      preserveModules: true,
      preserveModulesRoot: ".",
      entryFileNames: "[name].js",
    },
    external: (id) =>
      id !== "." &&
      external.some(
        (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
      ),
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      typescript({
        tsconfig: path.resolve(__dirname, "tsconfig.json"),
        declaration: true,
        declarationDir: "dist/types",
      }),
      json(),
    ],
  });
};
