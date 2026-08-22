// @nodefony/vector — index.ts

export type {
  IVectorStore,
  IVectorEntry,
  IVectorMetadata,
  IVectorSearchOptions,
  IVectorSearchResult,
  IVectorStoreConfig,
} from "./src/interfaces/IVectorStore.js";

export { MemoryVectorStore } from "./src/adapters/MemoryVectorStore.js";
export type {
  IPgVectorConfig,
  IPgPool,
} from "./src/adapters/PgVectorAdapter.js";
export { PgVectorAdapter } from "./src/adapters/PgVectorAdapter.js";

export {
  VectorError,
  VectorDimensionError,
  VectorConnectionError,
  VectorNotInitializedError,
} from "./src/errors/VectorErrors.js";
