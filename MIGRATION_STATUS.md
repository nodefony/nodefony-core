# MIGRATION_STATUS.md — Tableau de bord

> Mis à jour à chaque fin de session Claude Code.
> Légende : ✅ Migré | 🔶 Partiel | ⬜ À faire | 🚫 Bloqué | ⏭️ Skip (non pertinent)

---

## Progression globale

| Catégorie           | Total | ✅ | 🔶 | ⬜ |
|---------------------|-------|----|----|-----|
| **Build System**    | 10    | 10 | 0  | 0   |
| Core / Kernel       | 6     | 4  | 0  | 2   |
| DI Container        | 4     | 0  | 0  | 4   |
| Module System       | 5     | 2  | 0  | 3   |
| Syslog / Pdu        | 4     | 4  | 0  | 0   |
| Router              | 4     | 0  | 0  | 4   |
| HTTP / WS           | 6     | 0  | 0  | 6   |
| Controller          | 3     | 0  | 0  | 3   |
| Session             | 3     | 0  | 0  | 3   |
| Security / Auth     | 5     | 0  | 0  | 5   |
| ORM Adapters        | 4     | 0  | 0  | 4   |
| CLI                 | 4     | 0  | 0  | 4   |
| Monitoring          | 3     | 0  | 0  | 3   |
| Types / Interfaces  | 5     | 4  | 0  | 1   |
| **TOTAL**           | **66**| **24** | **0** | **42** |

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

| # | Tâche | Fichier(s) | Statut | Complexité |
|---|-------|------------|--------|------------|
| 1 | Shim `vendor.d.ts` — fin des `@ts-ignore` | `src/nodefony/src/types/vendor.d.ts` + 4 packages | ✅ | 1 |
| 2 | Supprimer les `@ts-ignore` | http, security, framework, redis, root rollup | ✅ | 1 |
| 3 | Refactorer core rollup (3 outputs, no CJS, no tests, no `any`) | `src/nodefony/rollup.config.ts` | ✅ | 3 |
| 4 | Core `package.json` : ESM only + exports `browser`/`node` | `src/nodefony/package.json` | ✅ | 2 |
| 5 | Tests : `tsx node_modules/.bin/mocha` (110 tests, ~3s) | `src/nodefony/package.json` | ✅ | 1 |
| 6 | Créer `turbo.json` à la racine | `turbo.json` | ✅ | 2 |
| 7 | Root `package.json` : `prepare → turbo run build` + turbo devDep | `package.json` | ✅ | 1 |
| 8 | Supprimer `src/packages/package.json` | supprimé | ✅ | 1 |
| 9 | `@nodefony/llm` — son propre `rollup.config.ts` + `tsconfig.json` | `src/packages/@nodefony/llm/` | ✅ | 2 |
| 10 | `peerDependencies: { nodefony: "*" }` dans http/security/framework/llm | 4 × `package.json` | ✅ | 1 |

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

| Fichier TS (chemin réel)                     | Source JS référence                          | Statut | Complexité | Notes |
|----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/nodefony/src/types/nodefony.d.ts`       | `nodefony/core/nodefony.js`                  | ✅     | 2          | Types globaux, enums env |
| `src/nodefony/src/types/IKernel.ts`          | `nodefony/core/kernel.js` (interfaces)       | ✅     | 2          | Interface IKernel complète |
| `src/nodefony/src/types/IModule.ts`          | `nodefony/core/bundles/nodefonyBundle.js`    | ✅     | 1          | Interface IModule |
| `src/nodefony/src/types/IService.ts`         | `nodefony/core/container/`                   | ✅     | 1          | Interface IService |
| `src/nodefony/src/types/IContext.ts`         | `nodefony/core/controller/`                  | ⬜     | 3          | Contexte unifié HTTP+WS — à faire |

### 1.2 Syslog & Pdu

| Fichier TS (chemin réel)                     | Source JS référence                          | Statut | Complexité | Notes |
|----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/nodefony/src/types/ISyslog.ts`          | `nodefony/core/syslog/`                      | ✅     | 1          | Interface ISyslog |
| `src/nodefony/src/syslog/Pdu.ts`             | `nodefony/core/syslog/pdu.js`                | ✅     | 2          | CircularBuffer O(1), Date.now() |
| `src/nodefony/src/syslog/Syslog.ts`          | `nodefony/core/syslog/syslog.js`             | ✅     | 3          | severityNameMap, fastTypeOf, no lodash |
| `src/nodefony/src/syslog/index.ts`           | N/A                                          | ✅     | 1          | Barrel export |

### 1.3 DI Container

