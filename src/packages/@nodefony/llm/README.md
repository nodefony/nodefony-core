# @nodefony/llm

Generic multi-model LLM provider interface for Nodefony.

## Supported providers

| Provider           | Mode      | Embeddings | Streaming |
| ------------------ | --------- | ---------- | --------- |
| Claude (Anthropic) | cloud     | ❌         | ✅        |
| Gemini (Google)    | cloud     | ✅         | ✅        |
| OpenAI             | cloud     | ✅         | ✅        |
| Ollama             | sovereign | ✅         | ✅        |

## Usage

```typescript
import { LLMService, ClaudeProvider } from "@nodefony/llm";

const provider = new ClaudeProvider({
  provider: "claude",
  model: "claude-sonnet-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const llm = new LLMService(provider);

// Réponse complète
const response = await llm.chat([
  { role: "user", content: "Quel est le délai de prescription ?" },
]);

// Streaming token par token
for await (const chunk of llm.stream(messages)) {
  if (chunk.type === "token") process.stdout.write(chunk.content);
}
```

## Mode souverain (Ollama)

```typescript
import { OllamaProvider } from "@nodefony/llm";

const provider = new OllamaProvider({
  provider: "ollama",
  model: "mistral:7b-instruct-q4",
  endpoint: "http://localhost:11434",
});
// Le code métier ne change pas — seul le provider change
```
