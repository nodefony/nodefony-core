---
name: nodefony-roadmap
metadata:
  version: 2.0.0
description: >
  Contexte de la **couche IA agentic** de Nodefony (Phase 12) — la seule phase réellement future du
  framework : modules `@nodefony/{llm,vector,rag,memory,agent,agent-guard}`, invariants de design
  (générique, injectable, streaming natif, validation humaine, mode souverain, conformité AI Act,
  WebSocket = transport LLM) et la règle « ne pas démarrer de session IA avant P6 ». Les phases 10
  (Studio), 13 (Realtime) et 14 (builder Vite) sont LIVRÉES : leurs conventions encore actives sont
  pointées vers le skill ou la doc qui les porte désormais, pas recopiées.
  Déclencheurs : "couche IA", "agentic", "@nodefony/agent", "@nodefony/llm", "@nodefony/rag",
  "agent-guard", "AI Act", "mode souverain", "streaming LLM", "phase 12", "interface consommée par
  un agent", "convention route /nodefony", "API admin d'un module".
---

# nodefony-roadmap — la couche IA (Phase 12) + les conventions des phases livrées

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'avancement fin vit dans
> `MIGRATION_STATUS.md`, l'historique dans `git log`. Une leçon durable devient une règle.

**Où en est le framework** : P10 (Studio), P13 (Realtime) et P14 (builder Vite) sont **livrées** —
leurs conventions restent applicables mais vivent dans les skills/docs dédiés (§3). **P12, la couche
IA agentic, est la seule phase réellement future** (≈17 % au dernier point) : c'est l'objet principal
de ce skill. Vérité fine = `MIGRATION_STATUS.md`.

---

## 1. Phase 12 — Couche IA agentic (⬜ future, après P6)

**Destination finale de Nodefony** : plateforme Node.js pour agents IA métier, avec gouvernance
AI Act et mode souverain (LLM local). Le différenciateur : **serveur + IA native + gouvernance** dans
un seul framework (NestJS a le serveur sans l'IA ; LangChain l'IA sans le serveur ni la gouvernance).

**Piliers techniques réutilisés** : WS natif `@nodefony/http` = transport streaming LLM · DI
Container = orchestration de sous-agents · multi-ORM = persistance audit/coûts.

### Modules IA — état réel (à revérifier au câblage de la phase)

| Module                  | Rôle                                                      | Sous-phase |
| ----------------------- | --------------------------------------------------------- | ---------- |
| `@nodefony/llm`         | Multi-LLM (Claude, Gemini, OpenAI, Ollama, Mistral, Groq) | P12.1      |
| `@nodefony/vector`      | Adapters vectoriels (pgvector, Qdrant, Chroma)            | P12.1      |
| `@nodefony/rag`         | Pipeline RAG (ingestion/chunking/embedding/recherche)     | P12.1      |
| `@nodefony/memory`      | Mémoire agents (court/long/épisodique)                    | P12.1      |
| `@nodefony/agent`       | Orchestrateur + sous-agents (`@Agent`, `@Tool`)           | P12.2      |
| `@nodefony/agent-guard` | **Différenciateur** — zones, PII, audit, approval, coûts  | P12.4      |
| `@nodefony/studio`      | Panels IA intégrés dans Studio (pas de module séparé)     | P12.5      |