| Fichier TS (chemin réel)                     | Source JS référence                          | Statut | Complexité | Notes |
|----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/nodefony/src/Container.ts`              | `nodefony/core/container/container.js`       | ⬜     | 3          | Core DI |
| `src/container/ServiceDefinition.ts`         | `nodefony/core/container/`                   | ⬜     | 2          | Définition de service |
| `src/container/decorators.ts`                | N/A (nouveau)                                | ⬜     | 2          | @Service, @Injectable |
| `src/container/index.ts`                     | N/A                                          | ⬜     | 1          | Barrel export |

---

## Phase 2 — Kernel & Modules

### 2.1 Service & Kernel

| Fichier TS (chemin réel)                     | Source JS référence                          | Statut | Complexité | Notes |
|----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/nodefony/src/Service.ts`                | `nodefony/core/service.js`                   | ✅     | 2          | `#nc` privé, `implements IService` |
| `src/nodefony/src/kernel/Kernel.ts`          | `nodefony/core/kernel.js`                    | ✅     | 3          | `Kernel implements IKernel`, KernelNetworkResult |
| `src/nodefony/src/kernel/CliKernel.ts`       | `nodefony/core/cli/kernel.js`                | ✅     | 2          | Cast `as Kernel`, import IKernel inutilisé supprimé |
| `src/nodefony/src/kernel/KernelEvents.ts`    | `nodefony/core/kernel.js` (events)           | ⬜     | 2          | Events lifecycle |
| `src/nodefony/src/kernel/Environment.ts`     | `nodefony/core/kernel.js` (env)              | ⬜     | 1          | dev/prod/test |
| `src/nodefony/src/kernel/index.ts`           | N/A                                          | ⬜     | 1          | Barrel export |

### 2.2 Module System

| Fichier TS (chemin réel)                     | Source JS référence                          | Statut | Complexité | Notes |
|----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/nodefony/src/kernel/Module.ts`          | `nodefony/core/bundles/nodefonyBundle.js`    | ✅     | 3          | `Module implements IModule`, PackageJson types, casts `as Module` éliminés |
| `src/bundles/ModuleRegistry.ts`              | `nodefony/core/bundles/`                     | ⬜     | 2          | Registre des modules |
| `src/bundles/decorators.ts`                  | N/A (nouveau)                                | ⬜     | 2          | @Module decorator |
| `src/bundles/ModuleCompiler.ts`              | `nodefony/core/bundles/`                     | ⬜     | 3          | Compilation des modules |
| `src/bundles/index.ts`                       | N/A                                          | ⬜     | 1          | Barrel export |

---

## Phase 3 — Router & Contexte unifié

### 3.1 Contexte HTTP+WS (différenciateur clé)

| Fichier TS cible                              | Source JS référence                          | Statut | Complexité | Notes |
|-----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/packages/@nodefony/http/NodefonyContext.ts` | `nodefony/core/controller/`               | ⬜     | 3          | Contexte unifié |
| `src/packages/@nodefony/http/HttpContext.ts`  | `nodefony/core/`                             | ⬜     | 3          | Contexte HTTP |
| `src/packages/@nodefony/http/WebSocketContext.ts` | `nodefony/core/`                         | ⬜     | 3          | Contexte WS |

### 3.2 Router

| Fichier TS cible                              | Source JS référence                          | Statut | Complexité | Notes |
|-----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/packages/@nodefony/framework/Router.ts`  | `nodefony/core/router/router.js`             | ⬜     | 3          | Router principal |
| `src/packages/@nodefony/framework/Route.ts`   | `nodefony/core/router/`                      | ⬜     | 2          | Définition route |
| `src/packages/@nodefony/framework/decorators.ts` | N/A (nouveau)                             | ⬜     | 2          | @Route, @WebSocketRoute |
| `src/packages/@nodefony/framework/index.ts`   | N/A                                          | ⬜     | 1          | Barrel export |

---

## Phase 4 — Serveurs HTTP/WS natifs Node.js

> **Node.js natif uniquement** — `node:http`, `node:http2`, `ws`. Jamais `Bun.serve()`.

### 4.1 Serveurs

| Fichier TS cible                              | Source JS référence                          | Statut | Complexité | Notes |
|-----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/packages/@nodefony/http/HttpServer.ts`   | `nodefony/core/`                             | ⬜     | 3          | node:http |
| `src/packages/@nodefony/http/HttpsServer.ts`  | `nodefony/core/`                             | ⬜     | 2          | TLS + HTTP/2 |
| `src/packages/@nodefony/http/WebSocketServer.ts` | `nodefony/core/`                          | ⬜     | 3          | `ws` natif Node.js |
| `src/packages/@nodefony/http/WssServer.ts`    | `nodefony/core/`                             | ⬜     | 2          | WS sécurisé |
| `src/packages/@nodefony/http/StaticServer.ts` | `nodefony/bundles/framework-bundle/`         | ⬜     | 2          | Fichiers statiques |
| `src/packages/@nodefony/http/index.ts`        | N/A                                          | ⬜     | 1          | Barrel export |

