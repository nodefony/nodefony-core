import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared";

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
