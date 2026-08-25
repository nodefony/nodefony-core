// @nodefony/memory — tests/MemoryService.test.ts
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { MemoryService } from "../src/services/MemoryService.js";
import {
  MemoryShutdownError,
  MemoryInvalidInputError,
} from "../src/errors/MemoryErrors.js";
import { MemoryVectorStore } from "../../vector/src/adapters/MemoryVectorStore.js";
import type { ILLMProvider } from "../../llm/src/interfaces/ILLMProvider.js";

const createMockLLM = (): ILLMProvider => ({
  name: "ollama",
  model: "test",
  mode: "sovereign",
  chat: mock(async () => ({
    content: "",
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costEur: 0 },
    stopReason: "end_turn" as const,
  })),
  stream: mock(async function* () {
    yield { type: "done" as const, content: "" };
  }),
  embed: mock(async () => [0.1, 0.2, 0.3]),
  healthCheck: mock(async () => true),
  shutdown: mock(async () => undefined),
});

describe("MemoryService", () => {
  let llm: ILLMProvider;
  let vector: MemoryVectorStore;
  let memory: MemoryService;

  beforeEach(async () => {
    llm = createMockLLM();
    vector = new MemoryVectorStore({ collection: "mem", dimensions: 3 });
    await vector.init();
    memory = new MemoryService(llm, vector);
  });

  afterEach(async () => {
    await memory.shutdown();
    await vector.shutdown();
  });

  describe("remember", () => {
    it("creates entry with id and timestamp", async () => {
      const entry = await memory.remember({
        agentId: "a1",
        sessionId: "s1",
        role: "user",
        content: "hello",
      });
      expect(entry.id).toBeString();
      expect(entry.timestamp).toBeInstanceOf(Date);
    });

    it("rejects empty agentId", async () => {
      await expect(
        memory.remember({
          agentId: "",
          sessionId: "s",
          role: "user",
          content: "x",
        }),
      ).rejects.toThrow(MemoryInvalidInputError);
    });

    it("rejects empty content", async () => {
      await expect(
        memory.remember({
          agentId: "a",
          sessionId: "s",
          role: "user",
          content: "",
        }),
      ).rejects.toThrow(MemoryInvalidInputError);
    });

    it("rejects too long content", async () => {
      const huge = "x".repeat(100_001);
      await expect(
        memory.remember({
          agentId: "a",
          sessionId: "s",
          role: "user",
          content: huge,
        }),
      ).rejects.toThrow(MemoryInvalidInputError);
    });

    it("rejects invalid role", async () => {
      await expect(
        memory.remember({
          agentId: "a",
          sessionId: "s",
          role: "invalid" as never,
          content: "x",
        }),
      ).rejects.toThrow(MemoryInvalidInputError);
    });
  });

  describe("recall", () => {
    it("returns recent entries for session", async () => {
      await memory.remember({
        agentId: "a",
        sessionId: "s1",
        role: "user",
        content: "msg1",
      });
      await memory.remember({
        agentId: "a",
        sessionId: "s1",
        role: "assistant",
        content: "msg2",
      });
      const recalled = await memory.recall("a", "s1");
      expect(recalled.length).toBe(2);
    });

    it("isolates by agent", async () => {
      await memory.remember({
        agentId: "a",
        sessionId: "s",
        role: "user",
        content: "hi",
      });
      await memory.remember({
        agentId: "b",
        sessionId: "s",
        role: "user",
        content: "hi",
      });
      const recalled = await memory.recall("a", "s");
      expect(recalled.every((e) => e.agentId === "a")).toBe(true);
    });

    it("respects limit", async () => {
      for (let i = 0; i < 10; i++) {
        await memory.remember({
          agentId: "a",
          sessionId: "s",
          role: "user",
          content: `msg${i}`,
        });
      }
      const recalled = await memory.recall("a", "s", 3);
      expect(recalled.length).toBe(3);
    });

    it("rejects invalid limit", async () => {
      await expect(memory.recall("a", "s", 0)).rejects.toThrow(
        MemoryInvalidInputError,
      );
      await expect(memory.recall("a", "s", 1001)).rejects.toThrow(
        MemoryInvalidInputError,
      );
    });
  });

  describe("consolidate", () => {
    it("moves session entries to long term", async () => {
      await memory.remember({
        agentId: "a",
        sessionId: "s",
        role: "user",
        content: "remember me",
      });
      const consolidated = await memory.consolidate("a", "s");
      expect(consolidated).toBe(1);
      expect(await vector.count()).toBe(1);
    });

    it("returns 0 if no entries", async () => {
      const result = await memory.consolidate("a", "empty-session");
      expect(result).toBe(0);
    });
  });

  describe("forget (RGPD)", () => {
    it("deletes all data for an agent", async () => {
      await memory.remember({
        agentId: "a",
        sessionId: "s1",
        role: "user",
        content: "x",
      });
      await memory.consolidate("a", "s1");
      const deleted = await memory.forget("a");
      expect(deleted).toBeGreaterThan(0);
    });

    it("rejects empty agentId", async () => {
      await expect(memory.forget("")).rejects.toThrow(MemoryInvalidInputError);
    });
  });

  describe("memory safety — InMemoryStore bounds", () => {
    it("enforces maxEntriesPerSession", async () => {
      const m = new MemoryService(llm, vector, {
        shortTerm: { maxEntriesPerSession: 5 },
      });
      try {
        for (let i = 0; i < 20; i++) {
          await m.remember({
            agentId: "a",
            sessionId: "s",
            role: "user",
            content: `msg${i}`,
          });
        }
        const recalled = await m.recall("a", "s", 100);
        expect(recalled.length).toBeLessThanOrEqual(5);
      } finally {
        await m.shutdown();
      }
    });

    it("rejects after shutdown", async () => {
      await memory.shutdown();
      await expect(
        memory.remember({
          agentId: "a",
          sessionId: "s",
          role: "user",
          content: "x",
        }),
      ).rejects.toThrow(MemoryShutdownError);
    });

    it("clears all data on shutdown", async () => {
      await memory.remember({
        agentId: "a",
        sessionId: "s",
        role: "user",
        content: "x",
      });
      await memory.shutdown();
      // shortTerm interne doit être vidé — pas de fuite
    });
  });
});
