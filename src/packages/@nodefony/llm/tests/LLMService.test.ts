// @nodefony/llm — tests/LLMService.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  ILLMProvider,
  IMessage,
  ILLMResponse,
  IStreamChunk,
} from "../src/interfaces/ILLMProvider.js";
import { LLMService } from "../src/services/LLMService.js";
import { LLMError } from "../src/errors/LLMErrors.js";

const createMockProvider = (
  name: "claude" | "ollama" = "claude",
): ILLMProvider => ({
  name,
  model: "test-model",
  mode: name === "ollama" ? "sovereign" : "cloud",

  chat: vi.fn(async (messages: IMessage[]) => ({
    content: `Echo: ${messages.at(-1)?.content}`,
    model: "test-model",
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costEur: 0.001,
    },
    stopReason: "end_turn" as const,
  })),

  stream: vi.fn(async function* (
    messages: IMessage[],
  ): AsyncGenerator<IStreamChunk> {
    const words = `Echo: ${messages.at(-1)?.content}`.split(" ");
    for (const w of words) yield { type: "token", content: w + " " };
    yield { type: "done", content: "" };
  }),

  embed: vi.fn(async () => Array.from({ length: 1536 }, () => Math.random())),
  healthCheck: vi.fn(async () => true),
  shutdown: vi.fn(async () => undefined),
});

describe("LLMService", () => {
  let service: LLMService;
  let provider: ILLMProvider;

  beforeEach(() => {
    provider = createMockProvider("claude");
    service = new LLMService(provider);
  });

  afterEach(async () => {
    await service.shutdown();
  });

  describe("basic operations", () => {
    it("delegates chat to provider", async () => {
      const response = await service.chat([{ role: "user", content: "test" }]);
      expect(response.content).toContain("Echo:");
      expect(provider.chat).toHaveBeenCalled();
    });

    it("delegates stream to provider", async () => {
      const tokens: string[] = [];
      for await (const chunk of service.stream([
        { role: "user", content: "hi" },
      ])) {
        if (chunk.type === "token") tokens.push(chunk.content);
      }
      expect(tokens.length).toBeGreaterThan(0);
    });

    it("delegates embed to provider", async () => {
      const vec = await service.embed("test");
      expect(vec.length).toBe(1536);
    });

    it("returns current provider", () => {
      expect(service.getCurrentProvider()).toBe(provider);
    });
  });

  describe("multi-provider", () => {
    it("registers a new provider", () => {
      const ollama = createMockProvider("ollama");
      service.registerProvider(ollama);
      expect(service.getProviders()).toHaveLength(2);
    });

    it("switches provider in runtime", () => {
      const ollama = createMockProvider("ollama");
      service.switchProvider(ollama);
      expect(service.getCurrentProvider().name).toBe("ollama");
      expect(service.mode).toBe("sovereign");
    });

    it("preserves all providers when switching", () => {
      const ollama = createMockProvider("ollama");
      service.switchProvider(ollama);
      expect(service.getProviders()).toHaveLength(2);
    });
  });

  describe("memory safety", () => {
    it("shuts down all registered providers", async () => {
      const ollama = createMockProvider("ollama");
      service.registerProvider(ollama);
      await service.shutdown();
      expect(provider.shutdown).toHaveBeenCalled();
      expect(ollama.shutdown).toHaveBeenCalled();
    });

    it("rejects operations after shutdown", async () => {
      await service.shutdown();
      await expect(service.chat([])).rejects.toThrow(LLMError);
    });

    it("getProviders returns empty after shutdown", async () => {
      await service.shutdown();
      expect(service.getProviders()).toHaveLength(0);
    });

    it("healthCheck returns false after shutdown", async () => {
      await service.shutdown();
      expect(await service.healthCheck()).toBe(false);
    });

    it("aggregates errors during shutdown", async () => {
      const failingProvider = createMockProvider("claude");
      failingProvider.shutdown = vi.fn(async () => {
        throw new Error("boom");
      });
      const s = new LLMService(failingProvider);
      await expect(s.shutdown()).rejects.toThrow();
    });
  });
});
