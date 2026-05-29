---
name: nodefony-roadmap
description: >
  Charge le contexte des phases futures Nodefony — Phase 10 (Studio admin web), 12 (couche IA
  agentic), 13 (Realtime + Redis cluster + client navigateur), 14 (frontend builder Vite). À utiliser
  quand un module doit prévoir une API admin, un design IA-compatible ou un endpoint Studio.
  Déclencheurs : "Studio", "Phase 10", "Phase 12", "Phase 13", "Phase 14", "couche IA",
  "agentic", "@nodefony/agent", "@nodefony/realtime", "@nodefony/client", "API admin", "route /nodefony", "AI Act".
---

# nodefony-roadmap

Contexte des phases futures (10, 12, 13, 14) — à activer quand un module impacte ces phases.

## Phase 10 — Module `@nodefony/studio`

Successeur de `monitoring-bundle` Vue 2 legacy. Application web d'administration du framework et des apps.

### 🔒 Convention de route RÉSERVÉE — applicable dès maintenant

- Le préfixe `/nodefony` est **réservé à Studio** dans toutes les apps en production.
- Modules internes exposant des routes admin → `/nodefony/<module>/...` (ex : `/nodefony/http/api/stats`).
- Les apps utilisateur doivent éviter `/nodefony/*`.
- Le module `test` actuel utilise `/nodefony/test/*` — cohérent (route interne).

### Conséquence pour chaque module migré

Si le module expose une API d'introspection/admin :

- `@nodefony/http` → stats serveurs
- `@nodefony/framework` → liste routes
- `@nodefony/security` → users connectés
- `@nodefony/orm-*` → état connexions DB

→ **Prévoir un controller `/nodefony/<module>/api/*` documenté** consommé par Studio.
→ Concevoir les API en **GraphQL ou REST JSON** — pas de couplage à la vue.
→ Documenter chaque endpoint admin dans le `MEMORY.md` du module.

### Stack cible (à figer en début de Phase 10)

- Frontend : Vue 3 + Vite + TS (ou React 19, décision Phase 10)
- Backend : `@nodefony/framework` controllers + GraphQL queries + REST mutations
- Auth : `@nodefony/security` factory dédiée admin (`ROLE_NODEFONY_ADMIN`)

---

## Phase 12 — Couche IA agentic (DERNIÈRE phase)

**Destination finale Nodefony** : plateforme Node.js pour agents IA métier, avec gouvernance AI Act, mode souverain (LLM local).

### Différenciateur

| Concurrent   | Serveur | IA native | Gouvernance |
| ------------ | ------- | --------- | ----------- |
| NestJS       | ✅      | ❌        | ❌          |
| LangChain    | ❌      | ✅        | ❌          |
| **Nodefony** | ✅      | ✅        | ✅          |

**Pilier technique** : WS natif `@nodefony/http` = transport streaming LLM. DI Container = orchestration sous-agents. Multi-ORM = persistence audit/coûts.

### 8 modules IA

| Module                  | Rôle                                                      | État       | Sous-phase |
| ----------------------- | --------------------------------------------------------- | ---------- | ---------- |
| `@nodefony/llm`         | Multi-LLM (Claude, Gemini, OpenAI, Ollama, Mistral, Groq) | 🔶         | P12.1      |
| `@nodefony/vector`      | Adapters (pgvector, Qdrant, Chroma)                       | 🔶         | P12.1      |
| `@nodefony/rag`         | Pipeline RAG (ingestion/chunking/embedding/recherche)     | 🔶         | P12.1      |
| `@nodefony/memory`      | Mémoire agents (court/long/épisodique)                    | 🔶         | P12.1      |
| `@nodefony/agent`       | Orchestrateur + sous-agents (`@Agent`, `@Tool`)           | 🔶 partiel | P12.2      |
| `@nodefony/mcp`         | MCP server + client (Model Context Protocol Anthropic)    | ⬜         | P12.3      |
| `@nodefony/agent-guard` | **Différenciateur** — zones, PII, audit, approval, coûts  | ⬜         | P12.4      |
| `@nodefony/studio`      | Panels IA intégrés dans `@nodefony/studio` (pas séparé)   | ⬜         | P12.5      |

### Principes invariants (ne pas dévier)

1. **Générique** — aucun module IA ne connaît le métier.
2. **Injectables** — tous via `@injectable` / `@inject`.
3. **Streaming natif** — `AsyncGenerator<string>` serveur, WS Nodefony client.
4. **Validation humaine** — approval obligatoire zones `restricted`.
5. **Mode souverain** — tout doit tourner local (Ollama + pgvector) — air gap OK.
6. **Conformité AI Act** — audit signé, traçabilité RAG, contrôle humain.
7. **WebSocket = transport LLM** — pipeline WS `@nodefony/http`.

### Règle dure pendant migration framework (P0-P11)

- Si module consommé par IA (security, user, orm-core, http WS, session, syslog) → **prévoir usage IA dans le design** : interfaces extensibles, async iterators, pas de couplage rigide.
- Modules IA existants partiellement TS : ne pas casser, mais design pas figé. Audit + refonte en P12.1.
- `@nodefony/studio` **intègre les panels IA** (agents, costs, audit, approvals). NB : ce module a été renommé `vision` → `studio` (2026-05-18) — il n'y a plus qu'un seul module Studio.
- **Ne pas démarrer de session sur les modules IA** pendant P0-P11 sauf demande explicite.

