---
title: Migration Nodefony — spécifications détaillées par phase
status: référence (déplacé de MIGRATION_STATUS.md le 2026-05-30)
note: le STATUT à jour vit dans MIGRATION_STATUS.md (roadmap P0–P16). Ici = le COMMENT (conception/archi/gotchas).
---

## Phase 0 — Refactorisation Build ✅ TERMINÉE

> Spec de référence : [`docs/architecture/BUILDER.md`](docs/architecture/BUILDER.md) (brainstorming — pas une spec exhaustive).
> Objectif : `npm install` installe + build + génère l'exécutable `nodefony`.

### Problèmes actuels

- `preinstall` séquentiel avec `--prefix` : fragile, lent, redondant avec workspaces npm.
- `prebuild` séquentiel : idem.
- Root `rollup.config.ts` monolithique : difficile à maintenir.
- `@ts-ignore` sur `rollup-sourcemap-path-transform` dans `src/nodefony/rollup.config.ts`.

### Tâches (ordre strict — voir docs/architecture/BUILDER.md pour le détail)

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

| Fichier TS cible                                                           | Source JS référence              | Statut | Complexité | Notes                                                                                                                    |
| -------------------------------------------------------------------------- | -------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/packages/@nodefony/framework/nodefony/service/router.ts`              | `nodefony/core/router/router.js` | ✅     | 3          | Router + IRoute + 11 tests unit                                                                                          |
| `src/packages/@nodefony/framework/nodefony/src/Route.ts`                   | `nodefony/core/router/`          | ✅     | 2          | Route + IRoute + 28 tests unit — fix WEBSOCKET return true                                                               |
| `src/packages/@nodefony/framework/nodefony/decorators/routerDecorators.ts` | N/A                              | ✅     | 2          | @route/@controller/@controllers + @Get/@Post/@Put/@Delete/@Patch + @HttpCode/@Header/@Redirect + **@Param/@Body/@Query** |
| `src/packages/@nodefony/framework/index.ts`                                | N/A                              | ✅     | 1          | Barrel export complet                                                                                                    |

---

## Phase 4 — Serveurs HTTP/WS natifs Node.js ✅ (branche refactor/http-deps)

> **Node.js natif uniquement** — `node:http`, `node:http2`, `ws`. Jamais `Bun.serve()`.
> Module `@nodefony/http` migré et fonctionnel. Voir plan tests ci-dessous.

### 4.1 Serveurs

| Fichier TS                                                                        | Statut | Notes                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/packages/@nodefony/http/nodefony/service/servers/server-http.ts`             | ✅     | node:http — port 5151                                                                                                                                       |
| `src/packages/@nodefony/http/nodefony/service/servers/server-https.ts`            | ✅     | TLS + HTTP/2                                                                                                                                                |
| `src/packages/@nodefony/http/nodefony/service/servers/server-websocket.ts`        | ✅     | ws@8 sur http                                                                                                                                               |
| `src/packages/@nodefony/http/nodefony/service/servers/server-websocket-secure.ts` | ✅     | wss sur https                                                                                                                                               |
| `src/packages/@nodefony/http/nodefony/service/servers/server-static.ts`           | ✅     | serve-static                                                                                                                                                |
| `src/packages/@nodefony/http/nodefony/service/http-kernel.ts`                     | ✅     | orchestrateur central                                                                                                                                       |
| `src/packages/@nodefony/http/nodefony/service/certificates.ts`                    | ✅     | TLS : mkcert (dev, CA trustée) / explicit (prod) / fallback node-forge **avec SAN** — conforme RFC 5280/6125 (2026-05-22). Migration auto si cert inadéquat |
| `src/packages/@nodefony/http/index.ts`                                            | ✅     | barrel export + types                                                                                                                                       |

### 4.2 Plan tests @nodefony/http (branche refactor/http-deps — 2026-05-15)

| Phase | Sujet                 | Fichier(s)                                                                    | Statut                                 |
| ----- | --------------------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| 1     | Interfaces TypeScript | `nodefony/interfaces/`                                                        | ✅ commit 8a81ede                      |
| 2     | Tests unitaires       | `Cookie.test.ts`, `HttpError.test.ts`, `Session.test.ts`                      | ✅ 67 passing                          |
| 3     | Intégration runtime   | `session.test.ts`, `security.test.ts`, `upload.test.ts`, `httpKernel.test.ts` | ✅ partiel — manque http1/https/errors |
| 3b    | Résiduel intégration  | `http1.test.ts`, `https.test.ts`, `errors.test.ts`                            | ⬜ à créer                             |
| 4     | HttpKernel + Context  | pipeline complet, Content-Type, parallel requests, cookies                    | ⬜                                     |
| 5     | Résilience + Sécurité | `resilience.test.ts`, `security.test.ts`                                      | ✅                                     |
| 5b    | Serve-static          | `static.test.ts`                                                              | ✅                                     |
| 5c    | Fuites mémoire        | `memory.test.ts`                                                              | ✅ partiel (à valider avec serveur)    |
| 6     | Performance           | autocannon, gzip/brotli, ETag                                                 | ⬜                                     |
| 7     | HTTP/3 stub           | `server-http3.ts`                                                             | ⏭️ Node.js >= 28 requis                |
| 8     | README.md             | documentation publique                                                        | ⬜                                     |
| 9     | Commandes CLI HTTP    | certificates, routes, sessions:clear, server:stats                            | ⬜                                     |
| 10    | Certificate tests     | `certificate.test.ts` (unit)                                                  | ⬜ pas urgent                          |

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

| Fichier TS cible                                              | Source JS référence                      | Statut | Complexité | Notes                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| `src/packages/@nodefony/framework/nodefony/src/Controller.ts` | `nodefony/core/controller/controller.js` | ✅     | 3          | `Controller implements IController` — 40 tests intégration                                           |
| `src/packages/@nodefony/framework/nodefony/src/Resolver.ts`   | N/A                                      | ✅     | 3          | `Resolver implements IResolver` — `_applyResponseDecorators` + `_handleRedirect` + `_buildParamArgs` |
| `src/packages/@nodefony/framework/nodefony/interfaces/`       | N/A (nouveau)                            | ✅     | 2          | `IController`, `IRoute`, `IResolver`                                                                 |

### 5.2 Session (refactor — actuel partiel)

> **État actuel** : `@nodefony/http/nodefony/src/session/session.ts` (715 L) — fonctionne avec `FileSessionStorage` mais champ `user?: string` (juste username, non typé), storage filesystem only.
> **Améliorations à apporter** :
>
> - `session.user` → typé `IUser` (référence vers module User), pas juste string
> - Storage drivers additionnels (Redis pour prod, ORM-backed pour persistence forte)
> - Hook `onUserInvalidated` quand `user.enabled=false` ou `user.accountNonLocked=false` → force `session.destroy()`
> - Sérialisation : préserver `roles` + `metaData` pour éviter refetch DB à chaque requête (read-through cache)
> - Migration session entre stores (logout / fixation prevention via `regenerateId()`)

| Fichier TS cible                                                      | Source JS référence                  | Statut | Complexité | Notes                                                      |
| --------------------------------------------------------------------- | ------------------------------------ | ------ | ---------- | ---------------------------------------------------------- |
| `@nodefony/http/nodefony/src/session/session.ts`                      | actuel + `framework-bundle/session/` | 🔶     | 3          | Refactor : `user: IUser`, hooks invalidation, regenerateId |
| `@nodefony/http/nodefony/service/sessions/sessions-service.ts`        | actuel                               | 🔶     | 2          | Sélection storage par config, lifecycle GC global          |
| `@nodefony/http/nodefony/src/session/storage/FileSessionStorage.ts`   | actuel                               | ✅     | —          | OK pour dev                                                |
| `@nodefony/http/nodefony/src/session/storage/MemorySessionStorage.ts` | nouveau                              | ⬜     | 1          | Map en mémoire, pour tests                                 |
| `@nodefony/http/nodefony/src/session/storage/RedisSessionStorage.ts`  | `bundles/redis-bundle/` (ref)        | ⬜     | 2          | TTL natif, prod-ready                                      |
| `@nodefony/http/nodefony/src/session/storage/OrmSessionStorage.ts`    | `bundles/framework-bundle/session/`  | ⬜     | 3          | Adapter générique via `@nodefony/orm-core`                 |
| `@nodefony/http/nodefony/interfaces/ISessionStorage.ts`               | N/A                                  | ⬜     | 1          | Interface publique storage                                 |
| `@nodefony/http/nodefony/interfaces/ISession.ts`                      | actuel                               | 🔶     | 1          | Étendre avec `user: IUser`, `regenerate()`                 |

### 5.3 User module (NEW — préalable à security)

> **Constat** : Le vieux framework avait `cli/builder/bundles/users-bundle/` (411 L service + entities Sequelize/Mongoose dupliquées) — bundle scaffold.
> **Problème** : entités User dupliquées par ORM → divergence garantie.
> **Solution** : `@nodefony/user` central avec **interface canonique IUser** + adapters ORM (via `@nodefony/orm-core`) + service provider.

> **Champs IUser canoniques** (extraits du legacy + standards 2026) :
> `id`, `username`, `email`, `password` (hashed), `roles: string[]`, `enabled`, `accountNonLocked`, `userNonExpired`, `credentialsNonExpired`, `twoFactorEnabled`, `twoFactorSecret`, `name`, `surname`, `lang`, `gender?`, `avatar?`, `url?`, `createdAt`, `updatedAt`, `lastLoginAt?`.
> **Méthodes IUser** : `hasRole(role)`, `isGranted(role)`, `verifyPassword(plain)`, `toSafeJson()` (sans password/secrets).

