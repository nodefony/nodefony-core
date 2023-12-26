/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineConfig, Plugin, RollupOptions } from 'rollup'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import copy from 'rollup-plugin-copy'
import glob from 'glob';
import path from 'node:path';
import { fileURLToPath } from 'node:url'
////import lib from './package.json'

const externalCjs :string[]= [
  "asciify",
  "cli-color", 
  "cli-table3", 
  "clui", 
  "commander", 
  //"inquirer", 
  "lodash", 
  "mime-types", 
  "moment", 
  "node-emoji", 
  "rxjs", 
  "semver", 
  "shelljs",
  "uuid"
]

const external :string[]= [
  "asciify",
  "cli-color", 
  "cli-table3", 
  "clui", 
  "commander", 
  "inquirer", 
  "lodash", 
  "mime-types", 
  "moment", 
  "node-emoji", 
  "rxjs", 
  "semver", 
  "shelljs",
  "uuid"
]

const sharedNodeOptions = defineConfig({
  treeshake: {
    moduleSideEffects: 'no-external',
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
  output: {
    dir: './dist',
    entryFileNames: `node/[name].js`,
    chunkFileNames: 'node/chunks/dep-[hash].js',
    exports: 'auto',
    format: 'esm',
    externalLiveBindings: false,
    freeze: false,
  },
  onwarn(warning, warn) {
    if (warning.message.includes('Circular dependency')) {
      return
    }
    warn(warning)
  },
})

const sharedTestOptions = defineConfig({
   treeshake: {
    moduleSideEffects: 'no-external',
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
   },
   output: {
    dir: './dist',
    entryFileNames: `tests/[name].js`,
    chunkFileNames: 'tests/chunks/dep-[hash].js',
    exports: 'auto',
    format: 'esm',
    externalLiveBindings: false,
    freeze: false,
  },
   onwarn(warning, warn) {
    if (warning.message.includes('Circular dependency')) {
      return
    }
    if (warning.code === 'EVAL' ) {
      return;
    }
    warn(warning)
  },
})

function createNodePlugins(
  isProduction: boolean,
  sourceMap: boolean,
  declarationDir: string | false,
): (Plugin)[] {
  return [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve( 'tsconfig.json'),
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined,
    }),
    commonjs({
      extensions: ['.js'],
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
      ]
    }),
    json(),
    copy({
      targets: [
       // { src: 'node_modules/asciify/lib/figlet-js/fonts/standard.flf', dest: 'dist/node-cjs/fonts/standard.flf' },
        //{ src: 'assets/images/**/*', dest: 'dist/public/images' }
      ]
    })
  ]
}

function createTstPlugins(
  isProduction: boolean,
  sourceMap: boolean,
  declarationDir: string | false,
): (Plugin)[] {
   return [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve( 'src','tests','tsconfig.test.json'),
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined,
    }),
    commonjs({
      extensions: ['.js'],
      //ignoreDynamicRequires: true
      dynamicRequireTargets: []
    }),
    json(),
  ]
}

const inputTest =  function input(){
  const myGlob =  glob.sync('./src/tests/**/*.ts').map(file => {
      if (/src\/.*.test.ts/.test(file)){
        return [
          path.relative(
            'src',
            file.slice(0, file.length - path.extname(file).length)
          ),
          // eslint-disable-next-line no-undef
          fileURLToPath(new URL(file, import.meta.url))
        ]
      }
  }).filter((ele)=>{
    if( ele){
      return ele
    }
  })
  return Object.fromEntries( myGlob as Iterable<readonly [PropertyKey, any]> )
}() 


function createNodeConfig(isProduction: boolean) : RollupOptions {
  return defineConfig({
    //input,
    input: "src/index.ts",
    ...sharedNodeOptions, 
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
    },
    external,
    plugins: createNodePlugins(isProduction, false, "dist/types")
  })
}

function createCjsConfig(isProduction: boolean) {
  return defineConfig({
    ...sharedNodeOptions,
    input:"src/index.ts",
    output: {
      dir: './dist',
      entryFileNames: `node-cjs/[name].cjs`,
      chunkFileNames: 'node-cjs/chunks/dep-[hash].js',
      exports: 'named',
      format: 'cjs',
      externalLiveBindings: false,
      freeze: false,
      sourcemap: false,
    },
    external: externalCjs,
    plugins: [...createNodePlugins(isProduction, false, false)]
  })
}


function createTestConfig(isProduction: boolean) : RollupOptions {
  return defineConfig({
    //input,
    input: inputTest,
    ...sharedTestOptions, 
    output: {
      ...sharedTestOptions.output,
      sourcemap: !isProduction,
    },
    external,
    plugins: createTstPlugins(isProduction, false, false)
  })
}


export default (commandLineArgs: any): RollupOptions[] => {
  const isDev = commandLineArgs.watch
  const isProduction = !isDev
  return defineConfig([
    //envConfig,
    //clientConfig,
    createNodeConfig(isProduction),
    createCjsConfig(isProduction),
    createTestConfig(isProduction)
  ])
}