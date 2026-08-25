// @nodefony/vector — src/errors/VectorErrors.ts

export class VectorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VectorError";
  }
}

export class VectorDimensionError extends VectorError {
  constructor(expected: number, actual: number) {
    super(
      `Vector dimension mismatch: expected ${expected}, got ${actual}`,
      "DIMENSION_MISMATCH",
      { expected, actual },
    );
    this.name = "VectorDimensionError";
  }
}

export class VectorConnectionError extends VectorError {
  constructor(adapter: string, cause: Error) {
    super(`${adapter} connection error: ${cause.message}`, "CONNECTION", {
      adapter,
    });
    this.name = "VectorConnectionError";
    this.cause = cause;
  }
}

export class VectorNotInitializedError extends VectorError {
  constructor(adapter: string) {
    super(`${adapter} not initialized — call init() first`, "NOT_INITIALIZED");
    this.name = "VectorNotInitializedError";
  }
}
