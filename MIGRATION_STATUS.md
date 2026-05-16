# MIGRATION_STATUS.md — Tableau de bord

> Mis à jour à chaque fin de session Claude Code.
> Légende : ✅ Migré | 🔶 Partiel | ⬜ À faire | 🚫 Bloqué | ⏭️ Skip (non pertinent)

---

## Progression globale

| Catégorie                           | Total  | ✅     | 🔶    | ⬜     |
| ----------------------------------- | ------ | ------ | ----- | ------ |
| **Build System**                    | 10     | 10     | 0     | 0      |
| Core / Kernel                       | 6      | 4      | 0     | 2      |
| DI Container                        | 3      | 2      | 0     | 1      |
| Module System                       | 5      | 3      | 0     | 2      |
| Syslog / Pdu                        | 4      | 4      | 0     | 0      |
| Router                              | 4      | 4      | 0     | 0      |
| HTTP / WS                           | 6      | 0      | 0     | 6      |
| Controller                          | 3      | 3      | 0     | 0      |
| Session                             | 3      | 0      | 0     | 3      |
| Security / Auth                     | 5      | 0      | 0     | 5      |
| ORM Adapters                        | 4      | 0      | 0     | 4      |
| CLI                                 | 4      | 0      | 0     | 4      |
| Monitoring                          | 3      | 0      | 0     | 3      |
| Types / Interfaces                  | 6      | 5      | 0     | 1      |
| **Symbiose http↔fw (Phase 9.1)**    | 8      | 0      | 5     | 3      |
| **Cycle de vie Context (Phase 9.2)**| 12     | 0      | 0     | 12     |
| **Logs structurés (Phase 9.3)**     | 10     | 0      | 0     | 10     |
| **TOTAL**                           | **95** | **35** | **5** | **55** |

---

## 🗺️ Roadmap priorisée (dette technique d'abord)

> **Stratégie** : valider la fondation (hooks `Context` + tests symbiose) AVANT toute nouvelle feature (security, ORM, monitoring).
> **Unité d'effort** : 1 session Claude ≈ 1-4 h (réf. journal historique). Estimations indicatives.
> **Dépendances** : une tâche P_n peut dépendre d'une P_<n>. Lecture verticale possible.

### P0 — Bugs bloquants ouverts (avant toute nouvelle feature)

| #     | Tâche                                                                      | Phase    | Effort | Dépendances | Notes                                                                                       |
| ----- | -------------------------------------------------------------------------- | -------- | ------ | ----------- | ------------------------------------------------------------------------------------------- |
| P0.1  | Fix **11 fails** `http-rfc-errors.test.ts`                                  | 9.1 #6   | 1 ses. | —           | status-message vide, X-Request-Id non echoé sur erreur, 405 Allow, JSON shape — point d'entrée |
| P0.2  | Fix **2 fails WS binary séquentiels**                                       | —        | 1 ses. | —           | Timeout `context.send(buf, "binary")` en boucle → investiguer `http-kernel.ts` / `WebsocketContext` |
| P0.3  | `IModule.getController()` → `IController` (au lieu de `unknown`)            | Blocker  | 0.5 ses. | Phase 5.1 ✅ | Blocker listé — type correct maintenant que Controller est migré                            |

### P1 — Fondations symbiose (refactors techniques 9.5)

> Tout le reste de la Phase 9 et la Phase 6 (security) en dépend. Faire d'abord, sinon retour en arrière garanti.

| #     | Tâche                                                                                 | Phase     | Effort | Dépendances | Notes                                                                                          |
| ----- | ------------------------------------------------------------------------------------- | --------- | ------ | ----------- | ---------------------------------------------------------------------------------------------- |
| P1.1  | `Context.lifecycle` — exposer `phases: PhaseTiming[]` rempli par HttpKernel             | 9.5 #1    | 1 ses. | P0.1        | Pose les bases de l'observabilité phase-par-phase (axes 9.2.9, 9.3.25)                         |
| P1.2  | `Context.onAfterResponse(fn)` + listener `response.on("finish"\|"close")`               | 9.5 #3    | 1 ses. | P0.1        | Débloque audit log (9.2.19), tear-down (9.2.11), metrics post-réponse                          |
| P1.3  | `context.signal: AbortSignal` (`request.on("aborted")`)                                 | 9.5 #4    | 1 ses. | —           | Aborted requests (9.2.12), request timeout (9.2.18)                                            |
| P1.4  | `RequestContext` — `AsyncLocalStorage` `requestId` (+ userId futur)                     | 9.5 #5    | 2 ses. | P1.2        | **Bloc gros** : propagation downstream → débloque logs lisibles + injection scoped security    |
| P1.5  | `errorRenderer` module unifié HTTP+WS (sortie JSON cohérente)                           | 9.5 #6    | 1 ses. | P0.1        | Préalable à AuthFailureHandler (9.6) et tests symbiose 9.1.6                                   |
| P1.6  | `HttpKernel.logRequest()` extrait + `IRequestLogger` pluggable                          | 9.5 #2    | 0.5 ses. | P1.2       | Préalable à audit log (9.2.19) + pretty formatter (9.3.22) + requestLogger transport (9.3.30) |
| P1.7  | Hooks `Context` pour security : `beforeResolve`, `afterAuth`, `onAuthFailure`           | 9.5 #7    | 1 ses. | P1.2, P1.5  | **Préalable Phase 6** — éviter coupler `@nodefony/http` au security                            |

### P2 — Cycle de vie Context (axes 9.2 consommant les hooks P1)

| #     | Tâche                                                              | Axe     | Effort  | Dépendances | Notes                                                  |
| ----- | ------------------------------------------------------------------ | ------- | ------- | ----------- | ------------------------------------------------------ |
| P2.1  | Boundary timing phase-by-phase                                     | 9.2.9   | 1 ses.  | P1.1        | `performance.now()` à chaque hook HttpKernel           |
| P2.2  | Context tear-down déterministe (finish + close, dedup)             | 9.2.11  | 0.5 ses.| P1.2        | Couplé à P1.2                                          |
| P2.3  | Aborted requests cleanup + 499 status interne                      | 9.2.12  | 1 ses.  | P1.3        | Utilise `context.signal`                               |
| P2.4  | `initialize()` error boundary — réponse cohérente avec action crash | 9.2.16  | 0.5 ses.| P1.5        | Réutilise errorRenderer                                |
| P2.5  | Request timeout global (config + 408)                              | 9.2.18  | 0.5 ses.| P1.3        | Utilise AbortSignal                                    |
| P2.6  | Idempotency keys (`X-Idempotency-Key`)                             | 9.2.17  | 1 ses.  | P1.4        | Dédup via ALS scope court terme                        |
| P2.7  | W3C `traceparent` honor + génère                                   | 9.2.20  | 0.5 ses.| P1.4        | Compat OpenTelemetry                                   |
| P2.8  | Backpressure documentation + tests streaming                       | 9.2.13  | 1 ses.  | —           | Indépendant — focus media + download                   |
| P2.9  | Body streaming vs buffered (`@Body({ stream })`)                   | 9.2.14  | 1 ses.  | P0.1        | Lien upload formidable                                 |

### P3 — Logs structurés (consomme P1.2 + P1.6 + P2.1)

| #     | Tâche                                                          | Axe       | Effort  | Dépendances | Notes                                                  |
| ----- | -------------------------------------------------------------- | --------- | ------- | ----------- | ------------------------------------------------------ |
| P3.1  | Audit log canonique (1 PDU par requête, JSON)                  | 9.3.21+9.2.19 | 1 ses. | P1.2, P1.6, P1.4 | Le plus gros gain pour la machine                  |
| P3.2  | Pretty formatter dev (1 ligne colorée par requête)             | 9.3.22    | 1 ses.  | P3.1        | Le plus gros gain pour l'humain                        |
| P3.3  | Severity selon HTTP status (1xx-3xx INFO / 4xx WARN / 5xx ERR) | 9.3.23    | 0.5 ses.| P3.1        | Règle dans logRequest                                  |
| P3.4  | Header redaction (Authorization/Cookie/Set-Cookie)             | 9.3.29    | 0.5 ses.| P3.1        | Avant de logger quoi que ce soit en prod               |
| P3.5  | Erreur enrichie (1 PDU ERROR par requête + cause chain + stack) | 9.3.26   | 0.5 ses.| P3.1, P1.5  | Réutilise errorRenderer                                |
| P3.6  | Filtrage par requestId (CLI tool)                              | 9.3.24    | 0.5 ses.| P3.1        | Déjà supporté par Syslog conditions, expose en CLI     |
| P3.7  | Mode trace verbose (phase-by-phase DEBUG)                      | 9.3.25    | 1 ses.  | P2.1        | Utilise `context.timing[]`                             |
| P3.8  | Rate limit logs par requestId                                  | 9.3.27    | 0.5 ses.| P3.1        | Évite spam DEBUG boucles internes                      |
| P3.9  | WS logs (handshake + per-message + wsId)                       | 9.3.28    | 1 ses.  | P3.1        | Couplé à WS pipeline (P4.4)                            |
| P3.10 | `RequestLogger` transport dédié (NCSA/Combined optionnel)      | 9.3.30    | 1 ses.  | P3.1        | Pour log files séparés audit vs syslog                 |

