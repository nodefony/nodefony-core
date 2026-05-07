# PLAN_AGENTIC.md — Roadmap couche IA de Nodefony

> Complète MIGRATION_STATUS.md pour les phases 3 et 4.
> La migration TS (phases 1-2) est le prérequis technique.
> Ce document détaille ce qu'on construit après.

---

## Principe fondamental

**Nodefony ne connaît pas les métiers.**
Il fournit des outils génériques que les développeurs assemblent
pour construire des agents métier.

```
@nodefony/llm     → parler à n'importe quel LLM
@nodefony/rag     → indexer et chercher dans n'importe quel corpus
@nodefony/agent   → orchestrer n'importe quels sous-agents
@nodefony/mcp     → s'intégrer à l'écosystème Claude/Cursor/VS Code
```

L'avocat, le patrimoine, le support — c'est le code de l'utilisateur.
Le RAG, le streaming, la mémoire — c'est Nodefony.

---

## Phase 3 — Couche IA générique

### @nodefony/llm — Interface multi-modèles

**Pourquoi** : chaque projet choisit son LLM. Le code métier
ne doit pas changer si on passe de Claude à Gemini.

```typescript
interface ILLMProvider {
  name: string;
  chat(messages: IMessage[], options?: ChatOptions): Promise<ILLMResponse>;
  stream(messages: IMessage[], options?: ChatOptions): AsyncGenerator<string>;
  embed(text: string): Promise<number[]>;  // pour le RAG
}

// Adapters inclus dans @nodefony/llm
class ClaudeProvider implements ILLMProvider { ... }   // Anthropic API
class GeminiProvider implements ILLMProvider { ... }   // Google API
class OllamaProvider implements ILLMProvider { ... }   // local / souverain
class OpenAIProvider implements ILLMProvider { ... }   // OpenAI API
```

**Intégration Nodefony** : injectable via DI Container.
```typescript
@Service({ singleton: true })
class MyAgentService {
  constructor(@Inject("llm") private llm: ILLMProvider) {}
}
```

---

### @nodefony/rag — Pipeline RAG générique

**Pourquoi** : indexer des PDFs et chercher dedans est le besoin
commun à tous les agents métier (avocat, finance, médical...).

**Pipeline d'indexation** :
```
PDF / texte / URL
      ↓
Chunking (découpage en segments)
      ↓
Embedding (transformation en vecteurs numériques)
      via ILLMProvider.embed()
      ↓
Stockage dans base vectorielle
      via IVectorStore
```

**Pipeline de recherche** :
```
Question utilisateur
      ↓
Embedding de la question
      ↓
Recherche par similarité dans IVectorStore
      ↓
Top-K chunks les plus pertinents
      ↓
Injection dans le prompt LLM
      ↓
Réponse avec sources citées
```

**Adapters vector store inclus** :
- pgvector (PostgreSQL) → pour les projets qui ont déjà Postgres
- Qdrant → vector DB dédiée haute performance
- Chroma → local, gratuit, pour le dev

---

### @nodefony/agent — Orchestrateur générique

**Pourquoi** : un agent complexe décompose les tâches
et délègue à des sous-agents spécialisés.

```typescript
interface IAgent {
  run(task: string, context?: AgentContext): Promise<AgentResult>;
  stream(task: string, context?: AgentContext): AsyncGenerator<AgentEvent>;
}

// L'orchestrateur utilise le DI Container pour résoudre les sous-agents
@Service()
class AgentOrchestrator {
  constructor(
    @Inject("llm") private llm: ILLMProvider,
    @Inject("container") private container: IContainer
  ) {}

  async run(task: string): Promise<AgentResult> {
    // 1. Décomposer la tâche via LLM
    // 2. Résoudre les sous-agents depuis le container
    // 3. Exécuter en parallèle ou séquence
    // 4. Synthétiser les résultats
  }
}
```

**Validation des tools via Zod** :
```typescript
// Un tool = une fonction avec schéma strict
const searchTool: ITool = {
  name: "search_documents",
  schema: z.object({ query: z.string(), limit: z.number().max(10) }),
  execute: async (input) => ragService.search(input.query, input.limit)
};
```

---

### @nodefony/mcp — Model Context Protocol

**Pourquoi** : MCP est le standard 2025-2026 pour connecter
les agents IA aux outils externes. Claude, Cursor, VS Code, GitHub
l'adoptent tous. Nodefony doit pouvoir :
1. Exposer ses services comme un MCP server
2. Consommer des MCP servers externes

