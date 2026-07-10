import { defineNodefonyRolldownConfig } from "../../../rolldown.shared";

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
