# MIGRATION_STATUS.md — Tableau de bord

> **Mis à jour : 2026-06-05** (resync + assaini sur audit code — cf [`docs/migration/AUDIT-verite-2026-06.md`](docs/migration/AUDIT-verite-2026-06.md)).
> Légende : ✅ Migré | 🔶 Partiel | ⬜ À faire | 🚫 Bloqué | ⏭️ Skip/Caduc
>
> **Règle de tenue (CONVENTION) :** statut en **TÊTE de la 1ʳᵉ cellule** (`| ✅ P5.2 | …`), **1 ligne courte**
> par tâche. Le « comment » détaillé (pavés, hashes, gotchas) va dans `docs/migration/`, une mémoire IA ou le
> commit — **JAMAIS** dans la cellule (sinon scroll horizontal + fichier illisible, cf l'obésité corrigée le
> 2026-06-05 : 278 KB → ce fichier). Le bandeau « Avancement » se recalcule depuis ces marques.

---

## 🎯 Décisions stratégiques (le « pourquoi » vit en mémoire IA)

Les décisions complètes sont **persistées en mémoire IA** (survivent au `/clear`). Pointeurs :

- `project_decisions_p5_p6_orm` — Sécurité + ORM + IUser · `project_decisions_realtime_isomorphic` — Realtime + Core isomorphe + Mediasoup
- `project_orm_hardening_kit` — **virage ORM** (graine) · `project_orm_audit_state` — **audit ORM + plan** (boussole terrain) · `project_hardening_before_p6` — durcir avant P6 · `project_api_souveraine_poc` — API souveraine

### ⚡ Séquencement actuel (figé 2026-06-05)

**Config (`defineConfig`) ✅ CLOS** → **🥇 durcissement ORM** → (Realtime reste S1) → **POC API souveraine** → **P6 Security**.
Boussole : durcir les fondations (orm, realtime, core, http, framework) AVANT P6 — P6 se greffe dessus.

### 🔀 Virage ORM (décidé 2026-06-02) — ✅ audit 2026-06-08 · ✅ **Ph.1 Seq OUT** (`716fce6`) · ✅ **Ph.2 Mongoose REFAIT 2026-06-08** (`51d9ea8`)

- 📋 **Audit complet** : [`docs/audits/orm-state-and-hardening-2026-06.md`](docs/audits/orm-state-and-hardening-2026-06.md) + mémoire `project_orm_audit_state`. **Plan 5 phases** : **Ph.1 Seq OUT ✅** ∥ **Ph.2 Mongoose REFAIT ✅** → **Ph.3 kernel/orm OUT** (débloquée : plus aucun `service/orm.ts` legacy) → Ph.4 couplage (C2/C5) → API souveraine → P6.
- ✅ **Sequelize SUPPRIMÉ (Ph.1, `716fce6`)** : package + tous consommateurs + tests + ~2820 L de `package-lock` + mentions code/docs vivantes (0 résidu). Gates vertes (build 19/19, core 1559, http 436, fw 190, mémoire 9/9). Lignes P5.7/P7.1/P7.3 → **caduques**.
- ✅ **Mongoose REFAIT (Ph.2)** : `MongooseService extends Service` (boote un `MongooseOrm`/connecteur au `onBoot`, plus `extends Orm` core) + `SessionStorage` portable (logique = Drizzle, timestamps ms, GC `$lt`) + 4 sondes Studio (`describeEntity` ✅P5.4 / **`describeConnection`** + **flow tap** `MongooseRepository`→`queryFlowMonitor` ajoutés / `ping` ✅) + `registerMongooseAdapter` (erreurs) + data plane câblé côté module (C5 atténuée). Legacy `service/orm.ts` supprimé. **17 tests verts** (banc orm-core ReplSet + session hybride `MONGO_TEST_URI`). → **P7.2/P7.5 ✅**. **Reste P5.8** (adapter Mongoose _User_, hors Ph.2).
- **Orm core `src/nodefony/src/kernel/orm/{Orm,Connector,Entity}` → à RETIRER (Ph.3, débloquée)** (3 fichiers, 254 L + export `index.ts:226`). ⚠️ **Piège homonyme** : c'est le LEGACY du workspace `nodefony`, **PAS** `@nodefony/orm-core` (socle moderne validé ADR-0003, à **GARDER**). Plus AUCUN consommateur vivant (Seq+Mongoose `service/orm.ts` supprimés) → vérifier 0 import avant de couper.
- **Dette C5** (audit) : montage data plane ORM + sondes santé étaient **déclenchés par le seul module Drizzle** → **atténué (Ph.2)** : le module Mongoose câble aussi (`registerOrmAdminApi`/health/rich providers, GLOBAUX) → app Mongoose-only n'est plus muette. Factorisation `wireOrmAdminPlane(kernel)` (1 seul appel/driver) = **Ph.4**.
- **MikroORM (P7.8/P7.9) = abandonné** (0 code, traces docs/types seulement). → ⏭️.
- ⭐ **Drizzle = référence** (`extends Service`, 100 % propre). **Migrations** (absentes) : déléguer `drizzle-kit` (versioned) + façade `IMigrator` Studio — hors chemin critique.