```typescript
// Nodefony expose ses services via MCP
// → Claude Desktop peut se connecter à un projet Nodefony
// → Claude Code peut utiliser les services du projet
@MCPServer({ name: "nodefony-legal" })
class LegalMCPServer {

  @MCPTool({ description: "Recherche dans le corpus juridique" })
  async searchLaw(query: string): Promise<MCPResult> {
    return this.ragService.search(query);
  }
}
```

---

### @nodefony/memory — Mémoire agents

**Pourquoi** : un agent sans mémoire répond toujours
comme si c'était la première fois.

```typescript
interface IMemoryService {
  // Court terme — session WS en cours
  shortTerm: IShortTermMemory;   // déjà dans Nodefony via Session

  // Long terme — entre sessions
  longTerm: ILongTermMemory;     // stocké en base vectorielle

  // Épisodique — historique structuré
  episodic: IEpisodicMemory;     // MikroORM entity
}
```

---

## Phase 4 — Dev tooling IA

### @nodefony/studio — Dashboard développeur

`nodefony dev` lance le runtime + ouvre `/nodefony` dans le navigateur.

**Fonctionnalités** :
- Chat avec l'agent IA de développement (WebSocket streaming natif)
- Sélection du modèle LLM en live (Claude, Gemini, Ollama)
- Génération de modules via l'agent IA
- Validation humaine avant toute écriture de fichier (diff + approve)
- Vue monitoring (routes, services, modules chargés)
- Vue git (status, commits, branches)

**Le principe de validation humaine est non négociable** :
l'agent propose → le développeur approuve → le fichier est écrit.
Jamais d'écriture automatique sans confirmation.

---

### @nodefony/generator — Générateur IA de modules

**Remplace le CLI `nodefony generate:service`.**

```bash
# Avant (CLI déterministe)
nodefony generate:service UserService

# Après (IA + validation)
# Dans le dashboard /nodefony :
# "génère un module user avec auth JWT et CRUD complet"
# → agent analyse le projet existant
# → produit une ModuleSpec validée par Zod
# → affiche le diff dans le dashboard
# → développeur approuve
# → fichiers créés
```

**ModuleSpec — le contrat pivot** :
```typescript
const ModuleSpec = z.object({
  name: z.string(),
  entities: z.array(EntitySpec),
  services: z.array(ServiceSpec),
  controllers: z.array(ControllerSpec),
  routes: z.array(RouteSpec),
  tests: z.boolean(),
  orm: z.enum(["mikro", "sequelize", "mongoose"]).optional(),
});
```

---

## Ce que ça donne pour un utilisateur final

### Créer un agent avocat

```bash
# 1. Créer le projet
nodefony new agent-avocat

# 2. Dans le dashboard /nodefony
"crée un module qui indexe des PDFs juridiques"
→ génère PDFIndexerModule (validation humaine)

"crée un agent qui répond aux questions de droit civil"
→ génère LegalAgentModule avec RAG (validation humaine)

# 3. Lancer
nodefony dev
# → l'avocat accède à son agent sur localhost:5151
# → réponses streamées via WS, sources citées
```

### Créer un agent gestion de patrimoine

```bash
nodefony new agent-patrimoine

# Dans le dashboard
"crée un module qui ingère des rapports PDF financiers"
→ génère FinanceIndexerModule

"crée un agent qui analyse les risques patrimoniaux"
→ génère PatrimonialAgentModule avec RAG

nodefony dev
# → même UX, corpus différent
```

---

## Pourquoi c'est cohérent avec la migration TypeScript

| Décision migration | Raison agentic |
|---|---|
| TypeScript strict | Interfaces ILLMProvider, IAgent, IRagService |
| DI Container typé | Injection des services IA comme les services HTTP |
| Module system générique | @Module fonctionne pour HTTP et pour Agent |
| Rollup preserveModules | Chaque module IA publishable sur npm |
| WS natif conservé | Transport du streaming LLM vers le client |
| MikroORM prioritaire | Stockage mémoire épisodique agents |
| Node.js natif (pas Bun.serve) | Stabilité prod pour les agents métier critiques |

---

## Résumé en 3 lignes

La migration TypeScript crée les interfaces et le DI Container typés
dont les modules agentic ont besoin pour être génériques et réutilisables.
Le WS natif de Nodefony est le transport naturel du streaming LLM.
Rollup permet de publier chaque module IA indépendamment sur npm.
