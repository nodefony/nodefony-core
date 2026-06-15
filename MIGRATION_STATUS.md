# MIGRATION_STATUS.md — Tableau de bord

> **Mis à jour : 2026-06-12** (resync vérité + dégraissage — cf [`docs/migration/AUDIT-verite-2026-06.md`](docs/migration/AUDIT-verite-2026-06.md), passes 06-05 + 06-12).
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

### ⚡ Séquencement actuel (resync 2026-06-12)

**Config ✅** → **durcissement ORM Ph.1-4 ✅** (Seq OUT, Mongoose refait, kernel/orm OUT, C2/C5, 160 tests) → **durcissement WS ✅** → **POC API souveraine Ph.1+Ph.2 ✅** → **durcissement cycle requête V1-V5 ✅** (sécu 413/origin/CSWSH · perf · archi POJO · souverain stateless ALS+`@Scope` · robustesse RFC 416/421/teardown + contrat retours controller) → **Container ✅** (`1c9ebe1`, +6 % RPS) → **fast path T1-T4 + index routes ✅** (`fd7107e` +10,8 % · `c533efa` +15,3 % RPS) → **Allow 405 RFC 9110 ✅** (`bc88444`) → **dettes backplane realtime ✅** (`c082560`) → **POC souverain Ph.3 ✅ FULL-STACK** (pont `api.request` + data plane admin duplex + `RpcError` `a07fdf2` ; front ApiClient→socket succès-only `6b82d0b`+`de39aca`, 2026-06-12) → **🥇 P6 Security ◀ EN COURS** (J1 ✅ authenticators socle `c84c0ba3`+`25e90b29` · J2 ✅ argon2id+migration+throttling NIST `08ae659e`+`a7e2520e`+`bd9cd602` · J3 ✅ session BFF login/logout/me + anti-fixation + Studio réel `00ee6631`, 12/06 · **J3b cadré** (audit socket → 2 trous data plane : pont api.request contourne firewall + channels libres ; plan béton mémoire `project_p6_j3b_plan_kit`, 13/06) · **J8 ✅** garde @IsGranted WS (cookie+JWT) + **RBAC par canal WS** (subscribe/inbound : rôles/scopes par canal, plancher système durci ROLE_ADMIN, surcharge config + refus observable client) prouvé E2E — matrice 4 identités×6 canaux + **câblage firewall RÉEL** Firewall→hub→client `1d4e9a47` ; couverture poussée (frameAuthorizer/decorators/firewall/config 100 %, controller 72→99.5 %, RealtimeClient 67→97 %) `0ba539fd`, 15/06 ; reste POC : Ph.4 mediasoup, Ph.5 GraphQL).
Boussole : durcir les fondations (orm, realtime, core, http, framework) AVANT P6 — P6 se greffe dessus. **Fondations DURCIES — P6 débloqué.** Détail jalons : `git log` + `docs/session-retros/`.

### 🔀 Virage ORM (décidé 2026-06-02) — ✅ **CLOS 2026-06-08** (Ph.1→Ph.4)

- **Ph.1 Sequelize SUPPRIMÉ** (`716fce6`, 0 résidu) · **Ph.2 Mongoose REFAIT** (`51d9ea8`, `extends Service` + sondes Studio) · **Ph.2.5 contrat CRUD durci** (`220c00a`, `updateOne`/`updateMany` + critère strict) · **Ph.3 kernel/orm RETIRÉ du core** (`5ba6bd1`) · **Ph.4 couplage C2 `IErrorAdapter` + C5 `wireOrmAdminPlane`** (`58381df`/`7ac0bac`) · **config Zod unifiée** drizzle+mongoose+redis · **couverture 109→160 tests** + seuils v8 (`953ccc2`).
- Audits : [`orm-state-and-hardening`](docs/audits/orm-state-and-hardening-2026-06.md) · [`orm-solidity`](docs/audits/orm-solidity-2026-06.md) · [`orm-config-pattern`](docs/audits/orm-config-pattern-2026-06.md). MikroORM abandonné (⏭️). ⭐ **Drizzle = référence** ; migrations DB = déléguer `drizzle-kit` (hors chemin critique).
- ⚠️ **Gap restant** : 0 test E2E système (Kernel réel + HTTP + ORM Docker persistant) — cf note P7.

### 🔐 Sécurité (P6) — décisions **EN REVUE 2026-06-08** (les « figées 2026-05-20 » ont divergé — cf mémoire `project_p6_security_kit` §REVUE)

