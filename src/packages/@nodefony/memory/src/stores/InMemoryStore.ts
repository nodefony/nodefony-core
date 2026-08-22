// @nodefony/memory — src/stores/InMemoryStore.ts
// Store court terme en mémoire — borné par session
// Important : limite stricte pour éviter fuite mémoire

import type { IMemoryEntry } from "../interfaces/IMemoryService.js";

export interface IInMemoryStoreConfig {
  maxEntriesPerSession?: number; // défaut 100
  maxSessions?: number; // défaut 1000
  sessionTtlMs?: number; // défaut 1h
}

export class InMemoryStore {
  private readonly maxEntriesPerSession: number;
  private readonly maxSessions: number;
  private readonly sessionTtlMs: number;

  // sessionId -> entries[]
  private sessions = new Map<string, IMemoryEntry[]>();
  // sessionId -> last access timestamp (pour TTL/LRU)
  private lastAccess = new Map<string, number>();

  // Cleanup timer
  private cleanupHandle: ReturnType<typeof setInterval> | null = null;
  private isShutdown = false;

  constructor(config: IInMemoryStoreConfig = {}) {
    this.maxEntriesPerSession = config.maxEntriesPerSession ?? 100;
    this.maxSessions = config.maxSessions ?? 1000;
    this.sessionTtlMs = config.sessionTtlMs ?? 3_600_000;

    // Cleanup périodique des sessions expirées
    this.cleanupHandle = setInterval(() => this.cleanupExpired(), 60_000);
    // Permettre au process de finir si seul ce timer tourne
    if (
      this.cleanupHandle &&
      typeof (this.cleanupHandle as unknown as { unref?: () => void }).unref ===
        "function"
    ) {
      (this.cleanupHandle as unknown as { unref: () => void }).unref();
    }
  }

  add(entry: IMemoryEntry): void {
    if (this.isShutdown) return;

    let entries = this.sessions.get(entry.sessionId);
    if (!entries) {
      // Évincer la session la plus ancienne si on dépasse maxSessions
      if (this.sessions.size >= this.maxSessions) {
        const oldest = this.findOldestSession();
        if (oldest) this.evictSession(oldest);
      }
      entries = [];
      this.sessions.set(entry.sessionId, entries);
    }

    entries.push(entry);

    // FIFO : si on dépasse maxEntriesPerSession, on supprime le plus ancien
    if (entries.length > this.maxEntriesPerSession) {
      entries.shift();
    }

    this.lastAccess.set(entry.sessionId, Date.now());
  }

  get(sessionId: string, limit?: number): IMemoryEntry[] {
    if (this.isShutdown) return [];
    const entries = this.sessions.get(sessionId);
    if (!entries) return [];
    this.lastAccess.set(sessionId, Date.now());
    return limit ? entries.slice(-limit) : [...entries];
  }

  getAll(agentId: string): IMemoryEntry[] {
    if (this.isShutdown) return [];
    const result: IMemoryEntry[] = [];
    for (const entries of this.sessions.values()) {
      for (const e of entries) {
        if (e.agentId === agentId) result.push(e);
      }
    }
    return result;
  }

  removeSession(sessionId: string): number {
    const entries = this.sessions.get(sessionId);
    if (!entries) return 0;
    const count = entries.length;
    this.sessions.delete(sessionId);
    this.lastAccess.delete(sessionId);
    return count;
  }

  removeAgent(agentId: string): number {
    let removed = 0;
    for (const [sessionId, entries] of this.sessions) {
      if (entries.some((e) => e.agentId === agentId)) {
        removed += entries.filter((e) => e.agentId === agentId).length;
        const filtered = entries.filter((e) => e.agentId !== agentId);
        if (filtered.length === 0) {
          this.sessions.delete(sessionId);
          this.lastAccess.delete(sessionId);
        } else {
          this.sessions.set(sessionId, filtered);
        }
      }
    }
    return removed;
  }

  size(): { sessions: number; entries: number } {
    let entries = 0;
    for (const e of this.sessions.values()) entries += e.length;
    return { sessions: this.sessions.size, entries };
  }

  shutdown(): void {
    this.isShutdown = true;
    if (this.cleanupHandle) {
      clearInterval(this.cleanupHandle);
      this.cleanupHandle = null;
    }
    this.sessions.clear();
    this.lastAccess.clear();
  }

  private findOldestSession(): string | null {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [sid, time] of this.lastAccess) {
      if (time < oldestTime) {
        oldestTime = time;
        oldest = sid;
      }
    }
    return oldest;
  }

  private evictSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.lastAccess.delete(sessionId);
  }

  private cleanupExpired(): void {
    if (this.isShutdown) return;
    const now = Date.now();
    for (const [sid, lastAt] of this.lastAccess) {
      if (now - lastAt > this.sessionTtlMs) {
        this.evictSession(sid);
      }
    }
  }
}
