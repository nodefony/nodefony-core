import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/framework",
    "@nodefony/http",
    "zod",
    "tslib",
  ],
});
