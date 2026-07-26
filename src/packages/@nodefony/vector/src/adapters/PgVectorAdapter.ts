// @nodefony/vector — src/adapters/PgVectorAdapter.ts
// Adapter PostgreSQL avec extension pgvector
// Usage : pg + pgvector pour la production

import type {
  IVectorStore,
  IVectorEntry,
  IVectorSearchOptions,
  IVectorSearchResult,
  IVectorStoreConfig,
} from "../interfaces/IVectorStore.js";
import {
  VectorError,
  VectorDimensionError,
  VectorConnectionError,
  VectorNotInitializedError,
} from "../errors/VectorErrors.js";

export interface IPgVectorConfig extends IVectorStoreConfig {
  connectionString: string;
}

// Interface minimale pour pg.Pool (pour ne pas dépendre de pg dans les types)
export interface IPgPool {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

/**
 * Adapter pgvector pour PostgreSQL.
 * Le client `pg.Pool` est injecté pour permettre les tests sans connexion réelle.
 */
export class PgVectorAdapter implements IVectorStore {
  readonly name = "pgvector";
  readonly collection: string;
  readonly dimensions: number;

  private pool: IPgPool | null = null;
  private initialized = false;
  private isShutdown = false;

  constructor(
    config: IPgVectorConfig,
    poolFactory: (connStr: string) => IPgPool,
  ) {
    this.collection = this.sanitizeName(config.collection);
    this.dimensions = config.dimensions;
    try {
      this.pool = poolFactory(config.connectionString);
    } catch (err) {
      throw new VectorConnectionError(this.name, err as Error);
    }
  }

  async init(): Promise<void> {
    if (!this.pool) throw new VectorNotInitializedError(this.name);
    if (this.initialized) return;

    try {
      // Active extension + crée la table
      await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector");
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ${this.collection} (
          id        TEXT PRIMARY KEY,
          vector    VECTOR(${this.dimensions}) NOT NULL,
          text      TEXT NOT NULL,
          metadata  JSONB NOT NULL DEFAULT '{}'
        )
      `);
      // Index HNSW pour recherche rapide
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS ${this.collection}_vector_hnsw
        ON ${this.collection} USING hnsw (vector vector_cosine_ops)
      `);
      this.initialized = true;
    } catch (err) {
      throw new VectorConnectionError(this.name, err as Error);
    }
  }

  async insert(entries: IVectorEntry[]): Promise<string[]> {
    this.assertReady();
    if (entries.length === 0) return [];

    for (const entry of entries) {
      if (entry.vector.length !== this.dimensions) {
        throw new VectorDimensionError(this.dimensions, entry.vector.length);
      }
    }

    // Insert en batch avec ON CONFLICT pour upsert
    const values: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    for (const entry of entries) {
      values.push(
        `($${paramIdx}, $${paramIdx + 1}::vector, $${paramIdx + 2}, $${paramIdx + 3}::jsonb)`,
      );
      params.push(
        entry.id,
        `[${entry.vector.join(",")}]`,
        entry.text,
        JSON.stringify(entry.metadata),
      );
      paramIdx += 4;
    }

    await this.pool!.query(
      `
      INSERT INTO ${this.collection} (id, vector, text, metadata)
      VALUES ${values.join(", ")}
      ON CONFLICT (id) DO UPDATE
      SET vector = EXCLUDED.vector,
          text = EXCLUDED.text,
          metadata = EXCLUDED.metadata
    `,
      params,
    );

    return entries.map((e) => e.id);
  }

  async search(
    queryVector: number[],
    options: IVectorSearchOptions = {},
  ): Promise<IVectorSearchResult[]> {
    this.assertReady();
    if (queryVector.length !== this.dimensions) {
      throw new VectorDimensionError(this.dimensions, queryVector.length);
    }

    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0;
    const vectorParam = `[${queryVector.join(",")}]`;

    let where = "";
    const params: unknown[] = [vectorParam, limit];

    if (options.filter) {
      const conditions: string[] = [];
      for (const [key, value] of Object.entries(options.filter)) {
        params.push(JSON.stringify(value));
        conditions.push(
          `metadata->>'${this.sanitizeName(key)}' = $${params.length}::text`,
        );
      }
      if (conditions.length) where = `WHERE ${conditions.join(" AND ")}`;
    }

    const result = await this.pool!.query<{
      id: string;
      vector_str: string;
      text: string;
      metadata: Record<string, unknown>;
      distance: number;
    }>(
      `
      SELECT id, vector::text AS vector_str, text, metadata,
             1 - (vector <=> $1::vector) AS score
      FROM ${this.collection}
      ${where}
      ORDER BY vector <=> $1::vector
      LIMIT $2
    `,
      params,
    );

    return result.rows
      .map((row, i) => ({
        entry: {
          id: row.id,
          vector: this.parseVector(row.vector_str),
          text: row.text,
          metadata: row.metadata as IVectorEntry["metadata"],
        },
        score: (row as unknown as { score: number }).score,
        rank: i + 1,
      }))
      .filter((r) => r.score >= minScore);
  }

  async delete(criteria: {
    ids?: string[];
    filter?: Record<string, unknown>;
  }): Promise<number> {
    this.assertReady();
    if (criteria.ids?.length) {
      const result = await this.pool!.query(
        `DELETE FROM ${this.collection} WHERE id = ANY($1::text[])`,
        [criteria.ids],
      );
      return (result as unknown as { rowCount?: number }).rowCount ?? 0;
    }
    if (criteria.filter) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      for (const [key, value] of Object.entries(criteria.filter)) {
        params.push(JSON.stringify(value));
        conditions.push(
          `metadata->>'${this.sanitizeName(key)}' = $${params.length}::text`,
        );
      }
      const result = await this.pool!.query(
        `DELETE FROM ${this.collection} WHERE ${conditions.join(" AND ")}`,
        params,
      );
      return (result as unknown as { rowCount?: number }).rowCount ?? 0;
    }
    return 0;
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    this.assertReady();
    if (!filter) {
      const result = await this.pool!.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.collection}`,
      );
      return parseInt(result.rows[0]?.count ?? "0", 10);
    }
    const conditions: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(filter)) {
      params.push(JSON.stringify(value));
      conditions.push(
        `metadata->>'${this.sanitizeName(key)}' = $${params.length}::text`,
      );
    }
    const result = await this.pool!.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${this.collection} WHERE ${conditions.join(" AND ")}`,
      params,
    );
    return parseInt(result.rows[0]?.count ?? "0", 10);
  }

  async stats() {
    return { totalEntries: await this.count(), dimensions: this.dimensions };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.pool || this.isShutdown) return false;
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {
        /* OK */
      }
      this.pool = null;
    }
  }

  private assertReady(): void {
    if (this.isShutdown || !this.pool)
      throw new VectorNotInitializedError(this.name);
    if (!this.initialized) throw new VectorNotInitializedError(this.name);
  }

  /** Sécurise les noms d'identifiants SQL (collection, clé metadata). */
  private sanitizeName(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new VectorError(`Invalid identifier: ${name}`, "INVALID_NAME");
    }
    return name;
  }

  private parseVector(str: string): number[] {
    return str.replace(/[[\]]/g, "").split(",").map(Number);
  }
}
