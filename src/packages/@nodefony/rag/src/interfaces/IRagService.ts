// @nodefony/rag — src/interfaces/IRagService.ts

export interface IChunk {
  id: string;
  text: string;
  metadata: {
    source: string;
    page?: number;
    section?: string;
    date?: string;
    [key: string]: unknown;
  };
}

export interface ISearchResult {
  chunk: IChunk;
  score: number;
  rank?: number;
}

export type ChunkingStrategy = "fixed" | "sentence" | "paragraph";

export interface IIndexOptions {
  chunkSize?: number; // tokens, défaut 512
  chunkOverlap?: number; // tokens, défaut 50
  strategy?: ChunkingStrategy;
  metadata?: Record<string, unknown>;
}

export interface ISearchOptions {
  limit?: number;
  minScore?: number;
  filters?: Record<string, unknown>;
}

export interface IRagStats {
  totalChunks: number;
  totalSources: number;
  dimensions: number;
}

export interface IRagService {
  /**
   * Indexe un texte dans la base vectorielle.
   * Retourne le nombre de chunks créés.
   */
  indexText(
    text: string,
    source: string,
    options?: IIndexOptions,
  ): Promise<number>;

  /**
   * Recherche sémantique.
   */
  search(query: string, options?: ISearchOptions): Promise<ISearchResult[]>;

  /**
   * Supprime tous les chunks d'une source.
   */
  deleteSource(source: string): Promise<number>;

  /**
   * Statistiques du corpus.
   */
  getStats(): Promise<IRagStats>;

  /**
   * Cleanup ressources.
   */
  shutdown(): Promise<void>;
}

export interface IChunker {
  chunk(text: string, options?: IIndexOptions): string[];
}
