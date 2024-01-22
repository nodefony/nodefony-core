/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineConfig, Plugin, RollupOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import copy from "rollup-plugin-copy";
import replace from "@rollup/plugin-replace";
import { sync as globSync } from "glob";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { visualizer } from "rollup-plugin-visualizer";
////import lib from './package.json'
//import terser from "@rollup/plugin-terser";

const external: string[] = [
  "nodefony",
  "asciify",
  "cli-color",
  "cli-table3",
  "clui",
  "commander",
  "@inquirer/prompts",
  "lodash",
  "mime-types",
  "moment",
  "node-emoji",
  "rxjs",
  "semver",
  "shelljs",
  "uuid",
  "twig",
  "ejs",
];

const sharedNodeOptions = defineConfig({
  treeshake: {
    moduleSideEffects: "no-external",
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
  output: {
    dir: "./dist",
    entryFileNames: `node/[name].js`,
    //chunkFileNames: "node/chunks/dep-[hash].js",
    exports: "auto",
    format: "esm",
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

const sharedBinaryOptions = defineConfig({
  treeshake: {
    moduleSideEffects: "no-external",
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
  output: {
    file: "./bin/nodefony",
    exports: "none",
    format: "esm",
    externalLiveBindings: false,
    //freeze: false,
  },
  onwarn(warning, warn) {
    if (warning.message.includes("Circular dependency")) {
      return;
    }
    if (warning.code === "EVAL") {
      return;
    }
    warn(warning);
  },
});

function createBinaryConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    //input,
    input: "src/bin/nodefony.ts",
    ...sharedBinaryOptions,
    output: {
      ...sharedBinaryOptions.output,
      sourcemap: false,
    },
    external,
    plugins: [...createBinaryPlugins(isProduction, false, false)],
  });
}

function createBinaryPlugins(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isProduction?: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sourceMap?: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  declarationDir?: string | false
): Plugin[] {
  const tab = [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve("src/config/tsconfig.bin.json"),
    }),
    json(),
  ];
  if (isProduction) {
    //tab.push(terser());
  }
  return tab;
}

const sharedTestOptions = defineConfig({
  treeshake: {
    moduleSideEffects: "no-external",
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
  output: {
    dir: "./dist",
    entryFileNames: `tests/[name].js`,
    chunkFileNames: "tests/chunks/dep-[hash].js",
    exports: "auto",
    format: "esm",
    externalLiveBindings: false,
    freeze: false,
  },
  onwarn(warning, warn) {
    if (warning.message.includes("Circular dependency")) {
      return;
    }
    if (warning.code === "EVAL") {
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
      dynamicRequireTargets: [
        //"node_modules/shelljs/src/*",
        //"node_modules/shelljs/src/ln.js",
        //"node_modules/shelljs/src/ls.js",
        //"node_modules/shelljs/src/cd.js",
        //"node_modules/shelljs/src/mkdir.js",
        //"node_modules/shelljs/src/rm.js",
        //"node_modules/shelljs/src/chmod.js",
        //"node_modules/shelljs/src/cp.js",
        //"node_modules/shelljs/src/dirs.js"
      ],
    }),
    json(),
    copy({
      targets: [
        // { src: 'node_modules/asciify/lib/figlet-js/fonts/standard.flf', dest: 'dist/node-cjs/fonts/standard.flf' },
        //{ src: 'assets/images/**/*', dest: 'dist/public/images' }
      ],
    }),
  ];
  if (isProduction) {
    //tab.push(terser());
  }
  return tab;
}

function createTestPlugins(
  isProduction: boolean,
  sourceMap: boolean,
  declarationDir: string | false
): Plugin[] {
  return [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve("src", "tests", "tsconfig.test.json"),
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
    replace({
      preventAssignment: true,
      "navigator.userAgent": JSON.stringify(
        "Mozilla/5.0 (compatible; Node.js)"
      ),
      "window.navigator.userAgent": JSON.stringify(
        "Mozilla/5.0 (compatible; Node.js)"
      ),
      "document._defaultView.navigator.userAgent": JSON.stringify(
        "Mozilla/5.0 (compatible; Node.js)"
      ),
    }),
  ];
}

const inputTest = (function input() {
  const myGlob = globSync("./src/tests/**/*.ts")
    .map((file) => {
      if (/src\/.*.test.ts/.test(file)) {
        return [
          path.relative(
            "src",
            file.slice(0, file.length - path.extname(file).length)
          ),
          // eslint-disable-next-line no-undef
          fileURLToPath(new URL(file, import.meta.url)),
        ];
      }
    })
    .filter((ele) => {
      if (ele) {
        return ele;
      }
    });
  return Object.fromEntries(myGlob as Iterable<readonly [PropertyKey, any]>);
})();

function createNodeConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    //input,
    input: "src/index.ts",
    ...sharedNodeOptions,
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
      //preserveModules: true,
      //preserveModulesRoot: "src",
    },
    external,
    plugins: [
      ...createNodePlugins(isProduction, true, "dist/types"),
      visualizer({ filename: "dist/stats.html" }),
    ],
  });
}

function createCjsConfig(isProduction: boolean) {
  return defineConfig({
    ...sharedNodeOptions,
    input: "src/index.ts",
    output: {
      dir: "./dist",
      entryFileNames: `node-cjs/[name].cjs`,
      chunkFileNames: "node-cjs/chunks/dep-[hash].js",
      exports: "named",
      format: "cjs",
      externalLiveBindings: false,
      freeze: false,
      sourcemap: false,
    },
    external,
    plugins: [
      ...createNodePlugins(isProduction, true, false),
      visualizer({ filename: "dist/statsCjs.html" }),
    ],
  });
}

function createTestConfig(isProduction: boolean): RollupOptions {
  return defineConfig({
    //input,
    input: inputTest,
    ...sharedTestOptions,
    output: {
      ...sharedTestOptions.output,
      sourcemap: !isProduction,
    },
    external,
    plugins: createTestPlugins(isProduction, false, false),
  });
}

export default (commandLineArgs: any): RollupOptions[] => {
  const isDev = commandLineArgs.watch;
  const isProduction = !isDev;
  return defineConfig([
    //envConfig,
    //clientConfig,
    createNodeConfig(isProduction),
    createBinaryConfig(isProduction),
    createCjsConfig(isProduction),
    createTestConfig(isProduction),
  ]);
};
