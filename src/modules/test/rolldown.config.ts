import { defineNodefonyRolldownConfig } from "../../../rolldown.shared";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/orm-core",
    "drizzle-orm",
    "@nodefony/drizzle",
    "@nodefony/security",
    "@nodefony/framework",
    "@nodefony/realtime",
    "@nodefony/user",
    "tslib",
  ],
});
