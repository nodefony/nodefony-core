// @nodefony/rag — tests/RagService.test.ts
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { RagService } from "../src/services/RagService.js";
import { RagInvalidInputError, RagShutdownError } from "../src/errors/RagErrors.js";
import { MemoryVectorStore } from "../../vector/src/adapters/MemoryVectorStore.js";
import type { ILLMProvider } from "../../llm/src/interfaces/ILLMProvider.js";

const createMockLLM = (dim = 3): ILLMProvider => ({
  name: "ollama",
  model: "test",
  mode: "sovereign",
  chat: mock(async () => ({ content: "", model: "test", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costEur: 0 }, stopReason: "end_turn" as const })),
  stream: mock(async function* () { yield { type: "done" as const, content: "" }; }),
  embed: mock(async (text: string) => {
    // Embedding déterministe basé sur la longueur
    const seed = text.length % 100;
    return Array.from({ length: dim }, (_, i) => Math.sin(seed + i));
  }),
  healthCheck: mock(async () => true),
  shutdown: mock(async () => undefined),
});

describe("RagService", () => {
  let llm: ILLMProvider;
  let vector: MemoryVectorStore;
  let rag: RagService;

  beforeEach(async () => {
    llm = createMockLLM(3);
    vector = new MemoryVectorStore({ collection: "test", dimensions: 3 });
    await vector.init();
    rag = new RagService(llm, vector);
  });

  afterEach(async () => {
    await rag.shutdown();
    await vector.shutdown();
  });

  describe("indexText", () => {
    it("creates chunks and embeds them", async () => {
      const text = "Phrase une. Phrase deux. Phrase trois. Phrase quatre.";
      const count = await rag.indexText(text, "test.txt", { strategy: "sentence", chunkSize: 5 });
      expect(count).toBeGreaterThan(0);
      expect(llm.embed).toHaveBeenCalled();
    });

    it("rejects empty text", async () => {
      await expect(rag.indexText("", "src")).rejects.toThrow(RagInvalidInputError);
      await expect(rag.indexText("   ", "src")).rejects.toThrow(RagInvalidInputError);
    });

    it("rejects empty source", async () => {
      await expect(rag.indexText("text", "")).rejects.toThrow(RagInvalidInputError);
    });

    it("rejects too long text", async () => {
      const huge = "a".repeat(10_000_001);
      await expect(rag.indexText(huge, "src")).rejects.toThrow(RagInvalidInputError);
    });

    it("rejects too long source", async () => {
      const longSource = "x".repeat(2000);
      await expect(rag.indexText("text", longSource)).rejects.toThrow(RagInvalidInputError);
    });

    it("rejects unknown strategy", async () => {
      await expect(rag.indexText(
        "text", "src",
        { strategy: "unknown" as never }
      )).rejects.toThrow(RagInvalidInputError);
    });

    it("attaches metadata to chunks", async () => {
      await rag.indexText("Test text.", "test.txt", {
        strategy: "fixed",
        metadata: { author: "John", year: 2024 },
      });
      const results = await rag.search("test");
      expect(results[0]?.chunk.metadata.author).toBe("John");
      expect(results[0]?.chunk.metadata.year).toBe(2024);
      expect(results[0]?.chunk.metadata.hash).toBeString();
    });
  });

  describe("search", () => {
    it("rejects empty query", async () => {
      await expect(rag.search("")).rejects.toThrow(RagInvalidInputError);
    });

    it("rejects too long query", async () => {
      await expect(rag.search("a".repeat(10_001))).rejects.toThrow(RagInvalidInputError);
    });

    it("returns empty array when no documents indexed", async () => {
      const results = await rag.search("test");
      expect(results).toEqual([]);
    });

    it("returns relevant results", async () => {
      await rag.indexText("Sujet A.", "a.txt", { strategy: "sentence" });
      await rag.indexText("Sujet B.", "b.txt", { strategy: "sentence" });
      const results = await rag.search("Sujet A.", { limit: 1 });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("deleteSource", () => {
    it("rejects empty source", async () => {
      await expect(rag.deleteSource("")).rejects.toThrow(RagInvalidInputError);
    });

    it("removes all chunks from a source", async () => {
      await rag.indexText("Texte du fichier A.", "a.txt", { strategy: "fixed" });
      await rag.indexText("Texte du fichier B.", "b.txt", { strategy: "fixed" });
      const deleted = await rag.deleteSource("a.txt");
      expect(deleted).toBeGreaterThan(0);
    });
  });

  describe("memory safety", () => {
    it("rejects operations after shutdown", async () => {
      await rag.shutdown();
      await expect(rag.indexText("text", "src")).rejects.toThrow(RagShutdownError);
      await expect(rag.search("query")).rejects.toThrow(RagShutdownError);
    });

    it("does not shutdown injected services", async () => {
      await rag.shutdown();
      // llm et vector NE doivent PAS être shutdown — gérés par DI
      expect(llm.shutdown).not.toHaveBeenCalled();
    });
  });
});

describe("FixedChunker", () => {
  it("validates chunkSize > 0", async () => {
    const { FixedChunker } = await import("../src/chunking/FixedChunker.js");
    const c = new FixedChunker();
    expect(() => c.chunk("text", { chunkSize: 0 })).toThrow();
  });

  it("validates chunkOverlap < chunkSize", async () => {
    const { FixedChunker } = await import("../src/chunking/FixedChunker.js");
    const c = new FixedChunker();
    expect(() => c.chunk("text", { chunkSize: 10, chunkOverlap: 10 })).toThrow();
  });

  it("returns empty for empty input", async () => {
    const { FixedChunker } = await import("../src/chunking/FixedChunker.js");
    const c = new FixedChunker();
    expect(c.chunk("")).toEqual([]);
    expect(c.chunk("   ")).toEqual([]);
  });
});

describe("SentenceChunker", () => {
  it("splits by sentence", async () => {
    const { SentenceChunker } = await import("../src/chunking/SentenceChunker.js");
    const c = new SentenceChunker();
    const chunks = c.chunk("Phrase un. Phrase deux. Phrase trois.", { chunkSize: 100 });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("groups sentences up to chunkSize", async () => {
    const { SentenceChunker } = await import("../src/chunking/SentenceChunker.js");
    const c = new SentenceChunker();
    const text = Array.from({ length: 10 }, (_, i) => `Phrase ${i}.`).join(" ");
    const chunks = c.chunk(text, { chunkSize: 4 });
    expect(chunks.length).toBeGreaterThan(1);
  });
});
