# MIGRATION_STATUS.md — Tableau de bord

> **Mis à jour : 2026-06-28** (resync vérité — cf [`docs/migration/AUDIT-verite-2026-06.md`](docs/migration/AUDIT-verite-2026-06.md), passes 06-05 + 06-12 + 06-28).
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

Config ✅ → durcissement ORM Ph.1-4 ✅ → durcissement WS ✅ → POC API souveraine Ph.1-3 ✅ (pont `api.request` + data plane admin duplex) → durcissement cycle requête V1-V5 ✅ → Container + fast path routes ✅ → **P6 Security — cœur MVP LIVRÉ, durcissement en cours** (J1→J9 ✅ + API Keys + Audit + 2FA + Webhooks ✅ COMPLET + Sessions/Users + Firewall Studio + red-team par brique ; reste = durcissement/niches hors MVP). Détail-journal = `git log` + mémoires IA (pointeurs ci-dessus).
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

| Couche                | État | Résumé (détail → mémoire `project_hardening_*`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodefony` (core)     | ✅   | Kit C1→C6 clos (PM2 retiré, modes run `IRunProfile`, park, ménage boot −378 ms). `project_hardening_core_kit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@nodefony/http`      | ✅   | Kit H1→H6 + config Zod + domain matching + forwarded RFC 7239 COMPLET + banc proxy Docker E2E + **service certificates durci** (RFC 5280/6125, SHA-256, serial 128b, 0600, lazy node-forge, CLI `certificates`) + **banc TLS re-encrypt validé** (verify required/verifyhost/sni) + `proxy:generate` + **préfixe natif statique `/<module>/`** (`mountModulePublics`, configurable `publicMount`) + **`assets:publish`** (arbre CDN-ready provider-agnostic) + **`PATCH` parsé** (RFC 5789 — était absent de la table `parse` de `Request.ts` → body jamais lu → 500 sur mutation). `65f7e41`/`6ac8562`/`e735544`/`6918f89`/`867d6458` |
| `@nodefony/framework` | ✅   | F1→F7 (sauf F6 résolu via dette CLI) ; 176 tests unit ; 0 dette. `project_hardening_framework_kit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `@nodefony/realtime`  | ✅   | **Durci** : back-pressure WS, 5 seams sécu, **210 tests verts** (+9 skipped docker ; inclut banc loopback isomorphe E2E L0-L4 — 26 scénarios VRAI client↔serveur) ; série socket isomorphe L0-L4 ✅ (duplex S→C, contrat typé partagé, façade serveur `ServerRealtimeSocket`) ; dettes backplane #1/#2 fixées (`c082560`). Reste dette #3 (frontière inter-modules, attend P6) + plan S1 (fan-out mutualisé, attend canal 100+ abonnés)                                                                                                                                                                                                |
| `@nodefony/orm-*`     | ✅   | **Virage ORM Ph.1-4 CLOS 2026-06-08** (cf § Virage ORM) : Seq OUT, Mongoose refait, kernel/orm OUT, C2/C5, 160 tests + seuils v8. ⚠️ Reste : E2E système (cf note P7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Log Backplane** (`project_log_backplane_vision`) : axe WRITE (`LB.W`) ✅ + axe QUERY (`LB.0→LB.5`) ✅ — drivers
`memory`/`file`/`cluster-file`/`loki`/`opensearch` queryables, validés runtime cluster + Loki/OpenSearch réels.
Reste ⬜ **LB.3b** (CLI `syslog:filter`, dette dispatch CLI). Console Logs Studio = panneau P10 de facto livré.

> **DETTE-CFG (ordering config `module-<name>` ⊥ validation Zod) ✅ RÉSOLUE** : `Kernel.applyModuleConfigOverrides()`
> appliqué entre `onPreRegister` et `onPreBoot`. `project_config_ordering_chantier`.

> 🏗️ **CHANTIER config clarté ◀ BLOQUEUR MVP** : 4 structures de config coexistent + duplication des
> défauts (ex. security `timeCost` 3 vs 2) = confusion réelle du user. **Vision** : chaque module =
> `config.ts` (Zod commenté = **SEULE source des défauts**) + `defineXConfig.ts` (builder pur),
> fusionner les `schema.ts` ; Studio = provenance par champ (défaut / surcharge / env).
> `project_config_clarity_chantier_kit`

---

## 📊 Avancement (vérifié code · **2026-06-28**)

> Comptage **autorité = emoji en 1ʳᵉ cellule** de la roadmap (1 ligne = 1 tâche, ⏭️ exclu). `◀` = bloqueur du chemin critique. **MVP sécurité ✅ atteint (P6) → bloqueur RELEASE actuel = ORM (P7), multi-dialecte sqlite/pg/mysql.**

```
━━━━━━ NODEFONY · MIGRATION ━━━━━━━━━━━━━━━━━━━ vérifié code 2026-06-28 ━━━━━━
 P0  Bugs bloquants        ██████████ 100%   6✅  0🔶  0⬜
 P1  Fondations symbiose   ██████████ 100%   8✅  0🔶  0⬜
 P2  Cycle de vie Context  ██████████ 100%   9✅  0🔶  0⬜   (P2.6 idempotency ✅ via @Idempotent)
 P3  Logs structurés       █████████░  85%   7✅  3🔶  0⬜
 P4  Tests symbiose        ██████████ 100%   6✅  0🔶  0⬜
 P5  Session/User/ORM core ████████▌░  85%  13✅  3🔶  1⬜   ◀ (P5.14 ✅ J3 ; reste P5.0b batch/cron)
 P6  Security              ███████▊░░  78%  16✅  4🔶  3⬜   ✅ cœur MVP LIVRÉ (authn/authz/CSRF/CORS/API-Keys/webhooks COMPLET/2FA/audit/scopes/idempotence/firewall+Studio) ; reste HORS MVP : P6.18 audit persistant · mTLS/rpId · authz niveau B · OAuth resource-server · logs auth · live audit
 P7  ORM drivers           ███████▌░░  75%   3✅  3🔶  0⬜   ◀ **BLOQUEUR RELEASE** — multi-dialecte sqlite/pg/mysql (P7.10) TRÈS important + confiance ORM à regagner (comparatif froid) ; reste P7.5 E2E + P7.7 redis
 P8  CLI + Monitoring      ██████░░░░  63%   2✅  1🔶  1⬜
 P9  Polish + clôture      ██████░░░░  63%   2✅  1🔶  1⬜   (P9.3 READMEs ✅ · P9.4 : 3 low transitives, held back)
 P10 Studio (admin web)    ███████▎░░  73%   9✅  4🔶  2⬜   (~80 pages + Jumeau + portail doc ; reste tests intég P10.11)
 P11 CLI par module        ████░░░░░░  44%   3✅  1🔶  4⬜   ◀ **BLOQUEUR MVP** (partiel) — CLI essentielles (lifecycle start/dev/build/prod/cluster + orm:migrate + user/security:*) implémentées mais NON testées intég ; P11.6/7/8 livrés
 P12 Couche IA agentic     ██░░░░░░░░  17%   0✅  2🔶  4⬜   🧪 différé (llm = module réel non intégré ; agent-guard/mcp vides)
 P13 Realtime distribué    ████████░░  77%   7✅  3🔶  1⬜   (dettes backplane #1/#2 fixées c082560 · 167 tests)
 P14 Frontend Vite + iso   ████████░░  75%  11✅  2🔶  3⬜
 P15 Mediasoup + SIP       ░░░░░░░░░░   0%   0✅  0🔶  8⬜   (banc ORM `mod/mediasoup` ≠ implé P15)
 P16 Cloud-Native (10 axes)███░░░░░░░  29%  10✅  0🔶 25⬜   (16.I livez ✅ · 16.J /metrics repoussé 06-15)
────────────────────────────────────────────────────────────────────────
 GLOBAL                    ██████▌░░░  65% 112✅ 27🔶 53⬜  (192 tâches · resync vérité 2026-06-28)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> Fondations **hors roadmap** (déjà migrées, Phases 0-4) : Build, Core/Kernel, DI, Syslog, Router, Controller, Types.
> Le durcissement transverse (cycle requête V1-V5, Container, fast path, forwarded/proxy, WS, certificats)
> n'a **pas de lignes P dédiées** — cf § Durcissement fondations + `git log`.
> **Verdict audit 2026-06-28 : chiffres honnêtes, mais bandeau périmé du 17/06 (189 commits depuis)** — P6 quasi
> bouclé (webhooks COMPLET / 2FA / audit / scopes / idempotence), Studio plus avancé (~73 %). Le dashboard se
> **sous-vendait**. Corrigés : P2.6 ✅ · P9.3 ✅ (READMEs présents) · P9.4 → 3 low · P10.7/8/14 ✅ · P10.11 → ⬜.
> Détail : [`docs/migration/AUDIT-verite-2026-06.md`](docs/migration/AUDIT-verite-2026-06.md) (passe 06-28).

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
| ✅ P2.6 | Idempotency keys (`X-Idempotency-Key`) | livré via `@Idempotent` (P6.8) + stores Redis/Drizzle                                       |
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

### P5 — Session + User + ORM Core (85 %) ◀ chemin critique

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

### P6 — Security (78 %) — ✅ cœur MVP LIVRÉ (bloqueur MVP LEVÉ) ; reste durcissement/niches HORS MVP. CHANTIER OUVERT (branche `refactor/p6-security`)

> **CŒUR P6 BOUCLÉ** — J0→J9 (`1634f09e`→`1df19b93`) + CSRF/CORS/en-têtes (`ebe7e915`/`0724a8c6`/`f4f9ead8`) + CSP nonce (`eb59daf6`). Authenticators Anonymous/Password/Session-BFF/JWT/OAuth2-social/WebAuthn ; autorisation voters + `@IsGranted` (HTTP **et** WS) ; Argon2id + throttle NIST. **Détail-journal = `git log` + mémoires IA + [audit vérité](docs/migration/AUDIT-verite-2026-06.md) + [plan P6](docs/audits/p6-security-audit-2026-06-12.md).** ✅ **modèle session NIST-aligné** (idle+absolute+touch HTTP+WS, retrait du reliquat PHP `maxLifetimeS`, red-team 11/11, `e27de035`). Reste : P6.18 store audit persistant · P6.16 rpId multi-vhost · P6.9b mTLS (niches). App pose `users` en prod (`3d140de1`, auth prod réparée).

| #        | Tâche                                                       | Preuve / état (détail → git log + mémoires IA)                                                                                                                                                                                                                                                               |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅ P6.1  | `AccessControl` (RBAC walker)                               | `RoleHierarchyWalker.ts` câblé J6 (firewall→container→`RoleVoter`)                                                                                                                                                                                                                                           |
| ✅ P6.2  | `cors.ts` service                                           | J5 `Cors` (Fetch Standard) ; `handleCors` en tête de `handleHttp`                                                                                                                                                                                                                                            |
| ✅ P6.3  | `firewall.ts` + `SecuredArea` + `defineSecurityConfig`      | J1 `c84c0ba3` : Zod fail-closed, mode first\|all, WWW-Authenticate RFC 7235                                                                                                                                                                                                                                  |
| ✅ P6.4  | `AnonymousAuthenticator` + token                            | J1 `c84c0ba3` : anonymat opt-in (Zero Trust sinon)                                                                                                                                                                                                                                                           |
| ✅ P6.5  | `UserPasswordAuthenticator`                                 | J1 `c84c0ba3`+`25e90b29` : Basic RFC 7617 → `IPasswordVerifier`                                                                                                                                                                                                                                              |
| ✅ P6.5b | Argon2id + migration + throttling NIST                      | J2 `08ae659e`+`a7e2520e`+`bd9cd602` : RFC 9106, MigratingEncoder, LoginThrottler 429                                                                                                                                                                                                                         |
| ✅ P6.5c | **Session BFF** : SessionAuthenticator + AuthFlow           | J3 : login/logout/me, anti-fixation OWASP, throttler partagé entre portes                                                                                                                                                                                                                                    |
| ✅ P6.6  | `JwtAuthenticator` (Bearer EdDSA, `jose`)                   | J4 : allowlist EdDSA+aud+iss RFC 8725, Ed25519 keystore JWKS, TokenService                                                                                                                                                                                                                                   |
| ✅ P6.7  | `csrf.ts` + `@CsrfProtect`/`@CsrfExempt`                    | J5 : Sec-Fetch-Site primaire + Origin/Referer ; double-submit HMAC stateless                                                                                                                                                                                                                                 |
| 🔶 P6.8  | `authorization.ts` (3 niveaux)                              | J6 `4e336d50` : RoleVoter + `decide()` affirmative+DENY véto, voterRegistry ; reste niveau B (ACL fine par ressource)                                                                                                                                                                                        |
| ✅ P6.8b | Décorateurs sécu (`@IsGranted`/`@Anonymous`/`@CurrentUser`) | J7 `df673ef8`+`4a11523b` : dans @nodefony/framework (0 cycle, moteur par nom)                                                                                                                                                                                                                                |
| 🔶 P6.9  | OAuth2 social login (`arctic`)                              | BFF Google/Keycloak/GitHub `oauth2-flow` 6/6 (J9 `41c702f2`→`1df19b93`) ; reste resource-server                                                                                                                                                                                                              |
| ✅ P6.9c | Passkeys / WebAuthn (FIDO2)                                 | `@simplewebauthn` lazy, stores memory/file/Drizzle/Mongoose/Redis, 34 tests (J9)                                                                                                                                                                                                                             |
| ⬜ P6.9b | `MTlsAuthenticator`                                         | zones admin (niche, non démarré)                                                                                                                                                                                                                                                                             |
| 🔶 P6.10 | Logs auth + CSP stricte + headers                           | J5-A `SecurityHeaders` (CSP + Referrer + COOP/COEP/CORP + Permissions-Policy) ; reste logs auth dédiés                                                                                                                                                                                                       |
| ✅ P6.11 | Tests intégration security complets                         | 23 fichiers test + 7 bancs E2E live ; chantier red-team (matrice d'attaque par brique)                                                                                                                                                                                                                       |
| ✅ P6.12 | API Keys (PAT)                                              | `2c3e252c` : `ApiKeyAuthenticator` (`nf_…` CRC anti-DoS, sha256, révoqué/expiré)                                                                                                                                                                                                                             |
| ✅ P6.13 | Webhooks (backend + data plane + stores ORM + Studio)       | **COMPLET** `4d9006c5`→`486eb75b` — SSRF+secret chiffré+dispatcher Standard Webhooks v1+livraison bornée anti-DoS ; data plane `WebhookAdminApi` (broker) + stores Drizzle/Mongoose + page Studio + livraisons récentes + récepteur sink ; e2e live 25/25, 765 security. [[project_p6_webhooks_slice_c_kit]] |
| ✅ P6.14 | Audit events + stream WS                                    | `6f028fbe` : `IAuditEvent` + `MemoryAuditStore` FIFO + query curseur (lots 1-4)                                                                                                                                                                                                                              |
| 🔶 P6.15 | Studio — section Sécurité                                   | Pages LIVRÉES : Sessions/Users/API Keys/Firewall/Audit/Profil self+admin (`8d54bf4a`→`486eb75b`) ; reste live `security:audit` (canal OFF)                                                                                                                                                                   |
| ✅ P6.17 | 2FA / TOTP (step-up login)                                  | `e5d47a73`→`52a18811` : RFC 6238 step-up du login mot de passe + Studio + passkeys CRUD                                                                                                                                                                                                                      |
| ⬜ P6.18 | Audit — store PERSISTANT (dette de P6.14)                   | journal 100 % RAM (`MemoryAuditStore` volatile, ring 10k, per-pod) → store durable                                                                                                                                                                                                                           |
| ⬜ P6.16 | WebAuthn — `rpId` dynamique par Host (multi-vhost)          | `#rpID` figé au boot (`webAuthn.ts`) → dériver du `Host` de la requête                                                                                                                                                                                                                                       |

### P7 — ORM Drivers (75 %) ◀ **BLOQUEUR RELEASE** — multi-dialecte sqlite/pg/mysql = condition de release ; confiance ORM à regagner (comparatif froid Drizzle/Prisma/Kysely/TypeORM avant d'investir)

| #        | Tâche                                                | État                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ⏭️ P7.1  | ~~Sequelize (legacy)~~                               | **SUPPRESSION COMPLÈTE** (virage ORM, `716fce6`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ✅ P7.2  | Mongoose — adapter orm-core                          | **refait (Ph.2)** : `MongooseService extends Service` + `describeConnection`/flow tap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ⏭️ P7.3  | ~~Tests intégration Sequelize~~                      | caduc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ✅ P7.4  | ⭐ **`@nodefony/drizzle`** (référence)               | `DrizzleOrm`/`DrizzleRepository`, 8 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🔶 P7.5  | Tests Mongoose                                       | 46 verts via `mongodb-memory-server` (mongod réel hermétique) — niveau **module/composant** : adapter orm-core, User (P5.8), SessionStorage CRUD, transactions, eager-load, garde-fous. ⚠️ **boot hors-kernel** + **0 E2E** (pas de serveur Nodefony bootté ni MongoDB Docker persistant) → reste à faire                                                                                                                                                                                                                                                                                                                                  |
| ✅ P7.6  | Tests Drizzle (SQLite/PG)                            | banc orm-core 8 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 🔶 P7.7  | `@nodefony/redis` refactor                           | conventions/config Zod faites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 🔶 P7.10 | ⭐ **Portabilité multi-dialecte (CRITIQUE RELEASE)** | **Slice 0 ✅** (`5bcd2d7f`+`6b596f90`, 06-26) : `connector.dialect` sqlite/postgres/mysql + `DrizzleOrm` dialect-aware (`#connectPostgres` driver `pg` lazy/optionalDep, DDL partagé) + factory `createIdempotencyTable(dialect)` (PG bigint/jsonb, colonnes agnostiques) + service `postgres` docker-compose. **e2e PG cross-pod 7/7** + idempotence Drizzle activable (`NF_IDEMPOTENCY_STORE=drizzle`, résolveur ORM lazy). Reste : **4 entités portables + mysql**. ⏸️ **EN PAUSE après P6** (user : perte de confiance ORM → comparatif froid Drizzle/Prisma/Kysely/TypeORM avant d'investir). `project_orm_multidialect_chantier_kit` |
| ⏭️ P7.8  | ~~`@nodefony/mikroorm`~~                             | **abandonné** (jamais commencé, module absent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ⏭️ P7.9  | ~~Tests MikroORM~~                                   | caduc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

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

| #       | Tâche                         | État                                                                |
| ------- | ----------------------------- | ------------------------------------------------------------------- |
| ✅ P9.1 | `@entities` decorator + tests | `kernelDecorator.ts`                                                |
| ⬜ P9.2 | Barrels `index.ts`            | résiduel                                                            |
| ✅ P9.3 | README publics                | http + framework + security présents (vérif 06-28)                  |
| 🔶 P9.4 | Vulnérabilités npm            | **3 low** transitives (dev, held back rolldown) — `npm audit` 06-28 |

### P10 — Studio admin web (73 %)

| #         | Tâche                                       | État                                                                                                                                                                          |
| --------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ P10.1  | Stack frontend (React 19) + Vite            | acté                                                                                                                                                                          |
| ✅ P10.2  | `IAdminApi` + `AdminBroker`                 | contrat figé, inversion de dép                                                                                                                                                |
| ✅ P10.3  | `IAdminApi` http/framework/syslog/frontend  | 5 producteurs, data plane `/nodefony/<m>/api/*`                                                                                                                               |
| 🔶 P10.4  | `IAdminApi` user/orm-core/security          | orm ✓ ; user/security en attente P5/P6                                                                                                                                        |
| 🔶 P10.5  | Backend Studio + WS realtime                | StudioController + JSON-RPC pub/sub ; reste IAdminApi                                                                                                                         |
| ⬜ P10.6  | Auth admin (`ROLE_NODEFONY_ADMIN`)          | dépend P6                                                                                                                                                                     |
| ✅ P10.7  | Frontend bootstrap + router + layouts       | React 19 + Mantine + MobX + WS permanent + auth réelle (P6)                                                                                                                   |
| ✅ P10.8  | Vues prio (dashboard/routes/sessions/users) | Dashboard/Modules/Routes/Cluster/Runtime/Sessions/Users ✅ livrées                                                                                                            |
| ✅ P10.x  | Docs+API modules dans Studio                | onglets Docs/API + carte Core                                                                                                                                                 |
| 🔶 P10.9  | Vues firewall/logs/databases/migrate        | Logs ✅ (WS) + Databases ✅ ; firewall/migrate attente                                                                                                                        |
| 🔶 P10.10 | Vues services/profiling                     | incrémental (~~pm2~~ retiré C6)                                                                                                                                               |
| ⬜ P10.11 | Tests intégration studio                    | 0 test studio (vérif 06-28) — back couvert e2e via security                                                                                                                   |
| ✅ P10.12 | Workspace composable (bureau)               | fenêtres libres + espaces nommés + Mission Control + catalogue à facettes (taxonomie tags) + widgets supervision (mémoire/handles/erreurs/health/gc) ; remplace dashboard Dev |
| ✅ P10.13 | Jumeau vivant (Twin)                        | explorateur archi runtime + registre de blocs unifié + forages Realtime/ORM/HTTP                                                                                              |
| ✅ P10.14 | Portail doc (`@nodefony/documentation`)     | DocLayout/MarkdownDoc/FlowGraph + data plane `/nodefony/documentation/api` (COMPLET, 14 src)                                                                                  |

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

| #         | Tâche                                     | État                                                                                                                                                                                                                                                                         |
| --------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ P14.1  | Interfaces + décision Vite                | —                                                                                                                                                                                                                                                                            |
| ✅ P14.2  | Preset `vue3-vite`                        | + module test-frontend-vue                                                                                                                                                                                                                                                   |
| ✅ P14.3  | Preset `react19-vite`                     | + Fast Refresh                                                                                                                                                                                                                                                               |
| ✅ P14.4  | `ViteProcessSupervisor`                   | child process isolé, résilience                                                                                                                                                                                                                                              |
| ✅ P14.5  | Build prod (manifest) + statique          | page blanche prod/cluster résolue (`renderProdTags`)                                                                                                                                                                                                                         |
| ✅ P14.6  | Multi-module frontend                     | N bundles cohabitent                                                                                                                                                                                                                                                         |
| 🔶 P14.7  | CLI `frontend:create/build/dev`           | commands existent (bug CLI) ; skill scaffold ✓                                                                                                                                                                                                                               |
| ✅ P14.8  | Tests intégration                         | 14 unit + 3 real spawn                                                                                                                                                                                                                                                       |
| 🔶 P14.9  | Presets Svelte/Solid/**Angular**/Vue      | **Angular ✅** (instance isolée) ; reste Svelte/Solid                                                                                                                                                                                                                        |
| ✅ P14.10 | Migration Studio sur `@nodefony/frontend` | 1er consommateur prod                                                                                                                                                                                                                                                        |
| ✅ P14.11 | **Core isomorphe**                        | Container/Service/Event/Syslog/Pdu runnable browser — shim `node:events` complété (`rawListeners`/`prepend*`, hot path `emitAsync`) ; 0 `node:` runtime dans le bundle client                                                                                                |
| ⬜ P14.12 | Plugin Vite Nodefony (alias + env)        | zéro config dev                                                                                                                                                                                                                                                              |
| ✅ P14.13 | Multi-instance Vite résilient             | familles d'isolation (default/angular)                                                                                                                                                                                                                                       |
| ⬜ P14.14 | API CSP origines dynamiques               | remplace hack POC                                                                                                                                                                                                                                                            |
| ✅ P14.15 | DevSupervisor auto-restart                | group-kill anti-orphelin, rebuild ciblé ; **introspection process MULTI-MODE** (`1bd57a7d`) : `nodefony status`/`stop` voient dev/prod/cluster (champ `mode`), gardes anti-collision fail-loud (dev refuse sur prod/cluster & inverse), `start.sh` délègue à `nodefony stop` |
| ⬜ P14.16 | Syslog isomorphe (logs front → back)      | traçabilité front                                                                                                                                                                                                                                                            |

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

### P17 — Multi-tenant / SaaS (0 %) — ⏸️ POST cloud-native (P16) + POST release 10.0.0

> Séquencement **acté 2026-06-19** : chantier ouvert APRÈS P16 ET APRÈS la release 10.0.0. Audit terrain complet + modèle + plan : mémoire IA `project_multitenant_chantier_kit`.

**Verdict audit (06-19)** : Nodefony n'est pas multi-tenant câblé MAIS l'archi est **saine** — aucun framework ne l'est par défaut (Rails/Django/Nest/Laravel/Spring = couche ajoutée) ; fondations dures déjà là (ALS, Repository, firewall central, `withTransaction` = patron de `withTenant`, slots `tenantId` semés). **Pas de refonte, couche additive.**

**Modèle acté** : pool (DB partagée + `tenant_id`) + scoping **AUTO fail-closed** + tenant dans l'**ALS** (PAS sur `IUser`) + **membership** `user × tenant × rôles`. **Livraison** = 1 module `@nodefony/tenant` + 1 seam de scope `orm-core` + 1 hook resolver firewall + entités drizzle/mongoose.

**Trous P6 à traiter** : RBAC plat global **incompatible** (→ P6.8 `IRole/IPermission` à concevoir tenant-aware) · tokens `tenantId=null` (slot existe → backfill, non bloquant).

| Lot (chemin critique = 1→2→3)                                         | Effort |
| --------------------------------------------------------------------- | ------ |
| 1. `ITenantResolver` + résolution firewall + tenant ALS               | M      |
| 2. Membership user×tenant×rôles (fonde RBAC tenant-aware)             | L      |
| 3. Repo `withTenant()` scope auto fail-closed                         | M      |
| 4. Tokens tenant-scopés · 5. cache/WS/audit · 6. RLS Postgres (bonus) | S–M    |

---

## 🛣️ Chemins (détail effort → `docs/migration/phases-details.md`)

- **MVP prod** : P0 → P1 → P2.2-2.5 + P3 minimal → P5.1-5.6 + 1 adapter (Drizzle) + session → **P6.1-6.8b ✅ LIVRÉ** + **config clean** + **CLI essentielles** (lifecycle + orm:migrate + user/security). Sécurité ✅ ; **reste MVP = config clean + CLI essentielles**.
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

> **Deux fronts pour livrer :**
>
> **A — Bloqueurs MVP** (pour un MVP utilisable) :
>
> 1. **Config clean** — 4 structures de config coexistent + défauts dupliqués = confusion réelle. Cible : 1 `config.ts` Zod par module (SEULE source des défauts) + `defineXConfig.ts` (builder) ; provenance par champ dans Studio. `project_config_clarity_chantier_kit`.
> 2. **CLI essentielles** — lifecycle (`start`/`dev`/`build`/`prod`/`cluster`) + `orm:migrate` + `user`/`security:*` : implémentées mais **NON testées en intégration** → fiabiliser + tester (P11.1-4).
>
> **B — Bloqueur RELEASE** (production-grade) :
>
> - **ORM / multi-dialecte** (P7.10) sqlite/postgres/mysql = TRÈS important + **confiance à regagner** → comparatif FROID Drizzle/Prisma/Kysely/TypeORM AVANT d'investir, puis 4 entités portables + MySQL (Slice 0 ✅ : `DrizzleOrm` dialect-aware + PG e2e 7/7). `project_orm_multidialect_chantier_kit` · `project_orm_audit_state`.
>
> ✅ **P6 (ex-bloqueur MVP) = LEVÉ** : cœur sécurité livré (authn/authz/CSRF-CORS/API Keys/Audit/2FA/Webhooks/Sessions-Users/Firewall Studio). Reste = durcissement/niches **HORS MVP** (P6.18 audit persistant, mTLS/rpId, authz niveau B, OAuth resource-server, logs auth, live audit ; modèle session NIST ✅ `e27de035`).

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
