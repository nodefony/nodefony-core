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
