import { defineNodefonyRolldownConfig } from "../../../rolldown.shared.ts";

export default defineNodefonyRolldownConfig({
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
