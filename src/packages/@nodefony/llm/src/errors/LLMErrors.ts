// @nodefony/llm — src/errors/LLMErrors.ts

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export class LLMRateLimitError extends LLMError {
  constructor(provider: string, retryAfterSeconds: number) {
    super(
      `${provider} rate limit exceeded. Retry after ${retryAfterSeconds}s`,
      "RATE_LIMIT",
      { provider, retryAfterSeconds },
    );
    this.name = "LLMRateLimitError";
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(provider: string, timeoutMs: number) {
    super(`${provider} request timed out after ${timeoutMs}ms`, "TIMEOUT", {
      provider,
      timeoutMs,
    });
    this.name = "LLMTimeoutError";
  }
}

export class LLMProviderError extends LLMError {
  constructor(provider: string, cause: Error) {
    super(`${provider} provider error: ${cause.message}`, "PROVIDER_ERROR", {
      provider,
    });
    this.name = "LLMProviderError";
    this.cause = cause;
  }
}

export class LLMAbortError extends LLMError {
  constructor(provider: string) {
    super(`${provider} request aborted`, "ABORTED", { provider });
    this.name = "LLMAbortError";
  }
}

export class LLMEmbedNotSupportedError extends LLMError {
  constructor(provider: string) {
    super(
      `${provider} does not support embeddings natively`,
      "EMBED_NOT_SUPPORTED",
      { provider },
    );
    this.name = "LLMEmbedNotSupportedError";
  }
}
