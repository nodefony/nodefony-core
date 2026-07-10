import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/orm-core",
    "@nodefony/http",
    "@nodefony/user",
    "@nodefony/security",
    "@nodefony/framework",
    "drizzle-orm",
    "better-sqlite3",
    "pg",
    "mysql2",
    "zod",
    "tslib",
  ],
});
