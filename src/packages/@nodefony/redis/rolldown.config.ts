import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared";

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
