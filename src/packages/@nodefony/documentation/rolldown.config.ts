import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/framework",
    "@nodefony/http",
    "zod",
    "tslib",
  ],
});
