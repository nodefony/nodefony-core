import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/framework",
    "vite",
    "zod",
    "@vitejs/plugin-react",
    "@vitejs/plugin-vue",
    "@analogjs/vite-plugin-angular",
    "@sveltejs/vite-plugin-svelte",
    "@angular",
    "tslib",
  ],
});
