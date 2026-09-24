import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/orm-core",
    "@nodefony/user",
    "@nodefony/security",
    "@nodefony/framework",
    "mongodb",
    "mongoose",
    "zod",
    "tslib",
  ],
});
