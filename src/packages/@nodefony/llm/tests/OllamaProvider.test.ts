// @nodefony/llm — tests/OllamaProvider.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { OllamaProvider } from "../src/providers/OllamaProvider.js";
import { LLMError } from "../src/errors/LLMErrors.js";

describe("OllamaProvider — sovereign mode", () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider({
      provider: "ollama",
      model: "mistral:7b",
      endpoint: "http://localhost:11434",
    });
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it("works without API key", () => {
    expect(provider.name).toBe("ollama");
    expect(provider.mode).toBe("sovereign");
  });

  it("uses default endpoint when not specified", () => {
    const p = new OllamaProvider({ provider: "ollama", model: "test" });
    expect(p.name).toBe("ollama");
  });

  it("supports embeddings (unlike Claude)", () => {
    expect(typeof provider.embed).toBe("function");
  });

  it("rejects after shutdown", async () => {
    await provider.shutdown();
    await expect(provider.chat([])).rejects.toThrow(LLMError);
  });

  it("healthCheck returns false after shutdown", async () => {
    await provider.shutdown();
    expect(await provider.healthCheck()).toBe(false);
  });
});