| Fichier TS cible                                      | Rôle                                                                       | Statut | Complexité | Notes                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------- |
| `@nodefony/user/interfaces/IUser.ts`                  | Interface canonique IUser (champs + méthodes)                              | ⬜     | 2          | Lue par security, session, controllers              |
| `@nodefony/user/interfaces/IUserRepository.ts`        | Repository contract : `findByUsername/Email/Id`, `create`, `update`        | ⬜     | 2          | Implémenté par chaque driver ORM                    |
| `@nodefony/user/interfaces/IUserProvider.ts`          | Provider security (alimente le Firewall)                                   | ⬜     | 2          | `loadByUsername(name): Promise<IUser>` etc.         |
| `@nodefony/user/src/User.ts`                          | Classe base (champs + `hasRole`, `isGranted`, `toSafeJson`)                | ⬜     | 2          | Code commun, indépendant de l'ORM                   |
| `@nodefony/user/src/AnonymousUser.ts`                 | User par défaut non authentifié — roles `["IS_AUTHENTICATED_ANONYMOUSLY"]` | ⬜     | 1          | Évite null partout                                  |
| `@nodefony/user/service/user-service.ts`              | Service `register/authenticate/disable/lock/unlock` + events               | ⬜     | 2          | Délègue au IUserRepository                          |
| `@nodefony/user/adapters/sequelize/UserEntity.ts`     | `@entity({ orm: "sequelize" })` — schema Sequelize                         | ⬜     | 2          | Ref : `users-bundle/Entity/sequelize/userEntity.js` |
| `@nodefony/user/adapters/sequelize/UserRepository.ts` | `implements IUserRepository`                                               | ⬜     | 2          |                                                     |
| `@nodefony/user/adapters/mongoose/UserEntity.ts`      | Schema Mongoose                                                            | ⬜     | 2          | Ref : `users-bundle/Entity/mongoose/userEntity.js`  |
| `@nodefony/user/adapters/mongoose/UserRepository.ts`  | `implements IUserRepository`                                               | ⬜     | 2          |                                                     |
| `@nodefony/user/adapters/drizzle/UserEntity.ts`       | Schema Drizzle (nouveau, type-safe)                                        | ⬜     | 2          | Sans précédent JS                                   |
| `@nodefony/user/adapters/drizzle/UserRepository.ts`   | `implements IUserRepository`                                               | ⬜     | 2          |                                                     |
| `@nodefony/user/index.ts`                             | Barrel exports                                                             | ⬜     | 1          |                                                     |

**Décisions IUser à figer avant code** :

- `id` : `string` (UUID) — pas `username` PK (legacy), permet rename username sans casser relations
- `roles` : `string[]` JSON — pas table jointure (lourd pour use case basique, peut évoluer)
- `password` : toujours hashed bcrypt — colonne séparée (jamais retournée par `toSafeJson()`)
- `twoFactorSecret` : chiffré au repos (clé app), jamais en clair en DB
- Validations : email RFC 5321, username regex alphanumeric + `._-`, password min 8 chars (configurable)
- Events : `onUserCreated`, `onUserAuthenticated`, `onUserDisabled`, `onPasswordChanged` (consommés par audit logs Phase 9.3)

---

## Phase 6 — Sécurité & Auth

