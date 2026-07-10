import { defineNodefonyRolldownConfig } from "../../../../rolldown.shared.ts";

export default defineNodefonyRolldownConfig({
  external: ["nodefony", "@anthropic-ai/sdk", "openai", "tslib"],
});
