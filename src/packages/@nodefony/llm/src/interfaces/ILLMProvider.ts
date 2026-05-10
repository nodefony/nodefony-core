// @nodefony/llm — src/interfaces/ILLMProvider.ts

export type LLMRole = "system" | "user" | "assistant" | "tool";

export interface IMessage {
  role:    LLMRole;
  content: string;
  name?:   string;
  toolCallId?: string;
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "tool_use"
  | "stop_sequence"
  | "error"
  | "aborted";

export interface ITokenUsage {
  inputTokens:  number;
  outputTokens: number;
  totalTokens:  number;
  costEur:      number;
}

export interface IToolCall {
  id:        string;
  name:      string;
  arguments: Record<string, unknown>;
}

export interface ILLMResponse {
  content:    string;
  model:      string;
  usage:      ITokenUsage;
  stopReason: StopReason;
  toolCalls?: IToolCall[];
}

export interface IStreamChunk {
  type:      "token" | "tool_call" | "done" | "error";
  content:   string;
  usage?:    ITokenUsage;
  toolCall?: IToolCall;
  error?:    string;
}

export interface IToolDefinition {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface IChatOptions {
  context?:     string;
  system?:      string;
  tools?:       IToolDefinition[];
  maxTokens?:   number;
  temperature?: number;
  signal?:      AbortSignal;
  metadata?:    Record<string, unknown>;
}

export type LLMProviderName = "claude" | "gemini" | "ollama" | "openai";
export type LLMMode = "cloud" | "sovereign";

export interface ILLMConfig {
  provider:     LLMProviderName;
  model:        string;
  apiKey?:      string;
  endpoint?:    string;
  maxTokens?:   number;
  temperature?: number;
  mode?:        LLMMode;
  timeout?:     number;
  maxRetries?:  number;
}

export interface ILLMProvider {
  readonly name:  LLMProviderName;
  readonly model: string;
  readonly mode:  LLMMode;

  chat(messages: IMessage[], options?: IChatOptions): Promise<ILLMResponse>;
  stream(messages: IMessage[], options?: IChatOptions): AsyncGenerator<IStreamChunk>;
  embed(text: string): Promise<number[]>;
  healthCheck(): Promise<boolean>;
  shutdown(): Promise<void>;
}