> **Détail complet du périmètre** : voir [Phase 9.6](#96-intégration-nodefonysecurity-futur-module-phase-6) — composants à migrer, points d'intégration symbiose, ordre proposé.
> **Référence JS** : `/Users/cci/repository/nodefony/src/nodefony/bundles/security-bundle/` (à consulter avant migration TS).

| Fichier TS cible                                    | Source JS référence                              | Statut | Complexité | Notes                                                       |
| --------------------------------------------------- | ------------------------------------------------ | ------ | ---------- | ----------------------------------------------------------- |
| `@nodefony/security/service/firewall.ts`            | `services/firewall/firewallService.js` (694 L)   | ⬜     | 3          | SecuredArea, factory selection, auth pipeline               |
| `@nodefony/security/service/cors.ts`                | `services/cors/corsService.js` (182 L)           | ⬜     | 2          | Pre-flight + Access-Control-\* headers                      |
| `@nodefony/security/service/csrf.ts`                | `services/csrf/csrfService.es6` (193 L)          | ⬜     | 2          | Token + double-submit                                       |
| `@nodefony/security/service/authorization.ts`       | `services/authorization/authorizationService.js` | ⬜     | 2          | ACL/rôles                                                   |
| `@nodefony/security/src/AccessControl.ts`           | `src/Authorization/accessControl.js`             | ⬜     | 2          | Hiérarchie rôles                                            |
| `@nodefony/security/src/encoders/BcryptEncoder.ts`  | `src/encoders/bcryptEncoder.js`                  | ⬜     | 1          | Hash password                                               |
| `@nodefony/security/src/PassportBridge.ts`          | `src/passport/passportFramework.js`              | ⬜     | 2          | Adapter Passport.js                                         |
| `@nodefony/security/src/factories/*` (9 stratégies) | `src/factories/passport/*` + `anonymous/`        | ⬜     | 3          | basic/digest/jwt/local/ldap/oauth2/openid/google/github     |
| `@nodefony/security/src/tokens/*` (8 types)         | `src/tokens/*.js`                                | ⬜     | 2          | anonymous/jwt/ldap/oauth2/openid/github/google/userpassword |
| `@nodefony/security/index.ts`                       | N/A                                              | ⬜     | 1          | Barrel export                                               |

---

## Phase 7 — ORM multi-driver (architecture refondée)

> **Constat** : Sequelize est en perte de vitesse, mais encore maintenu (v6/v7). Mongoose reste leader pour MongoDB.
> Le framework doit **charger plusieurs ORM simultanément** dans le même process (ex : Drizzle pour SQL + Mongoose pour Mongo + Redis pour cache).
> Pattern legacy nodefony JS : `Orm` (interface) → `Connector` (lib) → `Entity` (modèle) → `OrmRegistry` (multi-instance).

### 7.1 Architecture cible

```
@nodefony/orm-core         ← interfaces abstraites : IOrm, IEntity, IConnector, IRepository, ITransaction
                            registre multi-ORM : OrmRegistry.get(name) → IOrm
   ↑                       ↑
@nodefony/sequelize        @nodefony/mongoose        @nodefony/drizzle        @nodefony/prisma (optionnel)
   ↑                       ↑                         ↑
   └───────────────────────┴─────────────────────────┘
                  consommés par : User module, Session storage, security, application
```

### 7.2 Choix ORM 2026 (ordre de priorité)

| ORM           | Type           | Statut prévu        | Raison                                                                          |
| ------------- | -------------- | ------------------- | ------------------------------------------------------------------------------- |
| **Mongoose**  | MongoDB ODM    | ✅ migration legacy | Leader incontesté MongoDB, pas de challenger                                    |
| **Drizzle**   | SQL builder TS | ✅ nouveau          | Type-safe SQL, perf, ascendant 2024-2026, schemas TS natifs, migrations CLI     |
| **Sequelize** | SQL ORM legacy | 🔶 maintenance      | Compat existant — figer en v6, pas étendre — bridge minimal                     |
| **Prisma**    | Schema-first   | ⏭️ optionnel        | Très populaire mais code gen externe + Prisma engine binaire — complique le pkg |
| **MikroORM**  | DataMapper     | ⏭️ optionnel        | Doctrine-like, supporte SQL + Mongo, à évaluer si Drizzle insuffisant           |
| **TypeORM**   | DataMapper     | ⏭️ skip             | En perte de vitesse, décorateurs lourds                                         |
| **Kysely**    | SQL builder    | ⏭️ skip             | Pas un ORM, déjà couvert par Drizzle                                            |

### 7.3 Module `@nodefony/orm-core` (nouveau — fondation)

> **✅ P5.1 (2026-05-21)** — package scaffoldé (config conforme `dist/types` + `exports`, lib pure hors `@modules()`) + 4 interfaces sous `nodefony/interfaces/` (chemin réel ; `IOrm.getNativeConnection<C>()` ajouté = trappe SQL brut). Build vert, typecheck strict 0 erreur. Schéma banc-test figé dans [ADR-0002](adr/0002-schema-conference-webrtc-mediasoup.md).
>
> **✅ P5.2 + P5.4-partiel (2026-05-21)** — runtime sous `nodefony/src/` : `OrmRegistry`/`EntityRegistry` (singletons process-wide lazy, classes instanciables pour tests + instances `ormRegistry`/`entityRegistry`), `Orm` abstract `extends Service` (template `connect()` → émet `onOrmReady`, auto-register au constructeur), `Entity` abstract (`getSchema()` + `register()`). **Auto-register Entity reporté en P5.3** (trap ordre d'init TS : ctor base avant initialiseurs sous-classe → `name`/`orm` undefined → l'auto-register passe par le décorateur `@entity`). 15 tests unit verts (mocha+tsx, `node:assert`).
>
> **✅ P5.3 (2026-05-21)** — décorateurs sous `nodefony/src/decorators/` : `@entity({orm,name?,schema?,relations?})` (class deco, `name` défaut = nom de classe) construit un **descripteur `IEntity` depuis les options** (0 instanciation au boot) + auto-register dans `entityRegistry` au chargement du module ; `@repository(name,{entity,orm?})` = **tag pur** repo↔entity (binding DI reporté à l'adapter P5.4+). Métadonnées dans un **`WeakMap` maison** (`metadataStore.ts`) — **PAS de `reflect-metadata`** : orm-core ne fait pas de DI par `design:paramtypes`, reste lib pure 0 dep runtime (helper `__metadata` gardé → no-op sans polyfill). +7 tests (22 total). **Reste P5.4** (intégration multi-ORM + 1 adapter Sequelize).

| Fichier TS cible                                           | Rôle                                                                                                         | Statut | Complexité |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ | ---------- |
| `@nodefony/orm-core/interfaces/IOrm.ts`                    | Interface ORM : `connect()`, `disconnect()`, `getRepository(name)`, `transaction()`, `getNativeConnection()` | ✅     | 2          |
| `@nodefony/orm-core/interfaces/IEntity.ts`                 | Interface Entity : `name`, `orm`, `schema`, `model`, `relations` (+ `IEntityRelation`)                       | ✅     | 2          |
| `@nodefony/orm-core/interfaces/IRepository.ts`             | Interface Repository : `find/findOne/create/update/delete/count` (+ `OrmCriteria`)                           | ✅     | 2          |
| `@nodefony/orm-core/interfaces/ITransaction.ts`            | UoW/transaction abstraite (commit/rollback/savepoint/rollbackTo/getNative)                                   | ✅     | 2          |
| `@nodefony/orm-core/nodefony/src/OrmRegistry.ts`           | Singleton lazy — `register/get/has/list/unregister` + instance `ormRegistry`                                 | ✅     | 2          |
| `@nodefony/orm-core/nodefony/src/Orm.ts`                   | Classe abstraite base extends Service, template `connect()` → `onOrmReady`, auto-register                    | ✅     | 2          |
| `@nodefony/orm-core/nodefony/src/Entity.ts`                | Classe abstraite — `getSchema()` + `register()` (auto-register via `@entity` P5.3)                           | ✅     | 2          |
| `@nodefony/orm-core/nodefony/src/EntityRegistry.ts`        | Cross-ORM entity lookup lazy `entities[name][ormName]` + instance `entityRegistry`                           | ✅     | 2          |
| `@nodefony/orm-core/src/decorators/entityDecorator.ts`     | `@entity({ orm, name, schema })` — métadonnées + auto-register                                               | ⬜     | 2          |
| `@nodefony/orm-core/src/decorators/repositoryDecorator.ts` | `@repository("UserRepository", { entity: "User" })`                                                          | ⬜     | 2          |
| `@nodefony/orm-core/index.ts`                              | Barrel exports (+ `nodefony/interfaces/index.ts`)                                                            | ✅     | 1          |

### 7.4 Drivers ORM (consomment orm-core)

| Module                            | Fichier TS                                                 | Source réf JS               | Statut | Complexité |
| --------------------------------- | ---------------------------------------------------------- | --------------------------- | ------ | ---------- |
| `@nodefony/sequelize`             | `service/sequelize.ts` + `connector/SequelizeConnector.ts` | `bundles/sequelize-bundle/` | 🔶     | 3          |
| `@nodefony/mongoose`              | `service/mongoose.ts` + `connector/MongooseConnector.ts`   | `bundles/mongoose-bundle/`  | 🔶     | 2          |
| `@nodefony/drizzle` (NEW)         | `service/drizzle.ts` + `connector/DrizzleConnector.ts`     | N/A                         | ⬜     | 3          |
| `@nodefony/redis` (cache+session) | `service/redis.ts`                                         | `bundles/redis-bundle/`     | 🔶     | 2          |

### 7.5 Tests ORM (critique — non couvert dans le core actuel)

| Fichier                                                   | Sujet                                                                                   | Statut |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| `@nodefony/orm-core/tests/unit/OrmRegistry.test.ts`       | register/get/list, doublon, cleanup                                                     | ⬜     |
| `@nodefony/orm-core/tests/unit/EntityRegistry.test.ts`    | Cross-ORM lookup, conflits noms                                                         | ⬜     |
| `@nodefony/orm-core/tests/unit/decorators.test.ts`        | `@entity` + `@repository` metadata                                                      | ⬜     |
| `@nodefony/sequelize/tests/integration/sequelize.test.ts` | Connect SQLite mem, CRUD, transactions, hooks                                           | ⬜     |
| `@nodefony/mongoose/tests/integration/mongoose.test.ts`   | Connect mongo-memory-server, CRUD, schemas                                              | ⬜     |
| `@nodefony/drizzle/tests/integration/drizzle.test.ts`     | Connect SQLite mem, CRUD, type-safe queries                                             | ⬜     |
| `@nodefony/orm-core/tests/integration/multi-orm.test.ts`  | **CRITIQUE** : charger 2 ORM en parallèle, User défini une fois, persisté dans 2 stores | ⬜     |

### 7.6 Préoccupations transverses

- **Connection pooling** : déléguer à chaque connector (Sequelize a son pool, Mongoose `mongoose.connection`, Drizzle via `postgres.js`/`better-sqlite3`).
- **Transactions cross-ORM** : 2PC non géré (limite documentée — pas de transaction MySQL + Mongo cohérente).
- **Migration scripts** : déléguer au CLI de chaque ORM (drizzle-kit, sequelize-cli, mongoose pas de migration). CLI Nodefony agrège.
- **Lifecycle `onOrmReady`** : tous les ORM doivent emit cet event avant que Phase Kernel onReady ne se déclenche.

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

| #   | Axe                                | Sujet                                                                                                                                                  | Tests existants                               | Statut |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------ |
| 1   | **Pipeline complet**               | controller → resolver → HttpContext → Response, propagation HttpError, status codes (200/3xx/4xx/5xx/RFC 9110)                                         | `http-rfc-errors.test.ts` (partiel, 11 fails) | 🔶     |
| 2   | **Forward cross-module**           | `forward("mod:ctrl:action")` redispatch sans nouvelle requête HTTP — partage du context, pas de double-resolve                                         | manuel via `/nodefony/test/forward`           | ⬜     |
| 3   | **Decorators × pipeline**          | `@Get/@Post` + `@Param/@Body/@Query` + `@HttpCode/@Header/@Redirect` combinés sur une seule action — ordre d'application, conflits headers             | `http/decorators.test.ts` (10 cas)            | 🔶     |
| 4   | **Concurrence / context leak**     | N requêtes parallèles — vérifier que `metaData`, `session`, `requestId`, `queryGet/Post`, `cookies` ne fuient JAMAIS entre contextes                   | aucun                                         | ⬜     |
| 5   | **Lifecycle session × controller** | `initialize() → startSession()` → action → `saveSession()` → cookie cross-request (load → modify → persist → reload) ; isolation entre users           | `http/session.test.ts` (partiel)              | 🔶     |
| 6   | **HttpError handling**             | controller throw → `Resolver` catch → `HttpKernel.onError` → ErrorController → 500 JSON conservé requestId + Allow header pour 405                     | `http-rfc-errors.test.ts`                     | 🔶     |
| 7   | **WS pipeline**                    | Router résout protocole **AVANT** `connect()` → handshake action (`execute(null)`) → message handler ; isolation par connexion ; broadcast inclut self | `websocket-*.test.ts` (partiel)               | 🔶     |
| 8   | **DI scope × requête**             | service singleton vs per-request, `@inject` dans controller, propagation kernel→module→controller ; Phase B Injector (scoped/ALS)                      | aucun (intégration)                           | ⬜     |

### 9.2 Cycle de vie d'une requête + Context (observabilité + robustesse)

> Le Context est créé à chaque requête et porte tout (`requestId`, `metaData`, `session`, `resolver`, `request`, `response`). Sa traçabilité bout-en-bout est la clé pour debug+observabilité.

| #   | Axe                                      | Sujet                                                                                                                                                                                      | Notes                                                                  | Statut |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------ |
| 9   | **Boundary timing (phase-by-phase)**     | Tracer durée de chaque phase : `connection → parse → resolve → firewall → initialize → action → render → write → send`                                                                     | Performance API (`performance.now()`) — exposé dans `context.timing[]` | ⬜     |
| 10  | **AsyncLocalStorage `requestId`**        | Propager `requestId` dans les services downstream (Syslog auto, DB queries, fetch) sans passer le `context` en param partout                                                               | Phase B du plan Injector (`INJECTION_PLAN.md`)                         | ⬜     |
| 11  | **Context tear-down déterministe**       | `context.cleanup()` à `response.end` : libérer listeners, fermer streams, flush session, retirer le `context` du `requestId` ALS map                                                       | Listener `response.on("finish")` + `on("close")`                       | ⬜     |
| 12  | **Aborted requests (client disconnect)** | Client ferme la socket pendant action async → propre cleanup (subscribers, DB tx ouverte, lock) ; 499 status interne (Nginx-style)                                                         | `request.on("aborted")` + `AbortController` injecté dans le Context    | ⬜     |
| 13  | **Backpressure Response.write()**        | Quand `res.write()` retourne `false` → controller doit `await` le drain ; documenter ; tests streaming                                                                                     | `MediaStream` route déjà sensible                                      | ⬜     |
| 14  | **Body streaming vs buffered**           | Controller reçoit un `Readable` (stream) ou un body bufferisé ? Configurable par `@Body({ stream: true })` ? Limites mémoire/taille                                                        | Upload multipart = streaming busboy (H6 ✅) ; reste `@Body({stream})`  | 🔶     |
| 15  | **`onTerminate` hook par requête**       | Le controller enregistre une callback exécutée APRÈS `response.end` (logs, metrics, audit, push) — pattern `context.onAfterResponse(fn)`                                                   | Émettre event `"onRequestEnd"` sur Context                             | ⬜     |
| 16  | **Initialize error boundary**            | `initialize()` throw → action NON appelée → format réponse cohérent avec un crash action (même JSON shape, même requestId)                                                                 | Vérifier dans `Resolver.callController`                                | ⬜     |
| 17  | **Idempotency keys (RFC 9110 §9.2.2)**   | Header `X-Idempotency-Key` → dedup côté serveur ; relié à `requestId` ; cache court terme                                                                                                  | Header standardisé Stripe/AWS                                          | ⬜     |
| 18  | **Request timeout**                      | Limite globale d'exécution action (`config.http.requestTimeoutMs`) → 408 si dépassé → cleanup propre via abort                                                                             | Pas de garde-fou actuel                                                | ⬜     |
| 19  | **Context audit log**                    | À `response.finish` → 1 PDU INFO structuré contenant : `requestId`, `method`, `path`, `status`, `duration`, `controller`, `action`, `ip`, `userAgent`, `bytesIn`, `bytesOut`, `sessionId?` | Un seul log par requête (résume tout)                                  | ⬜     |
| 20  | **Trace ID W3C (RFC `traceparent`)**     | Honor `traceparent` header entrant + générer si absent → propager en sortie ; coexistence avec `X-Request-Id`                                                                              | Compat OpenTelemetry                                                   | ⬜     |

### 9.3 Logs — clarté homme + machine

> Les transports sont en place (Console/File/Http/Syslog — Phase X). Manque : un format JSON canonique requête + un format pretty humain en dev + filtrage par `requestId`.

| #   | Axe                                   | Sujet                                                                                                                                             | Statut |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 21  | **Format JSON canonique par requête** | Champs obligatoires : `ts, lvl, requestId, traceId, method, path, status, durationMs, controller, action, ip, userAgent, bytesIn, bytesOut, msg`  | ⬜     |
| 22  | **Pretty formatter dev (homme)**      | Mode dev : 1 ligne colorée par requête `[ID 1a2b…] 200 GET /foo 12ms — DefaultController.index` ; erreur sur 2 lignes (1 résumé + 1 stack)        | ⬜     |
| 23  | **Severity selon HTTP status**        | `1xx/2xx/3xx → INFO` ; `4xx → WARNING` (sauf 401/403 → NOTICE config) ; `5xx → ERROR` ; règles encodées dans `HttpKernel.logRequest()`            | ⬜     |
| 24  | **Filtrage par requestId**            | `syslog.filter({ msgid: requestId })` — reconstruire l'historique complet d'une requête (déjà supporté par Syslog conditions, à exposer dans CLI) | ⬜     |
| 25  | **Mode trace verbose**                | `DEBUG` activé → log phase-par-phase via `context.timing[]` + entrées/sorties des hooks → 1 ligne par phase, même `requestId` partout             | ⬜     |
| 26  | **Erreur enrichie**                   | 1 PDU ERROR par requête en erreur : `requestId`, `controller`, `action`, `status`, full stack trace, `cause` chain, headers entrants relevants    | ⬜     |
| 27  | **Rate limit ciblé par `requestId`**  | Si même `requestId` produit > N logs DEBUG → rate limit local (évite spam sur boucles internes)                                                   | ⬜     |
| 28  | **WS logs**                           | 1 PDU connexion (handshake), 1 PDU par message (opcode/size/protocol) — `wsId = connection.uuid`, lié à `requestId` du handshake                  | ⬜     |
| 29  | **Sensitive header redaction**        | Mask `Authorization, Cookie, Set-Cookie, X-Api-Key` dans tous les logs (production) — config-driven                                               | ⬜     |
| 30  | **Transport `requestLogger` dédié**   | `ITransport` spécialisé : 1 ligne JSON par requête (NCSA/Combined Log Format facultatif) → fichier rotatif ; séparé du syslog général             | ⬜     |

### 9.4 Tests cibles à créer

| Fichier                                                    | Sujet                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `@nodefony/http/tests/integration/lifecycle.test.ts`       | Context tear-down, `response.on("finish")`, aborted requests, listener leaks             |
| `@nodefony/http/tests/integration/concurrency.test.ts`     | N=100 req // → assertion que les `requestId` sont uniques + pas de cross-context         |
| `@nodefony/http/tests/integration/timing.test.ts`          | `context.timing[]` rempli, durations cohérentes, ordre phases respecté                   |
| `@nodefony/http/tests/integration/audit-log.test.ts`       | 1 et 1 seule PDU INFO par requête, champs obligatoires présents                          |
| `@nodefony/http/tests/integration/http-rfc-errors.test.ts` | **(existant — fixer 11 fails)** — status-message vide, X-Request-Id sur 4xx/5xx          |
| `@nodefony/framework/tests/integration/forward.test.ts`    | `forward("mod:ctrl:action")` partage le context, single resolver chain                   |
| `@nodefony/framework/tests/integration/scope.test.ts`      | scope singleton vs transient via `@inject` dans Controller, isolation pas re-utilisation |

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

| Service / Module             | Fichier JS source                                     | Rôle                                                                                                  | Cible TS                                           |
| ---------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `firewallService`            | `services/firewall/firewallService.js` (694 L)        | SecuredArea matching URL, sélection factory, auth pipeline, redirection login                         | `@nodefony/security/service/firewall.ts`           |
| `corsService`                | `services/cors/corsService.js` (182 L)                | Pre-flight `OPTIONS`, headers `Access-Control-*`                                                      | `@nodefony/security/service/cors.ts`               |
| `csrfService`                | `services/csrf/csrfService.es6` (193 L)               | Token CSRF + double-submit cookie                                                                     | `@nodefony/security/service/csrf.ts`               |
| `authorizationService`       | `services/authorization/authorizationService.js`      | Access control (rôles + ACL `accessControl.js`)                                                       | `@nodefony/security/service/authorization.ts`      |
| `accessControl`              | `src/Authorization/accessControl.js`                  | Vérif rôles, hiérarchie                                                                               | `@nodefony/security/src/AccessControl.ts`          |
| `bcryptEncoder`              | `src/encoders/bcryptEncoder.js`                       | Hash mot de passe                                                                                     | `@nodefony/security/src/encoders/BcryptEncoder.ts` |
| `passportFramework`          | `src/passport/passportFramework.js`                   | Adapter Passport.js                                                                                   | `@nodefony/security/src/PassportBridge.ts`         |
| **Factories** (9 stratégies) | `src/factories/passport/passport-*.js` + `anonymous/` | basic, digest, jwt, local, ldap, oauth2, openid, google, github + anonymous                           | `@nodefony/security/src/factories/*.ts`            |
| **Tokens** (8 types)         | `src/tokens/*.js`                                     | Représentation token utilisateur : anonymous, jwt, ldap, oauth2, openid, github, google, userpassword | `@nodefony/security/src/tokens/*.ts`               |
| **Providers**                | `src/providers/anonymousProvider.js`                  | Provider d'identité (anonymous + extensible)                                                          | `@nodefony/security/src/providers/*.ts`            |

#### Points d'intégration dans la symbiose (cibles des hooks 9.5.7)

| Phase requête                                      | Hook security                    | Action                                                                                             |
| -------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `beforeResolve` (avant Router)                     | **CORS pre-flight**              | Court-circuit `OPTIONS` → 204 + headers `Access-Control-*` ; jamais d'appel au controller          |
| après `Router.resolve` (route + controller connus) | **Firewall match SecuredArea**   | Matche URL → SecuredArea → factory → token → user (échec → 401/redirect login)                     |
| `afterAuth`                                        | **Authorization (ACL/rôles)**    | Vérifier `route.requirements.roles` contre `context.user.roles` (échec → 403)                      |
| avant `controller.action()`                        | **CSRF check (POST/PUT/DELETE)** | Vérifier `_csrf` body/header == cookie ; échec → 403                                               |
| `onError` (HttpError)                              | **AuthFailureHandler**           | 401 → redirect login (HTML) ou JSON (XHR/API) ; 403 → 403 JSON ; conservation `requestId`          |
| WS handshake (avant `connect()`)                   | **WS Firewall**                  | Même SecuredArea matching qu'HTTP — `WebsocketContext.request.url` ; protocole + auth avant accept |
| WS message                                         | **Per-message authorization**    | Vérifier `context.user` toujours valide ; session expirée → close `1008` (policy violation)        |

#### Axes spécifiques sécurité × logs (extension de 9.3)

| #   | Axe                                   | Sujet                                                                                                                                 |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Audit log auth**                    | 1 PDU NOTICE par tentative d'auth (success/failure) : `requestId`, `factory`, `username/sub`, `ip`, `userAgent`, `outcome`            |
| S2  | **Logs failure ≠ logs error**         | Échec auth = NOTICE (attendu) — pas WARNING/ERROR (sinon pollution + faux signal sécurité). 401 répété même IP → escalade WARNING     |
| S3  | **Redaction stricte tokens**          | JAMAIS de log `Authorization`, `Cookie`, `Set-Cookie`, `_csrf`, `password`, JWT body — même en DEBUG (extension axe 29)               |
| S4  | **Trace `userId` dans tous les logs** | Une fois l'auth résolue → `context.user.id` propagé via ALS → tous les logs downstream incluent `userId`                              |
| S5  | **Rate limit auth**                   | N tentatives échouées par IP/user → escalade NOTICE→WARNING→ERROR + lock temporaire (firewall directive `bruteForceProtection`)       |
| S6  | **CSP / security headers**            | Headers `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` configurables |

#### Tests cibles security (en plus des tests Phase 6)

| Fichier                                                       | Sujet                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@nodefony/security/tests/integration/firewall-http.test.ts`  | SecuredArea match + factory + token cycle complet contre serveur live       |
| `@nodefony/security/tests/integration/firewall-ws.test.ts`    | Auth WS handshake + close 1008 sur session expirée                          |
| `@nodefony/security/tests/integration/cors.test.ts`           | Pre-flight `OPTIONS`, headers `Access-Control-*`, origin allowlist          |
| `@nodefony/security/tests/integration/csrf.test.ts`           | Double-submit cookie, échec sur tampering, exemption GET/HEAD               |
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

## Phase 10 — `@nodefony/studio` (successeur monitoring-bundle)

> Application web d'administration du framework. Remplace `/Users/cci/repository/nodefony/src/nodefony/bundles/monitoring-bundle/` (Vue 2 legacy).
> Démarrera **après** un niveau satisfaisant de migration (P0→P6 + P5+P7+P8 minimum) — sinon consomme des API qui n'existent pas encore.
> **Convention** : préfixe route `/nodefony` réservé à ce module + sous-routes `/nodefony/<module>/*` pour les API d'admin que chaque module migré doit exposer.

### 10.1 Périmètre fonctionnel (inspiration legacy)

> Voir vues legacy `/monitoring-bundle/src/views/` : bundles, databases, documentation, firewall, logs, migrate, monitoring, npm, pm2, profiling, router, service, sessions, users.

| Vue          | Consomme module     | API requise                                                               |
| ------------ | ------------------- | ------------------------------------------------------------------------- |
| Dashboard    | core/http           | `/nodefony/system/stats` (mem, uptime, requests/s, servers status)        |
| Routes       | framework           | `/nodefony/framework/routes` — liste + détails route                      |
| Sessions     | http/session        | `/nodefony/http/sessions` — liste, destroy, regenerate                    |
| Users        | user + security     | `/nodefony/user/list`, `add/disable/lock/unlock/roles`                    |
| Firewall     | security            | `/nodefony/security/areas`, `/nodefony/security/tokens` (actifs)          |
| Logs         | syslog (transports) | `/nodefony/syslog/stream` (SSE/WS), `/nodefony/syslog/filter`             |
| Databases    | orm-core            | `/nodefony/orm/connections`, status par ORM, liste entités                |
| Migrations   | orm-\* + CLI        | `/nodefony/orm/migrations` — run/rollback/status                          |
| NPM          | core CLI            | `/nodefony/npm/outdated`, `/nodefony/npm/audit`                           |
| PM2          | core CLI            | `/nodefony/pm2/processes` — list/restart/stop                             |
| Profiling    | http + monitoring   | `/nodefony/profiling/request/{id}` — utilise axe 9.2.9 (`context.timing`) |
| Service / DI | core                | `/nodefony/services/list` — registre Injector                             |

### 10.2 Structure module

```
src/packages/@nodefony/studio/
├── package.json                       ← @nodefony/studio
├── nodefony/
│   ├── config/config.ts               ← prefix /nodefony, auth ROLE_NODEFONY_ADMIN
│   ├── controller/
│   │   ├── DashboardController.ts     ← /nodefony — page principale
│   │   ├── api/
│   │   │   ├── SystemApiController.ts ← /nodefony/api/system
│   │   │   ├── FrameworkApiController.ts
│   │   │   ├── SecurityApiController.ts
│   │   │   ├── OrmApiController.ts
│   │   │   └── ...
│   │   └── graphql/                   ← Apollo handlers (read-heavy)
│   ├── service/
│   │   ├── studio-service.ts          ← Aggrégateur d'API cross-module
│   │   └── ApiBroker.ts               ← Dispatch vers les API des modules
│   └── interfaces/
│       └── IAdminApi.ts               ← Contract que chaque module doit implémenter pour exposer son admin
├── frontend/                          ← Vue 3 + Vite + TS (ou React — décision début Phase 10)
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.vue
│   │   ├── router/
│   │   ├── stores/                    ← Pinia
│   │   ├── views/                     ← (1 vue par périmètre 10.1)
│   │   └── i18n/
│   └── package.json
└── tests/
    └── integration/
        └── studio.test.ts             ← Smoke test routes + GraphQL schema
```

### 10.3 Prérequis (durs)

Avant de démarrer Phase 10, ces modules DOIVENT exposer leur API admin sous `/nodefony/<module>/*` :

| Module                | API admin minimale                             | Phase prérequis |
| --------------------- | ---------------------------------------------- | --------------- |
| `@nodefony/http`      | servers status + sessions list + request stats | P4 ✅ (post)    |
| `@nodefony/framework` | routes list + controllers list                 | P4 ✅ (post)    |
| `@nodefony/security`  | users connectés + areas + access logs          | P6 ✅           |
| `@nodefony/user`      | CRUD users + roles                             | P5.6 ✅         |
| `@nodefony/orm-core`  | connections status + entities list             | P5.4 ✅         |
| Core (syslog)         | stream logs (SSE/WS) + filter                  | P3.10 ✅        |

### 10.4 Tâches Phase 10

| #         | Tâche                                                                  | Effort   | Dépendances       | Notes                                         |
| --------- | ---------------------------------------------------------------------- | -------- | ----------------- | --------------------------------------------- |
| P10.1     | Décision stack frontend (Vue 3 vs React 19) + bootstrap Vite           | 0.5 ses. | —                 | Cohérence ou rupture — décision business      |
| P10.2     | `IAdminApi` interface + `ApiBroker` service — contract module → studio | 1 ses.   | P5.4              | Permet à chaque module de plug son API admin  |
| P10.3     | Implémentation `IAdminApi` dans http, framework, syslog (core)         | 2 ses.   | P10.2             | Endpoints REST + GraphQL schemas              |
| 🔶 P10.4  | Implémentation `IAdminApi` dans user, orm-core, security               | 2 ses.   | P10.2, P5.6, P6.8 | Dépend que ces modules existent               |
| P10.5     | Backend `@nodefony/studio` — `DashboardController` + `api/*Controller` | 2 ses.   | P10.3, P10.4      | Routes prefix `/nodefony`                     |
| P10.6     | Auth admin : factory `studio-admin` + role `ROLE_NODEFONY_ADMIN`       | 1 ses.   | P6.5              | Login dédié, isolé de l'app                   |
| P10.7     | Frontend bootstrap + router + auth + layouts                           | 2 ses.   | P10.5             | Page Login + Dashboard de base                |
| P10.8     | Vues 10.1 (dashboard, routes, sessions, users) — 4 vues prio           | 3 ses.   | P10.7             | MVP utile                                     |
| 🔶 P10.9  | Vues 10.1 (firewall, logs streaming, databases, migrate)               | 3 ses.   | P10.8             | Logs streaming via SSE — nécessite Phase 3 ✅ |
| 🔶 P10.10 | Vues 10.1 (npm, pm2, profiling, services)                              | 2 ses.   | P10.9             | Niche, peut être livré incrémental            |
| 🔶 P10.11 | Tests intégration studio (smoke + auth + 4 vues prio)                  | 1 ses.   | P10.8             |                                               |

**Effort total Phase 10 : ~19.5 sessions** (frontend inclus, vues complètes).

---

## Phase 11 — Commandes CLI par module (non testées actuellement)

> Constat : 7 commandes CLI implémentées (`Start/Dev/Build/Prod/Cluster/Install/Outdated`) — **non testées en intégration**. Aucun module métier (http, framework, user, security, orm) n'a encore enregistré ses commandes. (`Pm2`/`Kill` retirées C6 2026-05-29 ; `Staging` retirée 2026-05-25.)

### 11.1 Commandes existantes — tests à créer

| Commande      | Module         | Test à créer                            | Statut |
| ------------- | -------------- | --------------------------------------- | ------ |
| `start`       | core/CliKernel | spawn child, vérifier 4 serveurs listen | ⬜     |
| `development` | core/CliKernel | idem `start` + watch mode actif         | ⬜     |
| `build`       | core/CliKernel | exit code 0 + dist/ peuplé              | ⬜     |
| `production`  | core/CliKernel | PM2 daemon up, ports actifs             | ⬜     |
| `staging`     | core/CliKernel | env staging chargé                      | ⬜     |
| `install`     | core/CliKernel | npm install dans tous workspaces        | ⬜     |
| `outdated`    | core/CliKernel | rapport JSON valide                     | ⬜     |
| `pm2`         | core/CliKernel | list/start/stop                         | ⬜     |
| `kill`        | core/CliKernel | tue process actif sur ports 5151/5152   | ⬜     |

### 11.2 Commandes à ajouter par module (vues comme indispensables)

| Module                | Commandes prévues                                                                    | Statut | Effort   |
| --------------------- | ------------------------------------------------------------------------------------ | ------ | -------- |
| `@nodefony/http`      | `http:routes:list`, `http:sessions:clear`, `http:cert:generate`, `http:server:stats` | ⬜     | 1 ses.   |
| `@nodefony/framework` | `framework:route:list`, `framework:controller:list`                                  | ⬜     | 0.5 ses. |
| `@nodefony/security`  | `security:user:list`, `security:area:list`, `security:token:revoke`                  | ⬜     | 1 ses.   |
| `@nodefony/user`      | `user:add`, `user:disable`, `user:roles:set`, `user:password:reset`                  | ⬜     | 1 ses.   |
| `@nodefony/orm-*`     | `orm:migrate`, `orm:rollback`, `orm:status`, `orm:seed`                              | ⬜     | 2 ses.   |
| Core / Syslog         | `logs:tail`, `logs:filter --requestId=...`                                           | ⬜     | 0.5 ses. |

### 11.3 Convention CLI

- Format : `nodefony <module>:<action> [args] [--options]` (ex : `nodefony security:user:add alice --role=ROLE_USER`).
- Chaque commande doit **avoir un endpoint API équivalent** consommable par Studio (axe 11.4).
- Tests : `npx nodefony <cmd>` lancé en sub-process avec `child_process.spawn`, assertion stdout + exit code.

### 11.4 Bridge CLI ↔ Studio

Un endpoint `/nodefony/<module>/cli/exec` (POST, role-protected) doit permettre à Studio d'invoquer la commande CLI équivalente — ainsi l'admin web ne dépend pas de SSH.

**Effort total Phase 11 : ~6 sessions** (tests existants + nouvelles commandes par module).

---

## Phase 14 — `@nodefony/frontend` (builder Vue/React/Svelte intégré)

> **Constat legacy** : chaque bundle pouvait déclarer `type: "react" | "vue"` dans son `Resources/config/config.js`. Le framework transpilait directement le frontend via `framework-bundle/services/webpackService.js` (631 L) + builders `cli/builder/react/reactBuilder.js` (224 L) + `cli/builder/vue/vueBuilder.js` (410 L).
> **Refonte 2026** : Webpack obsolète → **Vite** standard de facto (ESM natif, HMR ultra-rapide, cohérence avec Rollup déjà utilisé backend). Multi-framework via presets.
> Référence JS : `/Users/cci/repository/nodefony/src/nodefony/bundles/framework-bundle/services/webpackService.js` + `/Users/cci/repository/nodefony/src/nodefony/cli/builder/{react,vue}/`.

### 14.1 Architecture cible

```
@nodefony/frontend (NEW)
├── interfaces/
│   ├── IFrontBuilder.ts          ← Contract : build(), dev(), watch()
│   ├── IFrontPreset.ts           ← Preset framework (vue/react/svelte/solid)
│   └── IDevServerMiddleware.ts   ← Middleware HMR injectable dans @nodefony/http
├── service/
│   └── frontend.ts               ← Service principal, lit module.options.frontend, sélectionne builder
├── builders/
│   ├── ViteBuilder.ts            ← Implémente IFrontBuilder via Vite (défaut 2026)
│   └── WebpackBuilder.ts         ← Optionnel — compat legacy modules historiques
├── presets/
│   ├── vue3-vite.ts              ← Vue 3 + Vite + @vitejs/plugin-vue
│   ├── react19-vite.ts           ← React 19 + Vite + @vitejs/plugin-react-swc
│   ├── svelte5-vite.ts           ← Svelte 5 + Vite (optionnel)
│   └── solid-vite.ts             ← Solid + Vite (optionnel)
├── middleware/
│   ├── DevServerMiddleware.ts    ← Vite middleware injecté dans @nodefony/http en dev
│   └── StaticMiddleware.ts       ← Build prod → static serve via @nodefony/http
├── nodefony/
│   ├── command/
│   │   ├── frontend-build.ts     ← nodefony frontend:build [--module=name]
│   │   ├── frontend-dev.ts       ← nodefony frontend:dev (watch + HMR)
│   │   └── frontend-create.ts    ← nodefony frontend:create <module> --type=vue3
│   └── config/config.ts
└── tests/
    ├── unit/presets.test.ts
    └── integration/build-vue3.test.ts + build-react19.test.ts
```

### 14.2 Conventions module avec frontend

Un module Nodefony qui expose un frontend déclare dans sa config :

```typescript
// src/packages/@nodefony/studio/nodefony/config/config.ts
export default {
  frontend: {
    type: "vue3", // ou "react19", "svelte5", "solid"
    entry: "./frontend/src/main.ts",
    outDir: "./public/dist", // build prod
    devPort: 5173, // port Vite dev (proxy-mode)
    integrate: true, // true = middleware dans @nodefony/http | false = proxy externe
    vite: {
      /* options Vite custom */
    },
  },
};
```

**Lifecycle** :

- **Dev** (`npx nodefony development`) : kernel boot → `@nodefony/frontend` lit `module.options.frontend` pour chaque module → ViteBuilder en mode `middleware` → injecte dans `@nodefony/http` → HMR live via WS
- **Prod** (`npx nodefony build`) : ViteBuilder build → `dist/public/<module-name>/` → `@nodefony/http` sert en static
- **Hybrid mode** : `integrate: false` → Vite tourne en parallèle (port 5173), `@nodefony/http` proxy `/`→Vite en dev, static en prod

### 14.3 Tâches Phase 14

| #      | Tâche                                                                          | Effort | Dépendances         | Notes                                                           |
| ------ | ------------------------------------------------------------------------------ | ------ | ------------------- | --------------------------------------------------------------- |
| P14.1  | Décision Vite vs Webpack pour 2026 + interfaces `IFrontBuilder`/`IFrontPreset` | 1 ses. | —                   | Vite par défaut. Webpack uniquement si demande legacy explicite |
| P14.2  | `ViteBuilder` + preset `vue3-vite`                                             | 2 ses. | P14.1               | Couvre 80% du cas d'usage immédiat (Studio)                     |
| P14.3  | Preset `react19-vite`                                                          | 1 ses. | P14.2               | 2ème preset prioritaire                                         |
| P14.4  | `DevServerMiddleware` — intégration Vite dans `@nodefony/http`                 | 2 ses. | P14.2, P1 (Context) | Mode `integrate: true` — Vite middleware dans pipeline HTTP     |
| P14.5  | `StaticMiddleware` — serve build prod via `@nodefony/http`                     | 1 ses. | P14.2               | Mode prod, hash-cached assets                                   |
| P14.6  | Multi-module frontend — N modules avec frontend dans la même app               | 1 ses. | P14.4               | Routes prefix par module, isolation HMR                         |
| P14.7  | Commands CLI : `frontend:create/build/dev`                                     | 1 ses. | P14.2, P11.1        | Skeletons Vue/React, génère config + dépendances                |
| P14.8  | Tests intégration build Vue 3 + React 19                                       | 1 ses. | P14.3               | Vérifier output ESM hashed + sourcemaps                         |
| P14.9  | Presets optionnels Svelte 5 + Solid                                            | 1 ses. | P14.3               | Différable                                                      |
| P14.10 | Migration Studio pour utiliser `@nodefony/frontend`                            | 1 ses. | P14.4, P10.7        | Studio = 1er consommateur prod du module                        |

**Effort total Phase 14 : ~12 sessions**.

### 14.4 Décisions stratégiques

1. **Vite par défaut, Webpack uniquement sur demande** : standard 2026, perf imbattable, ESM natif.
2. **Pas de bundler propriétaire** : ne pas réinventer Vite. Wrapper minimal.
3. **Module frontend ≠ module backend** — un même `@nodefony/<module>` peut avoir les deux côtés cohabiter (`nodefony/` backend + `frontend/` UI).
4. **Studio = 1er consommateur prod** — son frontend (P10.7) utilisera Vite + Vue 3 (ou React 19, décision P10.1) via `@nodefony/frontend`.
5. **HMR via WS** : profite du WebSocket natif `@nodefony/http` — Vite HMR injecté directement, pas de port séparé en mode `integrate: true`.

### 14.5 ⚠️ MAJ 2026-05-16 — `@nodefony/frontend` + Core isomorphe (ex-`@nodefony/client`)

> **Refonte** : `@nodefony/client` SUPPRIMÉ comme module séparé. Voir mémoire `project_decisions_realtime_isomorphic.md`.

| Module                     | Rôle                                                                                                                                     | Quand l'utiliser                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@nodefony/frontend` (P14) | **Builder + dev server Vite** — transpile/bundle les frontends des modules (Vue/React/Svelte)                                            | Quand un module a un frontend à compiler                                                        |
| Core isomorphe (P14.11)    | **Container DI + Syslog + Service + EventEmitter** exportés côté browser via `package.json.exports.browser`                              | Importé DANS le code Vue/React/Svelte des modules via alias automatique du plugin Vite Nodefony |
| Protocole RT (P13.7)       | **JSON-RPC 2.0 maison** — RPC bidirectionnel + types partagés `ServerToClientEvents`/`ClientToServerEvents` + HTTP long-polling fallback | Pour temps réel symbiose Socket.IO-like                                                         |