### 🔐 Sécurité (P6) — décisions figées 2026-05-20

Passport ❌ · Sessions HTTP RAM ❌ (JWT cookie `HttpOnly;Secure;SameSite` only) · pattern `IAuthenticator` (pas « Bridge ») ·
3 tokens core (Anonymous/UserPassword/Jwt) + 2 étendus (OAuth2 `arctic`/mTLS) · CSRF SameSite+Origin + `@CsrfProtect` opt-in ·
`defineSecurityConfig()` + Zod · Zero Trust (route sans décorateur → 403). `BcryptEncoder`/`UserService` vivent dans **@nodefony/user**.

### Autres (résumés — détail en mémoire)

- **User/IUser (P5.5)** : module séparé `@nodefony/user` (IUser strict + BaseUser POJO + encoders). `project_nodefony_user_module`.
- **Realtime + Core isomorphe** : P13.3 supprimée → Core devient isomorphe (intégré P14). Pattern `IRealtimeHub` + `RealtimeService` + JSON-RPC 2.0 maison.
- **P15 Mediasoup + SIP/Asterisk** : agent IA vocal PSTN (`PlainTransport` RTP, pas WebRTC navigateur). Après P12+P13.
- **P16 Cloud-Native** : 1 process = 1 pod ; healthz/readyz (http), SecretProvider (security), tini PID 1 ; PM2 retiré (C6). `project_cloud_native_plan`.
- **API souveraine (POC, après ORM)** : 1 service → N surfaces (REST+WS+GraphQL) via `ResourceController`. `docs/api/README.md`.

---

## 🛡️ Durcissement fondations (transverse — pas de lignes P dédiées)

| Couche                | État | Résumé (détail → mémoire `project_hardening_*`)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodefony` (core)     | ✅   | Kit C1→C6 clos (PM2 retiré, modes run `IRunProfile`, park, ménage boot −378 ms). `project_hardening_core_kit`                                                                                                                                                                                                                                                                                                                                                                                         |
| `@nodefony/http`      | ✅   | Kit H1→H6 + config Zod + domain matching + forwarded RFC 7239 COMPLET + banc proxy Docker E2E + **service certificates durci** (RFC 5280/6125, SHA-256, serial 128b, 0600, lazy node-forge, CLI `certificates`) + **banc TLS re-encrypt validé** (verify required/verifyhost/sni) + `proxy:generate` + **préfixe natif statique `/<module>/`** (`mountModulePublics`, configurable `publicMount`) + **`assets:publish`** (arbre CDN-ready provider-agnostic). `65f7e41`/`6ac8562`/`e735544`/`6918f89` |
| `@nodefony/framework` | ✅   | F1→F7 (sauf F6 résolu via dette CLI) ; 176 tests unit ; 0 dette. `project_hardening_framework_kit`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `@nodefony/realtime`  | 🔶   | **Déjà bien durci** : back-pressure WS, 0 dette, 14 tests, 5 seams sécu livrés. Reste S1 (mutualiser fan-out)                                                                                                                                                                                                                                                                                                                                                                                         |
| `@nodefony/orm-*`     | ⬜   | **🥇 PROCHAIN** — virage ORM ✅ **audité 2026-06-08** ([`docs/audits/orm-state-and-hardening-2026-06.md`](docs/audits/orm-state-and-hardening-2026-06.md), plan 5 phases) : Seq sort, Mongoose refait, kernel/orm legacy retiré, couplage C2/C5 nettoyé + footgun `counts` sync                                                                                                                                                                                                                       |

**Log Backplane** (`project_log_backplane_vision`) : axe WRITE (`LB.W`) ✅ + axe QUERY (`LB.0→LB.5`) ✅ — drivers
`memory`/`file`/`cluster-file`/`loki`/`opensearch` queryables, validés runtime cluster + Loki/OpenSearch réels.
Reste ⬜ **LB.3b** (CLI `syslog:filter`, dette dispatch CLI). Console Logs Studio = panneau P10 de facto livré.

> **DETTE-CFG (ordering config `module-<name>` ⊥ validation Zod) ✅ RÉSOLUE** : `Kernel.applyModuleConfigOverrides()`
> appliqué entre `onPreRegister` et `onPreBoot`. `project_config_ordering_chantier`.

---

## 📊 Avancement (vérifié code · **2026-06-05**)

> Comptage **autorité = emoji en 1ʳᵉ cellule** de la roadmap (1 ligne = 1 tâche). `◀` = chemin critique MVP.

```
━━━━━━ NODEFONY · MIGRATION ━━━━━━━━━━━━━━━━━━━ vérifié code 2026-06-05 ━━━━━━
 P0  Bugs bloquants        ██████████ 100%   6✅  0🔶  0⬜
 P1  Fondations symbiose   ██████████ 100%   8✅  0🔶  0⬜
 P2  Cycle de vie Context  █████████░  89%   8✅  0🔶  1⬜
 P3  Logs structurés       ███████░░░  73%   7✅  3🔶  1⬜
 P4  Tests symbiose        ██████████ 100%   6✅  0🔶  0⬜
 P5  Session/User/ORM core ██████░░░░  58%   9✅  3🔶  6⬜   ◀ (virage ORM : P5.7/P5.8 à recadrer)
 P6  Security              █░░░░░░░░░  12%   0✅  4🔶 13⬜   ◀ bloqueur MVP (0 test = 0 tâche close)
 P7  ORM drivers           █████░░░░░  50%   2✅  5🔶  2⬜   (% va bouger post-virage : sequelize/mikroorm sortent)
 P8  CLI + Monitoring      ██████░░░░  63%   2✅  1🔶  1⬜
 P9  Polish + clôture      ████░░░░░░  38%   1✅  1🔶  2⬜
 P10 Studio (admin web)    ███████░░░  65%   5✅  7🔶  1⬜   (workspace + Jumeau, maj 2026-06-06)
 P11 CLI par module        ███░░░░░░░  33%   1✅  2🔶  3⬜
 P12 Couche IA agentic     ██░░░░░░░░  17%   0✅  2🔶  4⬜   🧪 différé (squelettes brainstorming, non audité)
 P13 Realtime distribué    ████████░░  77%   7✅  3🔶  1⬜
 P14 Frontend Vite + iso   ████████░░  75%  11✅  2🔶  3⬜
 P15 Mediasoup + SIP       ░░░░░░░░░░   0%   0✅  0🔶  8⬜   (banc ORM `mod/mediasoup` ≠ implé P15)
 P16 Cloud-Native (8 axes) ███░░░░░░░  26%   8✅  1🔶 24⬜
