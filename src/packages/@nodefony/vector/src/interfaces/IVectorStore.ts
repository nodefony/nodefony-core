// @nodefony/vector — src/interfaces/IVectorStore.ts

export interface IVectorMetadata {
  source: string;
  page?: number;
  section?: string;
  date?: string; // ISO 8601
  hash?: string; // SHA-256 du contenu original
  [key: string]: unknown;
}

export interface IVectorEntry {
  id: string;
  vector: number[];
  text: string;
  metadata: IVectorMetadata;
}

export interface IVectorSearchResult {
  entry: IVectorEntry;
  score: number; // similarité cosinus 0.0 → 1.0
  rank?: number;
}

export interface IVectorSearchOptions {
  limit?: number;
  minScore?: number;
  filter?: Record<string, unknown>;
}

export interface IVectorStoreConfig {
  collection: string;
  dimensions: number;
  distance?: "cosine" | "euclidean" | "dotproduct";
}

export interface IVectorStore {
  readonly name: string;
  readonly collection: string;
  readonly dimensions: number;

  /**
   * Initialise le store (crée la collection si nécessaire).
   * Idempotent — peut être appelé plusieurs fois.
   */
  init(): Promise<void>;

  /**
   * Insère un ou plusieurs vecteurs.
   * Retourne les IDs créés (ou ceux fournis).
   */
  insert(entries: IVectorEntry[]): Promise<string[]>;

  /**
   * Recherche par similarité.
   */
  search(
    queryVector: number[],
    options?: IVectorSearchOptions,
  ): Promise<IVectorSearchResult[]>;

  /**
   * Supprime des entrées par IDs ou par filtre.
   */
  delete(criteria: {
    ids?: string[];
    filter?: Record<string, unknown>;
  }): Promise<number>;

  /**
   * Compte les entrées (avec filtre optionnel).
   */
  count(filter?: Record<string, unknown>): Promise<number>;

  /**
   * Statistiques de la collection.
   */
  stats(): Promise<{ totalEntries: number; dimensions: number }>;

  /**
   * Vérifie que le store est accessible.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Cleanup ressources (connexions DB, etc.).
   */
  shutdown(): Promise<void>;
}