**Exemple Studio** : utilise `@nodefony/frontend` pour bundler son Vue 3, importe le Core isomorphe (Container + Syslog) pour structurer le code front exactement comme le back, consomme P13.7 pour les events temps réel typés vers backend.

---

## Phase 13 — Realtime + Redis cluster + Client navigateur

> **Trois sous-phases qui peuvent s'exécuter en parallèle d'autres phases selon leurs dépendances.**
> Référence JS : `realtime-bundle` (689 L `realTimeService` + sockets TCP/UDP/Unix) + `redis-bundle` (166 L `redisService`) — `/Users/cci/repository/nodefony/src/nodefony/bundles/{realtime,redis}-bundle/`.

### 13.1 `@nodefony/realtime` (nouveau module — sockets bas niveau)

> **Périmètre** : serveurs TCP / UDP / Unix domain sockets — protocoles bas niveau pour use cases IoT, télémétrie, ingestion devices, protocoles binaires internes.
> **Le WebSocket reste dans `@nodefony/http`** — pas de duplication. `realtime` complète avec les transports non-WS.

| Fichier TS cible                                       | Source JS référence                                   | Statut | Complexité | Notes                                                               |
| ------------------------------------------------------ | ----------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------- |
| `@nodefony/realtime/interfaces/IRealtimeServer.ts`     | N/A                                                   | ⬜     | 1          | Contract : `start/stop/onConnection/broadcast`                      |
| `@nodefony/realtime/interfaces/IRealtimeConnection.ts` | `realtime-bundle/src/connections.js`                  | ⬜     | 1          | Connection abstraite avec id, type, send, close                     |
| `@nodefony/realtime/src/TcpServer.ts`                  | `realtime-bundle/src/tcpSocket.js` (65 L)             | ⬜     | 2          | `node:net` — listen, connections Map, broadcast                     |
| `@nodefony/realtime/src/UdpServer.ts`                  | `realtime-bundle/src/udpSocket.js` (84 L)             | ⬜     | 2          | `node:dgram` — udp4/udp6, multicast support                         |
| `@nodefony/realtime/src/UnixServer.ts`                 | `realtime-bundle/src/unixSocket.js` (stub)            | ⬜     | 2          | `node:net` Unix socket — IPC local                                  |
| `@nodefony/realtime/service/realtime-service.ts`       | `realtime-bundle/services/realTimeService.js` (689 L) | ⬜     | 3          | Orchestrateur : sélection protocole, lifecycle kernel               |
| `@nodefony/realtime/src/ConnectionRegistry.ts`         | `realtime-bundle/src/connections.js`                  | ⬜     | 2          | `Map<id, IRealtimeConnection>` cross-protocol                       |
| `@nodefony/realtime/src/codecs/`                       | N/A                                                   | ⬜     | 2          | Codecs pluggables : raw, line-delimited, length-prefix, MessagePack |
| `@nodefony/realtime/nodefony/config/config.ts`         | `realtime-bundle/Resources/config/`                   | ⬜     | 1          | Ports, hosts, codecs par défaut                                     |
| `@nodefony/realtime/tests/integration/tcp.test.ts`     | N/A                                                   | ⬜     | 2          | Client TCP local → server, broadcast, disconnect                    |
| `@nodefony/realtime/tests/integration/udp.test.ts`     | N/A                                                   | ⬜     | 2          | Send/receive datagrammes, multicast                                 |
| `@nodefony/realtime/tests/integration/unix.test.ts`    | N/A                                                   | ⬜     | 1          | Socket file `/tmp/nodefony.sock`                                    |
| `@nodefony/realtime/index.ts`                          | N/A                                                   | ⬜     | 1          | Barrel                                                              |