────────────────────────────────────────────────────────────────────────
 GLOBAL                    █████░░░░░  51%  76✅ 35🔶 73⬜   (184 tâches)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> Fondations **hors roadmap** (déjà migrées, Phases 0-4) : Build, Core/Kernel, DI, Syslog, Router, Controller, Types.
> **Verdict audit 2026-06-05 : les chiffres sont honnêtes** (déclaré ≈ réel sur P0→P16). Les écarts sont de FORME
> (ex-obésité) + 1 virage ORM à répercuter + refs mortes nettoyées.

---

## 🗺️ Roadmap priorisée (dette technique d'abord)

> Spécifications détaillées : [`docs/migration/phases-details.md`](docs/migration/phases-details.md).

### P0 — Bugs bloquants ✅ (6/6)

Tous résolus : 11 fails RFC HTTP, 2 fails WS binary, `getController()` typé, **BUG-001→004** (propagation ALS WS,
leaks scope DI sur erreur/session WS). Tests preuve présents (`http-rfc-errors`, comptage scopes).

### P1 — Fondations symbiose ✅ (8/8)

`Context.phases`, `onAfterResponse`, `signal` (AbortSignal lazy), **`RequestContext` ALS** (requestId/user), `errorRenderer`
unifié HTTP+WS, `logRequest` pluggable, hooks security (`beforeResolve`/`afterAuth`/`onAuthFailure`), graphe symbolique `.ai/symbols.json`.

### P2 — Cycle de vie Context (89 %)

| #       | Tâche                                  | État                                                                                        |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| ✅ P2.1 | Boundary timing phase-by-phase         | via P1.1 (`Context.phases`, lazy)                                                           |
| ✅ P2.2 | Tear-down déterministe (finish+close)  | via P1.2 (dedup race)                                                                       |
| ✅ P2.3 | Aborted cleanup + 499 interne          | `client-abort-499.test.ts`                                                                  |
| ✅ P2.4 | `initialize()` error boundary          | crash → onError → 500 JSON cohérent                                                         |
| ✅ P2.5 | Request timeout (408/504)              | 2 couches (Node natif + `onTimeout` Nodefony)                                               |
| ⬜ P2.6 | Idempotency keys (`X-Idempotency-Key`) | dédup via ALS                                                                               |
| ✅ P2.7 | W3C `traceparent` honor + génère       | `service/trace.ts`                                                                          |
| ✅ P2.8 | Backpressure doc + tests streaming     | `write()===false` → attend `'drain'` (Node stream) ; CL⊥TE RFC 9112 §6.1 ; tests unit       |
| ✅ P2.9 | Body streaming (`@Body({stream})`)     | flux brut (`Readable`), parse sauté ; route-match avant parse (A/B 0 régression) ; HTTP/1+2 |

### P3 — Logs structurés (68 %)

