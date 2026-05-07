# MIGRATION_STATUS.md
> Branche : claude-ts | Base : main (Rollup)
> Légende : ✅ Fait | 🔶 Partiel | ⬜ À faire | 🚫 Bloqué | ⚠️ Dette technique

---

## Progression globale

| Phase | Modules | ✅ | 🔶 | ⬜ |
|-------|---------|----|----|-----|
| 1 — Core framework | 4 | 0 | 0 | 4 |
| 2 — ORM adapters | 3 | 0 | 0 | 3 |
| 3 — Couche IA | 6 | 0 | 0 | 6 |
| 4 — Dev tooling | 2 | 0 | 0 | 2 |
| **Total** | **15** | **0** | **0** | **15** |

---

## ⚠️ Dettes techniques à corriger EN PREMIER

| Fichier | Problème | Impact | Priorité |
|---------|----------|--------|----------|
| `tsconfig.json` | `moduleResolution: "Node"` obsolète | 🔴 Bloquant à terme | P0 |
| `package.json` | `bun.lock` + `package-lock.json` coexistent | 🟡 Confusion toolchain | P1 |
| `rollup.config.ts` | `@ts-ignore` sur sourcemap-path-transform | 🟡 Dette mineure | P2 |
| `nodefony/**` | `nodefony.d.ts` / `global.d.ts` à redistribuer | 🔴 Bloquant typage | P0 |

---

## Phase 1 — Core framework

### @nodefony/core
| Fichier | Source JS | Statut | Complexité |
|---------|-----------|--------|------------|
| `src/types/index.ts` | `nodefony/core/nodefony.js` | ⬜ | 2 |
| `src/types/IKernel.ts` | `nodefony/core/kernel.js` | ⬜ | 2 |
| `src/types/IModule.ts` | `nodefony/core/bundles/` | ⬜ | 1 |
| `src/types/IService.ts` | `nodefony/core/container/` | ⬜ | 1 |
| `src/types/IContext.ts` | `nodefony/core/controller/` | ⬜ | 3 |
| `src/container/Container.ts` | `nodefony/core/container/container.js` | ⬜ | 3 |
| `src/container/decorators.ts` | N/A (nouveau) | ⬜ | 2 |
| `src/modules/Module.ts` | `nodefony/core/bundles/nodefonyBundle.js` | ⬜ | 3 |
| `src/modules/decorators.ts` | N/A (nouveau) | ⬜ | 2 |
| `src/kernel/Kernel.ts` | `nodefony/core/kernel.js` | ⬜ | 3 |
| `src/kernel/KernelEvents.ts` | `nodefony/core/kernel.js` | ⬜ | 2 |

### @nodefony/http
| Fichier | Source JS | Statut | Complexité |
|---------|-----------|--------|------------|
| `src/context/NodefonyContext.ts` | `nodefony/core/controller/` | ⬜ | 3 |
| `src/context/HttpContext.ts` | `nodefony/core/` | ⬜ | 3 |
| `src/context/WsContext.ts` | `nodefony/core/` | ⬜ | 3 |
| `src/server/HttpServer.ts` | `nodefony/core/` | ⬜ | 3 |
| `src/server/HttpsServer.ts` | `nodefony/core/` | ⬜ | 2 |
| `src/server/Http2Server.ts` | `nodefony/core/` | ⬜ | 3 |
| `src/server/WsServer.ts` | `nodefony/core/` | ⬜ | 3 |

### @nodefony/router
| Fichier | Source JS | Statut | Complexité |
|---------|-----------|--------|------------|
| `src/router/Router.ts` | `nodefony/core/router/router.js` | ⬜ | 3 |
| `src/router/Route.ts` | `nodefony/core/router/` | ⬜ | 2 |
| `src/router/decorators.ts` | N/A (nouveau) | ⬜ | 2 |
| `src/controller/Controller.ts` | `nodefony/core/controller/controller.js` | ⬜ | 3 |
| `src/controller/decorators.ts` | N/A (nouveau) | ⬜ | 2 |

### @nodefony/security
| Fichier | Source JS | Statut | Complexité |
|---------|-----------|--------|------------|
| `src/security/SecurityManager.ts` | `nodefony/bundles/security-bundle/` | ⬜ | 3 |
| `src/security/JwtProvider.ts` | `nodefony/bundles/security-bundle/` | ⬜ | 2 |
| `src/security/OAuthProvider.ts` | `nodefony/bundles/security-bundle/` | ⬜ | 3 |
| `src/security/SessionManager.ts` | `nodefony/bundles/framework-bundle/session/` | ⬜ | 3 |

---

## Phase 2 — ORM adapters

| Module | Statut | Notes |
|--------|--------|-------|
| `@nodefony/mikro` | ⬜ | ORM principal TypeScript-first |
| `@nodefony/sequelize` | ⬜ | Compat legacy — ne pas casser |
| `@nodefony/mongoose` | ⬜ | MongoDB |

---

## Phase 3 — Couche IA générique

| Module | Statut | Notes |
|--------|--------|-------|
| `@nodefony/llm` | ⬜ | ILLMProvider + Claude/Gemini/Ollama |
| `@nodefony/rag` | ⬜ | Indexation + recherche vectorielle |
| `@nodefony/vector` | ⬜ | pgvector + Qdrant + Chroma |
| `@nodefony/agent` | ⬜ | Orchestrateur + sous-agents |
| `@nodefony/mcp` | ⬜ | MCP server + client |
| `@nodefony/memory` | ⬜ | Mémoire agents court/long terme |

---

## Phase 4 — Dev tooling IA

| Module | Statut | Notes |
|--------|--------|-------|
| `@nodefony/studio` | ⬜ | Dashboard IA /nodefony |
| `@nodefony/generator` | ⬜ | Générateur modules via IA |

---

## Blockers actifs

| # | Problème | Fichier | Solution | Résolu |
|---|----------|---------|----------|--------|
| 1 | moduleResolution obsolète | tsconfig.json | Changer en "Bundler" | ⬜ |
| 2 | Double lockfile | package.json | Supprimer package-lock.json | ⬜ |
| 3 | @ts-ignore rollup | rollup.config.ts | Créer .d.ts minimal | ⬜ |
| 4 | nodefony.d.ts / global.d.ts | nodefony/ | Redistribuer dans les modules | ⬜ |

---

## Journal des sessions

| Date | Module traité | Fichiers créés | Tests | Commit |
|------|---------------|----------------|-------|--------|
| _(à remplir)_ | | | | |
