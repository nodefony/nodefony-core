import { defineNodefonyRolldownConfig } from "nodefony/bundler";

export default defineNodefonyRolldownConfig({
  external: ["nodefony", "@anthropic-ai/sdk", "openai", "tslib"],
});
