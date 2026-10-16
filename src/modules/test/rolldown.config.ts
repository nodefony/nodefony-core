import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/ai",
    "@nodefony/http",
    "@nodefony/orm-core",
    "drizzle-orm",
    "@nodefony/drizzle",
    "@nodefony/security",
    "@nodefony/framework",
    "@nodefony/realtime",
    "@nodefony/user",
    "tslib",
    "zod",
  ],
});
