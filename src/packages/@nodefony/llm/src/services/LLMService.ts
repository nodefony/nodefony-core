// @nodefony/llm — src/services/LLMService.ts
// Service principal injectable — facade au-dessus des providers

import type {
  ILLMProvider,
  IMessage,
  ILLMResponse,
  IStreamChunk,
  IChatOptions,
} from "../interfaces/ILLMProvider.js";
import { LLMError } from "../errors/LLMErrors.js";

export interface ILLMService extends ILLMProvider {
  switchProvider(provider: ILLMProvider): void;
  getCurrentProvider(): ILLMProvider;
  getProviders(): ILLMProvider[];
  registerProvider(provider: ILLMProvider): void;
}

/**
 * Service LLM injectable dans le DI Container.
 * Supporte le switch de provider en runtime (depuis le dashboard).
 */
export class LLMService implements ILLMService {
  private currentProvider: ILLMProvider;
  private readonly providers = new Map<string, ILLMProvider>();
  private isShutdown = false;

  get name() {
    return this.currentProvider.name;
  }
  get model() {
    return this.currentProvider.model;
  }
  get mode() {
    return this.currentProvider.mode;
  }

  constructor(initialProvider: ILLMProvider) {
    this.currentProvider = initialProvider;
    this.providers.set(initialProvider.name, initialProvider);
  }

  registerProvider(provider: ILLMProvider): void {
    this.assertReady();
    this.providers.set(provider.name, provider);
  }

  switchProvider(provider: ILLMProvider): void {
    this.assertReady();
    if (!this.providers.has(provider.name)) {
      this.providers.set(provider.name, provider);
    }
    this.currentProvider = provider;
  }

  getCurrentProvider(): ILLMProvider {
    return this.currentProvider;
  }

  getProviders(): ILLMProvider[] {
    return [...this.providers.values()];
  }

  async chat(
    messages: IMessage[],
    options?: IChatOptions,
  ): Promise<ILLMResponse> {
    this.assertReady();
    return this.currentProvider.chat(messages, options);
  }

  stream(
    messages: IMessage[],
    options?: IChatOptions,
  ): AsyncGenerator<IStreamChunk> {
    this.assertReady();
    return this.currentProvider.stream(messages, options);
  }

  async embed(text: string): Promise<number[]> {
    this.assertReady();
    return this.currentProvider.embed(text);
  }

  async healthCheck(): Promise<boolean> {
    if (this.isShutdown) return false;
    return this.currentProvider.healthCheck();
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    // Shutdown TOUS les providers, pas seulement le courant
    const errors: Error[] = [];
    for (const provider of this.providers.values()) {
      try {
        await provider.shutdown();
      } catch (err) {
        errors.push(err as Error);
      }
    }
    this.providers.clear();
    if (errors.length > 0) {
      throw new LLMError(
        `Errors during shutdown: ${errors.map((e) => e.message).join("; ")}`,
        "SHUTDOWN_ERRORS",
      );
    }
  }

  private assertReady(): void {
    if (this.isShutdown) {
      throw new LLMError("LLMService has been shut down", "SHUTDOWN");
    }
  }
}
