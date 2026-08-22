// @nodefony/memory — src/errors/MemoryErrors.ts

export class MemoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MemoryError";
  }
}

export class MemoryShutdownError extends MemoryError {
  constructor() {
    super("MemoryService has been shut down", "SHUTDOWN");
    this.name = "MemoryShutdownError";
  }
}

export class MemoryInvalidInputError extends MemoryError {
  constructor(reason: string) {
    super(`Invalid input: ${reason}`, "INVALID_INPUT");
    this.name = "MemoryInvalidInputError";
  }
}
