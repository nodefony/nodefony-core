// @nodefony/memory — index.ts

export type {
  IMemoryService, IMemoryEntry, IMemoryStats,
} from "./src/interfaces/IMemoryService.js";

export type { IMemoryServiceConfig } from "./src/services/MemoryService.js";
export { MemoryService } from "./src/services/MemoryService.js";

export type { IInMemoryStoreConfig } from "./src/stores/InMemoryStore.js";
export { InMemoryStore } from "./src/stores/InMemoryStore.js";

export {
  MemoryError, MemoryShutdownError, MemoryInvalidInputError,
} from "./src/errors/MemoryErrors.js";