---

## Phase 5 — Controller & Session

### 5.1 Controller

| Fichier TS cible                              | Source JS référence                          | Statut | Complexité | Notes |
|-----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/packages/@nodefony/framework/Controller.ts` | `nodefony/core/controller/controller.js` | ⬜     | 3          | `Controller implements IController` |
| `src/packages/@nodefony/framework/decorators.ts` | N/A (nouveau)                             | ⬜     | 2          | @Controller |
| `src/packages/@nodefony/framework/index.ts`   | N/A                                          | ⬜     | 1          | Barrel export |

### 5.2 Session

| Fichier TS cible                              | Source JS référence                          | Statut | Complexité | Notes |
|-----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/packages/@nodefony/http/SessionManager.ts` | `nodefony/bundles/framework-bundle/session/` | ⬜   | 3          | Gestionnaire sessions |
| `src/packages/@nodefony/http/SessionStorage.ts` | `nodefony/bundles/framework-bundle/session/` | ⬜   | 2          | Drivers (memory, redis, ORM) |
| `src/packages/@nodefony/http/session/index.ts` | N/A                                         | ⬜     | 1          | Barrel export |

---

## Phase 6 — Sécurité & Auth

| Fichier TS cible                              | Source JS référence                          | Statut | Complexité | Notes |
|-----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/packages/@nodefony/security/SecurityManager.ts` | `nodefony/bundles/security-bundle/`  | ⬜     | 3          | WAF, CORS, Auth |
| `src/packages/@nodefony/security/JwtProvider.ts`    | `nodefony/bundles/security-bundle/`  | ⬜     | 2          | JWT |
| `src/packages/@nodefony/security/OAuthProvider.ts`  | `nodefony/bundles/security-bundle/`  | ⬜     | 3          | OAuth |
| `src/packages/@nodefony/security/PassportBridge.ts` | `nodefony/bundles/security-bundle/`  | ⬜     | 2          | Compat Passport.js |
| `src/packages/@nodefony/security/index.ts`          | N/A                                  | ⬜     | 1          | Barrel export |

---

## Phase 7 — ORM Adapters

| Fichier TS cible                              | Source JS référence                          | Statut | Complexité | Notes |
|-----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/packages/@nodefony/sequelize/SequelizeAdapter.ts` | `nodefony/bundles/sequelize-bundle/`  | ⬜  | 3          | Compat legacy |
| `src/packages/@nodefony/mongoose/MongooseAdapter.ts`   | `nodefony/bundles/mongoose-bundle/`   | ⬜  | 2          | MongoDB |
| `src/orm/MikroOrmAdapter.ts`                  | N/A (nouveau)                                | ⬜     | 3          | ORM principal TS |
| `src/orm/index.ts`                            | N/A                                          | ⬜     | 1          | Barrel export |

---

## Phase 8 — CLI & Monitoring

### 8.1 CLI

