import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/security",
    "eta",
    "graphql",
    "@graphql-tools/merge",
    "@graphql-tools/schema",
    "reflect-metadata",
    "tslib",
    "zod",
  ],
});
