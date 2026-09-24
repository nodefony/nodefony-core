import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/framework",
    "@nodefony/frontend",
    "@nodefony/orm-core",
    "@nodefony/drizzle",
    "drizzle-orm",
    "tslib",
  ],
});