### P4 — Tests symbiose http↔framework (axes 9.1 — finalisation)

| #     | Tâche                                                                       | Axe    | Effort  | Dépendances | Notes                                                                       |
| ----- | --------------------------------------------------------------------------- | ------ | ------- | ----------- | --------------------------------------------------------------------------- |
| P4.1  | Tests `forward("mod:ctrl:action")` cross-module + context partagé           | 9.1 #2 | 1 ses.  | P0.1        | `@nodefony/framework/tests/integration/forward.test.ts`                     |
| P4.2  | Tests decorators × pipeline combinés (@HttpCode + @Header + @Param + ...)   | 9.1 #3 | 1 ses.  | P0.1        | Étendre `http/decorators.test.ts`                                           |
| P4.3  | Tests concurrence / context leak (N=100 req // + assertions unicité IDs)    | 9.1 #4 | 1 ses.  | P1.4        | `lifecycle.test.ts` + `concurrency.test.ts` (créer)                         |
| P4.4  | Tests WS pipeline complet (handshake protocol → action → message handler)   | 9.1 #7 | 1 ses.  | P0.2        | Finaliser couverture WS (déjà partiel)                                      |
| P4.5  | Tests DI scope × requête (singleton vs transient, isolation)                 | 9.1 #8 | 1 ses.  | P1.4        | Préalable à Injector Phase B (scoped/ALS officiel)                          |
| P4.6  | Tests lifecycle session × controller (load → modify → persist → reload)     | 9.1 #5 | 1 ses.  | —           | Étendre `http/session.test.ts`                                              |

### P5 — Session (Phase 5.2)

| #     | Tâche                                                                | Effort  | Dépendances | Notes                                                          |
| ----- | -------------------------------------------------------------------- | ------- | ----------- | -------------------------------------------------------------- |
| P5.1  | `SessionManager` + `SessionStorage` interface complète + drivers     | 2 ses.  | P4.6        | Memory/Redis/ORM ; déjà partiellement codé dans `@nodefony/http` |
| P5.2  | Tests intégration sessions cross-request + expiry + flash            | 1 ses.  | P5.1        |                                                                |

### P6 — Security (Phase 6 / 9.6 — gros chantier)

> **Bloc complet** : ne pas démarrer avant que P1.7 (hooks `Context`) + P1.4 (ALS) + P1.5 (errorRenderer) soient ✅.

| #      | Tâche                                                            | Source JS                                       | Effort  | Dépendances | Notes                                                          |
| ------ | ---------------------------------------------------------------- | ----------------------------------------------- | ------- | ----------- | -------------------------------------------------------------- |
| P6.1   | `AccessControl` + `BcryptEncoder` (sans dep http)                | `accessControl.js`, `bcryptEncoder.js`          | 1 ses.  | —           | Fondations sans dépendance                                     |
| P6.2   | `cors.ts` service                                                 | `corsService.js` (182 L)                        | 1 ses.  | P1.7        | Plus simple, débloque API browser                              |
| P6.3   | `firewall.ts` service + SecuredArea match                         | `firewallService.js` (694 L)                    | 3 ses.  | P1.7, P1.4, P1.5 | Gros morceau — découper en (a) SecuredArea (b) factory selection (c) auth pipeline |
| P6.4   | `AnonymousProvider` + `AnonymousFactory` + `AnonymousToken`       | `anonymousProvider.js` + factories              | 1 ses.  | P6.3        | Valide le pipeline complet                                     |
| P6.5   | `PassportBridge` + factory `passport-local` + token userpassword  | `passportFramework.js` + `passport-localFactory.js` | 2 ses. | P6.3, P6.4 | 1ère stratégie réelle                                          |
| P6.6   | Factory `passport-jwt` + token JWT                                | `passport-jwtFactory.js`                        | 1 ses.  | P6.5        | API moderne                                                    |
| P6.7   | `csrf.ts` service                                                 | `csrfService.es6` (193 L)                       | 1 ses.  | P6.3        | Dépend firewall                                                |
| P6.8   | `authorization.ts` service                                        | `authorizationService.js`                       | 1 ses.  | P6.3, P6.1  | ACL/rôles                                                      |
| P6.9   | Factories OAuth/OpenID/LDAP/Google/GitHub (5 stratégies)          | `passport-*Factory.js`                          | 3 ses.  | P6.6        | Étalées — extensions optionnelles                              |
| P6.10  | Logs auth (audit S1-S5) + CSP/security headers (S6)               | —                                               | 1 ses.  | P3.1, P6.3  | Extension de 9.3 / 9.6                                         |
| P6.11  | Tests intégration security complets (firewall-http/ws, cors, csrf, stack) | —                                       | 2 ses.  | P6.10       | `symbiose-stack.test.ts` couvre CORS→Firewall→ACL→CSRF→Ctrl   |

### P7 — ORM Adapters (Phase 7)

| #     | Tâche                                                       | Effort  | Dépendances | Notes                                          |
| ----- | ----------------------------------------------------------- | ------- | ----------- | ---------------------------------------------- |
| P7.1  | `SequelizeAdapter` (compat legacy)                          | 2 ses.  | —           | Module existe partiellement                    |
| P7.2  | `MongooseAdapter`                                           | 1 ses.  | —           | Module existe partiellement                    |
| P7.3  | `MikroOrmAdapter` (nouveau, ORM principal TS)               | 3 ses.  | —           | Découper schema + repository + transactions    |
| P7.4  | Tests adapters + intégration session ORM-backed             | 1 ses.  | P5.1, P7.*  |                                                |

### P8 — CLI + Monitoring (Phase 8)

| #     | Tâche                                                          | Effort  | Dépendances | Notes                                          |
| ----- | -------------------------------------------------------------- | ------- | ----------- | ---------------------------------------------- |
| P8.1  | `bin/nodefony.ts` — shebang via rollup banner                  | 1 ses.  | —           | CLI principal                                  |
| P8.2  | Generators (`Module.ts`, `Controller.ts`, `Service.ts`)        | 1 ses.  | P8.1        |                                                |
| P8.3  | `DebugBar` (monitoring middleware HTML + JSON)                 | 2 ses.  | P3.1        | Consomme audit log                             |
| P8.4  | `Metrics` runtime (memory, requests, errors)                   | 1 ses.  | P3.1        |                                                |

### P9 — Polish + clôture

| #     | Tâche                                                          | Effort   | Notes                                          |
| ----- | -------------------------------------------------------------- | -------- | ---------------------------------------------- |
| P9.1  | `@entities` decorator + tests (pattern `Decorators.test.ts`)   | 0.5 ses. | Phase 1.3 résiduel                             |
| P9.2  | Barrel `src/container/index.ts`, `src/bundles/index.ts`, etc. | 0.5 ses. | Phase 1.3, 2.2, 2.1 résiduels                  |
| P9.3  | README.md publics (http, framework, security)                  | 1 ses.   | Audience humaine                               |
| P9.4  | Vulnérabilités restantes (9 — twig/mocha)                      | 0.5 ses. | Audit dépendances + upgrades majeurs possibles |

### Synthèse effort total

| Bloc                                  | Sessions estimées |
| ------------------------------------- | ----------------- |
| P0 — Bugs bloquants                   | ~2.5              |
| P1 — Fondations symbiose              | ~7.5              |
| P2 — Cycle de vie Context             | ~6                |
| P3 — Logs structurés                  | ~6.5              |
| P4 — Tests symbiose                   | ~6                |
| P5 — Session                          | ~3                |
| P6 — Security (gros)                  | ~16               |
| P7 — ORM                              | ~7                |
| P8 — CLI + Monitoring                 | ~5                |
| P9 — Polish                           | ~2.5              |
| **TOTAL**                             | **~62 sessions**  |

### Chemin critique (le plus rapide vers un framework prod-ready avec security)

```
P0 (2.5) → P1.1-P1.7 (7.5) → P3.1+P3.4+P3.5 (2)  ← logs minimal
                            → P2.2-P2.5 (2.5)    ← context tear-down + abort
                            → P5 (3)             ← sessions
                            → P6.1-P6.8 (11)     ← security minimal sans OAuth
                                                 = ~28 sessions vers MVP prod
```

Le reste (OAuth, ORM, monitoring, polish, axes secondaires) peut être livré incrémentalement sans bloquer un déploiement.

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

### 3.2 Router ✅ (2026-05-15/16)

| Fichier TS cible                                                  | Source JS référence              | Statut | Complexité | Notes                                                          |
| ----------------------------------------------------------------- | -------------------------------- | ------ | ---------- | -------------------------------------------------------------- |
| `src/packages/@nodefony/framework/nodefony/service/router.ts`    | `nodefony/core/router/router.js` | ✅     | 3          | Router + IRoute + 11 tests unit                                |
| `src/packages/@nodefony/framework/nodefony/src/Route.ts`         | `nodefony/core/router/`          | ✅     | 2          | Route + IRoute + 28 tests unit — fix WEBSOCKET return true     |
| `src/packages/@nodefony/framework/nodefony/decorators/routerDecorators.ts` | N/A                   | ✅     | 2          | @route/@controller/@controllers + @Get/@Post/@Put/@Delete/@Patch + @HttpCode/@Header/@Redirect + **@Param/@Body/@Query** |
| `src/packages/@nodefony/framework/index.ts`                      | N/A                              | ✅     | 1          | Barrel export complet                                          |

---

## Phase 4 — Serveurs HTTP/WS natifs Node.js ✅ (branche refactor/http-deps)

> **Node.js natif uniquement** — `node:http`, `node:http2`, `ws`. Jamais `Bun.serve()`.
> Module `@nodefony/http` migré et fonctionnel. Voir plan tests ci-dessous.

### 4.1 Serveurs

| Fichier TS                                                          | Statut | Notes                                |
| ------------------------------------------------------------------- | ------ | ------------------------------------ |
| `src/packages/@nodefony/http/nodefony/service/servers/server-http.ts`      | ✅     | node:http — port 5151                |
| `src/packages/@nodefony/http/nodefony/service/servers/server-https.ts`     | ✅     | TLS + HTTP/2                         |
| `src/packages/@nodefony/http/nodefony/service/servers/server-websocket.ts` | ✅     | ws@8 sur http                        |
| `src/packages/@nodefony/http/nodefony/service/servers/server-websocket-secure.ts` | ✅ | wss sur https                   |
| `src/packages/@nodefony/http/nodefony/service/servers/server-static.ts`   | ✅     | serve-static                         |
| `src/packages/@nodefony/http/nodefony/service/http-kernel.ts`             | ✅     | orchestrateur central                |
| `src/packages/@nodefony/http/nodefony/service/certificates.ts`            | ✅     | node-forge TLS (bugs mineurs connus) |
| `src/packages/@nodefony/http/index.ts`                                    | ✅     | barrel export + types                |

### 4.2 Plan tests @nodefony/http (branche refactor/http-deps — 2026-05-15)

| Phase | Sujet | Fichier(s) | Statut |
|---|---|---|---|
| 1 | Interfaces TypeScript | `nodefony/interfaces/` | ✅ commit 8a81ede |
| 2 | Tests unitaires | `Cookie.test.ts`, `HttpError.test.ts`, `Session.test.ts` | ✅ 67 passing |
| 3 | Intégration runtime | `session.test.ts`, `security.test.ts`, `upload.test.ts`, `httpKernel.test.ts` | ✅ partiel — manque http1/https/errors |
| 3b | Résiduel intégration | `http1.test.ts`, `https.test.ts`, `errors.test.ts` | ⬜ à créer |
| 4 | HttpKernel + Context | pipeline complet, Content-Type, parallel requests, cookies | ⬜ |
| 5 | Résilience + Sécurité | `resilience.test.ts`, `security.test.ts` | ✅ |
| 5b | Serve-static | `static.test.ts` | ✅ |
| 5c | Fuites mémoire | `memory.test.ts` | ✅ partiel (à valider avec serveur) |
| 6 | Performance | autocannon, gzip/brotli, ETag | ⬜ |
| 7 | HTTP/3 stub | `server-http3.ts` | ⏭️ Node.js >= 28 requis |
| 8 | README.md | documentation publique | ⬜ |
| 9 | Commandes CLI HTTP | certificates, routes, sessions:clear, server:stats | ⬜ |
| 10 | Certificate tests | `certificate.test.ts` (unit) | ⬜ pas urgent |

**Bugs corrigés @nodefony/http (2026-05-15/16)** :
- `ERR_INVALID_CHAR` statusMessage — dist périmé sans sanitization ASCII → rebuild ✅
- `ERR_INVALID_CHAR` writeHead — Node.js set `statusMessage` natif AVANT de valider → char invalide persiste → tous les writes suivants échouent (timeout inclus). Fix : `safeMsg = statusMessage.replace(/[^\x20-\x7E]/g, "")` dans `Response.writeHead()` avant appel `ServerResponse.writeHead()` ✅ (2026-05-16)
- `HttpError.Controller/Action/Response: undefined` — champs jamais renseignés. Fix : extraire `context.resolver.controller.name` + `resolver.actionName` dans `HttpError` constructor ✅ (2026-05-16)
- Cookie `Expires` an 58339 — `(getTime() + maxage) * 1000` → `getTime() + maxage * 1000` ✅
- Cookie session (maxAge=0) → `maxage === 0` ne catchait pas `undefined` → `!maxage` ✅
- **queryGet `?`-prefix** — `QS.parse(url.search)` → `QS.parse(url.search.slice(1))` : premier param retournait `"?name"` au lieu de `"name"` ✅ (2026-05-16)

**Bugs connus @nodefony/http** :
- 2 tests binary séquentiels WS → timeout (investigation `context.send()` en boucle)
- `Certificate.createFullChain()` : opérateur `+` sur `||` → concaténation incorrecte
- `Certificate.createCertificate()` : `serialNumber: "01"` hardcodé ignore `generateSerial()`

---

## Phase 5 — Controller & Session

### 5.1 Controller ✅ (2026-05-16)

| Fichier TS cible                                                   | Source JS référence                      | Statut | Complexité | Notes                                                             |
| ------------------------------------------------------------------ | ---------------------------------------- | ------ | ---------- | ----------------------------------------------------------------- |
| `src/packages/@nodefony/framework/nodefony/src/Controller.ts`      | `nodefony/core/controller/controller.js` | ✅     | 3          | `Controller implements IController` — 40 tests intégration        |
| `src/packages/@nodefony/framework/nodefony/src/Resolver.ts`        | N/A                                      | ✅     | 3          | `Resolver implements IResolver` — `_applyResponseDecorators` + `_handleRedirect` + `_buildParamArgs` |
| `src/packages/@nodefony/framework/nodefony/interfaces/`            | N/A (nouveau)                            | ✅     | 2          | `IController`, `IRoute`, `IResolver`                              |

### 5.2 Session

| Fichier TS cible                                | Source JS référence                          | Statut | Complexité | Notes                        |
| ----------------------------------------------- | -------------------------------------------- | ------ | ---------- | ---------------------------- |
| `src/packages/@nodefony/http/SessionManager.ts` | `nodefony/bundles/framework-bundle/session/` | ⬜     | 3          | Gestionnaire sessions        |
| `src/packages/@nodefony/http/SessionStorage.ts` | `nodefony/bundles/framework-bundle/session/` | ⬜     | 2          | Drivers (memory, redis, ORM) |
| `src/packages/@nodefony/http/session/index.ts`  | N/A                                          | ⬜     | 1          | Barrel export                |

---

## Phase 6 — Sécurité & Auth

> **Détail complet du périmètre** : voir [Phase 9.6](#96-intégration-nodefonysecurity-futur-module-phase-6) — composants à migrer, points d'intégration symbiose, ordre proposé.
> **Référence JS** : `/Users/cci/repository/nodefony/src/nodefony/bundles/security-bundle/` (à consulter avant migration TS).

| Fichier TS cible                                     | Source JS référence                                       | Statut | Complexité | Notes                                            |
| ---------------------------------------------------- | --------------------------------------------------------- | ------ | ---------- | ------------------------------------------------ |
| `@nodefony/security/service/firewall.ts`             | `services/firewall/firewallService.js` (694 L)            | ⬜     | 3          | SecuredArea, factory selection, auth pipeline    |
| `@nodefony/security/service/cors.ts`                 | `services/cors/corsService.js` (182 L)                    | ⬜     | 2          | Pre-flight + Access-Control-* headers            |
| `@nodefony/security/service/csrf.ts`                 | `services/csrf/csrfService.es6` (193 L)                   | ⬜     | 2          | Token + double-submit                            |
| `@nodefony/security/service/authorization.ts`        | `services/authorization/authorizationService.js`          | ⬜     | 2          | ACL/rôles                                        |
| `@nodefony/security/src/AccessControl.ts`            | `src/Authorization/accessControl.js`                      | ⬜     | 2          | Hiérarchie rôles                                 |
| `@nodefony/security/src/encoders/BcryptEncoder.ts`   | `src/encoders/bcryptEncoder.js`                           | ⬜     | 1          | Hash password                                    |
| `@nodefony/security/src/PassportBridge.ts`           | `src/passport/passportFramework.js`                       | ⬜     | 2          | Adapter Passport.js                              |
| `@nodefony/security/src/factories/*` (9 stratégies)  | `src/factories/passport/*` + `anonymous/`                 | ⬜     | 3          | basic/digest/jwt/local/ldap/oauth2/openid/google/github |
| `@nodefony/security/src/tokens/*` (8 types)          | `src/tokens/*.js`                                         | ⬜     | 2          | anonymous/jwt/ldap/oauth2/openid/github/google/userpassword |
| `@nodefony/security/index.ts`                        | N/A                                                       | ⬜     | 1          | Barrel export                                    |

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
| 5   | `LokiTransport`                              | —                                                | ⏭️     | —          |
| 6   | Barrel export + tests                        | `transports/index.ts`                            | ✅     | 1          |

---

## Phase 9 — Symbiose http↔framework + cycle de vie requête + logs structurés

> Objectif : valider que `@nodefony/http` et `@nodefony/framework` se comportent bien comme **un seul système**.
> Le pipeline est implémenté (Phase 4 + 5), mais les tests d'intégration croisés et l'observabilité de la requête sont incomplets.
> 11 tests d'intégration `http-rfc-errors.test.ts` échouent actuellement (status-message vide, X-Request-Id non echoé sur erreur, etc.) — symptômes d'une symbiose à durcir.

### 9.1 Axes d'intégration http↔framework

| #   | Axe                                       | Sujet                                                                                                                                                  | Tests existants                                  | Statut |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------ |
| 1   | **Pipeline complet**                      | controller → resolver → HttpContext → Response, propagation HttpError, status codes (200/3xx/4xx/5xx/RFC 9110)                                          | `http-rfc-errors.test.ts` (partiel, 11 fails)    | 🔶     |
| 2   | **Forward cross-module**                  | `forward("mod:ctrl:action")` redispatch sans nouvelle requête HTTP — partage du context, pas de double-resolve                                          | manuel via `/nodefony/test/forward`              | ⬜     |
| 3   | **Decorators × pipeline**                 | `@Get/@Post` + `@Param/@Body/@Query` + `@HttpCode/@Header/@Redirect` combinés sur une seule action — ordre d'application, conflits headers              | `http/decorators.test.ts` (10 cas)               | 🔶     |
| 4   | **Concurrence / context leak**            | N requêtes parallèles — vérifier que `metaData`, `session`, `requestId`, `queryGet/Post`, `cookies` ne fuient JAMAIS entre contextes                    | aucun                                            | ⬜     |
| 5   | **Lifecycle session × controller**        | `initialize() → startSession()` → action → `saveSession()` → cookie cross-request (load → modify → persist → reload) ; isolation entre users           | `http/session.test.ts` (partiel)                 | 🔶     |
| 6   | **HttpError handling**                    | controller throw → `Resolver` catch → `HttpKernel.onError` → ErrorController → 500 JSON conservé requestId + Allow header pour 405                      | `http-rfc-errors.test.ts`                        | 🔶     |
| 7   | **WS pipeline**                           | Router résout protocole **AVANT** `connect()` → handshake action (`execute(null)`) → message handler ; isolation par connexion ; broadcast inclut self  | `websocket-*.test.ts` (partiel)                  | 🔶     |
| 8   | **DI scope × requête**                    | service singleton vs per-request, `@inject` dans controller, propagation kernel→module→controller ; Phase B Injector (scoped/ALS)                       | aucun (intégration)                              | ⬜     |

### 9.2 Cycle de vie d'une requête + Context (observabilité + robustesse)

> Le Context est créé à chaque requête et porte tout (`requestId`, `metaData`, `session`, `resolver`, `request`, `response`). Sa traçabilité bout-en-bout est la clé pour debug+observabilité.

| #   | Axe                                       | Sujet                                                                                                                                                  | Notes                                                                  | Statut |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------ |
| 9   | **Boundary timing (phase-by-phase)**      | Tracer durée de chaque phase : `connection → parse → resolve → firewall → initialize → action → render → write → send`                                  | Performance API (`performance.now()`) — exposé dans `context.timing[]` | ⬜     |
| 10  | **AsyncLocalStorage `requestId`**         | Propager `requestId` dans les services downstream (Syslog auto, DB queries, fetch) sans passer le `context` en param partout                            | Phase B du plan Injector (`INJECTION_PLAN.md`)                         | ⬜     |
| 11  | **Context tear-down déterministe**        | `context.cleanup()` à `response.end` : libérer listeners, fermer streams, flush session, retirer le `context` du `requestId` ALS map                    | Listener `response.on("finish")` + `on("close")`                       | ⬜     |
| 12  | **Aborted requests (client disconnect)**  | Client ferme la socket pendant action async → propre cleanup (subscribers, DB tx ouverte, lock) ; 499 status interne (Nginx-style)                      | `request.on("aborted")` + `AbortController` injecté dans le Context     | ⬜     |
| 13  | **Backpressure Response.write()**         | Quand `res.write()` retourne `false` → controller doit `await` le drain ; documenter ; tests streaming                                                  | `MediaStream` route déjà sensible                                       | ⬜     |
| 14  | **Body streaming vs buffered**            | Controller reçoit un `Readable` (stream) ou un body bufferisé ? Configurable par `@Body({ stream: true })` ? Limites mémoire/taille                     | Lien upload formidable                                                 | ⬜     |
| 15  | **`onTerminate` hook par requête**        | Le controller enregistre une callback exécutée APRÈS `response.end` (logs, metrics, audit, push) — pattern `context.onAfterResponse(fn)`                | Émettre event `"onRequestEnd"` sur Context                              | ⬜     |
| 16  | **Initialize error boundary**             | `initialize()` throw → action NON appelée → format réponse cohérent avec un crash action (même JSON shape, même requestId)                              | Vérifier dans `Resolver.callController`                                 | ⬜     |
| 17  | **Idempotency keys (RFC 9110 §9.2.2)**    | Header `X-Idempotency-Key` → dedup côté serveur ; relié à `requestId` ; cache court terme                                                                | Header standardisé Stripe/AWS                                           | ⬜     |
| 18  | **Request timeout**                       | Limite globale d'exécution action (`config.http.requestTimeoutMs`) → 408 si dépassé → cleanup propre via abort                                          | Pas de garde-fou actuel                                                 | ⬜     |
| 19  | **Context audit log**                     | À `response.finish` → 1 PDU INFO structuré contenant : `requestId`, `method`, `path`, `status`, `duration`, `controller`, `action`, `ip`, `userAgent`, `bytesIn`, `bytesOut`, `sessionId?` | Un seul log par requête (résume tout)                                  | ⬜     |
| 20  | **Trace ID W3C (RFC `traceparent`)**      | Honor `traceparent` header entrant + générer si absent → propager en sortie ; coexistence avec `X-Request-Id`                                            | Compat OpenTelemetry                                                    | ⬜     |

### 9.3 Logs — clarté homme + machine

> Les transports sont en place (Console/File/Http/Syslog — Phase X). Manque : un format JSON canonique requête + un format pretty humain en dev + filtrage par `requestId`.

| #   | Axe                                          | Sujet                                                                                                                                                  | Statut |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 21  | **Format JSON canonique par requête**        | Champs obligatoires : `ts, lvl, requestId, traceId, method, path, status, durationMs, controller, action, ip, userAgent, bytesIn, bytesOut, msg`        | ⬜     |
| 22  | **Pretty formatter dev (homme)**             | Mode dev : 1 ligne colorée par requête `[ID 1a2b…] 200 GET /foo 12ms — DefaultController.index` ; erreur sur 2 lignes (1 résumé + 1 stack)              | ⬜     |
| 23  | **Severity selon HTTP status**               | `1xx/2xx/3xx → INFO` ; `4xx → WARNING` (sauf 401/403 → NOTICE config) ; `5xx → ERROR` ; règles encodées dans `HttpKernel.logRequest()`                  | ⬜     |
| 24  | **Filtrage par requestId**                   | `syslog.filter({ msgid: requestId })` — reconstruire l'historique complet d'une requête (déjà supporté par Syslog conditions, à exposer dans CLI)      | ⬜     |
| 25  | **Mode trace verbose**                       | `DEBUG` activé → log phase-par-phase via `context.timing[]` + entrées/sorties des hooks → 1 ligne par phase, même `requestId` partout                  | ⬜     |
| 26  | **Erreur enrichie**                          | 1 PDU ERROR par requête en erreur : `requestId`, `controller`, `action`, `status`, full stack trace, `cause` chain, headers entrants relevants         | ⬜     |
| 27  | **Rate limit ciblé par `requestId`**         | Si même `requestId` produit > N logs DEBUG → rate limit local (évite spam sur boucles internes)                                                         | ⬜     |
| 28  | **WS logs**                                  | 1 PDU connexion (handshake), 1 PDU par message (opcode/size/protocol) — `wsId = connection.uuid`, lié à `requestId` du handshake                       | ⬜     |
| 29  | **Sensitive header redaction**               | Mask `Authorization, Cookie, Set-Cookie, X-Api-Key` dans tous les logs (production) — config-driven                                                     | ⬜     |
| 30  | **Transport `requestLogger` dédié**          | `ITransport` spécialisé : 1 ligne JSON par requête (NCSA/Combined Log Format facultatif) → fichier rotatif ; séparé du syslog général                  | ⬜     |

### 9.4 Tests cibles à créer

| Fichier                                                                          | Sujet                                                                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `@nodefony/http/tests/integration/lifecycle.test.ts`                             | Context tear-down, `response.on("finish")`, aborted requests, listener leaks       |
| `@nodefony/http/tests/integration/concurrency.test.ts`                           | N=100 req // → assertion que les `requestId` sont uniques + pas de cross-context  |
| `@nodefony/http/tests/integration/timing.test.ts`                                | `context.timing[]` rempli, durations cohérentes, ordre phases respecté             |
| `@nodefony/http/tests/integration/audit-log.test.ts`                             | 1 et 1 seule PDU INFO par requête, champs obligatoires présents                    |
| `@nodefony/http/tests/integration/http-rfc-errors.test.ts`                       | **(existant — fixer 11 fails)** — status-message vide, X-Request-Id sur 4xx/5xx   |
| `@nodefony/framework/tests/integration/forward.test.ts`                          | `forward("mod:ctrl:action")` partage le context, single resolver chain             |
| `@nodefony/framework/tests/integration/scope.test.ts`                            | scope singleton vs transient via `@inject` dans Controller, isolation pas re-utilisation |

### 9.5 Refactors techniques préalables

1. **`Context.lifecycle`** : exposer `phases: PhaseTiming[]` rempli par les hooks `HttpKernel` ; type `PhaseTiming = { name: string; startMs: number; endMs?: number }`.
2. **`HttpKernel.logRequest()`** : extraire dans une méthode dédiée, accepter un formatter pluggable (`requestLogger?: IRequestLogger`).
3. **`Context.onAfterResponse(fn)`** : ajouter dans `Context.ts` — appelé sur `response.on("finish")` ET `on("close")` (déduplication).
4. **`AbortSignal`** : exposer `context.signal: AbortSignal` (depuis `request.on("aborted")`) → utilisable par actions async.
5. **`AsyncLocalStorage`** : créer `src/packages/@nodefony/http/nodefony/src/RequestContext.ts` — ALS dédié `requestId` (préalable axe 10).
6. **`HttpError` → format JSON unifié** : sortir un module dédié `errorRenderer` partagé HTTP+WS (RFC 7807 optionnel, contract Nodefony actuel par défaut).
7. **Hooks `Context` pour `@nodefony/security`** : exposer des extension points utilisés par le Firewall (axes 9.6 ci-dessous) — au minimum `beforeResolve`, `afterAuth`, `onAuthFailure` ; sans coupler `@nodefony/http` au security (security `dependsOn` http/framework, pas l'inverse).

---

### 9.6 Intégration `@nodefony/security` (futur module Phase 6)

> **Référence JS** : `/Users/cci/repository/nodefony/src/nodefony/bundles/security-bundle/` (à consulter avant la migration TS — ne PAS copier le code, reproduire le comportement).
> Le security s'enchâsse dans la **même symbiose** http↔framework définie en 9.1–9.3. Le pipeline de requête (axe 9) doit déjà prévoir les hooks d'authentification/autorisation avant de migrer security, sinon retour en arrière garanti.

#### Composants à migrer (JS → TS)

| Service / Module                | Fichier JS source                                       | Rôle                                                                                  | Cible TS                                                |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `firewallService`               | `services/firewall/firewallService.js` (694 L)          | SecuredArea matching URL, sélection factory, auth pipeline, redirection login         | `@nodefony/security/service/firewall.ts`                |
| `corsService`                   | `services/cors/corsService.js` (182 L)                  | Pre-flight `OPTIONS`, headers `Access-Control-*`                                       | `@nodefony/security/service/cors.ts`                    |
| `csrfService`                   | `services/csrf/csrfService.es6` (193 L)                 | Token CSRF + double-submit cookie                                                      | `@nodefony/security/service/csrf.ts`                    |
| `authorizationService`          | `services/authorization/authorizationService.js`        | Access control (rôles + ACL `accessControl.js`)                                        | `@nodefony/security/service/authorization.ts`           |
| `accessControl`                 | `src/Authorization/accessControl.js`                    | Vérif rôles, hiérarchie                                                                | `@nodefony/security/src/AccessControl.ts`               |
| `bcryptEncoder`                 | `src/encoders/bcryptEncoder.js`                         | Hash mot de passe                                                                      | `@nodefony/security/src/encoders/BcryptEncoder.ts`      |
| `passportFramework`             | `src/passport/passportFramework.js`                     | Adapter Passport.js                                                                    | `@nodefony/security/src/PassportBridge.ts`              |
| **Factories** (9 stratégies)    | `src/factories/passport/passport-*.js` + `anonymous/`   | basic, digest, jwt, local, ldap, oauth2, openid, google, github + anonymous            | `@nodefony/security/src/factories/*.ts`                 |
| **Tokens** (8 types)            | `src/tokens/*.js`                                       | Représentation token utilisateur : anonymous, jwt, ldap, oauth2, openid, github, google, userpassword | `@nodefony/security/src/tokens/*.ts`              |
| **Providers**                   | `src/providers/anonymousProvider.js`                    | Provider d'identité (anonymous + extensible)                                           | `@nodefony/security/src/providers/*.ts`                 |

#### Points d'intégration dans la symbiose (cibles des hooks 9.5.7)

| Phase requête                   | Hook security                       | Action                                                                                          |
| ------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `beforeResolve` (avant Router)  | **CORS pre-flight**                 | Court-circuit `OPTIONS` → 204 + headers `Access-Control-*` ; jamais d'appel au controller       |
| après `Router.resolve` (route + controller connus) | **Firewall match SecuredArea** | Matche URL → SecuredArea → factory → token → user (échec → 401/redirect login)                  |
| `afterAuth`                     | **Authorization (ACL/rôles)**       | Vérifier `route.requirements.roles` contre `context.user.roles` (échec → 403)                   |
| avant `controller.action()`     | **CSRF check (POST/PUT/DELETE)**    | Vérifier `_csrf` body/header == cookie ; échec → 403                                            |
| `onError` (HttpError)           | **AuthFailureHandler**              | 401 → redirect login (HTML) ou JSON (XHR/API) ; 403 → 403 JSON ; conservation `requestId`       |
| WS handshake (avant `connect()`)| **WS Firewall**                     | Même SecuredArea matching qu'HTTP — `WebsocketContext.request.url` ; protocole + auth avant accept |
| WS message                      | **Per-message authorization**       | Vérifier `context.user` toujours valide ; session expirée → close `1008` (policy violation)     |

#### Axes spécifiques sécurité × logs (extension de 9.3)

| #   | Axe                                          | Sujet                                                                                                                              |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Audit log auth**                           | 1 PDU NOTICE par tentative d'auth (success/failure) : `requestId`, `factory`, `username/sub`, `ip`, `userAgent`, `outcome`         |
| S2  | **Logs failure ≠ logs error**                | Échec auth = NOTICE (attendu) — pas WARNING/ERROR (sinon pollution + faux signal sécurité). 401 répété même IP → escalade WARNING  |
| S3  | **Redaction stricte tokens**                 | JAMAIS de log `Authorization`, `Cookie`, `Set-Cookie`, `_csrf`, `password`, JWT body — même en DEBUG (extension axe 29)            |
| S4  | **Trace `userId` dans tous les logs**        | Une fois l'auth résolue → `context.user.id` propagé via ALS → tous les logs downstream incluent `userId`                            |
| S5  | **Rate limit auth**                          | N tentatives échouées par IP/user → escalade NOTICE→WARNING→ERROR + lock temporaire (firewall directive `bruteForceProtection`)   |
| S6  | **CSP / security headers**                   | Headers `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` configurables |

#### Tests cibles security (en plus des tests Phase 6)

| Fichier                                                     | Sujet                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@nodefony/security/tests/integration/firewall-http.test.ts`| SecuredArea match + factory + token cycle complet contre serveur live       |
| `@nodefony/security/tests/integration/firewall-ws.test.ts`  | Auth WS handshake + close 1008 sur session expirée                          |
| `@nodefony/security/tests/integration/cors.test.ts`         | Pre-flight `OPTIONS`, headers `Access-Control-*`, origin allowlist          |
| `@nodefony/security/tests/integration/csrf.test.ts`         | Double-submit cookie, échec sur tampering, exemption GET/HEAD               |
| `@nodefony/security/tests/integration/symbiose-stack.test.ts` | Stack complète : CORS → Firewall → ACL → CSRF → Controller, ordre + erreurs |

#### Ordre de migration security (proposé)

1. **AccessControl + bcryptEncoder** (sans dépendance http) — fondations
2. **CORS service** (le plus simple, débloque API browser)
3. **Firewall service + SecuredArea match** (gros morceau — 694 L JS)
4. **Anonymous provider/factory/token** (cas le plus simple, valide le pipeline)
5. **Passport bridge + 1-2 factories prioritaires** (local, jwt)
6. **CSRF service** (dépend du firewall)
7. **Authorization service** (dépend du firewall + accessControl)
8. **Factories OAuth/OpenID/LDAP/Google/GitHub** (extensions optionnelles)

> Ce travail n'est pas dans la Phase 9 (qui pose les fondations http↔framework) mais consomme directement les hooks de 9.5.7 — d'où l'importance de les concevoir d'abord avec security en tête.

---

## Blockers connus

| Module                          | Problème                                                  | Solution envisagée             | Résolu |
| ------------------------------- | --------------------------------------------------------- | ------------------------------ | ------ |
| `src/nodefony/rollup.config.ts` | `@ts-ignore` sur `rollup-sourcemap-path-transform`        | Créer `.d.ts` shim minimal     | ⬜     |
| `IKernel.ts`                    | `cli: object \| null` → devrait être `ICliKernel \| null` | Session dédiée ICliKernel      | ✅     |
| `IModule.ts`                    | `getController()` retourne `unknown` → `IController`      | Session dédiée après Phase 5.1 | ⬜     |

---

## Journal des sessions

| Date       | Session                                                                           | Module migré                                                                                                                                                                                                                                                      | Durée  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-11 | Service + Interfaces                                                              | `Service.ts`, `IService`, `IKernel`                                                                                                                                                                                                                               | ~3h    | 85 tests ✅ — `#nc` privé, `implements IService`, `Command.ts` fixé                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-05-11 | ISyslog + Syslog                                                                  | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts`                                                                                                                                                                                                                               | ~2h    | 85 tests ✅ — `Pci=unknown`, `Function` → types propres, `implements ISyslog`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-05-11 | Syslog perf                                                                       | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts`                                                                                                                                                                                                                               | ~1h    | 85 tests ✅ — `CircularBuffer` O(1), `Date.now()`, `severityNameMap`, `fastTypeOf`, no lodash                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-05-11 | IKernel complet                                                                   | `IKernel.ts`, `IService.ts`, `Service.ts`, `Kernel.ts`, `CliKernel.ts`, commands                                                                                                                                                                                  | ~2h    | 111 tests ✅ — `Kernel implements IKernel`, `IService.kernel: IKernel\|null`, `KernelNetworkResult`, casts Module/CliKernel                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-05-11 | IModule complet                                                                   | `IModule.ts`, `IKernel.ts`, `Module.ts`, commands                                                                                                                                                                                                                 | ~1h    | 85 core ✅ — `Module implements IModule`, `PackageJson` migré vers types, casts `as Module` éliminés dans commands                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-05-12 | Phase 0 finalisée + sécurité                                                      | Build system, deps, vulnérabilités                                                                                                                                                                                                                                | ~2h    | Turbo OK — 1900 warnings TS2614 éliminés — 61→15 vulns — `mocha-jsdom` supprimé — mongoose `dependencies` nettoyé — merge sur `claude-ts`                                                                                                                                                                                                                                                                                                                                                     |
| 2026-05-13 | Service.ts — audit qualité + bugs                                                 | `Service.ts`, `Service.test.ts`                                                                                                                                                                                                                                   | ~2h    | 234 tests ✅ — 5 bugs corrigés — `MEMORY.md` créé — `README.md` Service complet                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-05-13 | Container.ts — audit qualité + bugs                                               | `Container.ts`, `Container.test.ts`                                                                                                                                                                                                                               | ~1h    | 257 tests ✅ — 2 bugs corrigés (`has`/`remove` valeurs falsy) — `id` public — MEMORY.md mis à jour                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-05-13 | IContainer + IScope                                                               | `IContainer.ts`, `Container.ts`, `IService.ts`                                                                                                                                                                                                                    | ~30min | `claude-ts` — `Container implements IContainer`, `Scope implements IScope`, `IService.container: IContainer\|null`                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-05-13 | ESM refactor — Nodefony.ts + index.ts                                             | `Nodefony.ts`, `index.ts`, `Error.ts`, 20+ fichiers packages                                                                                                                                                                                                      | ~3h    | branche `refactor/nodefony-esm` — suppression default export — `Nodefony` classe statique — `nodefonyError` renommé — tous packages + modules fixés — runtime ✅                                                                                                                                                                                                                                                                                                                              |
| 2026-05-13 | Fix 4 warnings TS ciblés                                                          | packages http, framework                                                                                                                                                                                                                                          | ~1h    | TS2531 routerDecorators ✅ — TS2339 toJSON ✅ — TS2614 isArray ✅ — TS2742 setMetaBag ✅ — CLAUDE.md section lancement ajoutée                                                                                                                                                                                                                                                                                                                                                                |
| 2026-05-14 | Zéro warnings build                                                               | 10 rollup.config.ts, 5 .d.ts, 4 .ts                                                                                                                                                                                                                               | ~3h    | 287 tests ✅ — sourcemap ✅ — TS2305 ✅ — TS2339 ✅ — TS6133/6196 ✅ — TS5055 supprimé onwarn ✅                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-05-14 | Syslog — audit + nouvelles features                                               | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts`, `Syslog.test.ts`, `MEMORY.md`, `README.md`                                                                                                                                                                                   | ~2h    | 282 tests ✅ — 4 bugs corrigés — `print()` + `logMultiple()` + `overrideConsole` + `rawLog()` + README.md complet                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-05-14 | Phase X — Transport Layer                                                         | `ITransport.ts`, `ConsoleTransport.ts`, `FileTransport.ts`, `HttpTransport.ts`, `transports/index.ts`                                                                                                                                                             | ~1h    | 303 tests ✅ — fire-and-forget — `onTransportError` — 9/9 build ✅                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-05-14 | Kernel.test.ts — tests complets                                                   | `Kernel.test.ts` (111 tests Kernel)                                                                                                                                                                                                                               | ~1h    | 443 tests ✅ — constructor, Events bitmask, setEnv/setNodeEnv, checkPath, readConfig, stats, network, modules, setDomain, logEnv, initializeLog (11), fire/emit, perf, edge cases                                                                                                                                                                                                                                                                                                             |
| 2026-05-14 | Module.test.ts — tests complets                                                   | `Module.test.ts` (74 tests Module)                                                                                                                                                                                                                                | ~1h    | 500 tests ✅ — construction, setPath, setEvents (lifecycle hooks), readOverrideModuleConfig (Module-\*), addService, getPackageJson, loadJson, install/outdated, addCommand, log, controllers statiques, perf, edge cases                                                                                                                                                                                                                                                                     |
| 2026-05-14 | CliKernel.test.ts — tests complets                                                | `CliKernel.test.ts` (71 tests CliKernel)                                                                                                                                                                                                                          | ~1h    | 571 tests ✅ — constructor, setType, setPackageManager, addCommand, parseCommand, initSyslog (8 cas: mock kernel, debug/msgid/json), loadLocalModule, terminate (mock), niceBytes statique (9 cas), showHelp, edge cases                                                                                                                                                                                                                                                                      |
| 2026-05-14 | Kernel/Module/CliKernel — doc IA + humaine                                        | `kernel/MEMORY.md`, `kernel/README.md`, `CLAUDE.md`                                                                                                                                                                                                               | ~30min | MEMORY.md: lifecycle flags, Events bitmask, setEnv/setNodeEnv, interfacesFilter gotchas, Module hooks prototype, setPath rules, CliKernel initSyslog, niceBytes — README.md: API tables, exemples, gotchas                                                                                                                                                                                                                                                                                    |
| 2026-05-14 | Tools.ts — optimisation extend + 152 tests                                        | `Tools.ts`, `Tools.test.ts`                                                                                                                                                                                                                                       | ~1h    | 723 tests ✅ — suppression lodash-es (isArray/isFunction/isRegExp → natifs) — hasOwn guard — pollution guard étendu (**proto**+constructor+prototype) — isPlainObject Object.prototype.toString explicite — perf: 100k shallow=38ms, 50k deep=135ms                                                                                                                                                                                                                                           |
| 2026-05-14 | Module.test.ts — readOverrideModuleConfig                                         | `Module.test.ts` (+15 tests)                                                                                                                                                                                                                                      | ~30min | 738 tests ✅ — captureLogs helper — WARNING log capture — deep=true/false — reference change — multiple Module-\* — ERROR missing — regex edge cases                                                                                                                                                                                                                                                                                                                                          |
| 2026-05-14 | Cli.test.ts + cli/MEMORY.md + cli/README.md                                       | `Cli.test.ts` (106 tests), `cli/MEMORY.md`, `cli/README.md`                                                                                                                                                                                                       | ~1h    | 836 tests ✅ — makeCli helper — EchoCommand pattern (done:Promise) — standalone sans kernel — construction (9) — commander (8) — registre (6) — exécution (8) — options/alias (4) — parse/parseAsync (6) — showBanner/logEnv (8) — checkVersion/semver (6) — timers (8) — setProcessTitle (4) — niceBytes/niceUptime/niceDate (9) — UI Progress/Spinner/Sparkline/Table (9) — existsSync/getCommandManager (10) — setPid/getEmoji (4)                                                         |
| 2026-05-14 | Injector.ts — auto-injection + Injector.test.ts                                   | `injector.ts`, `kernelDecorator.ts`, `Injector.test.ts` (57 tests)                                                                                                                                                                                                | ~2h    | 893 tests ✅ — `design:paramtypes` auto-injection — `isRegistered()` — position-aware instantiate — `@inject` fix (class-level metadata) — typo "ERRROR" corrigé — 13 sections : register/isRegistered/get/backward-compat/@inject/auto-DI/priorité/@injectable/kernel-lookup/inject-reflect/instance/cas-limites/perf                                                                                                                                                                        |
| 2026-05-14 | @modules + @services — tests complets                                             | `Decorators.test.ts` (45 tests)                                                                                                                                                                                                                                   | ~1h    | 938 tests ✅ — stub kernel minimal avec fireEvent — mock getPackageJson/addService/loadService — 17 sections : construction×2, string/ctor/array×2, mixed×2, edge cases×2, erreurs, combinés, perf                                                                                                                                                                                                                                                                                            |
| 2026-05-14 | Scope singleton/transient DI                                                      | `injector.ts`, `kernelDecorator.ts`, `index.ts`, `Injector.test.ts` (+15 tests), `INJECTION_PLAN.md`                                                                                                                                                              | ~1h    | 953 tests ✅ — `DIScope`, `InjectableOptions`, `@injectable({ scope })`, `Injector.getScope()`, `_resolve` scope-aware — plan 5 phases (property/circular/scoped/registry/lazy)                                                                                                                                                                                                                                                                                                               |
| 2026-05-14 | Kernel lifecycle — tests cycle de vie                                             | `KernelLifecycle.test.ts` (48 tests)                                                                                                                                                                                                                              | ~1h    | 1001 tests ✅ — boot/preRegister/onReady ordre events — flags registered/booted/ready — hooks module (register/boot/ready/initialize) — terminate + mockQuit — arrêt chaîne par command — propagation erreurs — addKernelService                                                                                                                                                                                                                                                              |
| 2026-05-14 | Kernel.ts — corrections bugs P1/P2 + plan refactor                                | `Kernel.ts`, `kernel/MEMORY.md`, `KERNEL_REFACTOR_PLAN.md`                                                                                                                                                                                                        | ~30min | 1001 tests ✅ — `preRegistered` set après onPreRegister — `postReady` set après onPostReady — `clean()` implémenté — `terminate()` reject(e) — `isModule(unknown)` — plan P3/P4 créé (isCore sync, initCluster syslog, loadApp configurable, GC removal, ModuleConstructor fix)                                                                                                                                                                                                               |
| 2026-05-14 | Bugfix debug CLI — 3 bugs Kernel/CliKernel                                        | `Kernel.ts`, `CliKernel.ts`                                                                                                                                                                                                                                       | ~1h    | 1001 tests ✅ — `initializeLog()` : CLI prioritaire sur config (`!this.cli` guard) — `CliKernel.initSyslog()` : `"dev"` → `"development"` (condition était morte) — `setCli()` : param `cli` au lieu de `this.cli` (null). Cause : `options.log.debug=true` dans config app forçait DEBUG même sans `-d`.                                                                                                                                                                                     |
| 2026-05-14 | Fix archi CLI/Syslog — catch Commander + init idempotent                          | `CliKernel.ts`, `Syslog.ts`, `CliKernel.test.ts`                                                                                                                                                                                                                  | ~30min | 1004 tests ✅ — `.catch()` distingue helpDisplayed/version (terminate) vs autres erreurs (fallback) — `Syslog.init()` idempotent via `removeAllListeners("onLog")` avant add — test mis à jour                                                                                                                                                                                                                                                                                                |
| 2026-05-14 | Mise à jour dépendances patch/minor                                               | tous les `package.json` workspaces                                                                                                                                                                                                                                | ~15min | 1004 tests ✅ — 15→9 vulnérabilités — skip majeurs : typescript 6, eslint 10, chai 6, mongoose 9, uuid 14, twig 3, etc.                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-14 | TypeScript 5→6 + uuid 11→14 + @types/node 24→25                                   | `Error.ts`, `Event.ts`, `globals.d.ts`, `nodefony.d.ts`, `tsconfig.json`, tous `package.json`                                                                                                                                                                     | ~2h    | 1004 tests ✅ — `override isError` + `detectType` — EventEmitter augmentation globale supprimée — interface Error all optional — `paths:{nodefony}` monorepo fix — `/// <reference types="node" />` rollup fix — build 0 erreur 0 warning                                                                                                                                                                                                                                                     |
| 2026-05-14 | ESLint 9→10 — flat config                                                         | `eslint.config.mjs` (nouveau), `.eslintrc.cjs` (supprimé), `package.json`, `globals.d.ts`, `Kernel.ts`, `Connector.ts`, `Syslog.test.ts`                                                                                                                          | ~1h    | 1004 tests ✅ — 0 erreur lint — 96 warnings `no-explicit-any` (intentionnels, à adresser session dédiée) — GitHub Actions CI mis à jour (matrix 3 OS × 3 Node, `nodefony production` avant tests)                                                                                                                                                                                                                                                                                             |
| 2026-05-14 | Event.ts + Command + Builder + FileClass + Finder                                 | `Event.ts`, `Command.ts`, `KillCommand.ts`, `Builder.ts`, `FileClass.ts`, `Finder.ts`, `FileResult.ts`, `Result.ts`, `Event.test.ts`, `Command.test.ts`, `Builder.test.ts`, `KernelCommands.test.ts`, `FileClass.test.ts`, `finder/MEMORY.md`, `finder/README.md` | ~3h    | 1181 tests ✅ — shelljs supprimé (Builder→fsp.\*) — lodash supprimé (Finder) — `new Promise(async...)` corrigé (Finder) — `for...in` → `for...of Object.keys()` (Event/Finder) — `ckeckPath` → `checkPath` — `find()` → `findByName()` — `uniq()` implémenté — `flag:"w"` bug corrigé (FileClass.content) — tests: 120+ tests Event/Command/Builder/KernelCommands/FileClass                                                                                                                  |
| 2026-05-14 | CLI Interfaces — ICommand + ICliKernel + refactor                                 | `types/ICommand.ts`, `types/ICliKernel.ts`, `types/IKernel.ts`, `command/Command.ts`, `kernel/CliKernel.ts`, `kernel/Kernel.ts`, `kernel/MEMORY.md`                                                                                                               | ~1h    | 1181 tests ✅ — `ICommand`: `name`, `kernelEvent: KernelEventKey`, `action()` — `ICliKernel`: interface minimale (commander, setProcessTitle, showAsciify, parseCommandAsync...) — `IKernel.cli: ICliKernel\|null` + `IKernel.command: ICommand\|null` (fin du `object\|null`) — `CommandConstructor` type exporté — `Command.kernelEvent: KernelEventKey` (fin du `string`) — `setEvents()` guard `eventsRegistered` — double-parsing `preRegister()` supprimé — build 0 erreur — runtime ✅ |
| 2026-05-15 | WebSocket migration — tests complets (limites, perf, binary, broadcast, protocol) | `WebSocketController.ts`, `websocket-limits.test.ts`, `websocket-perf.test.ts`, `websocket-binary-broadcast.test.ts`, `websocket-protocol.test.ts`                                                                                                                | ~3h    | 72 passing, 2 failing (sequential binary timeout) — 4 fichiers test créés — 5 routes ajoutées (binary, broadcast, proto/reflect, proto/json, echo/proto) — branche `refactor/http-deps`                                                                                                                                                                                                                                                                                                       |
| 2026-05-15 | @nodefony/http — bugs fixes + tests unitaires + 319 passing                       | `cookie.ts`, `Response.ts`, `Cookie.test.ts`, `Response.test.ts` (nouveau), `memory.test.ts`, `MIGRATION_STATUS.md`, `MEMORY.md`, `src/modules/test/package.json`                                                                                                 | ~2h    | ERR_INVALID_CHAR corrigé (ASCII sanitize) — Cookie Expires overflow corrigé (×1000) — maxAge=0 session cookie fix — turbo build order fix (peerDependencies) — 319 passing 0 failing — branche refactor/http-deps mergée dans claude-ts                                                                                                                                                      |
| 2026-05-15 | @nodefony/framework — Infrastructure types exports                                | `package.json`                                                                                                                                                                                                                                                    | ~15min | `exports` field ajouté — `types` → `dist/types/index.d.ts` — build 0 erreur — CLAUDE.md tableau mis à jour ✅                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-05-15 | @nodefony/framework — IController/IRoute/IResolver + implements + 47 tests        | `nodefony/interfaces/IController.ts`, `IRoute.ts`, `IResolver.ts`, `index.ts`, `Controller.ts`, `Resolver.ts`, `Route.ts`, `tests/unit/Route.test.ts`, `Router.test.ts`, `routerDecorators.test.ts`                                                               | ~3h    | Interfaces créées (readonly covariant fix, `(...args: unknown[]) => unknown` vs Function) — `implements IController/IRoute/IResolver` sur les 3 classes — bug Route.matchRequirements `return;`→`return true` (WEBSOCKET) — 47 tests (28 Route + 11 Router + 5 routerDecorators) 0 failing — mock-sequelize.mjs ESM hook pour éviter crash `getKernel().path` |
| 2026-05-16 | @nodefony/framework — NestJS decorators + integration tests Controller             | `routerDecorators.ts`, `Resolver.ts`, `index.ts`, `tests/unit/httpMethodDecorators.test.ts`, `tests/integration/controller.test.ts`, `src/modules/test/nodefony/controller/FrameworkController.ts`                                                                | ~4h    | `@Get/@Post/@Put/@Delete/@Patch` (requirements.methods, auto-name ClassName::method) — `@HttpCode/@Header/@Redirect` (Reflect metadata, appliqué par Resolver) — fix `@Post` constraint (méthode → requirements.methods) — fix `@Redirect` → `returnController(undefined)` — FrameworkController 14 routes — 90 tests (67 unit + 23 intégration), 0 failing — bug documenté: method-name conflict avec props Controller |
| 2026-05-16 | @nodefony/framework — @Param/@Body/@Query + tests d'intégration complets           | `routerDecorators.ts`, `Resolver.ts`, `index.ts`, `tests/unit/routerDecorators.test.ts`, `tests/integration/decorators.integration.test.ts`, `controller.test.ts`, `FrameworkController.ts`, `DecoratorController.ts`, `@nodefony/http/tests/http/decorators.test.ts` | ~3h    | `@Param/@Body/@Query` (PARAM_ARGS_METADATA, ParamMeta, _buildParamArgs) — fix `Route.match()` retourne slice(1) → `variables[i]` pas `i+1` — fix queryGet `url.search.slice(1)` — DecoratorController 7 routes, FrameworkController +8 routes — 112 tests framework (72 unit + 40 intégration), 10 tests http/decorators.test.ts, 0 failing |
| 2026-05-16 | @nodefony/http — fix ERR_INVALID_CHAR writeHead + HttpError Controller/Action/Response | `Response.ts`, `httpError.ts`, `CLAUDE.md` | ~1h    | **ERR_INVALID_CHAR** : Node.js set `statusMessage` natif avant validation → char invalide persiste → tous writes suivants échouent. Fix : `safeMsg.replace(/[^\x20-\x7E]/g,"")` dans `Response.writeHead()`. **HttpError champs** : `controller`/`action`/`jsonResponse` extraits de `context.resolver` dans constructor. 329 HTTP tests + 112 framework tests, 0 failing. CLAUDE.md : ajout RFC IETF references. |
| 2026-05-16 | @nodefony/http — suppression warnings TS build + request tracing requestId | `Context.ts`, `HttpContext.ts`, `Response.ts`, `WebsocketContext.ts`, `IContext.ts`, `IHttpKernel.ts`, `sessions-service.ts`, `securedArea.ts` | ~2h    | **Warnings supprimés** : TS6133 Ws, TS6196 interfaces non utilisées, TS7006 catch params, TS2345 resolve(ret), deprecation url.parse→new URL. **requestId** : `randomUUID()` dans Context constructor — honor `X-Request-Id` header entrant (HTTP+WS) — injecté dans `X-Request-Id` response header via `Response.writeHead()` — inclus dans `logRequest()` (ID : uuid) — dans `metaData.nodefony.requestId` — `IContext.requestId: string`. 94 HTTP tests, 0 failing. |
| 2026-05-16 | @nodefony/http — tests intégration complets (suite exhaustive) | `httpKernel.test.ts`, `session.test.ts`, `security.test.ts` | ~1h    | **336 passing 0 failing** — suite complète : unit (76) + http (http, http1, https, errors, decorators, fileStream, upload, httpKernel, static, session, security, memory, resilience) + routing (Router) + websockets (ws, limits, perf, binary-broadcast, protocol, session, w3c) — fix `/// <reference types="node" />` manquant session/security/httpKernel — 7 tests X-Request-Id ajoutés (UUID v4, unicité, corrélation, présence sur 200/404/500, concurrence) — test memory flaky en contexte full (GC pressure), passe en isolation |

---

## État des dépendances (2026-05-14)

| Package     | Avant  | Après  | Workspaces mis à jour                                                                                       |
| ----------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| typescript  | 5.8.3  | 6.0.3  | nodefony + tous packages                                                                                    |
| uuid        | 11.1.1 | 14.0.0 | nodefony + http                                                                                             |
| @types/node | 24.x   | 25.7.0 | nodefony + tous packages                                                                                    |
| @rollup/... | 28.x   | 29.x   | nodefony + tous packages                                                                                    |
| ESLint 9→10 | 9.31.0 | 10.3.0 | nodefony + root — flat config `eslint.config.mjs` — 0 erreur, 96 warnings `no-explicit-any` (intentionnels) |

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

**Branche active** : `claude-ts`

**État tests @nodefony/http** (2026-05-16) : **336 passing / 336** — suite exhaustive validée.

| Catégorie       | Fichiers                                                    | Tests |
| --------------- | ----------------------------------------------------------- | ----- |
| Unit            | Session, Cookie, HttpError, Response                        | 76    |
| HTTP            | http, http1, https, errors, decorators, fileStream, upload  | 103   |
| HttpKernel      | httpKernel (pipeline, contexte, resilience, X-Request-Id)   | 35    |
| Auth/Static     | static, session, security                                   | 47    |
| Memory          | memory (flaky en full suite — GC, passe en isolation)       | 7     |
| Resilience      | resilience                                                  | 7     |
| Routing         | Router                                                      | 11    |
| WebSockets      | ws, limits, perf, binary-broadcast, protocol, session, w3c  | 50    |

**Prochaines étapes** : voir la [Roadmap priorisée](#-roadmap-priorisée-dette-technique-dabord) en début de fichier.

**Démarrer ici (P0 — bugs bloquants, ~2.5 sessions)** :

1. **P0.1** — Fix les **11 fails** dans `@nodefony/http/tests/integration/http-rfc-errors.test.ts` (status-message ASCII, X-Request-Id sur 4xx/5xx, 405 Allow header, JSON shape erreur). 1 session.
2. **P0.2** — Fix les 2 tests binary séquentiels WS — timeout `context.send(buf, "binary")` en boucle (`http-kernel.ts` ou `WebsocketContext`). 1 session.
3. **P0.3** — `IModule.getController()` retour `IController` (blocker listé). 0.5 session.

**Ensuite (P1 — fondations symbiose, ~7.5 sessions)** : refactors techniques 9.5 dans cet ordre : `Context.lifecycle` (P1.1) → `onAfterResponse` (P1.2) → `AbortSignal` (P1.3) → `AsyncLocalStorage requestId` (P1.4) → `errorRenderer` (P1.5) → `logRequest` pluggable (P1.6) → hooks security (P1.7).

**NE PAS** démarrer Phase 6 (Security) avant que P1.7 soit ✅ — référence JS `/Users/cci/repository/nodefony/src/nodefony/bundles/security-bundle/` à consulter alors.

**Fichiers à lire en début de session** :

- `MIGRATION_STATUS.md` (ce fichier)
- `MEMORY.md` du module concerné
- `CLAUDE.md` du module concerné

**TS6 — Gotchas** :

- `Error.isError()` : built-in TS6 — utiliser `nodefonyError.detectType()` pour détection type erreur
- `EventEmitter` : NE PAS augmenter globalement (casse `net.Server.listen`)
- `tsconfig.json` : `paths: {nodefony: ["./src/index.ts"]}` obligatoire dans le workspace
- `globals.d.ts` : `/// <reference types="node" />` nécessaire pour le rollup plugin

**Vulnérabilités restantes (9)** : twig (locutus/minimatch/minimist) + mocha→diff — majeurs skippés intentionnellement
