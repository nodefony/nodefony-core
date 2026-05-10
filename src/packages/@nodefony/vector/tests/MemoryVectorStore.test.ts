// @nodefony/vector — tests/MemoryVectorStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MemoryVectorStore } from "../src/adapters/MemoryVectorStore.js";
import { VectorDimensionError, VectorNotInitializedError } from "../src/errors/VectorErrors.js";
import type { IVectorEntry } from "../src/interfaces/IVectorStore.js";

const makeEntry = (id: string, vector: number[], text = "", source = "test"): IVectorEntry => ({
  id, vector, text, metadata: { source },
});

describe("MemoryVectorStore", () => {
  let store: MemoryVectorStore;

  beforeEach(async () => {
    store = new MemoryVectorStore({ collection: "test", dimensions: 3 });
    await store.init();
  });

  afterEach(async () => {
    await store.shutdown();
  });

  describe("init/shutdown", () => {
    it("init is idempotent", async () => {
      await store.init();
      await store.init();
      expect(await store.healthCheck()).toBe(true);
    });

    it("rejects operations before init", async () => {
      const fresh = new MemoryVectorStore({ collection: "x", dimensions: 3 });
      await expect(fresh.insert([])).rejects.toThrow(VectorNotInitializedError);
    });

    it("shutdown clears all entries", async () => {
      await store.insert([makeEntry("a", [1, 0, 0])]);
      expect(await store.count()).toBe(1);
      await store.shutdown();
      expect(await store.healthCheck()).toBe(false);
    });

    it("rejects operations after shutdown", async () => {
      await store.shutdown();
      await expect(store.insert([])).rejects.toThrow(VectorNotInitializedError);
    });
  });

  describe("insert", () => {
    it("inserts entries and returns IDs", async () => {
      const ids = await store.insert([
        makeEntry("a", [1, 0, 0]),
        makeEntry("b", [0, 1, 0]),
      ]);
      expect(ids).toEqual(["a", "b"]);
    });

    it("rejects vectors with wrong dimensions", async () => {
      await expect(store.insert([makeEntry("a", [1, 0])]))
        .rejects.toThrow(VectorDimensionError);
    });

    it("upserts on duplicate ID", async () => {
      await store.insert([makeEntry("a", [1, 0, 0])]);
      await store.insert([makeEntry("a", [0, 1, 0])]);
      expect(await store.count()).toBe(1);
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await store.insert([
        makeEntry("a", [1, 0, 0], "text-a", "src1"),
        makeEntry("b", [0, 1, 0], "text-b", "src2"),
        makeEntry("c", [0.9, 0.1, 0], "text-c", "src1"),
      ]);
    });

    it("returns top-K results sorted by score", async () => {
      const results = await store.search([1, 0, 0], { limit: 2 });
      expect(results.length).toBe(2);
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
      expect(results[0]!.entry.id).toBe("a"); // identique → score 1
    });

    it("filters by minScore", async () => {
      const results = await store.search([1, 0, 0], { minScore: 0.95 });
      // Seul "a" (score 1.0) passe — "c" est ~0.99
      expect(results.every(r => r.score >= 0.95)).toBe(true);
    });

    it("filters by metadata", async () => {
      const results = await store.search([1, 0, 0], { filter: { source: "src1" } });
      expect(results.every(r => r.entry.metadata.source === "src1")).toBe(true);
      expect(results.length).toBe(2);
    });

    it("rejects query with wrong dimensions", async () => {
      await expect(store.search([1, 0])).rejects.toThrow(VectorDimensionError);
    });

    it("returns empty for orthogonal query", async () => {
      const results = await store.search([0, 0, 1], { minScore: 0.5 });
      expect(results.length).toBe(0);
    });
  });

  describe("delete", () => {
    beforeEach(async () => {
      await store.insert([
        makeEntry("a", [1, 0, 0], "", "src1"),
        makeEntry("b", [0, 1, 0], "", "src2"),
        makeEntry("c", [0, 0, 1], "", "src1"),
      ]);
    });

    it("deletes by IDs", async () => {
      const deleted = await store.delete({ ids: ["a", "b"] });
      expect(deleted).toBe(2);
      expect(await store.count()).toBe(1);
    });

    it("deletes by filter", async () => {
      const deleted = await store.delete({ filter: { source: "src1" } });
      expect(deleted).toBe(2);
      expect(await store.count()).toBe(1);
    });

    it("returns 0 for unknown criteria", async () => {
      const deleted = await store.delete({ ids: ["zzz"] });
      expect(deleted).toBe(0);
    });
  });

  describe("count", () => {
    it("counts all entries", async () => {
      await store.insert([makeEntry("a", [1, 0, 0]), makeEntry("b", [0, 1, 0])]);
      expect(await store.count()).toBe(2);
    });

    it("counts filtered entries", async () => {
      await store.insert([
        makeEntry("a", [1, 0, 0], "", "src1"),
        makeEntry("b", [0, 1, 0], "", "src2"),
      ]);
      expect(await store.count({ source: "src1" })).toBe(1);
    });
  });

  describe("memory safety", () => {
    it("clears all entries on shutdown", async () => {
      for (let i = 0; i < 100; i++) {
        await store.insert([makeEntry(`id-${i}`, [1, 0, 0])]);
      }
      await store.shutdown();
      // Le store ne doit plus avoir aucune référence interne
      expect(await store.healthCheck()).toBe(false);
    });
  });
});