Passport ❌ · **Session HYBRIDE** : session serveur cookie opaque (BFF) web/Studio + **JWT réservé API/agents** (révisé 2026-06-06 — PLUS « full stateless ») · pattern authenticator (pas « Bridge », **pas « Symfony »**) ·
auth de base (Anonymous/UserPassword/Jwt/OAuth2 `arctic`/mTLS/APIKeys) **+ à intégrer P6 : Passkeys/WebAuthn (FIDO2), Token Exchange RFC 8693 (délégation agents), DPoP, Argon2id, OAuth 2.1+PKCE** ·
CSRF SameSite+Origin + `@CsrfProtect` opt-in · `defineSecurityConfig()` + Zod · Zero Trust ·
identité = **`IUser` racine + slot agent/service** (`kind`/`onBehalfOf`, PAS `IPrincipal`) · `BcryptEncoder`/`UserService`/**`IUserProvider` (à implémenter)** dans **@nodefony/user** · gros travail = au démarrage P6.

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
| `@nodefony/realtime`  | ✅   | **Durci** : back-pressure WS, 5 seams sécu, **210 tests verts** (+9 skipped docker ; inclut banc loopback isomorphe E2E L0-L4 — 26 scénarios VRAI client↔serveur) ; série socket isomorphe L0-L4 ✅ (duplex S→C, contrat typé partagé, façade serveur `ServerRealtimeSocket`) ; dettes backplane #1/#2 fixées (`c082560`). Reste dette #3 (frontière inter-modules, attend P6) + plan S1 (fan-out mutualisé, attend canal 100+ abonnés)                                                               |
| `@nodefony/orm-*`     | ✅   | **Virage ORM Ph.1-4 CLOS 2026-06-08** (cf § Virage ORM) : Seq OUT, Mongoose refait, kernel/orm OUT, C2/C5, 160 tests + seuils v8. ⚠️ Reste : E2E système (cf note P7)                                                                                                                                                                                                                                                                                                                                 |

**Log Backplane** (`project_log_backplane_vision`) : axe WRITE (`LB.W`) ✅ + axe QUERY (`LB.0→LB.5`) ✅ — drivers
`memory`/`file`/`cluster-file`/`loki`/`opensearch` queryables, validés runtime cluster + Loki/OpenSearch réels.
Reste ⬜ **LB.3b** (CLI `syslog:filter`, dette dispatch CLI). Console Logs Studio = panneau P10 de facto livré.

> **DETTE-CFG (ordering config `module-<name>` ⊥ validation Zod) ✅ RÉSOLUE** : `Kernel.applyModuleConfigOverrides()`
> appliqué entre `onPreRegister` et `onPreBoot`. `project_config_ordering_chantier`.

---

## 📊 Avancement (vérifié code · **2026-06-12**)

> Comptage **autorité = emoji en 1ʳᵉ cellule** de la roadmap (1 ligne = 1 tâche, ⏭️ exclu). `◀` = chemin critique MVP.

```
━━━━━━ NODEFONY · MIGRATION ━━━━━━━━━━━━━━━━━━━ vérifié code 2026-06-12 ━━━━━━
 P0  Bugs bloquants        ██████████ 100%   6✅  0🔶  0⬜
 P1  Fondations symbiose   ██████████ 100%   8✅  0🔶  0⬜
 P2  Cycle de vie Context  █████████░  89%   8✅  0🔶  1⬜
 P3  Logs structurés       █████████░  85%   7✅  3🔶  0⬜
 P4  Tests symbiose        ██████████ 100%   6✅  0🔶  0⬜
 P5  Session/User/ORM core ████████▌░  85%  13✅  3🔶  1⬜   ◀ (P5.14 ✅ J3 ; reste P5.0b batch/cron)
 P6  Security              ██████░░░░  62%   10✅  2🔶  7⬜   ◀ bloqueur MVP — EN COURS (J1 authenticators · J2 argon2id+throttling · J3 ✅ session BFF · J4 ✅ JWT EdDSA · J6 ✅ autorisation (AuthorizationService decide affirmative+veto · voterRegistry · RoleVoter niveau A) · J7 ✅ décorateurs @IsGranted/@Anonymous/@CurrentUser + garde Resolver avant newController + **preuve E2E** admin 200/user 403/anon 401 · J8 ✅ garde @IsGranted prouvée côté WS — cookie+JWT, « 1 garde = N transports » (blocage réel = dual-package realtime du fixture de test, corrigé) ; reste J5 CSRF/CORS/headers · J9 OAuth2/Passkeys)
 P7  ORM drivers           ████████░░  80%   3✅  2🔶  0⬜   (post-virage ; reste P7.5 E2E système + P7.7 redis)
 P8  CLI + Monitoring      ██████░░░░  63%   2✅  1🔶  1⬜
 P9  Polish + clôture      ██████░░░░  63%   2✅  1🔶  1⬜   (P9.4 : 0 vulnérabilité npm 2026-06-12)
 P10 Studio (admin web)    ███████░░░  68%   6✅  7🔶  1⬜   (workspace + Jumeau, maj 2026-06-06)
 P11 CLI par module        ████░░░░░░  44%   3✅  1🔶  4⬜   (P11.6/7/8 livrés 06-07/06-09)
 P12 Couche IA agentic     ██░░░░░░░░  17%   0✅  2🔶  4⬜   🧪 différé (squelettes brainstorming, non audité)
 P13 Realtime distribué    ████████░░  77%   7✅  3🔶  1⬜   (dettes backplane #1/#2 fixées c082560 · 167 tests)
 P14 Frontend Vite + iso   ████████░░  75%  11✅  2🔶  3⬜
 P15 Mediasoup + SIP       ░░░░░░░░░░   0%   0✅  0🔶  8⬜   (banc ORM `mod/mediasoup` ≠ implé P15)
 P16 Cloud-Native (10 axes)███░░░░░░░  29%  10✅  0🔶 25⬜   (16.I livez ✅ · 16.J /metrics repoussé 06-15)
────────────────────────────────────────────────────────────────────────
 GLOBAL                    ██████░░░░  57%  90✅ 29🔶 63⬜   (182 tâches · resync complet 2026-06-12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> Fondations **hors roadmap** (déjà migrées, Phases 0-4) : Build, Core/Kernel, DI, Syslog, Router, Controller, Types.
> Le durcissement transverse (cycle requête V1-V5, Container, fast path, forwarded/proxy, WS, certificats)
> n'a **pas de lignes P dédiées** — cf § Durcissement fondations + `git log`.
> **Verdict audit 2026-06-12 : chiffres honnêtes** ; écarts corrigés = bandeau périmé (P3/P5/P9/P10/P11/P16),
> dettes backplane résolues non répercutées, re-obésité § Séquencement dégraissée.

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

### P3 — Logs structurés (85 %)

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

### P5 — Session + User + ORM Core (79 %) ◀ chemin critique

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
| ✅ P5.8  | Adapter Mongoose User                       | `MongooseUserRepository implements IUserRepository` + `userSchema`/`registerUserEntity` (parité Drizzle, binding ORM dynamique) ; `findBySocialProvider` via `$elemMatch`. **8 tests** (ReplSet : CRUD/finders/tx rollback)                                                                                                                                             |
| ✅ P5.9  | Adapter Drizzle User                        | ORM par défaut, 8 tests                                                                                                                                                                                                                                                                                                                                                 |
| 🔶 P5.10 | Tests User cross-ORM                        | couvert **de facto** par 2 bancs miroirs même contrat `IUserRepository` (Drizzle 8 + Mongoose 8) ; banc paramétré unifié = optionnel                                                                                                                                                                                                                                    |
| ✅ P5.11 | **Refonte cœur + plug runtime session**     | TS strict, ID CSPRNG opaque, dirty-tracking, cookie-only, contrat `ISessionStorage` unifié ; **plug runtime** `@UseSession` opt-in + lazy + L1 + point unique HTTP/WS (tue le ×23) ; cookie RFC 6265bis `__Host-`/SameSite/None⇒Secure + `cookie.hostPrefix` ; `readOnly` + `absolute_timeout` (OWASP). Tests unit+intég+load+mémoire. (chantier session 2026-06-06/07) |
| 🔶 P5.12 | `Redis` SessionStorage                      | File + **Redis livrés** (TTL natif IoC) ; reste câblage prod                                                                                                                                                                                                                                                                                                            |
| ✅ P5.13 | `OrmSessionStorage` générique               | Drizzle + **Mongoose livrés** (contrat `ISessionStorage` portable ; sequelize supprimé)                                                                                                                                                                                                                                                                                 |
| ✅ P5.14 | `session.user` + régén ID post-auth         | J3 `00ee6631` : câblé via `AuthFlow.login` (regen INCONDITIONNEL + destroy old, anti-fixation prouvée au banc) ; session porte l'IDENTIFIANT, re-fetch provider par requête                                                                                                                                                                                             |

### P6 — Security (58 %) ◀ bloqueur MVP — CHANTIER OUVERT (branche `refactor/p6-security`)

> Audit effort max + plan J0→J10 : [`docs/audits/p6-security-audit-2026-06-12.md`](docs/audits/p6-security-audit-2026-06-12.md). **J0/S0 réalignement ✅ `1634f09e`** (stateless→BFF défaut, argon2id OWASP, `mode first|all`, `IUserProvider` implémenté, sections passkeys/tokenExchange, purge Symfony, 17+6 tests unit). Hors-fenêtre assumé : OAuth2/arctic, webhooks, Studio UI sécu. **J3b Étapes 1+2 ✅ `f6f169c9`+`7995f481`** : data plane `/nodefony/*/api` FERMÉ côté HTTP — aire `nodefony-admin` portée par **framework** (broker), `bypassFirewall` câblé (plumbing manquant trouvé), `matchPath` source unique HTTP/WS ; handshake WS fermé en bonus ; `sessionContext` retiré (isolation admin = RBAC P6.8, legacy `checkChangeContext` non porté). **J3b Étape 3 ✅ `83986bf1`** : VERROU WS frame-level — `RealtimeHub.setFrameAuthorizer`/`runAuthorizer` (pont peer→token), `RealtimeController` branche `beforeDispatch` au handshake (bypass 0-coût sinon), `SessionRealtimeAuthenticator` transfère l'identité DÉJÀ résolue par le firewall (lue dans l'ALS, **0 re-lecture base**), `buildFrameAuthorizer` (invariant `api.request {path}` ≤ `GET {path}` via `matchPath` partagé + canaux d'observabilité réservés aux authentifiés), `firewall.#wireRealtime` (par nom de service, 0 dép realtime). Fix `handshakePath` (URL absolue→pathname). **Déblocage Studio `316bcff3`+`c94aad31`** : l'aire trop large gatait aussi la **liveness** (`/health`/`/info` pingés AVANT le login → 401 → login impossible) → rendues publiques via décorateur **`@BypassFirewall`** dual (drapeau méthode|classe, sucre sur `bypassFirewall`) ; + **fix close WS 1008** (refus auth = Policy, pas 1011 Internal → stoppe la boucle de reco RealtimeClient). Preuve **intégration cross-brique** `ws-data-plane-auth` 6/6 + unit + memory WS 9/9 + security-review ✅. **Co-évolution frontend ✅** (`c7d86c2c` L2 = identité au `realtime:welcome` + respect des close codes WS côté client = fin de la boucle de reco anonyme ; `98dd34e1` refonte login Studio identifier-first/anti-énumération + gestion d'erreurs zéro-saut + fix perf overlay, 13/06 soir). **Série « socket isomorphe » L0→L4 ✅** (13/06 soir, 4 commits `d0934fa0`/`9a51438f`/`40684721`/`f428d2cd`) : **L0** `RealtimeClient` **compose** `JsonRpcPeer` (fin dette isomorphe, `implements IRealtimePeer` vrai, `register()` client ⇒ duplex S→C). **L1** API serveur `RealtimeController.requestClient`/`notifyClient` (duplex S→C propre). **L2** identité au welcome (déjà livré `c7d86c2c`). **L3** contrat de canaux **typé partagé** (`RealtimeController<Emit, Actions>` générique → une map type client ET serveur, refactor-safe end-to-end). **L4** façade serveur `ServerRealtimeSocket implements IRealtimeSocket` au-dessus du hub (un service back tient UN handle, North Star). **L5** (mutations via `api.request`) reste post-P6 (API souveraine Ph.4). Preuve : **banc loopback E2E `realtimeLoopback.e2e.test.ts` = 26 scénarios VRAI client ↔ VRAI serveur** (les unit à stubs ne prouvent ni la plomberie ni le duplex) ; gates memory WS 9/9, typecheck core+client+realtime OK, realtime 210 verts, core 1598 verts. **J4 JWT ✅** : `JwtAuthenticator` (Bearer EdDSA, jose **lazy**, allowlist `["EdDSA"]`+aud+iss+`typ:at+jwt` RFC 8725 §3.1/3.8/3.9/3.11, denylist `jti`+`invalidBefore`, sub revalidé §3.10) + `JwtKeystore` Ed25519 (source **env→fichier(chmod 600)→mémoire+warn**, kid thumbprint RFC 7638, JWKS public via `createLocalJWKSet` sans `d` §3.5 ; ⚠️ jose v6 keygen `"Ed25519"`) + `TokenService` (password grant → access JWT + **refresh opaque haché sha256**, rotation + **reuse detection** RFC 9700 §4.14 → `revokeFamily`, downscoping ; **orchestrateur du seam `ITokenStore.gc()`** : `runGc()` PUBLIC + timer `setInterval(base).unref()` à **phase jittérée**, `gcIntervalS:0` délègue au cron P5.0b) + endpoints framework `TokenAuthController`/`mountTokenAuthRoutes` (convention-frère session, `bypassFirewall`, Bearer JSON RFC 6749 §5.1 jamais cookie/URL) + zone test M2M `/nodefony/test/m2m`. Décisions clés : **JWT Bearer jamais cookie** (OWASP), **émission via password grant** (verifier `users`), source clé pluggable (SecretProvider Vault/KMS = P16), gc cluster = tous+jitter (élection rank-0 = cron P5.0b). Gates : build 0 TS, **security 181 (+38 matrice 8725 + keystore + rotation/reuse + ponts firewall/api.request/subscribe)**, mémoire HTTP+WS 9/9, **banc serveur réel curl 7 ponts** (émission / Bearer 200 / 401+`WWW-Authenticate:Bearer` / bad / rotation / **reuse→401** / bad-cred), security-review 0 blocker. **J6 autorisation ✅** (`4e336d50`) : noyau RBAC/voters (niveau C) — `AuthorizationService.decide()` stratégie **affirmative + DENY veto**, défaut DENY (Zero Trust), **fail-closed si un voter throw** (refus + log ERROR, jamais 500) ; `voterRegistry` (fabriques pluggables, convention-frère `authenticatorRegistry`) ; **`RoleVoter` niveau A** (`ROLE_*` via `RoleHierarchyWalker`, ABSTAIN si rôle absent → jamais veto) ; firewall pose le **token complet dans l'ALS** (seam J7) + `roleHierarchy` au container. Niveau B (RBAC ORM persisté `IRole`/`IPermission`) **différé J6b** (pas de consommateur, multi-module ; se branchera comme un voter sans toucher `decide()`). 193 tests security. **J7 décorateurs ✅** (`df673ef8`+`4a11523b`) : `@IsGranted(attr|attr[], {subject?})` (classe/méthode, empilés=AND, tableau=OR — rend `@HasAnyRole`/`@HasAllRoles` inutiles), `@Anonymous()` (public + bypassFirewall), `@CurrentUser()` (injecte l'user ALS) — **dans @nodefony/framework** (lisent leur metadata, 0 import security → 0 cycle ; moteur appelé PAR NOM). Garde dans `Resolver.executeAction` **AVANT `newController()`** (403 court-circuite l'instanciation DI ; descripteur figé sur `route.actionMeta` mémo → **0 Reflect/0 await/0 alloc** par requête sur route non gardée). Ponts couverts : HTTP, WS `api.request`, **forward (`route=null`)**. **Preuve E2E ✅** (`5bf2087a`) : route réelle `@IsGranted("ROLE_ADMIN")`+`@CurrentUser` (zone test-secure) → **admin 200 / user 403 / anon 401** (autz ≠ authn prouvée) + test d'intégration automatisé. Gates : build 0 TS, security 193, framework unit 284, **framework intég 78 (+3 E2E)**, **http intég 463**, mémoire 9/9, security-review 0 blocker. **J8 garde @IsGranted côté WS ✅** : pont `api.request` (`RealtimeController.invokeApiRequest`) ouvre une bulle ALS avec le **token DU PEER** (`getTokenForPeer`, lié à la connexion) AVANT `executeAction` → la garde J7 décide à l'identique sur la socket ; `IToken.getUserIdentifier()` (commun HTTP↔WS, l'audit authz ne lit plus `getUser()`) ; `realtime` zone **défaut `true`** (Zero Trust : une zone protégée ferme TOUS ses transports, opt-out explicite `false` — un opt-in était fail-open) ; 403 garde → `RpcError(status:403)` (fetch-like, pas `-32603` opaque). **Preuve E2E « 1 garde = N transports ET N modes d'auth »** : banc cookie/BFF `ws-data-plane-auth` **8/8** + banc **JWT** `ws-isgranted-jwt` **2/2** (admin GRANT / user 403). **Cause racine du blocage JWT = bug de PACKAGING du fixture (pas la sécu)** : le module `test` ne déclarait pas `@nodefony/realtime` (peerDep + `external` rollup) → rollup bundlait une **2ᵉ copie du module** → `RealtimeHub` DUPLIQUÉ → l'authenticator WS câblé par le firewall (sur le hub canonique) invisible → handshake anonyme → garde 403 (dual-package hazard, même classe que orm-core/drizzle). Corrigé en externalisant realtime. Le code sécu/realtime était correct (banc cookie le prouvait). Gates : WS intég 105/105, mémoire 9/9, security 195, realtime 210, framework 284, security-review 0 blocker. **➡️ NEXT : J5 (CSRF Sec-Fetch-Site/CORS/headers, indépendant) · J9 (OAuth2 arctic + Passkeys/WebAuthn, slot prêt).**

