import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/framework",
    "@nodefony/user",
    "zod",
    "jose",
    "@simplewebauthn/server",
    "tslib",
  ],
});
