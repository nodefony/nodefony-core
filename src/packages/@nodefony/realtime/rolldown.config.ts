import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/framework",
    "@nodefony/http",
    "zod",
    "tslib",
  ],
});
