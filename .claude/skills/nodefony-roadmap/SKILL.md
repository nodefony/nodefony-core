---
name: nodefony-roadmap
description: >
  Charge le contexte roadmap des phases Studio/IA/Realtime/Frontend de Nodefony — Phase 10 (Studio
  admin web — LIVRÉ, conventions à respecter), 12 (couche IA agentic — SEULE vraie phase future),
  13 (Realtime + Redis cluster + client navigateur — quasi livré, restes identifiés), 14 (frontend
  builder Vite — LIVRÉ). À utiliser quand un module doit prévoir une API admin, un design
  IA-compatible ou un endpoint Studio. Déclencheurs : "Studio", "Phase 10", "Phase 12", "Phase 13",
  "Phase 14", "couche IA", "agentic", "@nodefony/agent", "@nodefony/realtime", "@nodefony/client",
  "API admin", "route /nodefony", "AI Act".
---

# nodefony-roadmap

Contexte roadmap des phases 10/12/13/14. **État resynchronisé 2026-06-12** : P10 et P14 sont
LIVRÉES (leurs conventions restent applicables à tout nouveau module), P13 est quasi livrée,
**P12 (IA agentic) est la seule phase réellement future**. Vérité fine = `MIGRATION_STATUS.md`.

## Phase 10 — Module `@nodefony/studio` — ✅ LIVRÉ (conventions toujours actives)

Successeur de `monitoring-bundle` Vue 2 legacy. Application web d'administration du framework et
des apps. **Stack figée et livrée** : React 19 + Mantine v9 + MobX, bundlé par `@nodefony/frontend`
(Vite). Workspace composable + Jumeau (Twin) livrés 06-06 (cf [[project_studio_workspace_kit]]).

> **Développer DANS Studio** (page, panneau, dashboard) → skill **`nodefony-studio-dev`** (recettes
> UI kit, useResource, hooks realtime). Ce skill-ci ne porte que les conventions transverses.

### 🔒 Convention de route RÉSERVÉE — applicable à tout module

- Le préfixe `/nodefony` est **réservé à Studio** dans toutes les apps en production.
- UI = `/nodefony/...` ; **data plane** = `/nodefony/<module>/api/*` (cf
  [[project_studio_routing_decision]] + broker `IAdminApi` [[project_admin_data_plane_iadminapi]]).
- Les apps utilisateur doivent éviter `/nodefony/*`. Le module `test` utilise `/nodefony/test/*` — cohérent (interne).

### Conséquence pour chaque module (toujours en vigueur)

Si le module expose une API d'introspection/admin :