| #        | Tâche                                                       | État                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ P6.1  | `AccessControl` (RBAC walker)                               | `RoleHierarchyWalker.ts` — câblé J6 : firewall pose `roleHierarchy` au container, consommé par `RoleVoter`                                                                                                                                                                                                                                                                                                                                                                            |
| ⬜ P6.2  | `cors.ts` service                                           | whitelist stricte                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ✅ P6.3  | `firewall.ts` + `SecuredArea` + `defineSecurityConfig`      | J1 `c84c0ba3` : Zod boot fail-closed, mode first\|all, registre fabriques, WWW-Authenticate RFC 7235                                                                                                                                                                                                                                                                                                                                                                                  |
| ✅ P6.4  | `AnonymousAuthenticator` + token                            | J1 `c84c0ba3` : opt-in d'anonymat explicite (Zero Trust sinon)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ✅ P6.5  | `UserPasswordAuthenticator`                                 | J1 `c84c0ba3`+`25e90b29` : Basic RFC 7617 → `IPasswordVerifier` ; banc test-secure 9 tests intég                                                                                                                                                                                                                                                                                                                                                                                      |
| ✅ P6.5b | Argon2id + migration + throttling NIST                      | J2 `08ae659e`+`a7e2520e`+`bd9cd602` : Argon2idEncoder RFC 9106 (~56 ms), MigratingEncoder bcrypt→argon2 au login, LoginThrottler 429+Retry-After, blocklist hook                                                                                                                                                                                                                                                                                                                      |
| ✅ P6.5c | **Session BFF** : SessionAuthenticator + AuthFlow           | J3 : login/logout/me `/nodefony/security/api/auth/*` (SessionAuthController framework, monté si authFlow), anti-fixation OWASP (regen+destroy), re-fetch provider/requête, throttler PARTAGÉ entre portes, pont config.encoders→container, Studio BFF (mocks supprimés), fix résurrection session au destroy                                                                                                                                                                          |
| ✅ P6.6  | `JwtAuthenticator` (Bearer EdDSA, `jose`)                   | J4 : `JwtAuthenticator` (allowlist `["EdDSA"]`+aud+iss+`typ:at+jwt` RFC 8725, denylist `jti`) + `JwtKeystore` Ed25519 (env→fichier 600→mémoire, JWKS) + `TokenService` (password grant → access JWT + refresh opaque sha256, rotation + reuse detection RFC 9700, downscoping, gc cluster jitter) + `TokenAuthController`. **Bearer jamais cookie** (OWASP)                                                                                                                           |
| ⬜ P6.7  | `csrf.ts` (SameSite+Origin + `@CsrfProtect`)                | service `csrf.ts` présent (stub à finaliser)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 🔶 P6.8  | `authorization.ts` (3 niveaux)                              | J6 `4e336d50` : niveaux **A** (`RoleVoter` via walker) + **C** (`AuthorizationService.decide()` affirmative+DENY veto, défaut DENY Zero Trust, fail-closed si voter throw) + `voterRegistry` pluggable. **Niveau B (RBAC ORM persisté) différé J6b** — se branchera comme `PermissionVoter` sans toucher `decide()`                                                                                                                                                                   |
| ✅ P6.8b | Décorateurs sécu (`@IsGranted`/`@Anonymous`/`@CurrentUser`) | J7 `df673ef8`+`4a11523b` : **dans @nodefony/framework** (0 import security → 0 cycle, moteur par nom) ; `@IsGranted(attr\|attr[],{subject?})` (empilés=AND, tableau=OR) rend `@HasAnyRole`/`@HasAllRoles` inutiles. Garde dans **`Resolver.executeAction` AVANT `newController()`** (PAS hook `beforeResolve`) ; descripteur figé sur `route.actionMeta` → 0 Reflect/await/alloc sur route non gardée. Ponts HTTP+WS+forward. **Preuve E2E** `5bf2087a` : admin 200/user 403/anon 401 |
| ⬜ P6.9  | `OAuth2Authenticator` (`arctic`)                            | 50+ providers config-driven                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ⬜ P6.9b | `MTlsAuthenticator`                                         | zones admin                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ⬜ P6.10 | Logs auth + CSP stricte + headers                           | OWASP A05                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ⬜ P6.11 | Tests intégration security complets                         | 17 unit security + 6 user (S0) ; intégration = 0                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ⬜ P6.12 | API Keys (PAT)                                              | entité orm-core hashée                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ⬜ P6.13 | Webhooks (HMAC sortant)                                     | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ⬜ P6.14 | Audit events + stream WS                                    | base auditeur                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ⬜ P6.15 | Studio — section Sécurité                                   | consomme data plane P6.12-14                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### P7 — ORM Drivers (≈80 % — virage ORM Ph.1+Ph.2 ✅)

