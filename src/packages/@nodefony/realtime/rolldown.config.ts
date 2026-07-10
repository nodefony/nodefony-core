import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared.ts";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/framework",
    "@nodefony/http",
    "zod",
    "tslib",
  ],
});
