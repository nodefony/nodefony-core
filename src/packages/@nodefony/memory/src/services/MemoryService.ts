// @nodefony/memory — src/services/MemoryService.ts

import type { ILLMProvider } from "@nodefony/llm";
import type { IVectorStore } from "@nodefony/vector";
import type { IMemoryService, IMemoryEntry, IMemoryStats } from "../interfaces/IMemoryService.js";
import { MemoryShutdownError, MemoryInvalidInputError } from "../errors/MemoryErrors.js";
import { InMemoryStore, type IInMemoryStoreConfig } from "../stores/InMemoryStore.js";
import { randomUUID } from "node:crypto";

const MAX_CONTENT_LENGTH = 100_000;

export interface IMemoryServiceConfig {
  shortTerm?: IInMemoryStoreConfig;
}

export class MemoryService implements IMemoryService {
  private readonly shortTerm: InMemoryStore;
  private isShutdown = false;

  constructor(
    private readonly llm:    ILLMProvider,
    private readonly vector: IVectorStore,
    config: IMemoryServiceConfig = {}
  ) {
    this.shortTerm = new InMemoryStore(config.shortTerm);
  }

  async remember(entry: Omit<IMemoryEntry, "id" | "timestamp">): Promise<IMemoryEntry> {
    this.assertReady();
    this.validateEntry(entry);

    const fullEntry: IMemoryEntry = {
      ...entry,
      id:        randomUUID(),
      timestamp: new Date(),
    };

    // Court terme — toujours
    this.shortTerm.add(fullEntry);
    return fullEntry;
  }

  async recall(agentId: string, sessionId: string, limit = 50): Promise<IMemoryEntry[]> {
    this.assertReady();
    if (!agentId || !sessionId) {
      throw new MemoryInvalidInputError("agentId and sessionId required");
    }
    if (limit <= 0 || limit > 1000) {
      throw new MemoryInvalidInputError("limit must be in [1, 1000]");
    }

    return this.shortTerm
      .get(sessionId, limit)
      .filter(e => e.agentId === agentId);
  }

  async search(agentId: string, query: string, limit = 5): Promise<IMemoryEntry[]> {
    this.assertReady();
    if (!agentId || !query) {
      throw new MemoryInvalidInputError("agentId and query required");
    }
    if (query.length > 10_000) {
      throw new MemoryInvalidInputError("query too long");
    }

    const queryVector = await this.llm.embed(query);
    const results = await this.vector.search(queryVector, {
      limit,
      filter: { agentId },
    });

    return results.map(r => ({
      id:        r.entry.id,
      agentId,
      sessionId: r.entry.metadata.sessionId as string ?? "",
      role:      (r.entry.metadata.role as IMemoryEntry["role"]) ?? "user",
      content:   r.entry.text,
      timestamp: r.entry.metadata.timestamp
        ? new Date(r.entry.metadata.timestamp as string)
        : new Date(),
      metadata:  r.entry.metadata as Record<string, unknown>,
    }));
  }

  async consolidate(agentId: string, sessionId: string): Promise<number> {
    this.assertReady();
    if (!agentId || !sessionId) {
      throw new MemoryInvalidInputError("agentId and sessionId required");
    }

    const entries = this.shortTerm.get(sessionId).filter(e => e.agentId === agentId);
    if (entries.length === 0) return 0;

    let consolidated = 0;
    for (const entry of entries) {
      try {
        const vector = await this.llm.embed(entry.content);
        await this.vector.insert([{
          id:     entry.id,
          vector,
          text:   entry.content,
          metadata: {
            source:    `agent:${agentId}`,
            agentId,
            sessionId: entry.sessionId,
            role:      entry.role,
            timestamp: entry.timestamp.toISOString(),
            ...(entry.metadata ?? {}),
          },
        }]);
        consolidated++;
      } catch {
        // continue avec les suivants — log dans une vraie impl
      }
    }
    return consolidated;
  }

  async forget(agentId: string): Promise<number> {
    this.assertReady();
    if (!agentId) throw new MemoryInvalidInputError("agentId required");

    const shortRemoved = this.shortTerm.removeAgent(agentId);
    const longRemoved  = await this.vector.delete({ filter: { agentId } });
    return shortRemoved + longRemoved;
  }

  async stats(): Promise<IMemoryStats> {
    this.assertReady();
    const shortSize = this.shortTerm.size();
    const vectorStats = await this.vector.stats();

    return {
      totalEntries:  shortSize.entries + vectorStats.totalEntries,
      totalSessions: shortSize.sessions,
      totalAgents:   0, // requiert query distinct
    };
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    this.shortTerm.shutdown();
  }

  private assertReady(): void {
    if (this.isShutdown) throw new MemoryShutdownError();
  }

  private validateEntry(entry: Omit<IMemoryEntry, "id" | "timestamp">): void {
    if (!entry.agentId) throw new MemoryInvalidInputError("agentId required");
    if (!entry.sessionId) throw new MemoryInvalidInputError("sessionId required");
    if (!entry.content) throw new MemoryInvalidInputError("content required");
    if (entry.content.length > MAX_CONTENT_LENGTH) {
      throw new MemoryInvalidInputError(`content exceeds ${MAX_CONTENT_LENGTH} chars`);
    }
    if (!["user", "assistant", "system"].includes(entry.role)) {
      throw new MemoryInvalidInputError(`invalid role: ${entry.role}`);
    }
  }
}
