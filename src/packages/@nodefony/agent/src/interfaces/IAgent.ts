// @nodefony/agent — src/interfaces/IAgent.ts

export interface IAgentContext {
  sessionId: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface IAgentResult {
  content: string;
  toolsUsed?: string[];
  cost?: number;
  durationMs: number;
}

export type AgentEventType =
  | "started"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "token"
  | "completed"
  | "error";

export interface IAgentEvent {
  type: AgentEventType;
  content?: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  toolResult?: { name: string; result: unknown };
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface IAgent {
  readonly name: string;
  readonly description: string;

  /**
   * Exécute l'agent — réponse complète.
   */
  run(input: string, context: IAgentContext): Promise<IAgentResult>;

  /**
   * Exécute l'agent en streaming.
   */
  stream(input: string, context: IAgentContext): AsyncGenerator<IAgentEvent>;

  /**
   * Annule l'exécution en cours pour un sessionId.
   */
  abort(sessionId: string): void;

  /**
   * Cleanup ressources.
   */
  shutdown(): Promise<void>;
}

export interface ITool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>; // JSON Schema

  execute(
    input: Record<string, unknown>,
    context: IAgentContext,
  ): Promise<unknown>;
}
