# MIGRATION_STATUS.md — Tableau de bord

> Mis à jour à chaque fin de session Claude Code.
> Légende : ✅ Migré | 🔶 Partiel | ⬜ À faire | 🚫 Bloqué | ⏭️ Skip (non pertinent)

---

## Progression globale

| Catégorie          | Total  | ✅     | 🔶    | ⬜     |
| ------------------ | ------ | ------ | ----- | ------ |
| **Build System**   | 10     | 10     | 0     | 0      |
| Core / Kernel      | 6      | 4      | 0     | 2      |
| DI Container       | 3      | 2      | 0     | 1      |
| Module System      | 5      | 3      | 0     | 2      |
| Syslog / Pdu       | 4      | 4      | 0     | 0      |
| Router             | 4      | 0      | 0     | 4      |
| HTTP / WS          | 6      | 0      | 0     | 6      |
| Controller         | 3      | 0      | 0     | 3      |
| Session            | 3      | 0      | 0     | 3      |
| Security / Auth    | 5      | 0      | 0     | 5      |
| ORM Adapters       | 4      | 0      | 0     | 4      |
| CLI                | 4      | 0      | 0     | 4      |
| Monitoring         | 3      | 0      | 0     | 3      |
| Types / Interfaces | 6      | 5      | 0     | 1      |
| **TOTAL**          | **66** | **28** | **0** | **38** |

---

## Phase 0 — Refactorisation Build ✅ TERMINÉE

> Spec de référence : `BUILDER.md` (brainstorming — pas une spec exhaustive).
> Objectif : `npm install` installe + build + génère l'exécutable `nodefony`.

### Problèmes actuels

- `preinstall` séquentiel avec `--prefix` : fragile, lent, redondant avec workspaces npm.
- `prebuild` séquentiel : idem.
- Root `rollup.config.ts` monolithique : difficile à maintenir.
- `@ts-ignore` sur `rollup-sourcemap-path-transform` dans `src/nodefony/rollup.config.ts`.

### Tâches (ordre strict — voir BUILDER.md pour le détail)

| #   | Tâche                                                                  | Fichier(s)                                        | Statut | Complexité |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------- | ------ | ---------- |
| 1   | Shim `vendor.d.ts` — fin des `@ts-ignore`                              | `src/nodefony/src/types/vendor.d.ts` + 4 packages | ✅     | 1          |
| 2   | Supprimer les `@ts-ignore`                                             | http, security, framework, redis, root rollup     | ✅     | 1          |
| 3   | Refactorer core rollup (3 outputs, no CJS, no tests, no `any`)         | `src/nodefony/rollup.config.ts`                   | ✅     | 3          |
| 4   | Core `package.json` : ESM only + exports `browser`/`node`              | `src/nodefony/package.json`                       | ✅     | 2          |
| 5   | Tests : `tsx node_modules/.bin/mocha` (110 tests, ~3s)                 | `src/nodefony/package.json`                       | ✅     | 1          |
| 6   | Créer `turbo.json` à la racine                                         | `turbo.json`                                      | ✅     | 2          |
| 7   | Root `package.json` : `prepare → turbo run build` + turbo devDep       | `package.json`                                    | ✅     | 1          |
| 8   | Supprimer `src/packages/package.json`                                  | supprimé                                          | ✅     | 1          |
| 9   | `@nodefony/llm` — son propre `rollup.config.ts` + `tsconfig.json`      | `src/packages/@nodefony/llm/`                     | ✅     | 2          |
| 10  | `peerDependencies: { nodefony: "*" }` dans http/security/framework/llm | 4 × `package.json`                                | ✅     | 1          |

**Notes de session :**