| #        | Tâche                                    | État                                                                           |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| ✅ P3.1  | Audit log canonique (1 PDU JSON/req)     | `JsonAuditLogger`                                                              |
| ✅ P3.2  | Pretty formatter dev                     | `PrettyRequestLogger`                                                          |
| ✅ P3.3  | Severity selon HTTP status               | `severityFromStatus()`                                                         |
| ✅ P3.4  | Header redaction (Authz/Cookie)          | flags booléens, valeurs jamais loggées                                         |
| ✅ P3.5  | Erreur enrichie (cause chain + stack)    | `AuditErrorEntry` récursif                                                     |
| 🔶 P3.6  | Filtrage par requestId (CLI)             | `Pdu.requestId` livré ; reste le CLI tool (LB.3b)                              |
| ✅ P3.7  | Mode trace verbose (phase DEBUG)         | `logPhasesVerbose()` opt-in `timing.verbose`, perf-gate (0 coût off), teardown |
| 🔶 P3.8  | Rate limit logs par requestId            | anti-flood livré ; reste clé par requestId                                     |
| ✅ P3.9  | WS logs (handshake/close/error + wsId)   | per-message volontairement écarté (hot path)                                   |
| ⏭️ P3.10 | Transport NCSA/Combined dédié            | absorbé par P3.11 (driver `file`)                                              |
| 🔶 P3.11 | **Log Backplane** (write↔read pluggable) | LB.W+LB.0→LB.5+LB.4 ✅ ; reste LB.3b CLI. Cf durcissement                      |

### P4 — Tests symbiose ✅ (6/6)

`forward` cross-module, decorators × pipeline, **concurrence 100 req** (unicité ALS), WS pipeline (7 fichiers),
DI scopes (singleton/transient), lifecycle session.

### P5 — Session + User + ORM Core (58 %) ◀ chemin critique

| #        | Tâche                                       | État                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔶 P5.0  | Gate batch/console (`initServers` par type) | `isConsole()` + dispatch 0-serveur OK ; reste `BatchCommand`                                                                                                                                                                                                                                                                                                            |
| ⬜ P5.0b | Service Cron/Worker (worker dédié)          | décision : gardé, découplé serveur                                                                                                                                                                                                                                                                                                                                      |
| ✅ P5.1  | `@nodefony/orm-core` + interfaces           | `IOrm/IRepository/IEntity` + trappe SQL brut                                                                                                                                                                                                                                                                                                                            |
| ✅ P5.2  | `OrmRegistry`/`EntityRegistry` + base class | 15 tests                                                                                                                                                                                                                                                                                                                                                                |
| ✅ P5.3  | `@entity`/`@repository` decorators          | WeakMap, sans reflect-metadata                                                                                                                                                                                                                                                                                                                                          |
| ✅ P5.3b | `AbstractCrudService<T,R>`                  | socle CRUD générique (hooks template)                                                                                                                                                                                                                                                                                                                                   |
| ✅ P5.4  | Tests orm-core + adapter réel               | portabilité prouvée (orm-core 22 tests)                                                                                                                                                                                                                                                                                                                                 |
| ✅ P5.5a | Workspace `@nodefony/user`                  | lib pure, peerDeps                                                                                                                                                                                                                                                                                                                                                      |
| ✅ P5.5  | Contrats `IUser`/`BaseUser`/`IUserProvider` | 11 tests, split credential                                                                                                                                                                                                                                                                                                                                              |
| ✅ P5.6  | `UserService` + `BcryptEncoder`             | `@node-rs/bcrypt`, 32 tests                                                                                                                                                                                                                                                                                                                                             |
| ⏭️ P5.7  | ~~Adapter Sequelize User~~                  | **caduc (virage ORM : sequelize supprimé)**                                                                                                                                                                                                                                                                                                                             |
| 🔨 P5.8  | Adapter Mongoose User                       | **à faire** (service Mongoose refait Ph.2 ✅ ; reste le repo `User` Mongoose, modèle `DrizzleUserRepository`)                                                                                                                                                                                                                                                           |
| ✅ P5.9  | Adapter Drizzle User                        | ORM par défaut, 8 tests                                                                                                                                                                                                                                                                                                                                                 |
| ⬜ P5.10 | Tests User cross-ORM                        | (recadrer : Drizzle + Mongoose refait)                                                                                                                                                                                                                                                                                                                                  |
| ✅ P5.11 | **Refonte cœur + plug runtime session**     | TS strict, ID CSPRNG opaque, dirty-tracking, cookie-only, contrat `ISessionStorage` unifié ; **plug runtime** `@UseSession` opt-in + lazy + L1 + point unique HTTP/WS (tue le ×23) ; cookie RFC 6265bis `__Host-`/SameSite/None⇒Secure + `cookie.hostPrefix` ; `readOnly` + `absolute_timeout` (OWASP). Tests unit+intég+load+mémoire. (chantier session 2026-06-06/07) |
| 🔶 P5.12 | `Redis` SessionStorage                      | File + **Redis livrés** (TTL natif IoC) ; reste câblage prod                                                                                                                                                                                                                                                                                                            |
| ✅ P5.13 | `OrmSessionStorage` générique               | Drizzle + **Mongoose livrés** (contrat `ISessionStorage` portable ; sequelize supprimé)                                                                                                                                                                                                                                                                                 |
| ⬜ P5.14 | `session.user: IUser` + régén ID post-auth  | seam `regenerateId()` prêt ; câblage = P6 firewall                                                                                                                                                                                                                                                                                                                      |

### P6 — Security (12 %) ◀ bloqueur MVP

> Fondations **S1 présentes** mais **0 test committé** → aucune tâche close (✅=0). Pipeline auth + tests = ~88 % devant.

