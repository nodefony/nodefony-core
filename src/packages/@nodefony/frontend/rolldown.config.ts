import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared";

export default defineNodefonyRolldownConfig({
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/framework",
    "vite",
    "zod",
    "@vitejs/plugin-react",
    "@vitejs/plugin-vue",
    "@analogjs/vite-plugin-angular",
    "@angular",
    "tslib",
  ],
});
