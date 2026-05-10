// @nodefony/llm — src/providers/ClaudeProvider.ts
// Adapter Anthropic Claude API avec gestion fuites mémoire

import type {
  ILLMProvider, ILLMConfig, IMessage, ILLMResponse,
  IStreamChunk, IChatOptions, LLMMode
} from "../interfaces/ILLMProvider.js";
import {
  LLMError, LLMRateLimitError, LLMTimeoutError,
  LLMAbortError, LLMEmbedNotSupportedError
} from "../errors/LLMErrors.js";

// Tarifs Claude Sonnet 4.6 (€/1M tokens — vérifier docs Anthropic)
const COST_INPUT_EUR_PER_1M  = 2.70;
const COST_OUTPUT_EUR_PER_1M = 13.50;

export class ClaudeProvider implements ILLMProvider {
  readonly name  = "claude" as const;
  readonly model: string;
  readonly mode:  LLMMode = "cloud";

  private readonly apiKey:     string;
  private readonly endpoint:   string;
  private readonly maxTokens:  number;
  private readonly timeout:    number;
  private readonly maxRetries: number;

  // Cleanup mémoire — toutes les requêtes en cours
  private readonly activeControllers = new Set<AbortController>();
  private isShutdown = false;

  constructor(config: ILLMConfig) {
    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new LLMError("Claude API key required", "MISSING_API_KEY");
    }
    this.apiKey     = config.apiKey;
    this.model      = config.model     ?? "claude-sonnet-4-6";
    this.endpoint   = config.endpoint  ?? "https://api.anthropic.com";
    this.maxTokens  = config.maxTokens ?? 4096;
    this.timeout    = config.timeout   ?? 60_000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  async chat(messages: IMessage[], options?: IChatOptions): Promise<ILLMResponse> {
    this.assertReady();
    const body = this.buildRequestBody(messages, options);
    const response = await this.fetchWithTimeout(
      `${this.endpoint}/v1/messages`,
      { method: "POST", headers: this.headers(), body: JSON.stringify({ ...body, stream: false }) },
      options?.signal
    );
    const data = await response.json() as ClaudeAPIResponse;
    return this.parseResponse(data);
  }

  async *stream(messages: IMessage[], options?: IChatOptions): AsyncGenerator<IStreamChunk> {
    this.assertReady();

    const controller = new AbortController();
    this.activeControllers.add(controller);

    // Lier le signal externe à notre controller
    const externalSignal = options?.signal;
    const onAbort = () => controller.abort();
    if (externalSignal) externalSignal.addEventListener("abort", onAbort);

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const body = this.buildRequestBody(messages, options);
      const response = await this.fetchWithTimeout(
        `${this.endpoint}/v1/messages`,
        { method: "POST", headers: this.headers(), body: JSON.stringify({ ...body, stream: true }) },
        controller.signal
      );

      if (!response.body) throw new LLMError("No response body", "STREAM_ERROR");

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
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "" || data === "[DONE]") continue;

          try {
            const event = JSON.parse(data) as ClaudeStreamEvent;
            if (event.type === "content_block_delta" && event.delta?.text) {
              yield { type: "token", content: event.delta.text };
            }
            if (event.type === "message_delta" && event.usage) {
              yield {
                type: "done",
                content: "",
                usage: this.calcUsage(
                  event.usage.input_tokens  ?? 0,
                  event.usage.output_tokens ?? 0
                ),
              };
            }
          } catch { /* ligne non-JSON — ignorer */ }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new LLMAbortError("claude");
      }
      throw err;
    } finally {
      // Cleanup garanti même en cas d'erreur ou d'abort
      if (reader) {
        try { reader.releaseLock(); } catch { /* déjà libéré */ }
      }
      if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
      this.activeControllers.delete(controller);
    }
  }

  async embed(_text: string): Promise<number[]> {
    throw new LLMEmbedNotSupportedError("claude");
  }

  async healthCheck(): Promise<boolean> {
    if (this.isShutdown) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${this.endpoint}/v1/messages`, {
        method:  "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model:      this.model,
          max_tokens: 1,
          messages:   [{ role: "user", content: "ping" }],
        }),
        signal: controller.signal,
      });
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    for (const controller of this.activeControllers) {
      try { controller.abort(); } catch { /* déjà aborté */ }
    }
    this.activeControllers.clear();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private assertReady(): void {
    if (this.isShutdown) {
      throw new LLMError("Provider has been shut down", "SHUTDOWN");
    }
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type":      "application/json",
      "x-api-key":         this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  private buildRequestBody(messages: IMessage[], options?: IChatOptions) {
    const body: Record<string, unknown> = {
      model:      this.model,
      max_tokens: options?.maxTokens ?? this.maxTokens,
      messages:   messages.filter(m => m.role !== "system"),
    };

    const sysContent = messages.find(m => m.role === "system")?.content;
    const finalSystem = options?.context
      ? `${sysContent ?? ""}\n\n<context>\n${options.context}\n</context>`.trim()
      : sysContent;

    if (finalSystem) body.system = finalSystem;
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.tools?.length) body.tools = options.tools;

    return body;
  }

  private parseResponse(data: ClaudeAPIResponse): ILLMResponse {
    return {
      content:    data.content[0]?.text ?? "",
      model:      data.model,
      usage:      this.calcUsage(data.usage.input_tokens, data.usage.output_tokens),
      stopReason: (data.stop_reason as ILLMResponse["stopReason"]) ?? "end_turn",
    };
  }

  private calcUsage(inputTokens: number, outputTokens: number) {
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costEur: (
        (inputTokens  / 1_000_000) * COST_INPUT_EUR_PER_1M +
        (outputTokens / 1_000_000) * COST_OUTPUT_EUR_PER_1M
      ),
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    this.activeControllers.add(controller);

    const onExternalAbort = () => controller.abort();
    if (externalSignal) externalSignal.addEventListener("abort", onExternalAbort);

    const timeoutHandle = setTimeout(() => controller.abort(), this.timeout);

    try {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          const response = await fetch(url, { ...init, signal: controller.signal });

          if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get("retry-after") ?? "5", 10);
            if (attempt < this.maxRetries - 1) {
              await this.delay(retryAfter * 1000);
              continue;
            }
            throw new LLMRateLimitError("claude", retryAfter);
          }

          if (!response.ok) {
            const errBody = await response.json().catch(() => ({})) as {
              error?: { message?: string }
            };
            throw new LLMError(
              errBody?.error?.message ?? `Claude API error ${response.status}`,
              "API_ERROR",
              { status: response.status }
            );
          }

          return response;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            if (controller.signal.aborted && !externalSignal?.aborted) {
              throw new LLMTimeoutError("claude", this.timeout);
            }
            throw new LLMAbortError("claude");
          }
          lastError = err as Error;
          if (attempt < this.maxRetries - 1) {
            await this.delay(Math.pow(2, attempt) * 1000); // backoff exponentiel
            continue;
          }
          throw err;
        }
      }
      throw lastError ?? new LLMError("Max retries exceeded", "MAX_RETRIES");
    } finally {
      clearTimeout(timeoutHandle);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
      this.activeControllers.delete(controller);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ── Types Anthropic API ──────────────────────────────────────────────────────

interface ClaudeAPIResponse {
  content:     { text: string }[];
  model:       string;
  stop_reason: string;
  usage:       { input_tokens: number; output_tokens: number };
}

interface ClaudeStreamEvent {
  type:   string;
  delta?: { text?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}