- **Prévoir un controller `/nodefony/<module>/api/*` documenté** consommé par Studio.
- Concevoir les API en **GraphQL ou REST JSON** — pas de couplage à la vue.
- Documenter chaque endpoint admin dans le `MEMORY.md` du module (section dédiée).
- Auth admin : `ROLE_NODEFONY_ADMIN` via `@nodefony/security` — câblage effectif en **P6** (RBAC) ;
  plusieurs visions Studio (audit à chaud, dette realtime #3) **attendent P6**.

---

## Phase 12 — Couche IA agentic — ⬜ SEULE VRAIE PHASE FUTURE (après P6)

**Destination finale Nodefony** : plateforme Node.js pour agents IA métier, avec gouvernance AI Act,
mode souverain (LLM local).

### Différenciateur

| Concurrent   | Serveur | IA native | Gouvernance |
| ------------ | ------- | --------- | ----------- |
| NestJS       | ✅      | ❌        | ❌          |
| LangChain    | ❌      | ✅        | ❌          |
| **Nodefony** | ✅      | ✅        | ✅          |

**Pilier technique** : WS natif `@nodefony/http` = transport streaming LLM. DI Container =
orchestration sous-agents. Multi-ORM = persistence audit/coûts.

### Modules IA — état réel (vérifié code 2026-06-12)

| Module                  | Rôle                                                      | État                                                                         | Sous-phase |
| ----------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------- |
| `@nodefony/llm`         | Multi-LLM (Claude, Gemini, OpenAI, Ollama, Mistral, Groq) | 🔶 seul câblé (rolldown OK ; tests Bun)                                      | P12.1      |
| `@nodefony/vector`      | Adapters (pgvector, Qdrant, Chroma)                       | ⬜ WIP sans rolldown                                                         | P12.1      |
| `@nodefony/rag`         | Pipeline RAG (ingestion/chunking/embedding/recherche)     | ⬜ WIP sans rolldown                                                         | P12.1      |
| `@nodefony/memory`      | Mémoire agents (court/long/épisodique)                    | ⬜ WIP sans rolldown                                                         | P12.1      |
| `@nodefony/agent`       | Orchestrateur + sous-agents (`@Agent`, `@Tool`)           | ⬜ WIP sans rolldown                                                         | P12.2      |
| `@nodefony/mcp`         | MCP server + client                                       | ❌ POC ABANDONNÉ (Skill > MCP — ne pas relancer, cf [[project_mcp_poc_kit]]) | —          |
| `@nodefony/agent-guard` | **Différenciateur** — zones, PII, audit, approval, coûts  | ⬜ WIP sans rolldown                                                         | P12.4      |
| `@nodefony/studio`      | Panels IA intégrés dans Studio (pas de module séparé)     | ⬜ (Studio lui-même est livré)                                               | P12.5      |

### Principes invariants (ne pas dévier)

1. **Générique** — aucun module IA ne connaît le métier.
2. **Injectables** — tous via `@injectable` / `@inject`.
3. **Streaming natif** — `AsyncGenerator<string>` serveur, WS Nodefony client.
4. **Validation humaine** — approval obligatoire zones `restricted`.
5. **Mode souverain** — tout doit tourner local (Ollama + pgvector) — air gap OK.
6. **Conformité AI Act** — audit signé, traçabilité RAG, contrôle humain.
7. **WebSocket = transport LLM** — pipeline WS `@nodefony/http`.

### Règle dure tant que P6 n'est pas finie

- Si module consommé par IA (security, user, orm-core, http WS, session, syslog) → **prévoir
  l'usage IA dans le design** : interfaces extensibles, async iterators, pas de couplage rigide.
- Modules IA WIP : ne pas casser, design pas figé. Audit + refonte en P12.1.
- **Ne pas démarrer de session sur les modules IA** avant P6 sauf demande explicite.

### Vision IA — SOURCE UNIQUE (lire en session IA, pas en session framework)

- **`docs/ia/livre-blanc-couche-ia.md`** — source unique de la vision IA depuis 2026-05-29.
  Consolide et remplace les anciens docs épars (`VISION.md`, `VISION_IA.md`, `IA_STATUS.md`,
  `CLAUDE_IA.md`, `PLAN_AGENTIC.md`, `CONTINUE_WITH_CLAUDE_CODE.md` — SUPPRIMÉS). Couvre :
  mission, cas d'usage, capacités, invariants, gouvernance/AI Act, décisions (ADR-0004
  inférence supervisée), état réel, feuille de route (standards agentiques, auto-développement).
- Décision figée associée : `docs/adr/0004-inference-llm-backend-supervise.md`.

---

## Phase 13 — Realtime + Redis cluster + Client navigateur — 🔶 QUASI LIVRÉ

État réel (audit 2026-06-12, cf [[project_p13_realtime_finish_plan]]) :

