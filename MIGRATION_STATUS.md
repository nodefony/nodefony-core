# MIGRATION_STATUS.md — Tableau de bord

> Mis à jour à chaque fin de session Claude Code.
> Légende : ✅ Migré | 🔶 Partiel | ⬜ À faire | 🚫 Bloqué | ⏭️ Skip (non pertinent)

---

## Progression globale

| Catégorie        | Total | ✅ | 🔶 | ⬜ |
|------------------|-------|----|----|-----|
| Core / Kernel    | 6     | 0  | 0  | 6   |
| DI Container     | 4     | 0  | 0  | 4   |
| Bundle System    | 5     | 0  | 0  | 5   |
| Router           | 4     | 0  | 0  | 4   |
| HTTP / WS        | 6     | 0  | 0  | 6   |
| Controller       | 3     | 0  | 0  | 3   |
| Session          | 3     | 0  | 0  | 3   |
| Security / Auth  | 5     | 0  | 0  | 5   |
| ORM Adapters     | 4     | 0  | 0  | 4   |
| CLI              | 4     | 0  | 0  | 4   |
| Monitoring       | 3     | 0  | 0  | 3   |
| Types / Interfaces | 5   | 0  | 0  | 5   |
| **TOTAL**        | **52**| **0** | **0** | **52** |

---

## Ordre de migration recommandé

Les modules sont ordonnés par dépendances — ne pas migrer un module
avant que ses dépendances soient ✅.

---

## Phase 1 — Fondations (aucune dépendance)

### 1.1 Types & Interfaces globaux
_Doit être fait en premier — tout le reste en dépend_

| Fichier TS cible              | Source JS référence                    | Statut | Complexité | Notes |
|-------------------------------|----------------------------------------|--------|------------|-------|
| `src/types/index.ts`          | `nodefony/core/nodefony.js`            | ⬜     | 2          | Types globaux, enums env |
| `src/types/IKernel.ts`        | `nodefony/core/kernel.js` (interfaces) | ⬜     | 2          | Interface IKernel |
| `src/types/IBundle.ts`        | `nodefony/core/bundles/nodefonyBundle.js` | ⬜  | 1          | Interface IBundle |
| `src/types/IService.ts`       | `nodefony/core/container/`             | ⬜     | 1          | Interface IService |
| `src/types/IContext.ts`       | `nodefony/core/controller/`            | ⬜     | 3          | Contexte unifié HTTP+WS |

### 1.2 DI Container
_Dépend de : Types_

| Fichier TS cible                    | Source JS référence                         | Statut | Complexité | Notes |
|-------------------------------------|---------------------------------------------|--------|------------|-------|
| `src/container/Container.ts`        | `nodefony/core/container/container.js`      | ⬜     | 3          | Core DI |
| `src/container/ServiceDefinition.ts`| `nodefony/core/container/`                  | ⬜     | 2          | Définition de service |
| `src/container/decorators.ts`       | N/A (nouveau)                               | ⬜     | 2          | @Service, @Injectable |
| `src/container/index.ts`            | N/A                                         | ⬜     | 1          | Barrel export |

---

## Phase 2 — Kernel & Bundles

### 2.1 Bundle System
_Dépend de : DI Container, Types_

| Fichier TS cible                  | Source JS référence                           | Statut | Complexité | Notes |
|-----------------------------------|-----------------------------------------------|--------|------------|-------|
| `src/bundles/Bundle.ts`           | `nodefony/core/bundles/nodefonyBundle.js`     | ⬜     | 3          | Classe de base Bundle |
| `src/bundles/BundleRegistry.ts`   | `nodefony/core/bundles/`                      | ⬜     | 2          | Registre des bundles |
| `src/bundles/decorators.ts`       | N/A (nouveau)                                 | ⬜     | 2          | @Bundle decorator |
| `src/bundles/BundleCompiler.ts`   | `nodefony/core/bundles/`                      | ⬜     | 3          | Compilation des bundles |
| `src/bundles/index.ts`            | N/A                                           | ⬜     | 1          | Barrel export |

### 2.2 Kernel
_Dépend de : Bundle System, DI Container, Types_

| Fichier TS cible              | Source JS référence                    | Statut | Complexité | Notes |
|-------------------------------|----------------------------------------|--------|------------|-------|
| `src/kernel/Kernel.ts`        | `nodefony/core/kernel.js`              | ⬜     | 3          | Kernel principal |
| `src/kernel/KernelEvents.ts`  | `nodefony/core/kernel.js` (events)     | ⬜     | 2          | Events lifecycle |
| `src/kernel/Environment.ts`   | `nodefony/core/kernel.js` (env)        | ⬜     | 1          | dev/prod/test |
| `src/kernel/Config.ts`        | `nodefony/core/kernel.js` (config)     | ⬜     | 2          | Chargement config |
| `src/kernel/index.ts`         | N/A                                    | ⬜     | 1          | Barrel export |

