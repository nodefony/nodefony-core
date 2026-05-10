// @nodefony/memory — src/interfaces/IMemoryService.ts

export interface IMemoryEntry {
  id:        string;
  agentId:   string;
  sessionId: string;
  role:      "user" | "assistant" | "system";
  content:   string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface IMemoryStats {
  totalEntries:  number;
  totalSessions: number;
  totalAgents:   number;
}

export interface IMemoryService {
  /**
   * Mémorise une entrée (court terme = session courante).
   */
  remember(entry: Omit<IMemoryEntry, "id" | "timestamp">): Promise<IMemoryEntry>;

  /**
   * Récupère les entrées récentes d'une session (court terme).
   */
  recall(agentId: string, sessionId: string, limit?: number): Promise<IMemoryEntry[]>;

  /**
   * Recherche sémantique dans la mémoire long terme.
   */
  search(agentId: string, query: string, limit?: number): Promise<IMemoryEntry[]>;

  /**
   * Promeut une session de la mémoire court terme vers long terme.
   * Appelé typiquement à la fin d'une session.
   */
  consolidate(agentId: string, sessionId: string): Promise<number>;

  /**
   * Supprime toute la mémoire d'un agent (RGPD — droit à l'oubli).
   */
  forget(agentId: string): Promise<number>;

  /**
   * Statistiques.
   */
  stats(): Promise<IMemoryStats>;

  /**
   * Cleanup ressources.
   */
  shutdown(): Promise<void>;
}
