import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared.ts";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/security",
    "redis",
    "zod",
    "tslib",
  ],
});