| #        | Tâche                                                  | État                                                          |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 🔶 P6.1  | `AccessControl` (RBAC walker)                          | `RoleHierarchyWalker.ts`                                      |
| ⬜ P6.2  | `cors.ts` service                                      | whitelist stricte                                             |
| 🔶 P6.3  | `firewall.ts` + `SecuredArea` + `defineSecurityConfig` | services + Zod présents ; reste pipeline auth + câblage       |
| 🔶 P6.4  | `AnonymousAuthenticator` + token                       | `AnonymousToken` livré ; authenticator à écrire               |
| ⬜ P6.5  | `UserPasswordAuthenticator`                            | utilise `userService.authenticate()`                          |
| ⬜ P6.6  | `JwtAuthenticator` + cookie layer (`jose`)             | rotation OWASP refresh                                        |
| ⬜ P6.7  | `csrf.ts` (SameSite+Origin + `@CsrfProtect`)           | service `csrf.ts` présent (stub à finaliser)                  |
| 🔶 P6.8  | `authorization.ts` (3 niveaux)                         | niveau A + contrat `IAccessVoter` ; RBAC ORM + voters à faire |
| ⬜ P6.8b | Décorateurs sécu panoplie (`@IsGranted`…)              | `Reflect.metadata` + hook `beforeResolve`                     |
| ⬜ P6.9  | `OAuth2Authenticator` (`arctic`)                       | 50+ providers config-driven                                   |
| ⬜ P6.9b | `MTlsAuthenticator`                                    | zones admin                                                   |
| ⬜ P6.10 | Logs auth + CSP stricte + headers                      | OWASP A05                                                     |
| ⬜ P6.11 | Tests intégration security complets                    | **0 test actuel** — débloque les ✅                           |
| ⬜ P6.12 | API Keys (PAT)                                         | entité orm-core hashée                                        |
| ⬜ P6.13 | Webhooks (HMAC sortant)                                | —                                                             |
| ⬜ P6.14 | Audit events + stream WS                               | base auditeur                                                 |
| ⬜ P6.15 | Studio — section Sécurité                              | consomme data plane P6.12-14                                  |

### P7 — ORM Drivers (≈80 % — virage ORM Ph.1+Ph.2 ✅)

| #       | Tâche                                  | État                                                                                  |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| ⏭️ P7.1 | ~~Sequelize (legacy)~~                 | **SUPPRESSION COMPLÈTE** (virage ORM, `716fce6`)                                      |
| ✅ P7.2 | Mongoose — adapter orm-core            | **refait (Ph.2)** : `MongooseService extends Service` + `describeConnection`/flow tap |
| ⏭️ P7.3 | ~~Tests intégration Sequelize~~        | caduc                                                                                 |
| ✅ P7.4 | ⭐ **`@nodefony/drizzle`** (référence) | `DrizzleOrm`/`DrizzleRepository`, 8 tests                                             |
| ✅ P7.5 | Tests Mongoose                         | 17 verts (orm-core ReplSet + session hybride `MONGO_TEST_URI`)                        |
| ✅ P7.6 | Tests Drizzle (SQLite/PG)              | banc orm-core 8 tests                                                                 |
| 🔶 P7.7 | `@nodefony/redis` refactor             | conventions/config Zod faites                                                         |
| ⏭️ P7.8 | ~~`@nodefony/mikroorm`~~               | **abandonné** (jamais commencé, module absent)                                        |
| ⏭️ P7.9 | ~~Tests MikroORM~~                     | caduc                                                                                 |

### P8 — CLI + Monitoring (63 %)

| #       | Tâche                        | État                                                                |
| ------- | ---------------------------- | ------------------------------------------------------------------- |
| ✅ P8.1 | `bin/nodefony.ts`            | banner rollup, CLI fonctionnel                                      |
| ⬜ P8.2 | Generators Module/Controller | **couvert par skills** (`nodefony-create-module`), pas commande CLI |
| ✅ P8.3 | `DebugBar` (monitoring)      | `src/nodefony/src/client/debugbar/`                                 |
| 🔶 P8.4 | `Metrics` runtime            | via Studio (canal `dashboard:stats`), pas service standalone        |

### P9 — Polish + clôture (38 %)

| #       | Tâche                         | État                                                              |
| ------- | ----------------------------- | ----------------------------------------------------------------- |
| ✅ P9.1 | `@entities` decorator + tests | `kernelDecorator.ts`                                              |
| ⬜ P9.2 | Barrels `index.ts`            | résiduel                                                          |
| 🔶 P9.3 | README publics                | security ✓ ; **http + framework absents**                         |
| ⬜ P9.4 | Vulnérabilités npm            | **10** (0 crit/3 high/6 mod/1 low, 2026-05-25 — à re-`npm audit`) |

### P10 — Studio admin web (65 %)