| Fichier TS cible                              | Source JS référence                          | Statut | Complexité | Notes |
|-----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/nodefony/src/bin/nodefony.ts`            | `nodefony/core/cli/`                         | ⬜     | 3          | CLI principal — shebang via rollup banner |
| `src/cli/generators/Module.ts`                | `nodefony/core/cli/generators/`              | ⬜     | 2          | Générateur module |
| `src/cli/generators/Controller.ts`            | `nodefony/core/cli/generators/`              | ⬜     | 2          | Générateur controller |
| `src/cli/index.ts`                            | N/A                                          | ⬜     | 1          | Barrel export |

### 8.2 Monitoring

| Fichier TS cible                              | Source JS référence                          | Statut | Complexité | Notes |
|-----------------------------------------------|----------------------------------------------|--------|------------|-------|
| `src/monitoring/DebugBar.ts`                  | `nodefony/bundles/monitoring-bundle/`        | ⬜     | 3          | Debug bar |
| `src/monitoring/Metrics.ts`                   | `nodefony/bundles/monitoring-bundle/`        | ⬜     | 2          | Métriques runtime |
| `src/monitoring/index.ts`                     | N/A                                          | ⬜     | 1          | Barrel export |

---

## Blockers connus

| Module | Problème | Solution envisagée | Résolu |
|--------|----------|--------------------|--------|
| `src/nodefony/rollup.config.ts` | `@ts-ignore` sur `rollup-sourcemap-path-transform` | Créer `.d.ts` shim minimal | ⬜ |
| `IKernel.ts` | `cli: object \| null` → devrait être `ICliKernel \| null` | Session dédiée ICliKernel | ⬜ |
| `IModule.ts` | `getController()` retourne `unknown` → `IController` | Session dédiée après Phase 5.1 | ⬜ |

---

## Journal des sessions

| Date | Session | Module migré | Durée | Notes |
|------|---------|--------------|-------|-------|
| 2026-05-11 | Service + Interfaces | `Service.ts`, `IService`, `IKernel` | ~3h | 85 tests ✅ — `#nc` privé, `implements IService`, `Command.ts` fixé |
| 2026-05-11 | ISyslog + Syslog | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts` | ~2h | 85 tests ✅ — `Pci=unknown`, `Function` → types propres, `implements ISyslog` |
| 2026-05-11 | Syslog perf | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts` | ~1h | 85 tests ✅ — `CircularBuffer` O(1), `Date.now()`, `severityNameMap`, `fastTypeOf`, no lodash |
| 2026-05-11 | IKernel complet | `IKernel.ts`, `IService.ts`, `Service.ts`, `Kernel.ts`, `CliKernel.ts`, commands | ~2h | 111 tests ✅ — `Kernel implements IKernel`, `IService.kernel: IKernel\|null`, `KernelNetworkResult`, casts Module/CliKernel |
| 2026-05-11 | IModule complet | `IModule.ts`, `IKernel.ts`, `Module.ts`, commands | ~1h | 85 core ✅ — `Module implements IModule`, `PackageJson` migré vers types, casts `as Module` éliminés dans commands |
| 2026-05-12 | Phase 0 finalisée + sécurité | Build system, deps, vulnérabilités | ~2h | Turbo OK — 1900 warnings TS2614 éliminés — 61→15 vulns — `mocha-jsdom` supprimé — mongoose `dependencies` nettoyé — merge sur `claude-ts` |

---

## Warnings TypeScript restants (build 2026-05-12)

> 61 occurrences totales — 7 codes d'erreur — résolution par session dédiée
> Règle : corriger dans la session du module concerné, pas avant.

### TS2339 — Property does not exist on type (~14 occurrences uniques)

| Fichier source | Ligne | Propriété manquante | Type actuel | Fix |
|----------------|-------|---------------------|-------------|-----|
| `@nodefony/http` `nodefony/service/http-kernel.ts` | 293 | `toJSON` | `Error \| HttpError \| nodefonyError` | Ajouter `toJSON?(): object` à `HttpError` et `nodefonyError`, ou narrowing |
| `@nodefony/mongoose` `nodefony/service/orm.ts` | 212 | `displayTable` | `object` | Typer le retour de la méthode en `{ displayTable(): void }` ou interface ORM |
| `@nodefony/sequelize` `nodefony/service/orm.ts` | 324 | `displayTable` | `object` | Idem — même pattern dans `Orm` base class |
| `@nodefony/redis` `nodefony/src/Connection.ts` | 198 | `displayTable` | `object` | Idem |
| `@nodefony/redis` `nodefony/src/Connection.ts` | 202 | `host` | `RedisSocketOptions` | `RedisSocketOptions` n'a pas `host` — utiliser `path` ou le bon type ioredis |
| `@nodefony/test` `nodefony/entity/BoatEntity.ts` | 48 | `init` | `typeof SessionModel` | `SessionModel` n'expose pas `init` statique — vérifier l'API Sequelize v6 |

**Packages affectés** : http, framework, security, mongoose, sequelize, redis, test (propagation de `http-kernel.ts`)

---

### TS2305 — Module has no exported member (~10 occurrences uniques)

| Fichier source | Ligne | Membre manquant | Package source | Fix |
|----------------|-------|-----------------|----------------|-----|
| `@nodefony/http` `sessions/sessions-service.ts` | 28 | `SessionStorage` | `@nodefony/sequelize` | Exporter `SessionStorage` depuis l'index de `@nodefony/sequelize` |
| `@nodefony/http` `sessions/sessions-service.ts` | 29 | `SessionStorage` | `@nodefony/mongoose` | Exporter `SessionStorage` depuis l'index de `@nodefony/mongoose` |
| `@nodefony/test` `nodefony/entity/BoatEntity.ts` | 2 | `sequelize` | `@nodefony/sequelize` | Exporter l'instance `sequelize` depuis l'index |
| `@nodefony/test` `nodefony/entity/BoatEntity.ts` | 2 | `Models` | `@nodefony/sequelize` | Exporter le type `Models` depuis l'index |
| `@nodefony/test` `index.ts` | 2 | `entities` | `@nodefony/sequelize` | Exporter `entities` depuis l'index |

