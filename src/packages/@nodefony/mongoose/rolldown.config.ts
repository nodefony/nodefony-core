import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared.ts";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/orm-core",
    "@nodefony/user",
    "@nodefony/security",
    "mongodb",
    "mongoose",
    "zod",
    "tslib",
  ],
});
