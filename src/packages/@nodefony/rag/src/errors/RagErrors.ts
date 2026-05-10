// @nodefony/rag — src/errors/RagErrors.ts

export class RagError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RagError";
  }
}

export class RagInvalidInputError extends RagError {
  constructor(reason: string) {
    super(`Invalid input: ${reason}`, "INVALID_INPUT");
    this.name = "RagInvalidInputError";
  }
}

export class RagShutdownError extends RagError {
  constructor() {
    super("RagService has been shut down", "SHUTDOWN");
    this.name = "RagShutdownError";
  }
}