**Cas d'usage** :

- IoT : devices envoient télémétrie via TCP/UDP → server pousse en Studio
- Microservices internes : IPC via Unix socket (plus rapide que HTTP loopback)
- Protocoles métier binaires (industrial, finance, gaming)

### 13.2 `@nodefony/redis` (refactor — cluster + pub/sub critique)

> **État actuel** : module existe (`src/packages/@nodefony/redis/`) mais minimal.
> **Refactor** : connection cluster + pub/sub + storage drivers (cache, session) + distributed lock.
> **Bloquant** : P5.12 (`RedisSessionStorage`) en dépend.

| Fichier TS cible                                   | Source JS référence                     | Statut | Complexité | Notes                                                         |
| -------------------------------------------------- | --------------------------------------- | ------ | ---------- | ------------------------------------------------------------- |
| `@nodefony/redis/interfaces/IRedisClient.ts`       | `redis-bundle/services/redisService.js` | ⬜     | 1          | Contract : `get/set/del/expire/ttl/keys/scan`                 |
| `@nodefony/redis/interfaces/IRedisPubSub.ts`       | N/A                                     | ⬜     | 2          | `publish/subscribe/unsubscribe/pSubscribe`                    |
| `@nodefony/redis/interfaces/IRedisCluster.ts`      | N/A                                     | ⬜     | 2          | `nodes/slots/failover` — mode Cluster                         |
| `@nodefony/redis/service/redis.ts`                 | `redisService.js` (166 L)               | 🔶     | 2          | Refactor — `node-redis@4` ou `ioredis` (décider)              |
| `@nodefony/redis/service/redis-pubsub.ts`          | N/A (nouveau)                           | ⬜     | 2          | **CRITIQUE** : publish/subscribe pour clusters + Studio WS    |
| `@nodefony/redis/service/redis-cluster.ts`         | N/A (nouveau)                           | ⬜     | 3          | Mode Cluster (sharding) + Sentinel (HA)                       |
| `@nodefony/redis/src/RedisCache.ts`                | N/A                                     | ⬜     | 2          | Cache générique avec TTL — consommé par services Nodefony     |
| `@nodefony/redis/src/RedisLock.ts`                 | N/A                                     | ⬜     | 2          | Distributed lock (Redlock pattern) — anti double-trigger jobs |
| `@nodefony/redis/src/RedisSessionStorage.ts`       | N/A                                     | ⬜     | 2          | **Implémente `ISessionStorage`** — débloque P5.12             |
| `@nodefony/redis/tests/integration/redis.test.ts`  | N/A                                     | ⬜     | 2          | redis-memory-server, CRUD + TTL + scan                        |
| `@nodefony/redis/tests/integration/pubsub.test.ts` | N/A                                     | ⬜     | 2          | Pub/Sub local, channels, pattern subscribe                    |
| `@nodefony/redis/tests/integration/lock.test.ts`   | N/A                                     | ⬜     | 2          | Concurrence lock + expiration                                 |
| `@nodefony/redis/index.ts`                         | actuel                                  | 🔶     | 1          | Barrel à compléter                                            |