| #         | Tâche                                       | État                                                                                                                                                                          |
| --------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ P10.1  | Stack frontend (React 19) + Vite            | acté                                                                                                                                                                          |
| ✅ P10.2  | `IAdminApi` + `AdminBroker`                 | contrat figé, inversion de dép                                                                                                                                                |
| ✅ P10.3  | `IAdminApi` http/framework/syslog/frontend  | 5 producteurs, data plane `/nodefony/<m>/api/*`                                                                                                                               |
| 🔶 P10.4  | `IAdminApi` user/orm-core/security          | orm ✓ ; user/security en attente P5/P6                                                                                                                                        |
| 🔶 P10.5  | Backend Studio + WS realtime                | StudioController + JSON-RPC pub/sub ; reste IAdminApi                                                                                                                         |
| ⬜ P10.6  | Auth admin (`ROLE_NODEFONY_ADMIN`)          | dépend P6                                                                                                                                                                     |
| 🔶 P10.7  | Frontend bootstrap + router + layouts       | React 19 + Mantine + MobX + WS permanent ; reste auth réelle                                                                                                                  |
| 🔶 P10.8  | Vues prio (dashboard/routes/sessions/users) | Dashboard/Modules/Routes/Cluster/Runtime ✅ ; sessions/users attente P5/P6                                                                                                    |
| ✅ P10.x  | Docs+API modules dans Studio                | onglets Docs/API + carte Core                                                                                                                                                 |
| 🔶 P10.9  | Vues firewall/logs/databases/migrate        | Logs ✅ (WS) + Databases ✅ ; firewall/migrate attente                                                                                                                        |
| 🔶 P10.10 | Vues services/profiling                     | incrémental (~~pm2~~ retiré C6)                                                                                                                                               |
| 🔶 P10.11 | Tests intégration studio                    | —                                                                                                                                                                             |
| ✅ P10.12 | Workspace composable (bureau)               | fenêtres libres + espaces nommés + Mission Control + catalogue à facettes (taxonomie tags) + widgets supervision (mémoire/handles/erreurs/health/gc) ; remplace dashboard Dev |
| ✅ P10.13 | Jumeau vivant (Twin)                        | explorateur archi runtime + registre de blocs unifié + forages Realtime/ORM/HTTP                                                                                              |

### P11 — CLI par module (33 %)

| #        | Tâche                                                        | État                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔶 P11.1 | Tests intégration commandes existantes                       | filet spawn livré (`RUN_CLI_BOOT=1`) ; reste commandes métier                                                                                                                                                                                                                                                                                            |
| ⬜ P11.2 | Commandes `http:*`                                           | couplée API admin Studio                                                                                                                                                                                                                                                                                                                                 |
| ⬜ P11.3 | Commandes `framework:*`/`security:*`/`user:*`                | —                                                                                                                                                                                                                                                                                                                                                        |
| ⬜ P11.4 | Commandes `orm:migrate/…`                                    | délègue CLI ORM natifs (Drizzle/Mongoose)                                                                                                                                                                                                                                                                                                                |
| ⬜ P11.5 | Commandes `logs:tail/filter` + bridge Studio                 | LB.3b                                                                                                                                                                                                                                                                                                                                                    |
| ✅ P11.6 | Boot UX dev — BootReporter                                   | spinner/checklist dev-only + help modules + Vite checklist                                                                                                                                                                                                                                                                                               |
| ✅ P11.7 | Commande `proxy:generate nginx\|haproxy` (`6ac8562`)         | dérive la conf de l'introspection (statiques, domaines sans IP, ports) ; nginx résout le trou statics multi-modules (chaîne `try_files`) ; haproxy proxy + Forwarded + `--reencrypt` ; générateurs purs (12 tests)                                                                                                                                       |
| ✅ P11.8 | Préfixe natif statique + CDN (`e735544`/`29203c1`/`6918f89`) | `server-static.mountModulePublics` monte `public/` de chaque module sous `/<module>/` (configurable `publicMount`, défaut basename) ; `frontend.assetBaseUrl` + helper `asset()` préfixent les URLs prod (CDN) sans toucher au mount ; commande `assets:publish` assemble l'arbre `dist-assets/` (carte préfixe→dossier, provider-agnostic, 0 dep cloud) |

### P13 — Realtime distribué (77 %)

> **5 seams sécurité (P13.4a/4b/4c/7a/8a) tous ✅** → P6 se branchera sans refonte. Setup infra docker (Redis/Kafka) livré.

| #         | Tâche                                            | État                                                |
| --------- | ------------------------------------------------ | --------------------------------------------------- |
| ✅ P13.0  | Rapatriement framework → `@nodefony/realtime`    | cycle cassé, 10 src + 5 tests `git mv`              |
| 🔶 P13.1  | TCP/UDP/Unix sockets                             | scaffold ; code protocoles reste (niche différable) |
| 🔶 P13.2  | `@nodefony/redis` refactor                       | fondation conventions faite ; 15 tests              |
| ✅ P13.4  | `IRealtimeHub` + `RealtimeService`               | façade + `defineRealtimeConfig` Zod                 |
| ✅ P13.5  | `RedisBackplane`                                 | **prouvé cluster live -w2** ; registre drivers      |
| ⬜ P13.6  | `KafkaRealtimeHub`                               | apps massives + bus agents IA                       |
| ✅ P13.7  | Protocole JSON-RPC 2.0 + types partagés          | RPC bidirectionnel ; long-polling droppé            |
| 🔶 P13.8  | Décorateurs `@RealtimeAction`/`@RealtimeChannel` | 3 décorateurs livrés ; reste pattern RegExp         |
| ✅ P13.9  | Tests cluster simulé (IPC)                       | e2e `child_process.fork`, 5 tests                   |
| ✅ P13.10 | Granularité + cadence AIMD                       | différenciateur, client-driven                      |
| ✅ P13.11 | Sonde « socket Nodefony »                        | `RealtimeHub.probe()` + endpoint health             |

