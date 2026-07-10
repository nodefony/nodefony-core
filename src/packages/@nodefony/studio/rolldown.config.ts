import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/framework",
    "@nodefony/frontend",
    "@nodefony/realtime",
    "tslib",
  ],
});