**Décision client Redis** : `node-redis@4` (officiel Redis Labs, TS natif) vs `ioredis` (legacy, cluster support mature). À figer début Phase 13.2.

**Use cases pub/sub** :

- Cluster Nodefony multi-instance : sync state (broadcast Studio update à toutes les instances)
- Notifications cross-process : un worker Nodefony notifie les autres
- WS broadcast scalable : pub à Redis → toutes instances Nodefony forward aux WS clients

### 13.3 ⚠️ OBSOLÈTE 2026-05-16 — `@nodefony/client` ABANDONNÉ → Core isomorphe P14.11

> **REFONTE** : `@nodefony/client` n'est PLUS un module séparé. Le **Core Nodefony (Container/Syslog/Service)** devient isomorphe (back + front) — voir tâche **P14.11** dans la roadmap priorisée.
>
> La table ci-dessous est conservée comme **référence historique du périmètre fonctionnel** (HTTP/WS/auth/streaming clients), à redistribuer entre :
>
> - `@nodefony/http` (déjà migré) — HTTP/WS côté serveur, types partageables côté client via build conditionnel
> - **P14.11** Core isomorphe — Container, Syslog, Service, EventEmitter exportés côté browser
> - **P13.7** — Protocole JSON-RPC 2.0 maison (RPC bidirectionnel, types `ServerToClientEvents`/`ClientToServerEvents` partagés)
>
> Voir mémoire IA `project_decisions_realtime_isomorphic.md` pour la décision et les raisons.