- `workspace:*` → `*` dans rag/agent/memory (syntaxe pnpm non supportée par npm)
- `Event.ts` : `"events"` → `"node:events"` (bug caché par l'ancien build)
- `Service.ts` : `export type { IService, ... }` — types masqués par Rollup avant
- `.gitignore` : `bin/` → `/bin/` pour ne pas ignorer `src/bin/`
- `nodePolyfills` conservé dans client config (Syslog importe cli-color)

---

## Phase 1 — Fondations (aucune dépendance)

> Chemins réels : tous sous `src/nodefony/src/`

### 1.1 Types & Interfaces globaux

| Fichier TS (chemin réel)               | Source JS référence                       | Statut | Complexité | Notes                             |
| -------------------------------------- | ----------------------------------------- | ------ | ---------- | --------------------------------- |
| `src/nodefony/src/types/nodefony.d.ts` | `nodefony/core/nodefony.js`               | ✅     | 2          | Types globaux, enums env          |
| `src/nodefony/src/types/IKernel.ts`    | `nodefony/core/kernel.js` (interfaces)    | ✅     | 2          | Interface IKernel complète        |
| `src/nodefony/src/types/IModule.ts`    | `nodefony/core/bundles/nodefonyBundle.js` | ✅     | 1          | Interface IModule                 |
| `src/nodefony/src/types/IService.ts`   | `nodefony/core/container/`                | ✅     | 1          | Interface IService                |
| `src/nodefony/src/types/IContainer.ts` | `nodefony/core/container/`                | ✅     | 1          | Interface IContainer + IScope     |
| `src/nodefony/src/types/IContext.ts`   | `nodefony/core/controller/`               | ⬜     | 3          | Contexte unifié HTTP+WS — à faire |

### 1.2 Syslog & Pdu

| Fichier TS (chemin réel)            | Source JS référence              | Statut | Complexité | Notes                                  |
| ----------------------------------- | -------------------------------- | ------ | ---------- | -------------------------------------- |
| `src/nodefony/src/types/ISyslog.ts` | `nodefony/core/syslog/`          | ✅     | 1          | Interface ISyslog                      |
| `src/nodefony/src/syslog/Pdu.ts`    | `nodefony/core/syslog/pdu.js`    | ✅     | 2          | CircularBuffer O(1), Date.now()        |
| `src/nodefony/src/syslog/Syslog.ts` | `nodefony/core/syslog/syslog.js` | ✅     | 3          | severityNameMap, fastTypeOf, no lodash |
| `src/nodefony/src/syslog/index.ts`  | N/A                              | ✅     | 1          | Barrel export                          |

### 1.3 DI Container

| Fichier TS (chemin réel)                                | Source JS référence                    | Statut | Complexité | Notes                                                                                      |
| ------------------------------------------------------- | -------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------ |
| `src/nodefony/src/Container.ts`                         | `nodefony/core/container/container.js` | ✅     | 3          | DynamicParam/Service unknown, null-guards, eslint-disable retiré                           |
| `src/nodefony/src/kernel/decorators/kernelDecorator.ts` | N/A (nouveau)                          | ✅     | 2          | `@injectable`, `@inject` — dans kernelDecorator.ts (Injector.test.ts + Decorators.test.ts) |
| `src/container/index.ts`                                | N/A                                    | ⬜     | 1          | Barrel export                                                                              |

---

## Phase 2 — Kernel & Modules

### 2.1 Service & Kernel

| Fichier TS (chemin réel)                  | Source JS référence                | Statut | Complexité | Notes                                               |
| ----------------------------------------- | ---------------------------------- | ------ | ---------- | --------------------------------------------------- |
| `src/nodefony/src/Service.ts`             | `nodefony/core/service.js`         | ✅     | 2          | `#nc` privé, `implements IService`                  |
| `src/nodefony/src/kernel/Kernel.ts`       | `nodefony/core/kernel.js`          | ✅     | 3          | `Kernel implements IKernel`, KernelNetworkResult    |
| `src/nodefony/src/kernel/CliKernel.ts`    | `nodefony/core/cli/kernel.js`      | ✅     | 2          | Cast `as Kernel`, import IKernel inutilisé supprimé |
| `src/nodefony/src/kernel/KernelEvents.ts` | `nodefony/core/kernel.js` (events) | ⬜     | 2          | Events lifecycle                                    |
| `src/nodefony/src/kernel/Environment.ts`  | `nodefony/core/kernel.js` (env)    | ⬜     | 1          | dev/prod/test                                       |
| `src/nodefony/src/kernel/index.ts`        | N/A                                | ⬜     | 1          | Barrel export                                       |

### 2.2 Module System

| Fichier TS (chemin réel)                                | Source JS référence                       | Statut | Complexité | Notes                                                                                          |
| ------------------------------------------------------- | ----------------------------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------------- |
| `src/nodefony/src/kernel/Module.ts`                     | `nodefony/core/bundles/nodefonyBundle.js` | ✅     | 3          | `Module implements IModule`, PackageJson types, casts `as Module` éliminés                     |
| `src/bundles/ModuleRegistry.ts`                         | `nodefony/core/bundles/`                  | ⬜     | 2          | Registre des modules                                                                           |
| `src/nodefony/src/kernel/decorators/kernelDecorator.ts` | N/A (nouveau)                             | ✅     | 2          | `@modules`, `@services`, `@entities` — dans kernelDecorator.ts (Decorators.test.ts — 45 tests) |
| `src/bundles/ModuleCompiler.ts`                         | `nodefony/core/bundles/`                  | ⬜     | 3          | Compilation des modules                                                                        |
| `src/bundles/index.ts`                                  | N/A                                       | ⬜     | 1          | Barrel export                                                                                  |

---

## Phase 3 — Router & Contexte unifié

### 3.1 Contexte HTTP+WS (différenciateur clé)

| Fichier TS cible                                  | Source JS référence         | Statut | Complexité | Notes           |
| ------------------------------------------------- | --------------------------- | ------ | ---------- | --------------- |
| `src/packages/@nodefony/http/NodefonyContext.ts`  | `nodefony/core/controller/` | ⬜     | 3          | Contexte unifié |
| `src/packages/@nodefony/http/HttpContext.ts`      | `nodefony/core/`            | ⬜     | 3          | Contexte HTTP   |
| `src/packages/@nodefony/http/WebSocketContext.ts` | `nodefony/core/`            | ⬜     | 3          | Contexte WS     |

### 3.2 Router

| Fichier TS cible                                 | Source JS référence              | Statut | Complexité | Notes                   |
| ------------------------------------------------ | -------------------------------- | ------ | ---------- | ----------------------- |
| `src/packages/@nodefony/framework/Router.ts`     | `nodefony/core/router/router.js` | ⬜     | 3          | Router principal        |
| `src/packages/@nodefony/framework/Route.ts`      | `nodefony/core/router/`          | ⬜     | 2          | Définition route        |
| `src/packages/@nodefony/framework/decorators.ts` | N/A (nouveau)                    | ⬜     | 2          | @Route, @WebSocketRoute |
| `src/packages/@nodefony/framework/index.ts`      | N/A                              | ⬜     | 1          | Barrel export           |

---

## Phase 4 — Serveurs HTTP/WS natifs Node.js

> **Node.js natif uniquement** — `node:http`, `node:http2`, `ws`. Jamais `Bun.serve()`.

### 4.1 Serveurs

| Fichier TS cible                                 | Source JS référence                  | Statut | Complexité | Notes              |
| ------------------------------------------------ | ------------------------------------ | ------ | ---------- | ------------------ |
| `src/packages/@nodefony/http/HttpServer.ts`      | `nodefony/core/`                     | ⬜     | 3          | node:http          |
| `src/packages/@nodefony/http/HttpsServer.ts`     | `nodefony/core/`                     | ⬜     | 2          | TLS + HTTP/2       |
| `src/packages/@nodefony/http/WebSocketServer.ts` | `nodefony/core/`                     | ⬜     | 3          | `ws` natif Node.js |
| `src/packages/@nodefony/http/WssServer.ts`       | `nodefony/core/`                     | ⬜     | 2          | WS sécurisé        |
| `src/packages/@nodefony/http/StaticServer.ts`    | `nodefony/bundles/framework-bundle/` | ⬜     | 2          | Fichiers statiques |
| `src/packages/@nodefony/http/index.ts`           | N/A                                  | ⬜     | 1          | Barrel export      |

---

## Phase 5 — Controller & Session

### 5.1 Controller

| Fichier TS cible                                 | Source JS référence                      | Statut | Complexité | Notes                               |
| ------------------------------------------------ | ---------------------------------------- | ------ | ---------- | ----------------------------------- |
| `src/packages/@nodefony/framework/Controller.ts` | `nodefony/core/controller/controller.js` | ⬜     | 3          | `Controller implements IController` |
| `src/packages/@nodefony/framework/decorators.ts` | N/A (nouveau)                            | ⬜     | 2          | @Controller                         |
| `src/packages/@nodefony/framework/index.ts`      | N/A                                      | ⬜     | 1          | Barrel export                       |

### 5.2 Session

| Fichier TS cible                                | Source JS référence                          | Statut | Complexité | Notes                        |
| ----------------------------------------------- | -------------------------------------------- | ------ | ---------- | ---------------------------- |
| `src/packages/@nodefony/http/SessionManager.ts` | `nodefony/bundles/framework-bundle/session/` | ⬜     | 3          | Gestionnaire sessions        |
| `src/packages/@nodefony/http/SessionStorage.ts` | `nodefony/bundles/framework-bundle/session/` | ⬜     | 2          | Drivers (memory, redis, ORM) |
| `src/packages/@nodefony/http/session/index.ts`  | N/A                                          | ⬜     | 1          | Barrel export                |

---

## Phase 6 — Sécurité & Auth

| Fichier TS cible                                     | Source JS référence                 | Statut | Complexité | Notes              |
| ---------------------------------------------------- | ----------------------------------- | ------ | ---------- | ------------------ |
| `src/packages/@nodefony/security/SecurityManager.ts` | `nodefony/bundles/security-bundle/` | ⬜     | 3          | WAF, CORS, Auth    |
| `src/packages/@nodefony/security/JwtProvider.ts`     | `nodefony/bundles/security-bundle/` | ⬜     | 2          | JWT                |
| `src/packages/@nodefony/security/OAuthProvider.ts`   | `nodefony/bundles/security-bundle/` | ⬜     | 3          | OAuth              |
| `src/packages/@nodefony/security/PassportBridge.ts`  | `nodefony/bundles/security-bundle/` | ⬜     | 2          | Compat Passport.js |
| `src/packages/@nodefony/security/index.ts`           | N/A                                 | ⬜     | 1          | Barrel export      |

---

## Phase 7 — ORM Adapters

| Fichier TS cible                                       | Source JS référence                  | Statut | Complexité | Notes            |
| ------------------------------------------------------ | ------------------------------------ | ------ | ---------- | ---------------- |
| `src/packages/@nodefony/sequelize/SequelizeAdapter.ts` | `nodefony/bundles/sequelize-bundle/` | ⬜     | 3          | Compat legacy    |
| `src/packages/@nodefony/mongoose/MongooseAdapter.ts`   | `nodefony/bundles/mongoose-bundle/`  | ⬜     | 2          | MongoDB          |
| `src/orm/MikroOrmAdapter.ts`                           | N/A (nouveau)                        | ⬜     | 3          | ORM principal TS |
| `src/orm/index.ts`                                     | N/A                                  | ⬜     | 1          | Barrel export    |

---

## Phase 8 — CLI & Monitoring

### 8.1 CLI

| Fichier TS cible                   | Source JS référence             | Statut | Complexité | Notes                                     |
| ---------------------------------- | ------------------------------- | ------ | ---------- | ----------------------------------------- |
| `src/nodefony/src/bin/nodefony.ts` | `nodefony/core/cli/`            | ⬜     | 3          | CLI principal — shebang via rollup banner |
| `src/cli/generators/Module.ts`     | `nodefony/core/cli/generators/` | ⬜     | 2          | Générateur module                         |
| `src/cli/generators/Controller.ts` | `nodefony/core/cli/generators/` | ⬜     | 2          | Générateur controller                     |
| `src/cli/index.ts`                 | N/A                             | ⬜     | 1          | Barrel export                             |

### 8.2 Monitoring

| Fichier TS cible             | Source JS référence                   | Statut | Complexité | Notes             |
| ---------------------------- | ------------------------------------- | ------ | ---------- | ----------------- |
| `src/monitoring/DebugBar.ts` | `nodefony/bundles/monitoring-bundle/` | ⬜     | 3          | Debug bar         |
| `src/monitoring/Metrics.ts`  | `nodefony/bundles/monitoring-bundle/` | ⬜     | 2          | Métriques runtime |
| `src/monitoring/index.ts`    | N/A                                   | ⬜     | 1          | Barrel export     |

---

## Phase X — Syslog Transport Layer ✅ TERMINÉE

> Session 2026-05-14. `ITransport` + `ConsoleTransport` + `FileTransport` + `HttpTransport`.

### Tâches

| #   | Tâche                                        | Fichier(s)                                       | Statut | Complexité |
| --- | -------------------------------------------- | ------------------------------------------------ | ------ | ---------- |
| 1   | Interface `ITransport` + `addTransport()`    | `types/ITransport.ts`, `Syslog.ts`, `ISyslog.ts` | ✅     | 2          |
| 2   | `ConsoleTransport`                           | `transports/ConsoleTransport.ts`                 | ✅     | 1          |
| 3   | `FileTransport` (JSON + text)                | `transports/FileTransport.ts`                    | ✅     | 2          |
| 4   | `HttpTransport` (POST JSON, node:http/https) | `transports/HttpTransport.ts`                    | ✅     | 2          |
| 5   | `LokiTransport`                              | —                                                | ⬜     | 2          |
| 6   | Barrel export + tests                        | `transports/index.ts`                            | ✅     | 1          |

---

## Blockers connus

| Module                          | Problème                                                  | Solution envisagée             | Résolu |
| ------------------------------- | --------------------------------------------------------- | ------------------------------ | ------ |
| `src/nodefony/rollup.config.ts` | `@ts-ignore` sur `rollup-sourcemap-path-transform`        | Créer `.d.ts` shim minimal     | ⬜     |
| `IKernel.ts`                    | `cli: object \| null` → devrait être `ICliKernel \| null` | Session dédiée ICliKernel      | ⬜     |
| `IModule.ts`                    | `getController()` retourne `unknown` → `IController`      | Session dédiée après Phase 5.1 | ⬜     |

---

## Journal des sessions

| Date       | Session                                            | Module migré                                                                                          | Durée  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-11 | Service + Interfaces                               | `Service.ts`, `IService`, `IKernel`                                                                   | ~3h    | 85 tests ✅ — `#nc` privé, `implements IService`, `Command.ts` fixé                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-05-11 | ISyslog + Syslog                                   | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts`                                                                   | ~2h    | 85 tests ✅ — `Pci=unknown`, `Function` → types propres, `implements ISyslog`                                                                                                                                                                                                                                                                                                                                                         |
| 2026-05-11 | Syslog perf                                        | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts`                                                                   | ~1h    | 85 tests ✅ — `CircularBuffer` O(1), `Date.now()`, `severityNameMap`, `fastTypeOf`, no lodash                                                                                                                                                                                                                                                                                                                                         |
| 2026-05-11 | IKernel complet                                    | `IKernel.ts`, `IService.ts`, `Service.ts`, `Kernel.ts`, `CliKernel.ts`, commands                      | ~2h    | 111 tests ✅ — `Kernel implements IKernel`, `IService.kernel: IKernel\|null`, `KernelNetworkResult`, casts Module/CliKernel                                                                                                                                                                                                                                                                                                           |
| 2026-05-11 | IModule complet                                    | `IModule.ts`, `IKernel.ts`, `Module.ts`, commands                                                     | ~1h    | 85 core ✅ — `Module implements IModule`, `PackageJson` migré vers types, casts `as Module` éliminés dans commands                                                                                                                                                                                                                                                                                                                    |
| 2026-05-12 | Phase 0 finalisée + sécurité                       | Build system, deps, vulnérabilités                                                                    | ~2h    | Turbo OK — 1900 warnings TS2614 éliminés — 61→15 vulns — `mocha-jsdom` supprimé — mongoose `dependencies` nettoyé — merge sur `claude-ts`                                                                                                                                                                                                                                                                                             |
| 2026-05-13 | Service.ts — audit qualité + bugs                  | `Service.ts`, `Service.test.ts`                                                                       | ~2h    | 234 tests ✅ — 5 bugs corrigés — `MEMORY.md` créé — `README.md` Service complet                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-13 | Container.ts — audit qualité + bugs                | `Container.ts`, `Container.test.ts`                                                                   | ~1h    | 257 tests ✅ — 2 bugs corrigés (`has`/`remove` valeurs falsy) — `id` public — MEMORY.md mis à jour                                                                                                                                                                                                                                                                                                                                    |
| 2026-05-13 | IContainer + IScope                                | `IContainer.ts`, `Container.ts`, `IService.ts`                                                        | ~30min | `claude-ts` — `Container implements IContainer`, `Scope implements IScope`, `IService.container: IContainer\|null`                                                                                                                                                                                                                                                                                                                    |
| 2026-05-13 | ESM refactor — Nodefony.ts + index.ts              | `Nodefony.ts`, `index.ts`, `Error.ts`, 20+ fichiers packages                                          | ~3h    | branche `refactor/nodefony-esm` — suppression default export — `Nodefony` classe statique — `nodefonyError` renommé — tous packages + modules fixés — runtime ✅                                                                                                                                                                                                                                                                      |
| 2026-05-13 | Fix 4 warnings TS ciblés                           | packages http, framework                                                                              | ~1h    | TS2531 routerDecorators ✅ — TS2339 toJSON ✅ — TS2614 isArray ✅ — TS2742 setMetaBag ✅ — CLAUDE.md section lancement ajoutée                                                                                                                                                                                                                                                                                                        |
| 2026-05-14 | Zéro warnings build                                | 10 rollup.config.ts, 5 .d.ts, 4 .ts                                                                   | ~3h    | 287 tests ✅ — sourcemap ✅ — TS2305 ✅ — TS2339 ✅ — TS6133/6196 ✅ — TS5055 supprimé onwarn ✅                                                                                                                                                                                                                                                                                                                                      |
| 2026-05-14 | Syslog — audit + nouvelles features                | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts`, `Syslog.test.ts`, `MEMORY.md`, `README.md`                       | ~2h    | 282 tests ✅ — 4 bugs corrigés — `print()` + `logMultiple()` + `overrideConsole` + `rawLog()` + README.md complet                                                                                                                                                                                                                                                                                                                     |
| 2026-05-14 | Phase X — Transport Layer                          | `ITransport.ts`, `ConsoleTransport.ts`, `FileTransport.ts`, `HttpTransport.ts`, `transports/index.ts` | ~1h    | 303 tests ✅ — fire-and-forget — `onTransportError` — 9/9 build ✅                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-05-14 | Kernel.test.ts — tests complets                    | `Kernel.test.ts` (111 tests Kernel)                                                                   | ~1h    | 443 tests ✅ — constructor, Events bitmask, setEnv/setNodeEnv, checkPath, readConfig, stats, network, modules, setDomain, logEnv, initializeLog (11), fire/emit, perf, edge cases                                                                                                                                                                                                                                                     |
| 2026-05-14 | Module.test.ts — tests complets                    | `Module.test.ts` (74 tests Module)                                                                    | ~1h    | 500 tests ✅ — construction, setPath, setEvents (lifecycle hooks), readOverrideModuleConfig (Module-\*), addService, getPackageJson, loadJson, install/outdated, addCommand, log, controllers statiques, perf, edge cases                                                                                                                                                                                                             |
| 2026-05-14 | CliKernel.test.ts — tests complets                 | `CliKernel.test.ts` (71 tests CliKernel)                                                              | ~1h    | 571 tests ✅ — constructor, setType, setPackageManager, addCommand, parseCommand, initSyslog (8 cas: mock kernel, debug/msgid/json), loadLocalModule, terminate (mock), niceBytes statique (9 cas), showHelp, edge cases                                                                                                                                                                                                              |
| 2026-05-14 | Kernel/Module/CliKernel — doc IA + humaine         | `kernel/MEMORY.md`, `kernel/README.md`, `CLAUDE.md`                                                   | ~30min | MEMORY.md: lifecycle flags, Events bitmask, setEnv/setNodeEnv, interfacesFilter gotchas, Module hooks prototype, setPath rules, CliKernel initSyslog, niceBytes — README.md: API tables, exemples, gotchas                                                                                                                                                                                                                            |
| 2026-05-14 | Tools.ts — optimisation extend + 152 tests         | `Tools.ts`, `Tools.test.ts`                                                                           | ~1h    | 723 tests ✅ — suppression lodash-es (isArray/isFunction/isRegExp → natifs) — hasOwn guard — pollution guard étendu (**proto**+constructor+prototype) — isPlainObject Object.prototype.toString explicite — perf: 100k shallow=38ms, 50k deep=135ms                                                                                                                                                                                   |
| 2026-05-14 | Module.test.ts — readOverrideModuleConfig          | `Module.test.ts` (+15 tests)                                                                          | ~30min | 738 tests ✅ — captureLogs helper — WARNING log capture — deep=true/false — reference change — multiple Module-\* — ERROR missing — regex edge cases                                                                                                                                                                                                                                                                                  |
| 2026-05-14 | Cli.test.ts + cli/MEMORY.md + cli/README.md        | `Cli.test.ts` (106 tests), `cli/MEMORY.md`, `cli/README.md`                                           | ~1h    | 836 tests ✅ — makeCli helper — EchoCommand pattern (done:Promise) — standalone sans kernel — construction (9) — commander (8) — registre (6) — exécution (8) — options/alias (4) — parse/parseAsync (6) — showBanner/logEnv (8) — checkVersion/semver (6) — timers (8) — setProcessTitle (4) — niceBytes/niceUptime/niceDate (9) — UI Progress/Spinner/Sparkline/Table (9) — existsSync/getCommandManager (10) — setPid/getEmoji (4) |
| 2026-05-14 | Injector.ts — auto-injection + Injector.test.ts    | `injector.ts`, `kernelDecorator.ts`, `Injector.test.ts` (57 tests)                                    | ~2h    | 893 tests ✅ — `design:paramtypes` auto-injection — `isRegistered()` — position-aware instantiate — `@inject` fix (class-level metadata) — typo "ERRROR" corrigé — 13 sections : register/isRegistered/get/backward-compat/@inject/auto-DI/priorité/@injectable/kernel-lookup/inject-reflect/instance/cas-limites/perf                                                                                                                |
| 2026-05-14 | @modules + @services — tests complets              | `Decorators.test.ts` (45 tests)                                                                       | ~1h    | 938 tests ✅ — stub kernel minimal avec fireEvent — mock getPackageJson/addService/loadService — 17 sections : construction×2, string/ctor/array×2, mixed×2, edge cases×2, erreurs, combinés, perf                                                                                                                                                                                                                                    |
| 2026-05-14 | Scope singleton/transient DI                       | `injector.ts`, `kernelDecorator.ts`, `index.ts`, `Injector.test.ts` (+15 tests), `INJECTION_PLAN.md`  | ~1h    | 953 tests ✅ — `DIScope`, `InjectableOptions`, `@injectable({ scope })`, `Injector.getScope()`, `_resolve` scope-aware — plan 5 phases (property/circular/scoped/registry/lazy)                                                                                                                                                                                                                                                       |
| 2026-05-14 | Kernel lifecycle — tests cycle de vie              | `KernelLifecycle.test.ts` (48 tests)                                                                  | ~1h    | 1001 tests ✅ — boot/preRegister/onReady ordre events — flags registered/booted/ready — hooks module (register/boot/ready/initialize) — terminate + mockQuit — arrêt chaîne par command — propagation erreurs — addKernelService                                                                                                                                                                                                      |
| 2026-05-14 | Kernel.ts — corrections bugs P1/P2 + plan refactor | `Kernel.ts`, `kernel/MEMORY.md`, `KERNEL_REFACTOR_PLAN.md`                                            | ~30min | 1001 tests ✅ — `preRegistered` set après onPreRegister — `postReady` set après onPostReady — `clean()` implémenté — `terminate()` reject(e) — `isModule(unknown)` — plan P3/P4 créé (isCore sync, initCluster syslog, loadApp configurable, GC removal, ModuleConstructor fix)                                                                                                                                                       |
| 2026-05-14 | Bugfix debug CLI — 3 bugs Kernel/CliKernel         | `Kernel.ts`, `CliKernel.ts`                                                                           | ~1h    | 1001 tests ✅ — `initializeLog()` : CLI prioritaire sur config (`!this.cli` guard) — `CliKernel.initSyslog()` : `"dev"` → `"development"` (condition était morte) — `setCli()` : param `cli` au lieu de `this.cli` (null). Cause : `options.log.debug=true` dans config app forçait DEBUG même sans `-d`. |
| 2026-05-14 | Fix archi CLI/Syslog — catch Commander + init idempotent | `CliKernel.ts`, `Syslog.ts`, `CliKernel.test.ts`                                                 | ~30min | 1004 tests ✅ — `.catch()` distingue helpDisplayed/version (terminate) vs autres erreurs (fallback) — `Syslog.init()` idempotent via `removeAllListeners("onLog")` avant add — test mis à jour |
| 2026-05-14 | Mise à jour dépendances patch/minor                | tous les `package.json` workspaces                                                                    | ~15min | 1004 tests ✅ — 15→9 vulnérabilités — skip majeurs : typescript 6, eslint 10, chai 6, mongoose 9, uuid 14, twig 3, etc. |
| 2026-05-14 | TypeScript 5→6 + uuid 11→14 + @types/node 24→25   | `Error.ts`, `Event.ts`, `globals.d.ts`, `nodefony.d.ts`, `tsconfig.json`, tous `package.json`         | ~2h    | 1004 tests ✅ — `override isError` + `detectType` — EventEmitter augmentation globale supprimée — interface Error all optional — `paths:{nodefony}` monorepo fix — `/// <reference types="node" />` rollup fix — build 0 erreur 0 warning |
| 2026-05-14 | ESLint 9→10 — flat config                          | `eslint.config.mjs` (nouveau), `.eslintrc.cjs` (supprimé), `package.json`, `globals.d.ts`, `Kernel.ts`, `Connector.ts`, `Syslog.test.ts` | ~1h | 1004 tests ✅ — 0 erreur lint — 96 warnings `no-explicit-any` (intentionnels, à adresser session dédiée) — GitHub Actions CI mis à jour (matrix 3 OS × 3 Node, `nodefony production` avant tests) |

---

## État des dépendances (2026-05-14)

| Package      | Avant  | Après  | Workspaces mis à jour                                              |
| ------------ | ------ | ------ | ------------------------------------------------------------------ |
| typescript   | 5.8.3  | 6.0.3  | nodefony + tous packages                                           |
| uuid         | 11.1.1 | 14.0.0 | nodefony + http                                                    |
| @types/node  | 24.x   | 25.7.0 | nodefony + tous packages                                           |
| @rollup/...  | 28.x   | 29.x   | nodefony + tous packages                                           |
| ESLint 9→10  | 9.31.0 | 10.3.0 | nodefony + root — flat config `eslint.config.mjs` — 0 erreur, 96 warnings `no-explicit-any` (intentionnels) |

---

## Warnings TypeScript restants (build 2026-05-14)

> **0 warnings `[plugin typescript]`** — build entièrement propre.

### TS4114 — Missing `override` modifier (priorité basse)

| Fichier source                                | Lignes         | Fix                                           |
| --------------------------------------------- | -------------- | --------------------------------------------- |
| `nodefony-core/index.ts` (app exemple racine) | 43, 76, 86, 96 | Ajouter `override` — hors packages distribués |

---

### TS2339 — BoatEntity.init (test module)

| Fichier source                                   | Ligne | Propriété                        | Fix                                        |
| ------------------------------------------------ | ----- | -------------------------------- | ------------------------------------------ |
| `@nodefony/test` `nodefony/entity/BoatEntity.ts` | 48    | `init` sur `typeof SessionModel` | Vérifier API Sequelize v6 — session dédiée |

---

## Prochaine session

**Branches actives** :

- `refactor/nodefony-esm` — ESM refactor complet (runtime OK, merge sur `claude-ts` quand prêt)
- `claude-ts` — branche principale migration TS (build propre, 287 tests ✅)

**Prochaine session recommandée** :

1. **ESLint 9→10** — migration flat config (`eslint.config.mjs`) — nouvelle branche
2. **Refacto CLI architecture** — branche `refactor/cli-kernel-order` — `ICliKernel`, `ICommand`, `ModuleConstructor`, `fixCommanderCli`
3. **Phase 5.1** — `IController` + `Controller.ts`
4. **Phase X reste** — `LokiTransport` (Grafana Loki, streams)
5. **@entities** — tester `@entities` (même pattern que `Decorators.test.ts`, event `onBoot`)

**Fichiers à lire en début de session** :

- `MIGRATION_STATUS.md` (ce fichier)
- `src/nodefony/MEMORY.md` (Service, Container, Nodefony, index)
- `src/nodefony/src/syslog/MEMORY.md` (Syslog, Pdu, transport plan)
- `src/nodefony/src/cli/MEMORY.md` (Cli, Command)
- `src/nodefony/src/kernel/MEMORY.md` (Kernel lifecycle, Module hooks, CliKernel)

**Vulnérabilités restantes (9)** : twig (locutus/minimatch/minimist) + mocha→diff — fix = majeurs skippés intentionnellement

**TS6 — Gotchas importants pour les prochaines sessions** :
- `Error.isError()` : c'est un built-in TS6 — utiliser `nodefonyError.detectType()` pour la détection de type d'erreur
- `EventEmitter` : NE PAS augmenter globalement (casse `net.Server.listen`) — méthodes custom sur la classe Event uniquement
- `tsconfig.json` : `paths: {nodefony: ["./src/index.ts"]}` obligatoire dans le workspace pour éviter la résolution vers `dist/types/` stale
- `globals.d.ts` : `/// <reference types="node" />` nécessaire pour le rollup plugin