---

## Phase 3 — Router & Contexte unifié

### 3.1 Contexte HTTP+WS (différenciateur clé)
_Dépend de : Kernel, Types_

| Fichier TS cible                    | Source JS référence                      | Statut | Complexité | Notes |
|-------------------------------------|------------------------------------------|--------|------------|-------|
| `src/context/NodefonyContext.ts`    | `nodefony/core/controller/`              | ⬜     | 3          | Contexte unifié |
| `src/context/HttpContext.ts`        | `nodefony/core/`                         | ⬜     | 3          | Contexte HTTP |
| `src/context/WebSocketContext.ts`   | `nodefony/core/`                         | ⬜     | 3          | Contexte WS |

### 3.2 Router
_Dépend de : Contexte, Kernel_

| Fichier TS cible              | Source JS référence                    | Statut | Complexité | Notes |
|-------------------------------|----------------------------------------|--------|------------|-------|
| `src/router/Router.ts`        | `nodefony/core/router/router.js`       | ⬜     | 3          | Router principal |
| `src/router/Route.ts`         | `nodefony/core/router/`                | ⬜     | 2          | Définition route |
| `src/router/decorators.ts`    | N/A (nouveau)                          | ⬜     | 2          | @Route, @WebSocketRoute |
| `src/router/index.ts`         | N/A                                    | ⬜     | 1          | Barrel export |

---

## Phase 4 — Serveurs HTTP/WS natifs Bun

### 4.1 Serveurs
_Dépend de : Router, Contexte_

| Fichier TS cible                  | Source JS référence                      | Statut | Complexité | Notes |
|-----------------------------------|------------------------------------------|--------|------------|-------|
| `src/http/HttpServer.ts`          | `nodefony/core/`                         | ⬜     | 3          | Bun.serve HTTP/2 |
| `src/http/HttpsServer.ts`         | `nodefony/core/`                         | ⬜     | 2          | TLS + HTTP/2 |
| `src/websocket/WebSocketServer.ts`| `nodefony/core/`                         | ⬜     | 3          | Bun WS natif |
| `src/websocket/WssServer.ts`      | `nodefony/core/`                         | ⬜     | 2          | WS sécurisé |
| `src/http/StaticServer.ts`        | `nodefony/bundles/framework-bundle/`     | ⬜     | 2          | Fichiers statiques |
| `src/http/index.ts`               | N/A                                      | ⬜     | 1          | Barrel export |

---

## Phase 5 — Controller & Session

### 5.1 Controller
_Dépend de : Serveurs, Router, Contexte_

| Fichier TS cible                   | Source JS référence                         | Statut | Complexité | Notes |
|------------------------------------|---------------------------------------------|--------|------------|-------|
| `src/controller/Controller.ts`     | `nodefony/core/controller/controller.js`    | ⬜     | 3          | Classe de base |
| `src/controller/decorators.ts`     | N/A (nouveau)                               | ⬜     | 2          | @Controller |
| `src/controller/index.ts`          | N/A                                         | ⬜     | 1          | Barrel export |

### 5.2 Session
_Dépend de : Controller_

| Fichier TS cible                   | Source JS référence                         | Statut | Complexité | Notes |
|------------------------------------|---------------------------------------------|--------|------------|-------|
| `src/session/SessionManager.ts`    | `nodefony/bundles/framework-bundle/session/`| ⬜     | 3          | Gestionnaire sessions |
| `src/session/SessionStorage.ts`    | `nodefony/bundles/framework-bundle/session/`| ⬜     | 2          | Drivers (memory, redis, ORM) |
| `src/session/index.ts`             | N/A                                         | ⬜     | 1          | Barrel export |

---

## Phase 6 — Sécurité & Auth

_Dépend de : Session, Controller_

| Fichier TS cible                   | Source JS référence                         | Statut | Complexité | Notes |
|------------------------------------|---------------------------------------------|--------|------------|-------|
| `src/security/SecurityManager.ts`  | `nodefony/bundles/security-bundle/`         | ⬜     | 3          | WAF, CORS, Auth |
| `src/security/JwtProvider.ts`      | `nodefony/bundles/security-bundle/`         | ⬜     | 2          | JWT |
| `src/security/OAuthProvider.ts`    | `nodefony/bundles/security-bundle/`         | ⬜     | 3          | OAuth |
| `src/security/PassportBridge.ts`   | `nodefony/bundles/security-bundle/`         | ⬜     | 2          | Compat Passport.js |
| `src/security/index.ts`            | N/A                                         | ⬜     | 1          | Barrel export |

