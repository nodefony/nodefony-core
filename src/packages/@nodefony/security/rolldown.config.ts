import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared.ts";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/framework",
    "@nodefony/user",
    "zod",
    "jose",
    "@simplewebauthn/server",
    "arctic",
    "tslib",
  ],
});