| #       | Tâche                                  | État                                                                                                                                                                                                                                                                                                      |
| ------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⏭️ P7.1 | ~~Sequelize (legacy)~~                 | **SUPPRESSION COMPLÈTE** (virage ORM, `716fce6`)                                                                                                                                                                                                                                                          |
| ✅ P7.2 | Mongoose — adapter orm-core            | **refait (Ph.2)** : `MongooseService extends Service` + `describeConnection`/flow tap                                                                                                                                                                                                                     |
| ⏭️ P7.3 | ~~Tests intégration Sequelize~~        | caduc                                                                                                                                                                                                                                                                                                     |
| ✅ P7.4 | ⭐ **`@nodefony/drizzle`** (référence) | `DrizzleOrm`/`DrizzleRepository`, 8 tests                                                                                                                                                                                                                                                                 |
| 🔶 P7.5 | Tests Mongoose                         | 46 verts via `mongodb-memory-server` (mongod réel hermétique) — niveau **module/composant** : adapter orm-core, User (P5.8), SessionStorage CRUD, transactions, eager-load, garde-fous. ⚠️ **boot hors-kernel** + **0 E2E** (pas de serveur Nodefony bootté ni MongoDB Docker persistant) → reste à faire |
| ✅ P7.6 | Tests Drizzle (SQLite/PG)              | banc orm-core 8 tests                                                                                                                                                                                                                                                                                     |
| 🔶 P7.7 | `@nodefony/redis` refactor             | conventions/config Zod faites                                                                                                                                                                                                                                                                             |
| ⏭️ P7.8 | ~~`@nodefony/mikroorm`~~               | **abandonné** (jamais commencé, module absent)                                                                                                                                                                                                                                                            |
| ⏭️ P7.9 | ~~Tests MikroORM~~                     | caduc                                                                                                                                                                                                                                                                                                     |

