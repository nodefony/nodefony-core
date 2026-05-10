# VISION_IA.md — Nodefony AI Modules

> **Ce fichier doit être lu par Claude Code en début de chaque session.**
> Il décrit la destination finale, pas l'état actuel.

---

## Mission

Nodefony devient une **plateforme Node.js générique pour construire des agents IA métier**.

Le framework fournit des modules réutilisables.
Le développeur apporte la logique métier.
Le framework gère la gouvernance, la sécurité, le monitoring, la conformité.

---

## Les 8 modules — rôle exact

| Module | Rôle | Dépendances |
|--------|------|-------------|
| `@nodefony/llm` | Interface multi-modèles (Claude, Gemini, Ollama, OpenAI) | aucune |
| `@nodefony/vector` | Adapters vector store (pgvector, Qdrant, Chroma) | aucune |
| `@nodefony/rag` | Pipeline RAG complet — ingestion, chunking, embedding, recherche | llm, vector |
| `@nodefony/memory` | Mémoire agents — court/long/épisodique | vector, llm |
| `@nodefony/agent` | Orchestrateur + sous-agents via DI Container | llm, rag, memory |
| `@nodefony/mcp` | MCP server + client (Model Context Protocol) | agent |
| `@nodefony/agent-guard` | Gouvernance — zones, PII, audit, circuit breaker, approval | llm, agent |
| `@nodefony/studio` | Dashboard `/nodefony` — monitoring, approbations | tous |

---

## Principes invariants

1. **Générique** — aucun module core ne connaît le métier (droit, finance...)
2. **Injectables** — tous les services passent par le DI Container
3. **Streaming natif** — réponses LLM token par token via WS Nodefony
4. **Validation humaine** — approval obligatoire dans zones restricted
5. **Mode souverain** — tout peut tourner local (Ollama + pgvector)
6. **index.ts unique** — chaque module expose uniquement via son index.ts
7. **Conformité AI Act** — audit, traçabilité, contrôle natifs

---

## Cas d'usage cibles

```
Avocat / Notaire     → RAG juridique + agents spécialisés
Gestion patrimoine   → RAG financier + simulateurs
Support client       → RAG documentaire + chatbot
Médical              → Mode souverain obligatoire
Défense              → Air gap + LLM local + audit signé
```

Tous construits sur les mêmes modules — seul le corpus et les règles métier changent.

---

## Ce qui différencie Nodefony

NestJS fait le serveur, pas l'IA native.
LangChain fait l'IA, pas le serveur.
**Nodefony fait les deux nativement, avec gouvernance intégrée.**

WebSocket natif Nodefony = transport idéal du streaming LLM.
DI Container = orchestration agents.
@nodefony/agent-guard = conformité AI Act dès la conception.
