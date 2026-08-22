// @nodefony/vector — tests/PgVectorAdapter.test.ts
// Tests avec mock du Pool — pas de Postgres requis

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  PgVectorAdapter,
  type IPgPool,
} from "../src/adapters/PgVectorAdapter.js";
import {
  VectorError,
  VectorDimensionError,
} from "../src/errors/VectorErrors.js";

const createMockPool = (): IPgPool => ({
  query: mock(async (_sql: string, _params?: unknown[]) => ({ rows: [] })),
  end: mock(async () => undefined),
});

describe("PgVectorAdapter", () => {
  let pool: IPgPool;
  let adapter: PgVectorAdapter;

  beforeEach(async () => {
    pool = createMockPool();
    adapter = new PgVectorAdapter(
      {
        collection: "docs",
        dimensions: 3,
        connectionString: "postgres://test",
      },
      () => pool,
    );
    await adapter.init();
  });

  afterEach(async () => {
    await adapter.shutdown();
  });

  describe("validation des identifiants SQL", () => {
    it("rejette nom de collection avec injection SQL", () => {
      expect(
        () =>
          new PgVectorAdapter(
            {
              collection: "docs; DROP TABLE users;",
              dimensions: 3,
              connectionString: "x",
            },
            () => createMockPool(),
          ),
      ).toThrow(VectorError);
    });

    it("rejette nom de collection avec espaces", () => {
      expect(
        () =>
          new PgVectorAdapter(
            { collection: "my docs", dimensions: 3, connectionString: "x" },
            () => createMockPool(),
          ),
      ).toThrow(VectorError);
    });

    it("accepte nom alphanumérique", () => {
      expect(
        () =>
          new PgVectorAdapter(
            { collection: "my_docs_2", dimensions: 3, connectionString: "x" },
            () => createMockPool(),
          ),
      ).not.toThrow();
    });
  });

  describe("init", () => {
    it("crée l'extension et la table", async () => {
      const queryMock = pool.query as ReturnType<typeof mock>;
      const calls = queryMock.mock.calls;
      const sqls = calls.map((c) => c[0] as string);
      expect(sqls.some((s) => s.includes("CREATE EXTENSION"))).toBe(true);
      expect(sqls.some((s) => s.includes("CREATE TABLE"))).toBe(true);
      expect(sqls.some((s) => s.includes("hnsw"))).toBe(true);
    });
  });

  describe("insert", () => {
    it("rejette dimensions invalides", async () => {
      await expect(
        adapter.insert([
          {
            id: "a",
            vector: [1, 2],
            text: "",
            metadata: { source: "x" },
          },
        ]),
      ).rejects.toThrow(VectorDimensionError);
    });

    it("retourne tableau vide si pas d'entries", async () => {
      const ids = await adapter.insert([]);
      expect(ids).toEqual([]);
    });
  });

  describe("memory safety", () => {
    it("ferme le pool au shutdown", async () => {
      await adapter.shutdown();
      expect((pool.end as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    });

    it("shutdown idempotent", async () => {
      await adapter.shutdown();
      await adapter.shutdown(); // ne doit pas crasher
    });
  });
});