| Fichier TS cible                                    | Rôle                                                                      | Statut | Complexité | Notes                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------- |
| `@nodefony/client/src/NodefonyClient.ts`            | Entry point — initialize avec `baseUrl`, `token?`, `wsUrl?`               | ⬜     | 2          | Singleton optionnel, configurable                             |
| `@nodefony/client/src/http/HttpClient.ts`           | Fetch wrapper avec auth, CSRF, propagation X-Request-Id                   | ⬜     | 2          | Typed via interfaces partagées                                |
| `@nodefony/client/src/ws/WebSocketClient.ts`        | WS avec reconnect auto, protocol negotiation, requestId trace             | ⬜     | 3          | Backoff exponentiel, queue messages offline                   |
| `@nodefony/client/src/ws/StreamClient.ts`           | Lecture AsyncIterable de tokens LLM streamés (consomme `@nodefony/agent`) | ⬜     | 2          | Pour Studio panels LLM + apps consommatrices                  |
| `@nodefony/client/src/auth/AuthClient.ts`           | login/logout/refresh, stockage token (cookie httpOnly via API)            | ⬜     | 2          | Pas de token en localStorage                                  |
| `@nodefony/client/src/auth/CsrfClient.ts`           | Double-submit cookie pattern côté browser                                 | ⬜     | 1          | Consomme `@nodefony/security/csrf`                            |
| `@nodefony/client/src/typed/` (DTO partagés)        | Types TS partagés client↔server (via npm workspaces ou monorepo path)     | ⬜     | 2          | Lien direct vers `@nodefony/{http,framework,user}` interfaces |
| `@nodefony/client/rollup.config.ts`                 | Build ESM + UMD + CDN bundle (browser-ready)                              | ⬜     | 2          | Sortie multi-format pour usage non-bundler                    |
| `@nodefony/client/tests/integration/client.test.ts` | Playwright/jsdom — server Nodefony local + client browser headless        | ⬜     | 3          | HTTP + WS round-trip + auth flow                              |
| `@nodefony/client/index.ts`                         | Exports publics                                                           | ⬜     | 1          | Barrel                                                        |

**Décisions** :

- **Pas de framework UI** dans `@nodefony/client` (pas de Vue/React) — c'est une lib bas niveau utilisable depuis n'importe quel framework UI.
- **TypeScript shared types** : créer `@nodefony/contracts` (nouveau, micro-package types-only) si besoin pour éviter circular dep avec http/framework. À évaluer début P13.3.
- **Bundle browser** : ESM (moderne), UMD (legacy), CDN minified (script tag direct). Rollup multi-output.
- **Pas de polyfill** : ES2022 target, WebSocket/fetch natifs (no socket.io).

**Use cases** :

- Studio frontend (Vue/React) consomme `@nodefony/client` directement
- Apps utilisateur Nodefony (SPA hébergées par le framework)
- Apps tierces qui veulent intégrer Nodefony (script tag CDN)
- Apps mobile via WebView (Vue Native / Capacitor)

### 13.4 Synthèse Phase 13

| Bloc      | Sessions estimées | Description                                    |
| --------- | ----------------- | ---------------------------------------------- |
| P13.1     | ~7                | `@nodefony/realtime` (TCP/UDP/Unix sockets)    |
| P13.2     | ~8                | `@nodefony/redis` refactor (cluster + pub/sub) |
| P13.3     | ~9                | `@nodefony/client` (lib navigateur)            |
| **TOTAL** | **~24**           |                                                |

**Ordre recommandé** :

1. **P13.2 prioritaire** (Redis) — bloque P5.12 (RedisSessionStorage) et apps prod cluster.
2. **P13.3 en parallèle ou avant P10.7** (Studio frontend bootstrap) — Studio en dépend.
3. **P13.1 en dernier** (Realtime) — indépendant, peut venir à n'importe quel moment après P1.

---

## Phase 12 — Couche IA agentic (DERNIÈRE phase de migration)