**Packages affectés** : http, sequelize, mongoose, redis, test (même `sessions-service.ts` compilé dans plusieurs packages)

---

### TS4114 — Missing `override` modifier (4 occurrences)

| Fichier source | Lignes | Base class | Fix |
|----------------|--------|------------|-----|
| `nodefony-core/index.ts` (app exemple racine) | 43, 76, 86, 96 | `Module` | Ajouter `override` aux méthodes qui surchargent `Module` |

> **Note** : fichier hors packages — c'est l'app de test racine `nodefony-core/index.ts`, pas un package distribué. Priorité basse.

---

### TS6196 — Declared but never used (2 occurrences)

| Fichier source | Ligne | Symbole | Fix |
|----------------|-------|---------|-----|
| `@nodefony/llm` `src/services/LLMService.ts` | 5 | `ILLMConfig` | Supprimer l'import ou utiliser l'interface |

---

### TS6133 — Declared but value never read (2 occurrences)

| Fichier source | Ligne | Symbole | Fix |
|----------------|-------|---------|-----|
| `@nodefony/security` `nodefony/src/decorators/firewallDecorator.ts` | 5 | `descriptor` | Supprimer le paramètre ou le préfixer `_descriptor` |

---

### TS2742 — Inferred type cannot be named (2 occurrences)

| Fichier source | Ligne | Symbole | Fix |
|----------------|-------|---------|-----|
| `@nodefony/http` `nodefony/src/session/session.ts` | 632 | `setMetaBag` | Ajouter une annotation de type explicite qui importe `Container` directement |

> **Cause** : TypeScript infère un type qui référence `nodefony/dist/types/Container` par chemin absolu — non portable.
> **Fix** : `setMetaBag(bag: Record<string, ReturnType<Container['get']>>): void` ou type inline.

---

### TS2322 — Type incompatible (2 occurrences)

| Fichier source | Ligne | Problème | Fix |
|----------------|-------|----------|-----|
| `@nodefony/mongoose` `rollup.config.ts` | 59 | `Plugin[]` du rollup racine ≠ `Plugin[]` du rollup local `@nodefony/mongoose` | Aligner la version de `rollup` dans le `package.json` de `@nodefony/mongoose` avec la racine |

> **Cause** : `@nodefony/mongoose` a sa propre installation de `rollup` dans `node_modules/` locale — les types `Plugin<any>[]` sont incompatibles entre les deux instances.

---

### Plugin warning — sourcemap (7 packages)

| Packages affectés |
|-------------------|
| http, framework, security, mongoose, sequelize, redis, test |

> Avertissement non-bloquant : `Rollup 'sourcemap' option must be set to generate source maps.`
> **Cause** : `tsconfig.json` des packages activent `sourceMap: true` mais le `rollup.config.ts` ne passe pas `sourcemap` dans l'output.
> **Fix** : Ajouter `sourcemap: true` dans les outputs rollup de chaque package, ou supprimer `sourceMap` des tsconfigs.

---

## Prochaine session

**Phase 0 terminée** ✅ — mergée sur `claude-ts` (2026-05-12)

**Prochaine session** : Phase 1.3 — `Container.ts` (DI Container) ou Phase 5.1 — `IController` + `Controller.ts`  
**Pré-requis** : `IService` ✅ — `IKernel` ✅ — `IModule` ✅  
**Fichiers à lire en début de session** :
- `src/nodefony/src/Container.ts` (DI Container — 🔶 partiellement typé)
- `src/packages/@nodefony/framework/nodefony/src/Controller.ts` (Phase 5.1)
- Ce fichier `MIGRATION_STATUS.md`

**Type warnings à traiter en priorité** :
- TS2305 : `SessionStorage`, `entities`, `sequelize`, `Models` manquants dans `@nodefony/sequelize` + `@nodefony/mongoose`
- TS2339 : `toJSON` sur `Error | HttpError | nodefonyError` dans `http-kernel.ts:293`
- TS4114 : `override` manquant dans `nodefony-core/index.ts` (app exemple racine)

**Vulnérabilités restantes (15)** : voir section "Warnings TypeScript restants" — twig@3.0.0 + asciify à traiter dans session dédiée
