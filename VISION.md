# VISION.md — Nodefony : destination agentic

> Ce fichier est lu par Claude Code pour comprendre POURQUOI
> chaque décision technique est prise.
> La migration TypeScript n'est pas une fin — c'est la fondation
> d'une plateforme agentic générique.

---

## Ce que Nodefony devient

**Nodefony est une plateforme Node.js pour construire des agents IA métier.**

Pas un framework web de plus.
Pas un concurrent de NestJS.

Un framework où :

- HTTP et WebSocket sont co-citoyens natifs (même contexte, même routing)
- Des modules génériques réutilisables permettent de construire des agents métier
- Un développeur peut créer en quelques commandes un agent avocat,
  un agent gestion de patrimoine, un agent support client...
- L'agent IA est intégré au runtime de développement (`nodefony dev`)

---

## Les deux niveaux du framework

### Niveau 1 — Framework web temps réel (migration en cours)

Ce que Nodefony fait déjà, migré en TypeScript strict :

- Kernel, DI Container, Module system
- Serveurs HTTP/HTTPS/HTTP2/WS/WSS natifs Node.js
- Router unifié HTTP+WS via NodefonyContext
- Sécurité, Sessions, ORM adapters

### Niveau 2 — Plateforme agentic (après migration)

Ce que Nodefony devient grâce à la migration TS :

- `@nodefony/llm` → interface générique multi-modèles (Claude, Gemini, Ollama)
- `@nodefony/rag` → pipeline RAG générique (indexation PDF, recherche vectorielle)
- `@nodefony/agent` → orchestrateur + sous-agents via DI Container
- `@nodefony/mcp` → MCP server/client (standard Anthropic)
- `@nodefony/memory` → mémoire agents court/long terme
- `@nodefony/studio` → dashboard IA dans le navigateur (`/nodefony`)

---

## Pourquoi la migration TS est le prérequis

### 1. Les interfaces génériques nécessitent TypeScript strict

```typescript
// Impossible proprement en JS — natif en TS
interface ILLMProvider {
  chat(messages: IMessage[], tools?: ITool[]): Promise<ILLMResponse>;
  stream(messages: IMessage[]): AsyncGenerator<string>;
}

// N'importe quel LLM implémente cette interface
class ClaudeProvider implements ILLMProvider { ... }
class GeminiProvider implements ILLMProvider { ... }
class OllamaProvider implements ILLMProvider { ... }
```

### 2. Le DI Container typé est le cœur de l'orchestration

```typescript
// Les agents sont des services injectables comme les autres
@Service({ singleton: true })
class LegalAgent implements IAgent {
  constructor(
    @Inject("rag") private rag: IRagService,
    @Inject("llm") private llm: ILLMProvider,
    @Inject("memory") private memory: IMemoryService,
  ) {}
}

// L'orchestrateur résout les agents depuis le container
// Exactement comme les services HTTP actuels
const agent = container.get<IAgent>("legal-agent");
```

### 3. Le streaming WS natif est le transport des agents

```typescript
// HTTP ne suffit pas pour les agents — trop lent, pas bidirectionnel
// WS natif Nodefony = stream token par token + interruption possible
@WebSocketRoute("/agent/stream")
async agentStream(ctx: NodefonyContext): Promise<void> {
  const stream = this.llm.stream(ctx.request.message);
  for await (const token of stream) {
    ctx.send(token); // tokens en temps réel via WS natif
  }
}
```

### 4. Rollup + modules indépendants = écosystème npm

```
@nodefony/llm     → publishable sur npm indépendamment
@nodefony/rag     → publishable sur npm indépendamment
@nodefony/agent   → publishable sur npm indépendamment
```

Un dev peut installer uniquement ce dont il a besoin.
La migration vers `preserveModules: true` avec Rollup rend ça possible.

---

## Exemple concret — ce que ça permet

### Créer un agent avocat en une commande

```bash
nodefony new agent-avocat --template legal
```

Génère automatiquement (via l'agent IA intégré) :

```
agent-avocat/
├── src/modules/
│   ├── legal-corpus/      # module d'indexation du corpus juridique
│   │   ├── PDFIndexer.ts  # ingestion Code Civil, CEDH, jurisprudences
│   │   └── CorpusModule.ts
│   ├── legal-search/      # module RAG juridique
│   │   ├── LegalRAG.ts    # recherche sémantique dans le corpus
│   │   └── SearchModule.ts
│   └── legal-agent/       # agent orchestrateur
│       ├── LegalAgent.ts  # répond aux questions, cite les sources
│       └── AgentModule.ts
```

L'avocat accède à son agent via le navigateur — réponses en streaming WS,
sources citées en temps réel, session persistante.

### Créer un agent gestion de patrimoine

```bash
nodefony new agent-patrimoine --template finance
```

Même structure, corpus différent (rapports, bilans, réglementation AMF).
Les modules `@nodefony/rag`, `@nodefony/llm`, `@nodefony/agent` sont
**réutilisés tels quels** — seul le contenu change.

---

## Ce que Claude Code doit garder en tête

### Pendant la migration TypeScript

**Chaque interface créée doit être pensée pour l'agentic.**

```typescript
// ✅ Pensé pour être étendu par les modules IA
export interface INodefonyContext {
  isWebSocket(): boolean;
  // → permettra plus tard : ctx.streamTokens()

  session: ISession;
  // → permettra plus tard : session.getAgentMemory()
}

// ✅ DI Container générique — pas spécifique HTTP
// → sera réutilisé pour injecter ILLMProvider, IRagService...

// ✅ Module system générique
// → un @Module peut être un module HTTP ou un module Agent
```

**Les serveurs WS natifs sont le transport des agents.**
Ne jamais simplifier ou supprimer la couche WS — c'est le streaming
des tokens LLM vers le client.

**Rollup preserveModules est obligatoire.**
Chaque module IA sera publié indépendamment sur npm.

### Ordre de priorité si un choix est difficile

1. Est-ce que ça supporte le streaming WS ? → priorité absolue
2. Est-ce que ça s'injecte dans le DI Container ? → priorité haute
3. Est-ce que c'est générique (pas de logique métier) ? → obligatoire
4. Est-ce que ça se publie indépendamment sur npm ? → objectif

---

## Les standards agentic à implémenter

| Standard            | Quoi                                              | Priorité     |
| ------------------- | ------------------------------------------------- | ------------ |
| **MCP** (Anthropic) | Expose Nodefony comme MCP server                  | 🔴 Critique  |
| **Tool Use**        | Controllers comme tools typés Zod                 | 🔴 Critique  |
| **Streaming**       | SSE + WS natif pour tokens LLM                    | 🔴 Critique  |
| **A2A** (Google)    | Agent-to-Agent protocol                           | 🟡 Important |
| **RAG**             | Pipeline indexation + recherche vectorielle       | 🔴 Critique  |
| **Memory**          | Court terme (WS session) + long terme (vector DB) | 🟡 Important |

---

## Résumé en une phrase

> Chaque ligne de TypeScript migré aujourd'hui est une brique
> de la plateforme qui permettra demain à un avocat, un gestionnaire
> de patrimoine ou n'importe quel métier de avoir son agent IA
> en quelques commandes — construit sur un framework open source
> libre et souverain.