> ⚠️ **Gap intégration ORM (à ne pas survendre comme « durci complet »)** : la couverture (160 tests
> orm-core+drizzle+mongoose) valide le **contrat portable, les adaptateurs et les invariants** au niveau
> module — sur SQLite et `mongodb-memory-server`. Il **manque l'intégration E2E système** : aucun test
> ne boote un **Kernel Nodefony réel** + serveur HTTP + requête `controller → service → ORM` contre un
> **MongoDB/Postgres Docker persistant**. Banc E2E prévu via [[project_mediasoup_test_db]] (POC API souveraine).

### P8 — CLI + Monitoring (63 %)

| #       | Tâche                        | État                                                                |
| ------- | ---------------------------- | ------------------------------------------------------------------- |
| ✅ P8.1 | `bin/nodefony.ts`            | banner rollup, CLI fonctionnel                                      |
| ⬜ P8.2 | Generators Module/Controller | **couvert par skills** (`nodefony-create-module`), pas commande CLI |
| ✅ P8.3 | `DebugBar` (monitoring)      | `src/nodefony/src/client/debugbar/`                                 |
| 🔶 P8.4 | `Metrics` runtime            | via Studio (canal `dashboard:stats`), pas service standalone        |

### P9 — Polish + clôture (63 %)

| #       | Tâche                         | État                                         |
| ------- | ----------------------------- | -------------------------------------------- |
| ✅ P9.1 | `@entities` decorator + tests | `kernelDecorator.ts`                         |
| ⬜ P9.2 | Barrels `index.ts`            | résiduel                                     |
| 🔶 P9.3 | README publics                | security ✓ ; **http + framework absents**    |
| ✅ P9.4 | Vulnérabilités npm            | **0 vulnérabilité** (`npm audit` 2026-06-12) |

