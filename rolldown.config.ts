import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/security",
    "@nodefony/framework",
    "@nodefony/mongoose",
    "@nodefony/redis",
    "@nodefony/test",
    "@nodefony/user",
    "@nodefony/drizzle",
    "@nodefony/orm-core",
    "drizzle-orm",
    "tslib",
  ],
});
