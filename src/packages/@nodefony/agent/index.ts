// @nodefony/agent — index.ts

export type {
  IAgent,
  IAgentContext,
  IAgentResult,
  IAgentEvent,
  AgentEventType,
  ITool,
} from "./src/interfaces/IAgent.js";

export { ToolRegistry } from "./src/tools/ToolRegistry.js";

export {
  AgentError,
  AgentShutdownError,
  AgentAbortedError,
  ToolNotFoundError,
  ToolExecutionError,
  ToolValidationError,
  AgentMaxIterationsError,
} from "./src/errors/AgentErrors.js";