### P10 — Studio admin web (68 %)

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

### P11 — CLI par module (44 %)

| #        | Tâche                                                                   | État                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔶 P11.1 | Tests intégration commandes existantes                                  | filet spawn livré (`RUN_CLI_BOOT=1`) ; reste commandes métier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ⬜ P11.2 | Commandes `http:*`                                                      | couplée API admin Studio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ⬜ P11.3 | Commandes `framework:*`/`security:*`/`user:*`                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ⬜ P11.4 | Commandes `orm:migrate/…`                                               | délègue CLI ORM natifs (Drizzle/Mongoose)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ⬜ P11.5 | Commandes `logs:tail/filter` + bridge Studio                            | LB.3b                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ✅ P11.6 | Boot UX dev — BootReporter + diagnostic (`58c15d8`/`74b4c8c`/`b140855`) | spinner/checklist dev-only + help modules + Vite checklist ; **diagnostic de boot** : `BootReport` (vérité unique) + **garde-fou 0-serveur** → CRITIC + `terminate(EX_UNAVAILABLE)` (visible k8s + DevSupervisor, plus de mort silencieuse) + résilience par-entrée `loadModulesFromManifest` ; **boot pro** : serveurs `➜ HTTP/HTTP2/WS/WSS` URLs cliquables, digest **Modules**, section **Données** (ORM `describeConnection` sans credential, via canal neutre `reportBootLine`), gate TTY `kernel.isTTY`, rien sur les commandes ; `await onServersReady` |
| ✅ P11.7 | Commande `proxy:generate nginx\|haproxy` (`6ac8562`)                    | dérive la conf de l'introspection (statiques, domaines sans IP, ports) ; nginx résout le trou statics multi-modules (chaîne `try_files`) ; haproxy proxy + Forwarded + `--reencrypt` ; générateurs purs (12 tests)                                                                                                                                                                                                                                                                                                                                             |
| ✅ P11.8 | Préfixe natif statique + CDN (`e735544`/`29203c1`/`6918f89`)            | `server-static.mountModulePublics` monte `public/` de chaque module sous `/<module>/` (configurable `publicMount`, défaut basename) ; `frontend.assetBaseUrl` + helper `asset()` préfixent les URLs prod (CDN) sans toucher au mount ; commande `assets:publish` assemble l'arbre `dist-assets/` (carte préfixe→dossier, provider-agnostic, 0 dep cloud)                                                                                                                                                                                                       |

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

