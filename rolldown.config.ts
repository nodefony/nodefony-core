import { defineNodefonyRolldownConfig } from "./rolldown.shared.ts";

export default defineNodefonyRolldownConfig({
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
