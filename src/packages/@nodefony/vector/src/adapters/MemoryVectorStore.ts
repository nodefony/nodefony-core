// @nodefony/vector — src/adapters/MemoryVectorStore.ts
// In-memory vector store — pour tests et dev local
// Implémente la similarité cosinus simple

import type {
  IVectorStore, IVectorEntry, IVectorSearchOptions,
  IVectorSearchResult, IVectorStoreConfig
} from "../interfaces/IVectorStore.js";
import { VectorDimensionError, VectorNotInitializedError } from "../errors/VectorErrors.js";

export class MemoryVectorStore implements IVectorStore {
  readonly name = "memory";
  readonly collection: string;
  readonly dimensions: number;

  private entries = new Map<string, IVectorEntry>();
  private initialized = false;
  private isShutdown = false;

  constructor(config: IVectorStoreConfig) {
    this.collection = config.collection;
    this.dimensions = config.dimensions;
  }

  async init(): Promise<void> {
    this.initialized = true;
  }

  async insert(entries: IVectorEntry[]): Promise<string[]> {
    this.assertReady();
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.vector.length !== this.dimensions) {
        throw new VectorDimensionError(this.dimensions, entry.vector.length);
      }
      this.entries.set(entry.id, entry);
      ids.push(entry.id);
    }
    return ids;
  }

  async search(
    queryVector: number[],
    options: IVectorSearchOptions = {}
  ): Promise<IVectorSearchResult[]> {
    this.assertReady();

    if (queryVector.length !== this.dimensions) {
      throw new VectorDimensionError(this.dimensions, queryVector.length);
    }

    const limit    = options.limit ?? 5;
    const minScore = options.minScore ?? 0;

    const results: IVectorSearchResult[] = [];

    for (const entry of this.entries.values()) {
      // Filtrage metadata si fourni
      if (options.filter && !this.matchesFilter(entry, options.filter)) continue;

      const score = this.cosineSimilarity(queryVector, entry.vector);
      if (score >= minScore) {
        results.push({ entry, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  async delete(criteria: { ids?: string[]; filter?: Record<string, unknown> }): Promise<number> {
    this.assertReady();
    let deleted = 0;
    if (criteria.ids) {
      for (const id of criteria.ids) {
        if (this.entries.delete(id)) deleted++;
      }
    } else if (criteria.filter) {
      for (const [id, entry] of this.entries) {
        if (this.matchesFilter(entry, criteria.filter)) {
          this.entries.delete(id);
          deleted++;
        }
      }
    }
    return deleted;
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    this.assertReady();
    if (!filter) return this.entries.size;
    let count = 0;
    for (const entry of this.entries.values()) {
      if (this.matchesFilter(entry, filter)) count++;
    }
    return count;
  }

  async stats() {
    this.assertReady();
    return { totalEntries: this.entries.size, dimensions: this.dimensions };
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized && !this.isShutdown;
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    this.entries.clear();
  }

  private assertReady(): void {
    if (this.isShutdown) throw new VectorNotInitializedError(this.name);
    if (!this.initialized) throw new VectorNotInitializedError(this.name);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot   += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private matchesFilter(entry: IVectorEntry, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      const entryValue = (entry.metadata as Record<string, unknown>)[key];
      if (entryValue !== value) return false;
    }
    return true;
  }
}