> **Dettes backplane multi-pod / multi-app** (détail : [`docs/realtime/socket/08-distribue.md`](docs/realtime/socket/08-distribue.md)) :
>
> - ✅ **#1 + #2 RÉSOLUES (`c082560`, 2026-06-12)** : `resolveBackplaneOriginId()` = `(POD_NAME ?? hostname):pid` (anti-écho fiable cross-pod k8s) + champ `backplane.namespace` (Zod) → canal `nodefony:realtime:<ns>` dérivé de `kernel.projectName` (fin du cross-talk multi-app Redis mutualisé). +9 tests.
> - ⬜ **#3 (moyenne)** Frontière inter-module des canaux — design figé 2026-06-05 (`@RealtimeNamespace` + garde `#channelAllowed`, posture WARN → fail-closed avec P6). **Attend P6.** Détail : [`realtime-module-isolation`](docs/audits/realtime-module-isolation-2026-06-05.md).
> - ⬜ **Banc de conformité ventilation** (prouve le drop-in `IBackplane`) : scénarios paramétrés par driver (loopback/IPC/redis/kafka), comportement identique. Matrice : audit isolation § Banc de conformité.

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

### P16 — Cloud-Native (29 %)

| Axe                        | État                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16.A Kernel/Lifecycle      | ⬜ graceful shutdown per-process (cluster SIGTERM ✓ via 16.H)                                                                                                                                                                                                                                                                                                           |
| 16.B HTTP                  | ✅ chantier forwarded/proxy CLOS 2026-06-07 : RFC 7239 + XFF from-right anti-spoof + `trustProxy` gate + banc Docker E2E                                                                                                                                                                                                                                                |
| 16.C Secrets               | ⬜ `ISecretProvider` (dépend P6)                                                                                                                                                                                                                                                                                                                                        |
| 16.D Docker                | ⬜ `Dockerfile.dev`/prod ; **compose infra Redis/Kafka/Loki/OpenSearch déjà là**                                                                                                                                                                                                                                                                                        |
| 16.E Skills/Tooling        | ⬜ `docker-debug`/`infra-up`                                                                                                                                                                                                                                                                                                                                            |
| 16.F Cleanup PM2           | ✅ F.1/F.2 (retrait code+dep) ; ⬜ F.3 (doc migration users)                                                                                                                                                                                                                                                                                                            |
| 16.G Docs DevOps           | ⬜ (docker-cloud-native.md existe partiellement)                                                                                                                                                                                                                                                                                                                        |
| 16.H Scaling multi-process | ✅ **livré en avance** (`workers` topologie, cluster -w N, sonde/worker, Studio cluster) — H.6 backplane cross-pod ⬜                                                                                                                                                                                                                                                   |
| 16.I Liveness/Readiness    | ✅ `95bb221f` (06-15) : route PUBLIQUE graduée `GET /nodefony/kernel/api/livez` (sonde k8s/Docker non-auth → minimum vital + **503** si `!booted` = readiness ; authentifié → détails runtime, pattern Actuator `when-authorized`). Zone firewall `nodefony-liveness` (`["session","anonymous"]`, triée avant `nodefony-admin`) + flag `IAdminEndpoint.public` (broker) |
| 16.J Métriques (scaling)   | ⬜ **REPOUSSÉ (décidé 06-15)** : endpoint `/metrics` format Prometheus/OpenMetrics (RPS, latence, event-loop lag, connexions WS) → scrape Prometheus → HPA/KEDA pour l'autoscaling. Distinct de la liveness (16.I). Données déjà dispo (`dashboard:stats`), reste l'exposition Prometheus                                                                               |

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
║  🥇  P6 SECURITY   (project_p6_security_kit — bloqueur MVP)       ║
╠══════════════════════════════════════════════════════════════════╣
║  Fondations DURCIES (orm/realtime/core/http/framework ✅) :       ║
║  cycle requête V1-V5, Container, fast path, Allow 405, backplane. ║
║  • démarrer par la REVUE 2026-06-08 (hybride BFF, IUser racine,   ║
║    Argon2id, Passkeys/WebAuthn, Token Exchange RFC 8693)          ║
║  • S1 fondation FAITE → câblage http-kernel + hook beforeResolve  ║
║    + pipeline auth + tests (memory.test OBLIGATOIRE au câblage)   ║
║  Débloque : seams realtime, RBAC audit-window, CSP, Studio sécu.  ║
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