### Vision IA — SOURCE UNIQUE (lire en session IA, pas en session framework)

- **`docs/ia/livre-blanc-couche-ia.md`** — source unique de la vision IA depuis 2026-05-29.
  Consolide et remplace les anciens docs épars (`VISION.md`, `VISION_IA.md`, `IA_STATUS.md`,
  `CLAUDE_IA.md`, `PLAN_AGENTIC.md`, `CONTINUE_WITH_CLAUDE_CODE.md` — SUPPRIMÉS). Couvre :
  mission, cas d'usage, capacités, invariants, gouvernance/AI Act, décisions (ADR-0004
  inférence supervisée), état réel, feuille de route (standards agentiques, auto-développement).
- Décision figée associée : `docs/adr/0004-inference-llm-backend-supervise.md`.

---

## Phase 13 — Realtime + Redis cluster + Client navigateur

3 modules interconnectés avec d'autres phases.

| Module               | Rôle                                                         | Bloque            | Réf JS legacy                                |
| -------------------- | ------------------------------------------------------------ | ----------------- | -------------------------------------------- |
| `@nodefony/redis`    | Cluster + pub/sub + storage (cache, session, lock distribué) | P5.12 + apps prod | `bundles/redis-bundle/` (166 L)              |
| `@nodefony/client`   | Lib navigateur — HTTP/WS/auth/streaming LLM browser          | **P10.7 Studio**  | N/A — à créer                                |
| `@nodefony/realtime` | Serveurs TCP/UDP/Unix sockets (IoT, IPC, protos binaires)    | indépendant       | `bundles/realtime-bundle/` (689 L + sockets) |

### Règles transverses

- **WS reste dans `@nodefony/http`** — `realtime` complète avec TCP/UDP/Unix, pas WS.
- **Sessions prod** : `RedisSessionStorage` (P5.12) dépend de refacto `@nodefony/redis` (P13.2). Cluster Nodefony multi-instance → P13.2 non-négociable.
- **Studio frontend** consomme `@nodefony/client` → doit exposer : WS reconnect auto, fetch auth/CSRF, AsyncIterable streaming LLM, AuthClient (login/refresh).
- **`@nodefony/client` bas niveau** — pas de Vue/React inclus, utilisable depuis n'importe quel framework UI.
- **TypeScript shared types** : créer `@nodefony/contracts` (micro-package types-only) si nécessaire pour éviter cycles client↔server.
- **Pub/Sub Redis** : critique pour cluster — WS broadcast scalable nécessite pub/sub.

---

## Phase 14 — `@nodefony/frontend` (builder Vite multi-framework : React/Vue/Angular)

**Mécanique legacy à reproduire moderne** : chaque bundle pouvait déclarer `type: "react" | "vue"` → framework transpilait son frontend (`webpackService.js` 631 L + `cli/builder/{react,vue}/` 634 L).

**Refonte 2026** : Vite par défaut (ESM natif, HMR ultra-rapide), Webpack uniquement sur demande legacy.

### Convention module avec frontend

```typescript
// nodefony/config/config.ts
export default {
  frontend: {
    type: "vue3", // ou "react19", "angular", "svelte5", "solid"
    entry: "./frontend/src/main.ts",
    outDir: "./public/dist",
    integrate: true, // true = middleware HMR dans @nodefony/http | false = proxy Vite externe
  },
};
```

### Lifecycle

- **Dev** : kernel boot → `@nodefony/frontend` lit `module.options.frontend` → ViteBuilder middleware injecté dans `@nodefony/http` → HMR live via WS natif.
- **Prod** : `npx nodefony build` → assets hashed dans `dist/public/<module-name>/` → `@nodefony/http` static.

### Règle dure

`@nodefony/frontend` ≠ `@nodefony/client` — ne pas confondre :

| Module               | Rôle                                                                             |
| -------------------- | -------------------------------------------------------------------------------- |
| `@nodefony/frontend` | **Builder** : transpile/bundle les frontends des modules (React/Vue/Angular)     |
| `@nodefony/client`   | **Lib JS bas niveau** : HTTP/WS/auth/streaming clients, importée DANS le code UI |

Studio = consommateur des deux : `@nodefony/frontend` (Vite, multi-framework) pour bundler son frontend, qui importe `@nodefony/client` pour les appels backend.

P14 bloque P10.7 (Studio frontend).

---

## Pattern d'usage

1. Si la tâche touche un module qui doit prévoir une **API admin** → lire la section Phase 10.
2. Si on conçoit une **interface qui sera consommée par un agent IA** → lire la section Phase 12 (principes invariants).
3. Si la tâche concerne **sessions distribuées / cluster / pub-sub / browser client / TCP-UDP** → lire la section Phase 13.
4. Si on touche un module qui **expose un frontend** → lire la section Phase 14.

## Anti-patterns à éviter

- Démarrer une session sur les modules IA pendant P0-P11 sans demande explicite.
- Utiliser le préfixe `/nodefony/*` pour des routes utilisateur d'une app.
- Concevoir une API admin sans GraphQL/REST JSON (couplage vue interdit).
- Confondre `@nodefony/frontend` (builder) et `@nodefony/client` (lib browser).