| Brique               | Rôle                                                                                                                | État réel                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@nodefony/realtime` | Hub realtime + serveurs TCP/UDP + backplanes cross-process                                                          | ✅ P13.0 + seams + Redis livrés (167 tests) ; backplanes Loopback/IPC/Redis                             |
| `@nodefony/redis`    | Cluster + pub/sub + storage (cache, session, lock distribué)                                                        | ✅ refondu (driver backplane + sessions)                                                                |
| Client lib           | **Subpaths du core `nodefony`** : `nodefony/client` (RealtimeClient), `nodefony/react` (hooks), `nodefony/debugbar` | ✅ LIVRÉE — **plus de package `@nodefony/client` séparé** (cf [[project_client_lib_subpaths_decision]]) |

**Reste à faire P13** : Kafka P13.6 (driver backplane), banc conformité ventilation, dette #3
(auth WS — **attend P6**). Bindings vue/angular DIFFÉRÉS (pas de consommateur réel).

### Règles transverses (toujours valides)

- **WS reste dans `@nodefony/http`** — `realtime` complète avec TCP/UDP/Unix + hub, pas WS.
- **Client bas niveau** — `nodefony/client` sans framework UI ; bindings React = `nodefony/react`
  (hooks `useNodefonyState/Channel/ChannelData/Syslog`). North star = « socket Nodefony » 1 handle
  multiplexé (cf [[project_realtime_nodefony_socket_vision]]).
- **Pub/Sub Redis** : critique pour cluster — WS broadcast scalable = backplane Redis (livré).
- **Sondes/push à budget borné** : jamais d'observabilité qui peut tomber la prod
  (cf [[feedback_observability_no_prod_impact]]).

---

## Phase 14 — `@nodefony/frontend` (builder Vite) — ✅ LIVRÉ

Successeur de `webpackService.js` legacy. **Architecture livrée** : 1 seul process Vite
(mono-supervisor `ViteSupervisor`) pour N bundles de modules, HMR live, multi-framework
(React 19 / Vue 3 / Angular). Cf `src/packages/@nodefony/frontend/{CLAUDE,MEMORY}.md`.

### Conventions actuelles (modèle defineConfig — PAS l'ancien `nodefony/config/config.ts`)

- Un module expose son frontend en **s'enregistrant auprès de `FrontendService`**
  (`registerEntry`) — recette complète : skill **`nodefony-create-frontend-module`**.
- Config app = `nodefony.config.ts` racine via `use("@nodefony/frontend", {...})` — plus de
  dossier `nodefony/config/` par module pour l'app (chantier defineConfig Lot 5, 06-05).
- **Dev** : HMR Vite → 0 restart serveur pour une modif front. **Prod** : assets buildés
  servis en statique par `@nodefony/http`.

### Règle dure — ne pas confondre

| Brique               | Rôle                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| `@nodefony/frontend` | **Builder** : transpile/bundle les frontends des modules (React/Vue/Angular)         |
| `nodefony/client`    | **Lib JS bas niveau** (subpath du core) : HTTP/WS/realtime, importée DANS le code UI |

Studio = consommateur des deux : bundlé par `@nodefony/frontend`, son code importe
`nodefony/client` + `nodefony/react` pour les appels backend.

---

## Pattern d'usage

1. Tâche touche un module qui doit prévoir une **API admin** → section Phase 10 (conventions).
2. Conception d'une **interface consommée par un agent IA** → section Phase 12 (invariants).
3. Tâche **sessions distribuées / cluster / pub-sub / browser client / TCP-UDP** → section Phase 13.
4. Module qui **expose un frontend** → section Phase 14 + skill `nodefony-create-frontend-module`.
5. **Développer un écran Studio** → skill `nodefony-studio-dev` (pas ce skill).

## Anti-patterns à éviter

- Démarrer une session sur les modules IA avant P6 sans demande explicite.
- Relancer le POC MCP (abandonné — Skill > MCP, cf [[project_mcp_poc_kit]]).
- Utiliser le préfixe `/nodefony/*` pour des routes utilisateur d'une app.
- Concevoir une API admin sans GraphQL/REST JSON (couplage vue interdit).
- Confondre `@nodefony/frontend` (builder) et `nodefony/client` (lib browser subpath).
- Créer un package `@nodefony/client` séparé (décision : subpaths du core).
