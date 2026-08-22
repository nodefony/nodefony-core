// @nodefony/llm — src/providers/OllamaProvider.ts
// Adapter local souverain — tout local, rien ne sort

import type {
  ILLMProvider,
  ILLMConfig,
  IMessage,
  ILLMResponse,
  IStreamChunk,
  IChatOptions,
  LLMMode,
} from "../interfaces/ILLMProvider.js";
import {
  LLMError,
  LLMTimeoutError,
  LLMAbortError,
} from "../errors/LLMErrors.js";

export class OllamaProvider implements ILLMProvider {
  readonly name = "ollama" as const;
  readonly model: string;
  readonly mode: LLMMode = "sovereign";

  private readonly endpoint: string;
  private readonly maxTokens: number;
  private readonly timeout: number;

  private readonly activeControllers = new Set<AbortController>();
  private isShutdown = false;

  constructor(config: ILLMConfig) {
    this.endpoint = config.endpoint ?? "http://localhost:11434";
    this.model = config.model ?? "mistral:7b-instruct-q4";
    this.maxTokens = config.maxTokens ?? 4096;
    this.timeout = config.timeout ?? 120_000; // local peut être lent
  }

  async chat(
    messages: IMessage[],
    options?: IChatOptions,
  ): Promise<ILLMResponse> {
    this.assertReady();

    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: this.buildMessages(messages, options),
          stream: false,
          options: { num_predict: options?.maxTokens ?? this.maxTokens },
        }),
        signal: this.linkSignal(controller, options?.signal),
      });

      if (!response.ok) {
        throw new LLMError(`Ollama error ${response.status}`, "API_ERROR");
      }

      const data = (await response.json()) as OllamaResponse;

      return {
        content: data.message.content,
        model: data.model,
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
          costEur: 0,
        },
        stopReason: data.done ? "end_turn" : "max_tokens",
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        if (controller.signal.aborted) {
          throw new LLMTimeoutError("ollama", this.timeout);
        }
        throw new LLMAbortError("ollama");
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
      this.activeControllers.delete(controller);
    }
  }

  async *stream(
    messages: IMessage[],
    options?: IChatOptions,
  ): AsyncGenerator<IStreamChunk> {
    this.assertReady();

    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeout);

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: this.buildMessages(messages, options),
          stream: true,
        }),
        signal: this.linkSignal(controller, options?.signal),
      });

      if (!response.body)
        throw new LLMError("No response body", "STREAM_ERROR");

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as OllamaStreamEvent;
            if (event.message?.content) {
              yield { type: "token", content: event.message.content };
            }
            if (event.done) {
              yield {
                type: "done",
                content: "",
                usage: {
                  inputTokens: event.prompt_eval_count ?? 0,
                  outputTokens: event.eval_count ?? 0,
                  totalTokens:
                    (event.prompt_eval_count ?? 0) + (event.eval_count ?? 0),
                  costEur: 0,
                },
              };
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new LLMAbortError("ollama");
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
      if (reader) {
        try {
          reader.releaseLock();
        } catch {
          /* déjà libéré */
        }
      }
      this.activeControllers.delete(controller);
    }
  }

  async embed(text: string): Promise<number[]> {
    this.assertReady();
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.endpoint}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: controller.signal,
      });
      if (!response.ok) throw new LLMError("Ollama embed error", "EMBED_ERROR");
      const data = (await response.json()) as { embedding: number[] };
      return data.embedding;
    } finally {
      clearTimeout(timeoutHandle);
      this.activeControllers.delete(controller);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (this.isShutdown) return false;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { models?: { name: string }[] };
      return (
        data.models?.some((m) =>
          m.name.startsWith(this.model.split(":")[0]!),
        ) ?? false
      );
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    for (const controller of this.activeControllers) {
      try {
        controller.abort();
      } catch {
        /* OK */
      }
    }
    this.activeControllers.clear();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private assertReady(): void {
    if (this.isShutdown) {
      throw new LLMError("Provider has been shut down", "SHUTDOWN");
    }
  }

  private buildMessages(
    messages: IMessage[],
    options?: IChatOptions,
  ): IMessage[] {
    if (!options?.context) return messages;

    const result = [...messages];
    const sysIdx = result.findIndex((m) => m.role === "system");
    const ctxText = `\n\n<context>\n${options.context}\n</context>`;

    if (sysIdx >= 0) {
      result[sysIdx] = {
        ...result[sysIdx]!,
        content: result[sysIdx]!.content + ctxText,
      };
    } else {
      result.unshift({ role: "system", content: ctxText });
    }
    return result;
  }

  private linkSignal(
    internal: AbortController,
    external?: AbortSignal,
  ): AbortSignal {
    if (!external) return internal.signal;
    if (external.aborted) {
      internal.abort();
      return internal.signal;
    }
    external.addEventListener("abort", () => internal.abort(), { once: true });
    return internal.signal;
  }
}

interface OllamaResponse {
  model: string;
  message: { content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaStreamEvent {
  message?: { content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}
