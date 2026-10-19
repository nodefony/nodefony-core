import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/security",
    "eta",
    "reflect-metadata",
    "tslib",
    "zod",
  ],
});