---

## Phase 7 — ORM Adapters

_Dépend de : Kernel, DI Container_

| Fichier TS cible                   | Source JS référence                         | Statut | Complexité | Notes |
|------------------------------------|---------------------------------------------|--------|------------|-------|
| `src/orm/MikroOrmAdapter.ts`       | N/A (nouveau, remplace Sequelize natif)     | ⬜     | 3          | ORM principal TS |
| `src/orm/SequelizeAdapter.ts`      | `nodefony/bundles/sequelize-bundle/`        | ⬜     | 3          | Compat legacy |
| `src/orm/MongooseAdapter.ts`       | `nodefony/bundles/mongoose-bundle/`         | ⬜     | 2          | MongoDB |
| `src/orm/index.ts`                 | N/A                                         | ⬜     | 1          | Barrel export |

---

## Phase 8 — CLI & Monitoring

### 8.1 CLI
_Dépend de : Kernel_

| Fichier TS cible                   | Source JS référence                         | Statut | Complexité | Notes |
|------------------------------------|---------------------------------------------|--------|------------|-------|
| `src/cli/Cli.ts`                   | `nodefony/core/cli/`                        | ⬜     | 3          | CLI principal |
| `src/cli/generators/Bundle.ts`     | `nodefony/core/cli/generators/`             | ⬜     | 2          | Générateur bundle |
| `src/cli/generators/Controller.ts` | `nodefony/core/cli/generators/`             | ⬜     | 2          | Générateur controller |
| `src/cli/index.ts`                 | N/A                                         | ⬜     | 1          | Barrel export |

### 8.2 Monitoring
_Dépend de : Kernel, HTTP_

| Fichier TS cible                   | Source JS référence                         | Statut | Complexité | Notes |
|------------------------------------|---------------------------------------------|--------|------------|-------|
| `src/monitoring/DebugBar.ts`       | `nodefony/bundles/monitoring-bundle/`       | ⬜     | 3          | Debug bar |
| `src/monitoring/Metrics.ts`        | `nodefony/bundles/monitoring-bundle/`       | ⬜     | 2          | Métriques runtime |
| `src/monitoring/index.ts`          | N/A                                         | ⬜     | 1          | Barrel export |

---

## Blockers connus

| Module | Problème | Solution envisagée | Résolu |
|--------|----------|--------------------|--------|
| _(aucun pour l'instant)_ | | | |

---

## Incompatibilités Bun à surveiller

| Feature JS | Statut Bun | Action |
|------------|-----------|--------|
| C++ native addons | ❌ Non supporté | Wrapper Node.js |
| `cluster` module | ⚠️ Partiel | `Bun.spawn` |
| `pm2` | ❌ Non pertinent | `Bun.serve` process natif |
| `webpack` | ⏭️ Remplacé | `Bun.build` |
| `sockjs` | ⚠️ À tester | WS natif Bun |

---

## Journal des sessions

| Date | Session | Module migré | Durée | Notes |
|------|---------|--------------|-------|-------|
| 2026-05-11 | Service + Interfaces | `Service.ts`, `IService`, `IKernel` | ~3h | 85 tests ✅ — `#nc` privé, `implements IService`, `Command.ts` fixé |
| 2026-05-11 | ISyslog + Syslog | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts` | ~2h | 85 tests ✅ — `Pci=unknown`, `Function` → types propres, `implements ISyslog` |
| 2026-05-11 | Syslog perf | `Pdu.ts`, `Syslog.ts`, `ISyslog.ts` | ~1h | 85 tests ✅ — `CircularBuffer` O(1), `Date.now()`, `severityNameMap`, `fastTypeOf`, no lodash |

---

## Prochaine session

**Module cible** : IKernel complet — `Kernel.ts implements IKernel`
**Pré-requis** : `IService` ✅ — `ISyslog` ✅ — Syslog perf ✅
**Blockers connus** :
- `IService.kernel: object | null` → doit devenir `IKernel | null` quand `Kernel implements IKernel`
- `IKernel` est minimal (manque `command`, `commandArgs`, `terminate`, `isTrunk`…)
- `getModule()` retourne `object` → doit retourner `IModule` (nécessite IModule d'abord)
**Fichiers à lire** : `src/nodefony/src/kernel/Kernel.ts`, `src/nodefony/src/kernel/CliKernel.ts`, `src/nodefony/src/types/IKernel.ts`
