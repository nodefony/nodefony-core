import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  cleanDir: true,
  external: ["nodefony", "@anthropic-ai/sdk", "openai", "tslib"],
});
