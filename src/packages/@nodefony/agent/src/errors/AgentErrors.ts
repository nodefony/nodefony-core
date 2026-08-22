// @nodefony/agent — src/errors/AgentErrors.ts

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export class AgentShutdownError extends AgentError {
  constructor() {
    super("Agent has been shut down", "SHUTDOWN");
    this.name = "AgentShutdownError";
  }
}

export class AgentAbortedError extends AgentError {
  constructor(sessionId: string) {
    super(`Agent execution aborted for session ${sessionId}`, "ABORTED", {
      sessionId,
    });
    this.name = "AgentAbortedError";
  }
}

export class ToolNotFoundError extends AgentError {
  constructor(name: string) {
    super(`Tool not found: ${name}`, "TOOL_NOT_FOUND", { name });
    this.name = "ToolNotFoundError";
  }
}

export class ToolExecutionError extends AgentError {
  constructor(name: string, cause: Error) {
    super(`Tool ${name} execution failed: ${cause.message}`, "TOOL_EXECUTION", {
      name,
    });
    this.name = "ToolExecutionError";
    this.cause = cause;
  }
}

export class ToolValidationError extends AgentError {
  constructor(name: string, errors: string[]) {
    super(
      `Tool ${name} input validation failed: ${errors.join(", ")}`,
      "TOOL_VALIDATION",
      { name, errors },
    );
    this.name = "ToolValidationError";
  }
}

export class AgentMaxIterationsError extends AgentError {
  constructor(max: number) {
    super(`Agent exceeded max iterations (${max})`, "MAX_ITERATIONS", { max });
    this.name = "AgentMaxIterationsError";
  }
}
