// @nodefony/rag — index.ts

export type {
  IRagService, IChunk, ISearchResult,
  IIndexOptions, ISearchOptions, IRagStats,
  IChunker, ChunkingStrategy,
} from "./src/interfaces/IRagService.js";

export { RagService } from "./src/services/RagService.js";
export { FixedChunker } from "./src/chunking/FixedChunker.js";
export { SentenceChunker } from "./src/chunking/SentenceChunker.js";

export {
  RagError, RagInvalidInputError, RagShutdownError,
} from "./src/errors/RagErrors.js";
