// @nodefony/llm — tests/ClaudeProvider.test.ts
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { ClaudeProvider } from "../src/providers/ClaudeProvider.js";
import {
  LLMError, LLMEmbedNotSupportedError, LLMAbortError
} from "../src/errors/LLMErrors.js";

describe("ClaudeProvider", () => {
  let provider: ClaudeProvider;

  beforeEach(() => {
    provider = new ClaudeProvider({
      provider: "claude",
      model: "claude-sonnet-4-6",
      apiKey: "test-key-xxx",
      timeout: 1000,
      maxRetries: 1,
    });
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  describe("constructor validation", () => {
    it("throws without API key", () => {
      expect(() => new ClaudeProvider({
        provider: "claude",
        model: "claude-sonnet-4-6",
      })).toThrow(LLMError);
    });

    it("throws on empty API key", () => {
      expect(() => new ClaudeProvider({
        provider: "claude",
        model: "claude-sonnet-4-6",
        apiKey: "  ",
      })).toThrow(LLMError);
    });

    it("uses defaults when not provided", () => {
      const p = new ClaudeProvider({
        provider: "claude",
        model: "test",
        apiKey: "key",
      });
      expect(p.name).toBe("claude");
      expect(p.mode).toBe("cloud");
    });
  });

  describe("embed", () => {
    it("throws not supported", async () => {
      await expect(provider.embed("test")).rejects.toThrow(LLMEmbedNotSupportedError);
    });
  });

  describe("memory safety", () => {
    it("shutdown idempotent", async () => {
      await provider.shutdown();
      await provider.shutdown();
      // pas d'erreur
    });

    it("rejects chat after shutdown", async () => {
      await provider.shutdown();
      await expect(provider.chat([])).rejects.toThrow(LLMError);
    });

    it("aborts in-flight requests on shutdown", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        async (_input, init) => {
          await new Promise((res, rej) => {
            const signal = (init as RequestInit | undefined)?.signal;
            if (signal) signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
          });
          throw new Error("never");
        }
      );

      const promise = provider.chat([{ role: "user", content: "test" }]);
      await new Promise(r => setTimeout(r, 50));
      await provider.shutdown();
      await expect(promise).rejects.toThrow();
      fetchSpy.mockRestore();
    });
  });

  describe("AbortSignal support", () => {
    it("respects external abort signal", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        async (_input, init) => {
          return new Promise((_res, rej) => {
            const signal = (init as RequestInit | undefined)?.signal;
            if (signal) signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
          });
        }
      );

      const controller = new AbortController();
      const promise = provider.chat(
        [{ role: "user", content: "test" }],
        { signal: controller.signal }
      );
      controller.abort();
      await expect(promise).rejects.toThrow();
      fetchSpy.mockRestore();
    });
  });
});