> **Démarrage uniquement après P10 (Studio MVP) validée.**
> Les modules existants (`llm`, `vector`, `rag`, `memory`, `agent`) ont été créés pendant la première phase exploratoire — ils sont **incomplets, non figés**, et doivent être audités/refondus pour s'intégrer proprement à la nouvelle architecture framework (multi-ORM, security, Studio, ALS requestId, logs structurés).
> **Vision IA — source unique** : [`docs/ia/livre-blanc-couche-ia.md`](docs/ia/livre-blanc-couche-ia.md) (mission, cas d'usage, capacités, gouvernance/AI Act, décisions, feuille de route). Décision inférence : [`docs/adr/0004-inference-llm-backend-supervise.md`](docs/adr/0004-inference-llm-backend-supervise.md). Les anciens docs racine (`VISION_IA.md`, `CLAUDE_IA.md`, `IA_STATUS.md`, `VISION.md`, `PLAN_AGENTIC.md`, `CONTINUE_WITH_CLAUDE_CODE.md`) ont été consolidés puis supprimés le 2026-05-29.

### 12.1 Audit + refonte des 4 modules existants

> Aucun de ces modules n'a été conçu en prenant en compte : multi-ORM (P5/P7), `@nodefony/security` (P6), `IUser` (P5.5), Studio admin (P10), `AsyncLocalStorage requestId` (P1.4), logs structurés (P3).
> Audit complet avant de continuer.

| Module             | État actuel TS        | Refonte nécessaire                                                                                                                                                                                               |
| ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nodefony/llm`    | 10 fichiers, build ✅ | (a) Standardiser `ILLMProvider` (interface stable), (b) ajouter providers manquants (Mistral souverain, Groq), (c) intégrer ALS requestId dans logs LLM calls, (d) cost reporting hook (utilisé par agent-guard) |
| `@nodefony/vector` | 7 fichiers            | (a) Adapter pgvector **via `@nodefony/orm-core` + Drizzle** (pas client direct), (b) Qdrant via fetch natif, (c) Chroma local dev, (d) `IVectorStore` interface stable                                           |
| `@nodefony/rag`    | 7 fichiers            | (a) Pipeline ingestion async streamable, (b) chunking pluggable, (c) embedding via `ILLMProvider.embed`, (d) recherche multi-vector-store, (e) traçabilité sources (RAG citation)                                |
| `@nodefony/memory` | 6 fichiers            | (a) `IMemoryService` standardisé, (b) court/long/épisodique via stratégies, (c) storage via orm-core (table `agent_memory_*`)                                                                                    |

| #       | Tâche                                                              | Effort | Dépendances       | Notes                                                 |
| ------- | ------------------------------------------------------------------ | ------ | ----------------- | ----------------------------------------------------- |
| P12.1.1 | Audit `@nodefony/llm` — refonte interface stable + tests           | 2 ses. | P10 ✅            | Locker `ILLMProvider` shape — base de tout le reste   |
| P12.1.2 | `@nodefony/llm` — ajouter providers Mistral (EU souverain) + Groq  | 1 ses. | P12.1.1           | Mistral pour conformité AI Act (LLM EU)               |
| P12.1.3 | Audit `@nodefony/vector` — adapter pgvector via orm-core + Drizzle | 2 ses. | P7.4 ✅ (Drizzle) | Bascule de client SQL direct → ORM. Tests cross-store |
| P12.1.4 | Audit `@nodefony/rag` — pipeline + sources citation                | 2 ses. | P12.1.1, P12.1.3  | Conformité AI Act = traçabilité sources               |
| P12.1.5 | Audit `@nodefony/memory` — storage orm-core + stratégies           | 2 ses. | P12.1.4           |                                                       |

### 12.2 Finalisation `@nodefony/agent` (orchestrateur)

> Existant 🔶 — manque `AgentOrchestrator`, decorators `@Agent`/`@Tool`, tests.

| #       | Tâche                                                            | Effort | Dépendances | Notes                                                            |
| ------- | ---------------------------------------------------------------- | ------ | ----------- | ---------------------------------------------------------------- |
| P12.2.1 | `@Agent({ permissions, limits })` decorator + métadonnées        | 1 ses. | P12.1.1     | Métadonnées Reflect, contract IAgent                             |
| P12.2.2 | `@Tool({ inputSchema, outputRules })` decorator + ToolRegistry   | 1 ses. | P12.2.1     | Zod inputSchema pour validation runtime                          |
| P12.2.3 | `AgentOrchestrator.run()` — boucle agentic LLM ↔ tool calls      | 2 ses. | P12.2.2     | `maxIterations` (10 par défaut), `AgentMaxIterationsError`       |
| P12.2.4 | `AgentOrchestrator.stream()` — AsyncGenerator avec events        | 1 ses. | P12.2.3     | events: `started/thinking/tool_call/tool_result/token/completed` |
| P12.2.5 | `abort(sessionId)` + `shutdown()` — cleanup AbortController/Maps | 1 ses. | P12.2.4     | Map<sessionId, AbortController>                                  |
| P12.2.6 | Tests integration AgentOrchestrator (loop, abort, timeout)       | 1 ses. | P12.2.5     |                                                                  |

### 12.3 `@nodefony/mcp` — Model Context Protocol (Anthropic standard)

> Vide actuellement. Crée à partir de zéro.

| #       | Tâche                                                                     | Effort   | Dépendances      | Notes                                                           |
| ------- | ------------------------------------------------------------------------- | -------- | ---------------- | --------------------------------------------------------------- |
| P12.3.1 | `MCPProtocol.ts` — JSON-RPC 2.0 types + codes erreur                      | 0.5 ses. | —                | -32700 parse, -32600 invalid req, -32601 method not found, etc. |
| P12.3.2 | `MCPServer.ts` — handleRequest() + méthodes initialize/tools/resources    | 2 ses.   | P12.3.1, P12.2.2 | Expose tools Nodefony à Claude Desktop / Cursor / VS Code       |
| P12.3.3 | `MCPClient.ts` — Nodefony consomme des MCP servers externes               | 2 ses.   | P12.3.1          | Pour étendre les agents avec des tools externes                 |
| P12.3.4 | Validation strict noms tools (`/^[a-z][a-z0-9_]*$/`) + limites (256/1024) | 0.5 ses. | P12.3.2          |                                                                 |
| P12.3.5 | Tests MCPServer + MCPClient (JSON-RPC compliance, edge cases)             | 1 ses.   | P12.3.3          |                                                                 |

### 12.4 `@nodefony/agent-guard` — Gouvernance + conformité AI Act (DIFFÉRENCIATEUR)

> Vide actuellement. **C'est le module qui distingue Nodefony de NestJS+LangChain**. Conformité AI Act dès la conception.

| #        | Tâche                                                                         | Effort | Dépendances               | Notes                                           |
| -------- | ----------------------------------------------------------------------------- | ------ | ------------------------- | ----------------------------------------------- |
| P12.4.1  | Interfaces + decorators `@Agent/@AgentZone("sensitive")/@Tool`                | 1 ses. | P12.2.2                   | 4 zones : public/sensitive/restricted/forbidden |
| P12.4.2  | `ZoneResolverService` + `PermissionCheckerService` + `AgentRegistryService`   | 2 ses. | P12.4.1, P6 ✅ (security) | Default deny si aucune zone match               |
| P12.4.3  | `PIIMaskingService` — patterns FR (NIR, IBAN, CB, tel, email, SIRET) + custom | 1 ses. | —                         | Conformité RGPD + AI Act                        |
| P12.4.4  | `AuditService` — entités MikroORM→orm-core + audit trail signé                | 2 ses. | P12.4.3, P7 ✅            | Conformité AI Act : audit signé, immuable       |
| P12.4.5  | `CostTrackerService` — UPSERT par agent+date (1 ligne/jour)                   | 1 ses. | P12.4.4, P12.1.1          | Consommé par Studio panels (P12.5)              |
| P12.4.6  | `CircuitBreakerService` — closed → open → half-open + cooldown                | 1 ses. | P12.4.4                   |                                                 |
| P12.4.7  | `ApprovalService` — Promise en attente débloquée via WS Nodefony              | 2 ses. | P12.4.6                   | Humain dans la boucle pour zones `restricted`   |
| P12.4.8  | `OutputValidatorService` — règles de sortie par tool                          | 1 ses. | P12.4.7                   |                                                 |
| P12.4.9  | `AgentGuardMiddleware` — wire Orchestrator → checks → audit                   | 1 ses. | P12.4.8                   | Intercept toutes les LLM/tool calls             |
| P12.4.10 | Tests intégration agent-guard (zones, PII, circuit breaker, approval)         | 2 ses. | P12.4.9                   |                                                 |

### 12.5 Panels IA intégrés dans `@nodefony/studio` (ex-`@nodefony/studio`)

> **Décision** : `studio` n'est PAS un module séparé. Ses panels (agents, costs, audit, approvals) sont intégrés à `@nodefony/studio` via le pattern `IAdminApi` (cohérence avec autres panels Studio).

| #       | Tâche                                                              | Effort   | Dépendances     | Notes                                   |
| ------- | ------------------------------------------------------------------ | -------- | --------------- | --------------------------------------- |
| P12.5.1 | `IAdminApi` pour `@nodefony/agent-guard` (audit, costs, approvals) | 1 ses.   | P12.4.10, P10.4 | Endpoints `/nodefony/agent-guard/api/*` |
| P12.5.2 | Vues Studio : Agents (registry + état), Costs (UPSERT par jour)    | 2 ses.   | P12.5.1         |                                         |
| P12.5.3 | Vues Studio : Audit trail (search + filter), PII patterns config   | 1.5 ses. | P12.5.2         |                                         |
| P12.5.4 | Vue Studio : Approvals (queue WS realtime → approve/reject)        | 1.5 ses. | P12.5.3         | Critique pour humain dans la boucle     |

### 12.6 Tests cross-module IA + conformité AI Act

| #       | Tâche                                                                                   | Effort | Dépendances       | Notes                                        |
| ------- | --------------------------------------------------------------------------------------- | ------ | ----------------- | -------------------------------------------- |
| P12.6.1 | Test E2E RAG : ingest PDF → chunking → embed → vector store → query → réponse + sources | 1 ses. | P12.1.5           | Conformité AI Act traçabilité                |
| P12.6.2 | Test E2E agent loop : LLM → tool → re-LLM → end_turn (avec abort)                       | 1 ses. | P12.2.6           |                                              |
| P12.6.3 | Test E2E MCP server : Claude Desktop consomme un tool Nodefony                          | 1 ses. | P12.3.5           |                                              |
| P12.6.4 | Test E2E gouvernance : zone restricted → PII mask → audit → approval                    | 2 ses. | P12.4.10, P12.5.4 |                                              |
| P12.6.5 | Test E2E mode souverain : Ollama + pgvector + air gap                                   | 1 ses. | P12.1.5           | Aucune API externe ne doit être appelée      |
| P12.6.6 | Documentation conformité AI Act (audit trail, sources, contrôle humain)                 | 1 ses. | P12.6.5           | Article 50+ AI Act — preuves opérationnelles |

### 12.7 Synthèse Phase 12

| Bloc      | Sessions estimées | Description                               |
| --------- | ----------------- | ----------------------------------------- |
| P12.1     | ~9                | Audit + refonte 4 modules existants       |
| P12.2     | ~7                | Finalisation `@nodefony/agent`            |
| P12.3     | ~6                | `@nodefony/mcp` (server + client)         |
| P12.4     | ~14               | `@nodefony/agent-guard` (différenciateur) |
| P12.5     | ~6                | Panels IA dans Studio                     |
| P12.6     | ~7                | Tests E2E + conformité                    |
| **TOTAL** | **~49 sessions**  | Couche IA complète                        |

**Chemin critique IA** (MVP IA agentic minimal, sans agent-guard complet) :

```
P12.1.1-P12.1.5 (9)  → P12.2.1-P12.2.6 (7)  ← LLM stable + agent orchestrator
                     → P12.3.1-P12.3.5 (6)  ← MCP server (interop écosystème)
                     → P12.4.1-P12.4.4 (6)  ← agent-guard zones/PII/audit minimal
                     → P12.5.1-P12.5.2 (3)  ← Studio panels agents/costs
                                            = ~31 sessions vers MVP IA souverain agentic
```

Le reste (circuit breaker, approval, conformité AI Act docs) peut être livré après mais avant tout usage production réglementé.

### 12.8 Décisions stratégiques IA

1. **`@nodefony/studio` ≡ panels Studio** — pas un module séparé. Cohérence avec autres panels admin.
2. **Vector pgvector via orm-core + Drizzle** — pas de client SQL direct. Bénéfice multi-DB.
3. **Mistral providers prioritaire** — conformité AI Act EU.
4. **MCP avant agent-guard** — débloque l'écosystème Claude Desktop/Cursor immédiatement.
5. **Audit trail signé** — colonne `signature` + clé app (HMAC-SHA256). Immuable en DB.
6. **Storage IA via orm-core** — entités agent-guard et memory dans la même DB que l'app (cohérence transactions).

---