> `@nodefony/llm` est le plus avancé (migré vitest) ; les autres sont des WIP. `@nodefony/mcp` est un
> **POC ABANDONNÉ** — Skill > MCP, ne pas relancer ([[project_mcp_poc_kit]]). Le module
> `@nodefony/devkit` (outillage d'app) est **distinct** de la vision IA P12 ([[project_devkit_ai_kit]]).

### Invariants de design (ne pas dévier)

1. **Générique** — aucun module IA ne connaît le métier.
2. **Injectable** — tout via `@injectable` / `@inject`.
3. **Streaming natif** — `AsyncGenerator<string>` serveur, WS Nodefony client.
4. **Validation humaine** — approval obligatoire sur les zones `restricted`.
5. **Mode souverain** — tout doit tourner local (Ollama + pgvector), air-gap OK.
6. **Conformité AI Act** — audit signé, traçabilité RAG, contrôle humain.
7. **WebSocket = transport LLM** — pipeline WS de `@nodefony/http`.

### Règle dure tant que P6 n'est pas finie

- **Ne pas démarrer de session sur les modules IA avant P6**, sauf demande explicite (design pas figé,
  refonte prévue en P12.1 — ne pas casser l'existant WIP).
- Un module **consommé par l'IA** (security, user, orm-core, http WS, session, syslog) doit **prévoir
  l'usage IA dans son design** : interfaces extensibles, async iterators, pas de couplage rigide.

### Vision IA — source unique

- **`docs/ia/livre-blanc-couche-ia.md`** — la vision IA consolidée (mission, cas d'usage, capacités,
  invariants, gouvernance/AI Act, feuille de route). À lire en **session IA**, pas en session framework.
- Décision figée : `docs/adr/0004-inference-llm-backend-supervise.md` (inférence LLM back supervisée).

---

## 2. Phase 13 — Realtime (🔶 quasi livré) — le reste

`@nodefony/realtime` (hub + TCP/UDP + backplanes Loopback/IPC/Redis, bus authentifié) et
`@nodefony/redis` sont **livrés et durcis**. La lib cliente est livrée en **subpaths du core** —
`nodefony/client` (RealtimeClient), `nodefony/react` (hooks), `nodefony/debugbar` — **pas** de package
`@nodefony/client` séparé ([[project_client_lib_subpaths_decision]]).

**Reste** : `@nodefony/kafka` (P13.6, attend un 2ᵉ consommateur — bus events métier / agents P12),
banc de conformité ventilation, dette #3 (auth WS — **attend P6**). Détail :
[[project_p13_realtime_finish_plan]]. North star = « socket Nodefony », 1 handle multiplexant N
canaux duplex ([[project_realtime_nodefony_socket_vision]]).

---

## 3. Phases LIVRÉES — leurs conventions vivent ailleurs (ne pas recopier)

Ces phases sont terminées ; ce skill ne porte plus que le **pointeur** vers leur convention active.

| Convention encore en vigueur                                                                   | Où elle vit maintenant                                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Préfixe `/nodefony` **réservé** ; UI `/nodefony/…`, data plane `/nodefony/<module>/api/*`      | `CLAUDE.md` racine + [[project_studio_routing_decision]]                                      |
| Un module qui expose une API admin → controller `/nodefony/<module>/api/*` (GraphQL/REST JSON) | broker `IAdminApi` [[project_admin_data_plane_iadminapi]] ; doc dans le `MEMORY.md` du module |
| Développer un **écran** Studio (page, panneau, dashboard, Twin, debugbar)                      | skill `nodefony-studio-dev`                                                                   |
| **Builder Vite** : un module enregistre son front via `registerEntry` (P14)                    | skill `nodefony-create-frontend-module` + `nodefony-frontend-dev`                             |
| `@nodefony/frontend` = **builder** ≠ `nodefony/client` = **lib browser** (subpath du core)     | `src/packages/@nodefony/frontend/{CLAUDE,MEMORY}.md`                                          |
| Auth admin `ROLE_NODEFONY_ADMIN` via `@nodefony/security`                                      | skill `nodefony-security-review` (le RBAC data plane est câblé en P6)                         |

---

## 4. Pattern d'usage

1. Concevoir une **interface consommée par un agent IA** → §1 (invariants + règle dure P6).
2. Un module qui doit prévoir une **API admin** → §3 (convention de route + broker).
3. Tâche **cluster / pub-sub / client navigateur / TCP-UDP** → §2 + [[project_p13_realtime_finish_plan]].
4. Développer un **écran** Studio ou **exposer un front** → skills dédiés (§3), pas ce skill.

## 5. Anti-patterns

- Démarrer une session sur les modules IA avant P6 sans demande explicite.
- Relancer le POC MCP (abandonné — Skill > MCP, [[project_mcp_poc_kit]]).
- Utiliser `/nodefony/*` pour des routes utilisateur d'une app.
- Concevoir une API admin couplée à la vue (toujours GraphQL/REST JSON).
- Confondre `@nodefony/frontend` (builder) et `nodefony/client` (lib browser subpath), ou recréer un
  package `@nodefony/client` séparé (décision : subpaths du core).