> **Dettes backplane multi-pod / multi-app** (à corriger en P13 — détail : [`docs/realtime/socket/08-distribue.md`](docs/realtime/socket/08-distribue.md)) :
>
> - **#1 (moyenne)** Namespace de topic **non câblé** : `REDIS_RT_CHANNEL="nodefony:realtime"` en dur, factory de prod ne passe pas le 3e arg, schéma sans champ → **cross-talk multi-app** sur Redis/Kafka mutualisé. Fix : champ config OU dérivation auto `kernel.name`.
> - **#2 (HAUTE)** `originId = String(process.pid)` **non unique en k8s** (namespace PID par conteneur → PID 1 fréquent) → anti-echo confond 2 pods → **fan-out cross-pod jeté silencieusement**. Fix : `POD_NAME` / `os.hostname()` / `randomUUID`.
> - **#3 (moyenne)** Pas de **frontière dure inter-module** (hub = namespace de canaux plat ; `subscribe` sur canal déjà créé ne repasse par aucune factory → fuite cross-module « cas-2 »). **Design figé 2026-06-05** : décorateur classe `@RealtimeNamespace("chat:")` (+ override `realtimeChannelGuard()`, extension de P13.8) → garde `#channelAllowed` dans `RealtimeController.startChannel` AVANT le hub ; posture `null`+WARN (non-cassant) → `fail-closed` avec P6 ; refus = log WARNING + `notify("realtime:error")`, PAS de close. **Ferme le cas-2 SANS attendre P6** (voter P6 = ACL fine intra-module, complémentaire). L'inbound est déjà cloisonné (map per-controller). Détail : audit § Recommandations.
>
> **À FAIRE — banc de conformité ventilation** (très important, prouve le drop-in `IBackplane` ET exerce les dettes #1/#2) : `RealtimeController` « chat » minimal dans `src/modules/test` (route WS) + suite de scénarios **paramétrée par driver** (loopback/cluster IPC/redis/kafka), comportement observable **identique**. Scénarios : broadcast à 1 / à N même process / à N sur K pods / DM à 1 personne / canal non-broadcast (ne traverse pas) / anti-echo (1× pas 2×) / RPC local-only / unsubscribe ref-counting / pod rejoint après / ordre par pair. Réutilise le harnais `clusterIpc.e2e` (P13.9) + `testcontainers` redis/kafka. Matrice + sous-cas anti-cross-talk / anti-echo collision : [`docs/audits/realtime-module-isolation-2026-06-05.md`](docs/audits/realtime-module-isolation-2026-06-05.md) § Banc de conformité.

### P14 — Frontend Vite + Core isomorphe (75 %)

| #         | Tâche                                     | État                                                                                                                                                                          |
| --------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ P14.1  | Interfaces + décision Vite                | —                                                                                                                                                                             |
| ✅ P14.2  | Preset `vue3-vite`                        | + module test-frontend-vue                                                                                                                                                    |
| ✅ P14.3  | Preset `react19-vite`                     | + Fast Refresh                                                                                                                                                                |
| ✅ P14.4  | `ViteProcessSupervisor`                   | child process isolé, résilience                                                                                                                                               |
| ✅ P14.5  | Build prod (manifest) + statique          | page blanche prod/cluster résolue (`renderProdTags`)                                                                                                                          |
| ✅ P14.6  | Multi-module frontend                     | N bundles cohabitent                                                                                                                                                          |
| 🔶 P14.7  | CLI `frontend:create/build/dev`           | commands existent (bug CLI) ; skill scaffold ✓                                                                                                                                |
| ✅ P14.8  | Tests intégration                         | 14 unit + 3 real spawn                                                                                                                                                        |
| 🔶 P14.9  | Presets Svelte/Solid/**Angular**/Vue      | **Angular ✅** (instance isolée) ; reste Svelte/Solid                                                                                                                         |
| ✅ P14.10 | Migration Studio sur `@nodefony/frontend` | 1er consommateur prod                                                                                                                                                         |
| ✅ P14.11 | **Core isomorphe**                        | Container/Service/Event/Syslog/Pdu runnable browser — shim `node:events` complété (`rawListeners`/`prepend*`, hot path `emitAsync`) ; 0 `node:` runtime dans le bundle client |
| ⬜ P14.12 | Plugin Vite Nodefony (alias + env)        | zéro config dev                                                                                                                                                               |
| ✅ P14.13 | Multi-instance Vite résilient             | familles d'isolation (default/angular)                                                                                                                                        |
| ⬜ P14.14 | API CSP origines dynamiques               | remplace hack POC                                                                                                                                                             |
| ✅ P14.15 | DevSupervisor auto-restart                | group-kill anti-orphelin, rebuild ciblé                                                                                                                                       |
| ⬜ P14.16 | Syslog isomorphe (logs front → back)      | traçabilité front                                                                                                                                                             |

### P15 — Mediasoup + SIP/Asterisk (0 %)

> ⚠️ `src/modules/mediasoup` = **banc test ORM** (schémas Drizzle), **PAS** l'implé P15. Le pont télécom vocal n'est pas commencé.

P15.1 `MediasoupService`/`RoomManager` · P15.2 mapping Routers↔Rooms · P15.3 `SignalController` · P15.4 `PlainTransport` Asterisk ·
P15.5 ARI/AMI · P15.6 pipeline agent IA vocal (STT→LLM→TTS) · P15.7 cluster `PipeTransports` · P15.8 tests E2E. **Après P12+P13.**

### P16 — Cloud-Native (26 %)

| Axe                        | État                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 16.A Kernel/Lifecycle      | ⬜ graceful shutdown per-process (cluster SIGTERM ✓ via 16.H)                                                         |
| 16.B HTTP                  | 🔶 XFF lu (`remoteAddress`) ; reste `clientIp`/`scheme` + whitelist proxy ⚠️                                          |
| 16.C Secrets               | ⬜ `ISecretProvider` (dépend P6)                                                                                      |
| 16.D Docker                | ⬜ `Dockerfile.dev`/prod ; **compose infra Redis/Kafka/Loki/OpenSearch déjà là**                                      |
| 16.E Skills/Tooling        | ⬜ `docker-debug`/`infra-up`                                                                                          |
| 16.F Cleanup PM2           | ✅ F.1/F.2 (retrait code+dep) ; ⬜ F.3 (doc migration users)                                                          |
| 16.G Docs DevOps           | ⬜ (docker-cloud-native.md existe partiellement)                                                                      |
| 16.H Scaling multi-process | ✅ **livré en avance** (`workers` topologie, cluster -w N, sonde/worker, Studio cluster) — H.6 backplane cross-pod ⬜ |

---

## 🛣️ Chemins (détail effort → `docs/migration/phases-details.md`)

- **MVP prod** : P0 → P1 → P2.2-2.5 + P3 minimal → P5.1-5.6 + 1 adapter (Drizzle) + session → **P6.1-6.8b**. ≈ chemin critique.
- **Studio MVP** : MVP → P14 (Vite + Core isomorphe) → P13.4/13.7 → P11.1-3 → P10. (Studio = 1er consommateur prod de `@nodefony/frontend`.)
- **IA agentic** (phase FINALE, **différée**) : P12 (llm/vector/rag/memory refaits + agent + agent-guard + panels Studio).

---

## 🚧 Blockers connus

| Sujet                           | Problème                                           | État              |
| ------------------------------- | -------------------------------------------------- | ----------------- |
| `src/nodefony/rollup.config.ts` | `@ts-ignore` sur `rollup-sourcemap-path-transform` | ⬜ (shim `.d.ts`) |
| `IKernel.cli`                   | typage `ICliKernel`                                | ✅                |
| `IModule.getController()`       | `IController` générique                            | ✅                |

---

## ➡️ Prochaine étape

```
╔══════════════════════════════════════════════════════════════════╗
║  🥇  DURCISSEMENT ORM   (project_orm_hardening_kit)               ║
╠══════════════════════════════════════════════════════════════════╣
║  • Sequelize → SUPPRIMÉ ✅ (Ph.1, 716fce6)                        ║
║  • Mongoose → REFAIT NEUF (extends Service, Drizzle)  ◀ PH.2 ICI  ║
║  • Orm core kernel/orm/{Orm,Connector,Entity} → RETIRER du core   ║
║  • Drizzle = référence.                                           ║
║  Séquencement : config ✅ → Seq OUT ✅ → Mongoose → … → P6.       ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 📚 Détail déplacé hors du dashboard

> Le **statut** vit ici (roadmap + comptage 1ʳᵉ cellule). Le **détail** (« comment », hashes, gotchas) vit à côté :

| Source                                                                             | Contenu                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`docs/migration/AUDIT-verite-2026-06.md`](docs/migration/AUDIT-verite-2026-06.md) | **Audit vérité 2026-06-05** (confrontation code ligne à ligne) |
| [`docs/migration/phases-details.md`](docs/migration/phases-details.md)             | Specs détaillées par phase (conception, archi)                 |
| [`docs/migration/journal-sessions.md`](docs/migration/journal-sessions.md)         | Journal chronologique des sessions                             |
| [`docs/migration/archive-snapshots.md`](docs/migration/archive-snapshots.md)       | Instantanés périmés                                            |
| Mémoire IA `~/.claude/.../memory/`                                                 | Décisions persistantes (`project_*`, `feedback_*`)             |
| `git log`                                                                          | Détail-journal complet des commits (ex-cellules verbeuses)     |
