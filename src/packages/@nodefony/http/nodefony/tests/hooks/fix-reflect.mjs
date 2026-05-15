/**
 * ESM loader hook — patches Rollup's broken _virtual/Reflect.js.
 *
 * WHY: nodefony dist is built with preserveModules:true. Rollup wraps
 * reflect-metadata (CJS) with a virtual chunk that uses __require, a helper
 * defined only in the bundle preamble. When ts-node/esm loads individual
 * files there is no preamble, so __require is undefined.
 * This hook intercepts _virtual/Reflect.js and replaces it with a simple
 * createRequire call that loads reflect-metadata directly.
 */
import { createRequire } from "node:module";

const REFLECT_VIRTUAL_RE = /_virtual\/Reflect\.js/;

export async function load(url, context, nextLoad) {
  if (REFLECT_VIRTUAL_RE.test(url)) {
    return {
      format: "module",
      source: `
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
_require("reflect-metadata");
`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
