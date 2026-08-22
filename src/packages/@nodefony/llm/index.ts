// @nodefony/llm — index.ts
// Point d'entrée unique — tous les imports passent par ici

export type {
  ILLMProvider,
  ILLMConfig,
  IMessage,
  ILLMResponse,
  IStreamChunk,
  IChatOptions,
  IToolDefinition,
  IToolCall,
  ITokenUsage,
  LLMRole,
  LLMMode,
  LLMProviderName,
  StopReason,
} from "./src/interfaces/ILLMProvider.js";

export type { ILLMService } from "./src/services/LLMService.js";
export { LLMService } from "./src/services/LLMService.js";

export { ClaudeProvider } from "./src/providers/ClaudeProvider.js";
export { OllamaProvider } from "./src/providers/OllamaProvider.js";

export {
  LLMError,
  LLMRateLimitError,
  LLMTimeoutError,
  LLMProviderError,
  LLMAbortError,
  LLMEmbedNotSupportedError,
} from "./src/errors/LLMErrors.js";
