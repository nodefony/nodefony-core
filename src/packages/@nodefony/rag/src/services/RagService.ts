// @nodefony/rag — src/services/RagService.ts

import type { ILLMProvider } from "@nodefony/llm";
import type { IVectorStore, IVectorEntry } from "@nodefony/vector";
import type {
  IRagService, IChunk, ISearchResult, IIndexOptions,
  ISearchOptions, IRagStats, IChunker, ChunkingStrategy
} from "../interfaces/IRagService.js";
import { RagError, RagInvalidInputError, RagShutdownError } from "../errors/RagErrors.js";
import { FixedChunker } from "../chunking/FixedChunker.js";
import { SentenceChunker } from "../chunking/SentenceChunker.js";
import { createHash, randomUUID } from "node:crypto";

const MAX_TEXT_LENGTH = 10_000_000; // 10MB safety limit
const MAX_SOURCE_LENGTH = 1024;

export class RagService implements IRagService {
  private readonly chunkers: Record<ChunkingStrategy, IChunker>;
  private isShutdown = false;

  constructor(
    private readonly llm:    ILLMProvider,
    private readonly vector: IVectorStore,
  ) {
    this.chunkers = {
      fixed:     new FixedChunker(),
      sentence:  new SentenceChunker(),
      paragraph: new SentenceChunker(),
    };
  }

  async indexText(text: string, source: string, options: IIndexOptions = {}): Promise<number> {
    this.assertReady();
    this.validateInput(text, source);

    const strategy = options.strategy ?? "sentence";
    const chunker  = this.chunkers[strategy];
    if (!chunker) {
      throw new RagInvalidInputError(`Unknown strategy: ${strategy}`);
    }

    const textChunks = chunker.chunk(text, options);
    if (textChunks.length === 0) return 0;

    const sourceHash = createHash("sha256").update(text).digest("hex");

    // Embed les chunks séquentiellement (parallèle peut hit le rate limit)
    const entries: IVectorEntry[] = [];
    for (const chunkText of textChunks) {
      const vector = await this.llm.embed(chunkText);
      entries.push({
        id:       randomUUID(),
        vector,
        text:     chunkText,
        metadata: {
          source,
          hash: sourceHash,
          ...(options.metadata ?? {}),
        },
      });
    }

    await this.vector.insert(entries);
    return entries.length;
  }

  async search(query: string, options: ISearchOptions = {}): Promise<ISearchResult[]> {
    this.assertReady();
    if (!query || query.trim().length === 0) {
      throw new RagInvalidInputError("query is empty");
    }
    if (query.length > 10_000) {
      throw new RagInvalidInputError("query too long (max 10000 chars)");
    }

    const queryVector = await this.llm.embed(query);
    const results = await this.vector.search(queryVector, {
      limit:    options.limit,
      minScore: options.minScore,
      filter:   options.filters,
    });

    return results.map(r => ({
      chunk: {
        id:       r.entry.id,
        text:     r.entry.text,
        metadata: r.entry.metadata,
      } as IChunk,
      score: r.score,
      rank:  r.rank,
    }));
  }

  async deleteSource(source: string): Promise<number> {
    this.assertReady();
    if (!source) throw new RagInvalidInputError("source is required");
    return this.vector.delete({ filter: { source } });
  }

  async getStats(): Promise<IRagStats> {
    this.assertReady();
    const stats = await this.vector.stats();
    // Pour totalSources, on compte les sources distinctes — coûteux mais OK pour stats
    // Délégué au backend sinon
    return {
      totalChunks:  stats.totalEntries,
      totalSources: 0, // TODO: query distinct sur metadata.source côté adapter
      dimensions:   stats.dimensions,
    };
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    // Note : ne pas shutdown llm/vector — ils sont gérés par le DI Container
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private assertReady(): void {
    if (this.isShutdown) throw new RagShutdownError();
  }

  private validateInput(text: string, source: string): void {
    if (!text || text.trim().length === 0) {
      throw new RagInvalidInputError("text is empty");
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw new RagInvalidInputError(`text exceeds ${MAX_TEXT_LENGTH} chars`);
    }
    if (!source || source.trim().length === 0) {
      throw new RagInvalidInputError("source is required");
    }
    if (source.length > MAX_SOURCE_LENGTH) {
      throw new RagInvalidInputError(`source exceeds ${MAX_SOURCE_LENGTH} chars`);
    }
  }
}
