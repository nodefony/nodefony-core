# MIGRATION_STATUS.md — Tableau de bord

> Mis à jour à chaque fin de session Claude Code.
> Légende : ✅ Migré | 🔶 Partiel | ⬜ À faire | 🚫 Bloqué | ⏭️ Skip (non pertinent)

---

## 🎯 Décisions stratégiques 2026-05-16 (LIRE EN PREMIER)

Deux discussions architecturales ont changé le cap pour les phases P5/P6/P7/P13/P14 + ajout d'une Phase 15. **Toutes les décisions sont conservées dans la mémoire IA pour persistance cross-session** :
- `~/.claude/projects/.../memory/project_decisions_p5_p6_orm.md` — Sécurité + ORM + IUser
- `~/.claude/projects/.../memory/project_decisions_realtime_isomorphic.md` — Realtime + Core isomorphe + Mediasoup

### Sécurité (P6)
- ❌ **Passport.js ABANDONNÉ** totalement (incompatible TS strict + ALS, ère Express callbacks)
- ❌ **Sessions HTTP RAM serveur ABANDONNÉES** (2026-05-20) — JWT cookie `HttpOnly;Secure;SameSite=Strict` only. Service `sessions` existant deprecated en P6, suppression P16
- ✅ Cœur firewall 100% Nodefony pur ; vendors interchangeables au bout :
  - Local/password → `BcryptEncoder` maison (vit dans **@nodefony/user**, plus dans @nodefony/security)
  - JWT → `jose` (TS-first moderne) + cookie `nodefony_at` (15min) + refresh `nodefony_rt` (7j, rotation OWASP)
  - OAuth/social → **`arctic`** (créateur de Lucia, type-safe, léger) — 1 seul `OAuth2Authenticator` config-driven pour 50+ providers
  - mTLS → 🆕 `MTlsAuthenticator` pour zones admin (Node `tls.createServer({requestCert:true})`)
- 🔁 **P6.5 re-révisée 2026-05-20** : abandon complet du terme "Bridge" — pattern `IAuthenticator` + classes `*Authenticator` (Spring-like clean)
- 🔁 **P6.9 re-révisée 2026-05-20** : 5 stratégies OAuth → 1 seul `OAuth2Authenticator` config-driven. LDAP retiré du core (→ plugin externe `@nodefony/auth-ldap` post-P6). -1.5 ses.
- 🆕 **Config builder** : `defineSecurityConfig()` (style Vite) + validation **Zod** schema au boot (détection conflits patterns)
- 🆕 **CSRF refacto** : SameSite + Origin check par défaut, décorateur `@CsrfProtect({ttl})` opt-in HMAC pour routes critiques
- ➕ **Décorateurs sécurité panoplie étendue** : `@IsGranted`, `@HasAnyRole`, `@HasAllRoles`, `@HasCurrentRole`, `@CurrentUser()`, `@AuditLog()`, `@WafGuard()`, `@CsrfProtect()` via `Reflect.metadata` + hook `beforeResolve` (P1.7)
- ➕ **3 niveaux d'autorisation P6.8** : (A) RoleHierarchy config, (B) RBAC modèle ORM, (C) Voters (`IAccessVoter`) contextuels
- ➕ **Zero Trust par défaut** : route sans décorateur sécurité → 403 systématique

### User/IUser (P5.5) — 🆕 module séparé @nodefony/user (2026-05-20)
- 🆕 **`@nodefony/user` module workspace séparé** créé (révision 2026-05-20) — révise décision originale IUser-dans-security. Cf `project_nodefony_user_module.md`
- ✅ 3 couches étanches : `IUser` (contrat strict) + `BaseUser` POJO + classes par ORM (`MikroOrmUser`, `MongooseUser`, schéma Drizzle isolé)
- ✅ Champs anti-migration : `socialProviders[]` JSON (pas `googleId/githubId` en colonnes), `metadata: Record`, `currentRole` (session)
- ✅ `IUserProvider` étendu : `loadUserByOAuth(provider, providerId)` + `refreshUser(user)`
- ✅ Pattern **Shadow User** (ligne locale créée même pour login OAuth)
- ➕ **BcryptEncoder + IPasswordEncoder + UserService** vivent désormais dans @nodefony/user (consommables par security, Studio, orm, agent, etc. sans tirer toute la security)

### ORM (P7)
- ⭐ **Drizzle** = choix #1 SQL moderne
- 🆕 **MikroORM AJOUTÉ** comme 4ème driver (Data Mapper + Unit of Work pour apps complexes) — nouvelle ligne P7.x
- ✅ Mongoose = standard NoSQL
- 🪦 Sequelize = legacy maintenance descendante uniquement, plus de nouveaux dev
- ➕ **`IOrmManager.getNativeConnection()`** obligatoire dans P5.1 (trappe SQL brut anti-blocage)

### Realtime + Core isomorphe (P13/P14)
- 🔥 **P13.3 SUPPRIMÉE** — `@nodefony/client` n'est PAS un module séparé. Le **Core Nodefony devient isomorphe** : Container DI, Syslog, Service exportables côté navigateur (intégré dans P14)
- ➕ **Pattern `IRealtimeHub`** : `LocalRealtimeHub` (dev) + `RedisRealtimeHub` (P13.2) + **`KafkaRealtimeHub`** 🆕 (cluster massif, persistence, agents IA)
- ➕ **`RealtimeService` central** : façade unifiée, normalise TCP/UDP/Unix/WS en `{event, payload, meta}`, filtre échos cluster, crée `RequestContext` pour cohérence ALS
- ✅ **Protocole JSON-RPC 2.0 maison léger** (pas de wrap Socket.IO) — RPC bidirectionnel + HTTP long-polling fallback + end-to-end type safety (interfaces `ServerToClientEvents` / `ClientToServerEvents` partagées)
- ➕ Décorateurs `@RealtimeController`, `@RealtimeEvent`

### Phase 15 NOUVELLE — Mediasoup + SIP/Asterisk
- 🆕 `@nodefony/mediasoup-bundle` + connecteur Asterisk ARI/AMI — test ultime archi
- Cas d'usage cible : agent IA vocal téléphone (PSTN → Asterisk → mediasoup PlainTransport → STT → LLM → TTS → retour)
- **PAS** du WebRTC navigateur — `PlainTransport` RTP brut uniquement
- Priorité : APRÈS P12 (agents IA) + P13 (realtime) solides
- Cluster : `PipeTransports` mediasoup pour pod-to-pod (bypass Redis/Kafka pour flux media binaires)

### Phase 16 NOUVELLE — Cloud-Native (plan figé 2026-05-20, code différé après P6)
- 🆕 Nodefony cible **1 process Node = 1 pod / container** (k8s, Docker, Nomad, Cloud Run, Fargate)
- Plan **7 axes / 26 sous-tâches** (16.A Kernel & Lifecycle, 16.B HTTP, 16.C Secrets, 16.D Docker, 16.E Skills, 16.F PM2 cleanup, 16.G Docs DevOps)
- **Décisions figées** : healthz/readyz dans `@nodefony/http`, trusted proxies parser http + whitelist security, **SecretProvider dans `@nodefony/security`** (contrat figé `get/getRequired/getAs<T>`), docker-compose progressif minimal, tini PID 1
- Scaling horizontal délégué à l'orchestrateur (HPA) — fini `exec_mode: "cluster"` PM2
- Process supervision : k8s liveness/readiness probes, systemd, Docker restart-policy
- `pm2Service` + commande `nodefony pm2:*` + `MODE_START === "PM2"` retirés (P16.F)
- Mode `production` foreground par défaut + healthz endpoint + graceful SIGTERM
- **Démarrage du code attendu après P6 (couche security complète)** — fondation SecretProvider vit dans `@nodefony/security`, IUser/UserService vivent dans **`@nodefony/user`** (révision 2026-05-20)
- Voir mémoires `project_cloud_native_plan.md` + `project_pm2_deprecation.md` + sources `CLOUD-NATIVE.txt` / `SECURITY.txt`

---

## Progression globale

| Catégorie                            | Total   | ✅     | 🔶    | ⬜     |
| ------------------------------------ | ------- | ------ | ----- | ------ |
| **Build System**                     | 10      | 10     | 0     | 0      |
| Core / Kernel                        | 6       | 4      | 0     | 2      |
| DI Container                         | 3       | 2      | 0     | 1      |
| Module System                        | 5       | 3      | 0     | 2      |
| Syslog / Pdu                         | 4       | 4      | 0     | 0      |
| Router                               | 4       | 4      | 0     | 0      |
| HTTP / WS                            | 6       | 0      | 0     | 6      |
| Controller                           | 3       | 3      | 0     | 0      |
| Session (refactor)                   | 8       | 1      | 2     | 5      |
| **User module (NEW — séparé 2026-05-20)** | 13 | 0      | 0     | 13     |
| **ORM Core (NEW)**                   | 11      | 0      | 0     | 11     |
| ORM Drivers (Sequelize/Mongoose/**Drizzle**/**MikroORM**🆕) | 9 | 0      | 0     | 9      |
| Security / Auth (+ décorateurs panoplie + Voters + Authenticators + defineSecurityConfig + Zod, refondé 2026-05-20) | 13 | 0 | 0 | 13 |
| CLI                                  | 4       | 0      | 0     | 4      |
| Monitoring                           | 3       | 0      | 0     | 3      |
| Types / Interfaces                   | 6       | 5      | 0     | 1      |
| **Symbiose http↔fw (Phase 9.1)**     | 8       | 0      | 5     | 3      |
| **Cycle de vie Context (Phase 9.2)** | 12      | 0      | 0     | 12     |
| **Logs structurés (Phase 9.3)**      | 10      | 0      | 0     | 10     |
| **Studio admin web (Phase 10)**      | 11      | 1      | 3     | 7      |
| **CLI commandes par module (P11)**   | 14      | 0      | 0     | 14     |
| **IA — llm/vector/rag/memory (P12.1)** | 5     | 0      | 4     | 1      |
| **IA — agent orchestrateur (P12.2)** | 6       | 0      | 1     | 5      |
| **IA — MCP (P12.3)**                 | 5       | 0      | 0     | 5      |
| **IA — agent-guard (P12.4)**         | 10      | 0      | 0     | 10     |
| **IA — Studio panels (P12.5)**       | 4       | 0      | 0     | 4      |
| **IA — Tests E2E + AI Act (P12.6)**  | 6       | 0      | 0     | 6      |
| **Realtime TCP/UDP/Unix (P13.1)**    | 13      | 0      | 0     | 13     |
| **Redis cluster + pub/sub (P13.2)**  | 13      | 1      | 1     | 11     |
| 🆕 **RealtimeHub + Service + RPC (P13.4-9)** | 6 | 0      | 0     | 6      |
| 🆕 **Kafka driver (P13.6)**          | 1       | 0      | 0     | 1      |
| **Frontend Vite + 🆕 Core isomorphe (P14)** | 13 | 0      | 0     | 13     |
| 🆕 **Mediasoup + SIP/Asterisk (P15)** | 8     | 0      | 0     | 8      |
| 🆕 **Cloud-native + retrait PM2 (P16 — 7 axes)** | 26 | 0   | 0     | 26     |
| **TOTAL**                            | **297** | **37** | **13**| **247**|

---

## 🗺️ Roadmap priorisée (dette technique d'abord)

> **Stratégie** : valider la fondation (hooks `Context` + tests symbiose) AVANT toute nouvelle feature (security, ORM, monitoring).
> **Unité d'effort** : 1 session Claude ≈ 1-4 h (réf. journal historique). Estimations indicatives.
> **Dépendances** : une tâche P_n peut dépendre d'une P_<n>. Lecture verticale possible.

### P0 — Bugs bloquants ouverts (avant toute nouvelle feature)

| #     | Tâche                                                                      | Phase    | Effort | Dépendances | Notes                                                                                       |
| ----- | -------------------------------------------------------------------------- | -------- | ------ | ----------- | ------------------------------------------------------------------------------------------- |
| ✅ P0.1 | Fix **11 fails** `http-rfc-errors.test.ts`                                  | 9.1 #6   | 1 ses. | —           | Résolu (commit d0f8ecf) — RFC 9110 §15.5.6 ne s'applique pas WS. Tests 370/0 (2026-05-16)   |
| ✅ P0.2 | Fix **2 fails WS binary séquentiels**                                       | —        | 1 ses. | —           | Résolu — tests WS binary verts. Vérifié 2026-05-16 (370 passing)                            |
| ✅ P0.3 | `IModule.getController()` → `IController` (au lieu de `unknown`)            | Blocker  | 0.5 ses. | Phase 5.1 ✅ | Résolu (commits f2208d2 + 83049fc) — `IControllerConstructor<T>` générique                   |
| ✅ P0.4 | **BUG-001 + BUG-002** — propagation ALS (WS messages + `onAfterResponse`)   | Blocker P6 | 1 ses. | P1.4 ✅      | ✅ 2026-05-20 — `AsyncResource.bind` (WebsocketContext close/message + Context.onAfterResponse). Tear-down dedup intact, 0 fuite listener → **avance P2.2 + P4.3**. **Débloque P6 décorateurs security isomorphes** |
| ✅ P0.5 | **BUG-003** — leak scope DI sur erreur WS avant `connect()`                  | Mémoire/DoS | 0.5 ses. | P0.4       | ✅ 2026-05-20 — `teardownWired` + `releaseOrphanWsScope` dans `handleWebsocket` catch. Preuve par comptage `container.scopes` (404/1002 → reste à 1). Tests delta scopes (intégration + load). HTTP déjà sûr (listeners finish/close tôt). |
| ✅ P0.6 | **BUG-004** — leak scope DI sur WS **avec session** fermé au handshake       | Mémoire    | 0.5 ses. | P0.5       | ✅ 2026-05-20 — `onFinish` ne dépend plus de `once("onSaveSession")` : `await saveSession()` puis cleanup inconditionnel. Preuve : 100 WS session open/close → reste à 1 (avant 100). Tests delta (intégration 468/0 + load 12/0, memory OK). |

### P1 — Fondations symbiose (refactors techniques 9.5)

> Tout le reste de la Phase 9 et la Phase 6 (security) en dépend. Faire d'abord, sinon retour en arrière garanti.

| #     | Tâche                                                                                 | Phase     | Effort | Dépendances | Notes                                                                                          |
| ----- | ------------------------------------------------------------------------------------- | --------- | ------ | ----------- | ---------------------------------------------------------------------------------------------- |
| ✅ P1.1 | `Context.lifecycle` — exposer `phases: PhaseTiming[]` rempli par HttpKernel             | 9.5 #1    | 1 ses. | P0.1        | ✅ 2026-05-16 — `Context.phases` + `phaseStart/phaseEnd` ; HttpKernel instrumente parse/resolve/firewall/action ; 7 tests verts (377/0) |
| ✅ P1.2 | `Context.onAfterResponse(fn)` + listener `response.on("finish"\|"close")`               | 9.5 #3    | 1 ses. | P0.1        | ✅ 2026-05-16 — hook dédup finish/close ; HTTP + WS ; 6 tests verts (383/0). Débloque P3.1 audit log, P2.2 tear-down, metrics post-réponse |
| ✅ P1.3 | `context.signal: AbortSignal` (`request.on("close")`)                                 | 9.5 #4    | 1 ses. | —           | ✅ 2026-05-16 — lazy alloc (zéro overhead si signal non lu), abort sur client disconnect HTTP + WS, `_abortIfPending()` interne HttpKernel, 5 tests verts (388/0). Memory inchangé |
| ✅ P1.4 | `RequestContext` — `AsyncLocalStorage` `requestId` (+ userId/user/scheme/traceparent)   | 9.5 #5    | 2 ses. | P1.2 ✅    | ✅ 2026-05-16 — `RequestContext` exporté depuis `nodefony` (lazy ALS). HttpKernel wrap `handleHttp`+`handleWebsocket`. API : `run/get/getRequestId/getUser/getUserId/set`. 6 tests verts (418/0). Memory inchangé. **Débloque P3.1 audit log, P6.8b décorateurs `@IsGranted`, P13.4 RealtimeService TCP/UDP** |
| ✅ P1.5 | `errorRenderer` module unifié HTTP+WS (sortie JSON cohérente)                           | 9.5 #6    | 1 ses. | P0.1        | ✅ 2026-05-16 — `IErrorRenderer` interface + `DefaultErrorRenderer` singleton + `setErrorRenderer()` override. Shape JSON inchangée. 9 tests unit + 388 intégration verts, memory OK. Préalable AuthFailureHandler (P6) + tests symbiose 9.1.6 |
| ✅ P1.6 | `HttpKernel.logRequest()` extrait + `IRequestLogger` pluggable                          | 9.5 #2    | 0.5 ses. | P1.2 ✅    | ✅ 2026-05-16 — `IRequestLogger` interface + `DefaultRequestLogger` singleton + `setRequestLogger()`. `Context.logRequest` et `WebsocketContext.logRequest` délèguent. Format inchangé. 9 tests unit + 403 intégration verts. Préalable audit log P3.1 + pretty P3.2 + NCSA P3.10 |
| ✅ P1.7 | Hooks `Context` pour security : `beforeResolve`, `afterAuth`, `onAuthFailure`           | 9.5 #7    | 1 ses. | P1.2 ✅, P1.5 ✅ | ✅ 2026-05-16 — `httpKernel.fireAsync("beforeResolve"\|"afterAuth"\|"onAuthFailure")` HTTP+WS. Invariant : `afterAuthCount <= beforeResolveCount`. 6 tests verts (403/0). Memory inchangé. **Phase 6 débloquée** |
| P1.8  | ✅ Graphe symbolique TS (`scripts/generate-symbols.ts` + skill)                          | NEW       | done   | —           | `.ai/symbols.json` (stable, 152 KB) + `dist/symbols.json` (verbose, 560 KB) — `npm run generate-symbols` |

### P2 — Cycle de vie Context (axes 9.2 consommant les hooks P1)

| #     | Tâche                                                              | Axe     | Effort  | Dépendances | Notes                                                  |
| ----- | ------------------------------------------------------------------ | ------- | ------- | ----------- | ------------------------------------------------------ |
| P2.1  | Boundary timing phase-by-phase                                     | 9.2.9   | 1 ses.  | P1.1        | `performance.now()` à chaque hook HttpKernel           |
| P2.2  | Context tear-down déterministe (finish + close, dedup)             | 9.2.11  | 0.5 ses.| P1.2        | Couplé à P1.2                                          |
| P2.3  | Aborted requests cleanup + 499 status interne                      | 9.2.12  | 1 ses.  | P1.3        | Utilise `context.signal`                               |
| P2.4  | `initialize()` error boundary — réponse cohérente avec action crash | 9.2.16  | 0.5 ses.| P1.5        | Réutilise errorRenderer                                |
| P2.5  | Request timeout global (config + 408)                              | 9.2.18  | 0.5 ses.| P1.3        | Utilise AbortSignal                                    |
| P2.6  | Idempotency keys (`X-Idempotency-Key`)                             | 9.2.17  | 1 ses.  | P1.4        | Dédup via ALS scope court terme                        |
| ✅ P2.7 | W3C `traceparent` honor + génère                                   | 9.2.20  | 0.5 ses.| P1.4 ✅    | ✅ 2026-05-17 — helper `service/trace.ts` (parse+resolve), `Context.traceparent` (HTTP+WS), HttpKernel set au boot du scope ALS, Response inject `traceparent` header. Honor traceId+flags si incoming valide / new spanId. 8 tests intégration verts. Memory 8/8 inchangé |
| P2.8  | Backpressure documentation + tests streaming                       | 9.2.13  | 1 ses.  | —           | Indépendant — focus media + download                   |
| P2.9  | Body streaming vs buffered (`@Body({ stream })`)                   | 9.2.14  | 1 ses.  | P0.1        | Lien upload formidable                                 |

### P3 — Logs structurés (consomme P1.2 + P1.6 + P2.1)

| #     | Tâche                                                          | Axe       | Effort  | Dépendances | Notes                                                  |
| ----- | -------------------------------------------------------------- | --------- | ------- | ----------- | ------------------------------------------------------ |
| ✅ P3.1 | Audit log canonique (1 PDU par requête, JSON)                  | 9.3.21+9.2.19 | 1 ses. | P1.2 ✅, P1.6 ✅, P1.4 ✅ | ✅ 2026-05-16 — `JsonAuditLogger implements IRequestLogger` ; activable via `httpKernel.setRequestLogger(new JsonAuditLogger())` ; 18 tests unit + 436/0 intégration ; **P3.3 severity status + P3.4 header redaction bonus** |
| ✅ P3.2 | Pretty formatter dev (1 ligne colorée par requête)             | 9.3.22    | 1 ses.  | P3.1 ✅    | ✅ 2026-05-16 — `PrettyRequestLogger implements IRequestLogger` ; format `METHOD STATUS /url duration FROM [req-id]` colorisé ; severity status-based ; 11 tests verts |
| ✅ P3.3 | Severity selon HTTP status (1xx-3xx INFO / 4xx WARN / 5xx ERR) | 9.3.23    | 0.5 ses.| P3.1 ✅    | ✅ 2026-05-16 — `severityFromStatus()` exporté ; intégré dans `JsonAuditLogger` ; 7 tests verts |
| ✅ P3.4 | Header redaction (Authorization/Cookie/Set-Cookie)             | 9.3.29    | 0.5 ses.| P3.1 ✅    | ✅ 2026-05-16 — flags `hasAuthorization` / `hasCookie` (boolean) dans `JsonAuditLogger`, valeurs jamais loggées ; 2 tests redaction verts |
| ✅ P3.5 | Erreur enrichie (1 PDU ERROR par requête + cause chain + stack) | 9.3.26   | 0.5 ses.| P3.1 ✅, P1.5 ✅ | ✅ 2026-05-16 — `AuditErrorEntry { name, message, code?, errorType?, stack?, cause? }` récursif. Stack conditionnel via `NODE_ENV !== "production"` (override via opts.includeStack). `maxCauseDepth` configurable (default 5, anti-cycle). 6 tests P3.5 verts |
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

### P5 — Session + User + ORM Core (préalables Security)

> **Ordre critique** : `ORM core` (interfaces) → `User` (entité + adapters) → `Session refactor` (`session.user: IUser`) → Security peut alors démarrer (P6).
> Sans ce socle, Security va re-créer son propre User et on aura divergence.

| #      | Tâche                                                                          | Phase     | Effort  | Dépendances | Notes                                                                       |
| ------ | ------------------------------------------------------------------------------ | --------- | ------- | ----------- | --------------------------------------------------------------------------- |
| P5.0   | **Mode batch/console — gate `initServers()` par `KernelType`** : `Kernel.onReady()` ne démarre les serveurs que si `type === "SERVER"`. Permet de booter le socle (DI, modules, ORM, log) **sans** ouvrir http/ws/static. | NEW 2026-05-20 | 0.5 ses. | — | Le type `console`/`server` existe déjà mais `onReady()` appelle `initServers()` inconditionnellement (gate actuel = présence de `HttpKernel`). Câbler le vrai gate + une `BatchCommand` exemple (`generate()` avec accès DI). 1er consommateur réel de l'ORM hors requête HTTP. ⚠️ Faire avant P5.4 pour tester l'ORM en batch |
| P5.0b  | **Service Cron / Worker long-vivant** — migrer le `cronService.es6` legacy (wrapper `node-cron` : `createTask/start/stop/delete/validate` + `cronTab`). Mode "batch qui ne meurt jamais" : boot console + scheduler garde l'event loop vivant. | NEW 2026-05-20 | 1 ses. | P5.0 | ✅ **Décision (2026-05-20)** : **on garde le service**, mais **découplé du serveur** — il vit dans un process **worker dédié** (mode console/batch P5.0), **jamais** dans les pods serveur scalés (sinon la tâche fire N×, pas d'élection de leader). Raison : garder Nodefony auto-suffisant (parité Symfony, pas d'orchestrateur requis) + DX (tâche en code avec accès DI/ORM). **Escape hatch documenté** : k8s CronJob → `BatchCommand` éphémère pour les déploiements orchestrés. Élection de leader multi-replica (lock Redis) → branchée à P13 (cluster). Réf : `../nodefony/.../kernel/services/cron/cronService.es6` (123 L, `node-cron`) |
| P5.2   | `OrmRegistry` + `EntityRegistry` + `Orm` base class                            | 7.3       | 1 ses.  | P5.1        | Singleton process-wide, multi-ORM support natif                             |
| P5.3   | `@entity` + `@repository` decorators                                            | 7.3       | 1 ses.  | P5.2        | Métadonnées Reflect, auto-register au boot                                  |
| P5.4   | Tests unit orm-core (registry, entity, decorators) + multi-orm integration test | 7.5       | 1 ses.  | P5.3        | **CRITIQUE** : prouve qu'on peut tourner 2 ORM en parallèle                 |
| P5.5a  | 🆕 **Création workspace `@nodefony/user`** : `package.json`, `tsconfig.json`, `rollup.config.ts`, `README.md`, `CLAUDE.md`, `MEMORY.md`, `index.ts`, structure `nodefony/contracts/` + `nodefony/src/` + `nodefony/service/` | NEW 2026-05-20 | 1 ses. | P5.4 | Module séparé acté 2026-05-20 — révise décision originale. Cf `project_nodefony_user_module.md`. Setup workspace standard + types `dist/types/` + exports |
| P5.5   | `@nodefony/user` contracts : `IUser` (contrat strict) + `BaseUser` POJO + `AnonymousUser` + `IUserRepository` + `IUserProvider` (+ `loadUserByOAuth`, `refreshUser`) + **`IPasswordEncoder`** | 5.3 | 2 ses.  | P5.5a       | **Champs anti-migration** : `socialProviders[]` JSON, `metadata: Record`, `currentRole` (session). Pattern Shadow User. ⚠️ Voir mémoires `project_decisions_p5_p6_orm.md` + `project_nodefony_user_module.md` |
| P5.6   | `@nodefony/user/service/UserService.ts` (CRUD + `authenticate()`) + events lifecycle + **`BcryptEncoder`** (déplacé depuis P6.1) | 5.3 | 1 ses. | P5.5 | register/authenticate/disable/lock + events pour audit. BcryptEncoder vit dans @nodefony/user (révision 2026-05-20) — supplante l'ancienne place P6.1 |
| P5.7   | Adapter Sequelize (User entity + repository)                                   | 5.3       | 1 ses.  | P5.5, P7.1  | Migration legacy `users-bundle/Entity/sequelize/`                           |
| P5.8   | Adapter Mongoose (User entity + repository)                                    | 5.3       | 1 ses.  | P5.5, P7.2  | Migration legacy `users-bundle/Entity/mongoose/`                            |
| P5.9   | Adapter Drizzle (User entity + repository) — **nouveau**                       | 5.3       | 1 ses.  | P5.5, P7.4  | Pas de référence JS, design from scratch                                    |
| P5.10  | Tests intégration User cross-ORM (même IUser, 3 adapters CRUD)                 | 5.3       | 1 ses.  | P5.7-9      | Garantit que IUser tient face aux 3 drivers                                 |
| P5.11  | **Session refactor** : `session.user: IUser` + `regenerateId()` + hooks invalidation | 5.2 | 1 ses.  | P5.5        | Étendre `session.ts` actuel, pas réécrire                                   |
| P5.12  | `MemorySessionStorage` (tests) + `RedisSessionStorage` (prod)                  | 5.2       | 1 ses.  | P5.11, **P13.2** | Drivers manquants — file storage déjà ✅ — RedisSessionStorage en P13.2 |
| P5.13  | `OrmSessionStorage` générique (via orm-core)                                   | 5.2       | 1 ses.  | P5.11, P5.4 | Storage backed par n'importe quel ORM enregistré                            |
| P5.14  | Tests intégration sessions cross-request + expiry + flash + invalidation       | 5.2       | 1 ses.  | P5.13       |                                                                              |

### P6 — Security (Phase 6 / 9.6) — refondée 2026-05-20

> **Bloc complet** : ne pas démarrer avant que P1.7 (hooks `Context`) + P1.4 (ALS) + P1.5 (errorRenderer) soient ✅ **ET** **P5.5a + P5.5 + P5.6** (workspace `@nodefony/user` + IUser + UserService + BcryptEncoder) soient ✅. Sans User canonique, le Firewall recrée son propre type User → divergence garantie.
>
> **🆕 Décisions structurantes 2026-05-20** (cf mémoires `project_security_module_design.md`, `project_security_stateless_http_decision.md`) :
> - HTTP **full stateless** — JWT cookie `HttpOnly; Secure; SameSite=Strict` + refresh token cookie séparé (rotation OWASP). Sessions HTTP RAM serveur **abandonnées** (`@deprecated` en P6, suppression effective P16)
> - Pattern **`IAuthenticator` + classes `*Authenticator`** — abandon des termes "Bridge" et "Factory"
> - **3 tokens core** (Anonymous, UserPassword, Jwt) + **2 étendus** (OAuth2 via arctic, MTls) — LDAP/OpenID/GitHub/Google séparés ABANDONNÉS du périmètre P6 (LDAP → plugin externe `@nodefony/auth-ldap` post-P6 ; Google/GitHub/etc. absorbés par `OAuth2Authenticator` config-driven via arctic)
> - **CSRF** : SameSite + Origin check par défaut, décorateur `@CsrfProtect({ttl})` opt-in (HMAC double-submit) pour routes critiques
> - Config : **`defineSecurityConfig()` builder** (style Vite) + validation **Zod** schema au boot

| #      | Tâche                                                            | Source JS                                       | Effort  | Dépendances | Notes                                                          |
| ------ | ---------------------------------------------------------------- | ----------------------------------------------- | ------- | ----------- | -------------------------------------------------------------- |
| P6.1   | `AccessControl` (RBAC hierarchy walker)                          | `accessControl.js`                              | 0.5 ses.| —           | Fondation simple. ⚠️ `BcryptEncoder` déplacé en **P5.6** (@nodefony/user, révision 2026-05-20) |
| P6.2   | `cors.ts` service                                                 | `corsService.js` (182 L)                        | 1 ses.  | P1.7        | Plus simple, débloque API browser. Whitelist stricte, jamais `*` avec Credentials |
| P6.3   | `firewall.ts` service + `SecuredArea` match + **`defineSecurityConfig()` builder + Zod schema** | `firewallService.js` (694 L) | 3.5 ses. | P1.7, P1.4, P1.5, **P5.5** | Découper (a) `SecuredArea` (b) `defineSecurityConfig()` builder + validation Zod + détection conflits patterns au boot (c) auth pipeline. Consomme `IUserProvider` de @nodefony/user. **Origin/Referer check natif** pour CSRF defense |
| P6.4   | **`AnonymousAuthenticator`** + `AnonymousToken`                  | `anonymousProvider.js` + factories              | 1 ses.  | P6.3, **P5.5** | Utilise `AnonymousUser` de @nodefony/user. Pattern `IAuthenticator` (pas Factory/Bridge) |
| P6.5   | **`UserPasswordAuthenticator`** + `UserPasswordToken`             | `passportFramework.js` (référence design — code abandonné) | 1 ses. | P6.3, P6.4, **P5.6** | ⚠️ **Passport + Bridge ABANDONNÉS**. 1ère stratégie réelle, utilise `userService.authenticate()` (P5.6). Pattern `IAuthenticator`. **-1 ses. vs original** (plus de bridge à écrire) |
| P6.6   | **`JwtAuthenticator`** + `JwtToken` (via `jose`) + **cookie JWT layer** (`nodefony_at` 15min + `nodefony_rt` 7j Path=/auth/refresh, rotation OWASP) | —                                               | 1.5 ses.| P6.5        | `jose` (RFC 7519 + RFC 7515, EdDSA/RS256). Endpoint `/auth/refresh` génère nouveau access token + rotation refresh token. Cf `project_security_stateless_http_decision.md` |
| P6.7   | `csrf.ts` service — **defense par défaut SameSite + Origin check** (pas de token CSRF classique) + **décorateur `@CsrfProtect({ttl})` opt-in** (HMAC double-submit pour routes critiques) | `csrfService.es6` (193 L) | 1.5 ses. | P6.3        | Refacto majeur. Pattern OWASP CSRF Cheat Sheet 2024. Token CSRF classique abandonné par défaut. HMAC signé `requestId+userId+ttl` pour routes critiques opt-in |
| P6.8   | `authorization.ts` — **3 niveaux** : (A) `roleHierarchy` config + `RoleHierarchyWalker` (B) modèle ORM `IRole`+`IPermission` (RBAC) (C) `IAccessVoter` interface (Voters contextuels) | `authorizationService.js` | 3 ses.  | P6.3, P6.1, P5.5 | ACL/rôles — consomme `user.hasRole()` de IUser (@nodefony/user). Voters = killer feature pour métier complexe |
| P6.8b  | **Décorateurs sécurité panoplie** : `@IsGranted(role)`, `@HasAnyRole(...roles)`, `@HasAllRoles(...roles)`, `@HasCurrentRole(role)`, `@IsGranted(action, {subjectFromParam, voter})`, `@CurrentUser()`, `@AuditLog()`, `@WafGuard()`, `@CsrfProtect()` | NOUVEAU (analyse 2026-05-16, étendu 2026-05-20) | 1.5 ses. | P6.8, P1.7, P1.4 | `Reflect.metadata('security:requirements')` lue dans hook `beforeResolve`. ALS pour `user` type-safe. **Zero Trust par défaut** : route sans décorateur → 403 systématique |
| P6.9   | **`OAuth2Authenticator`** + `OAuth2Token` config-driven via **`arctic`** (1 authenticator pour Google/GitHub/Microsoft/Apple/Discord/etc., 50+ providers) | NOUVEAU (arctic lib) | 1.5 ses. | P6.6        | Arctic (créateur de Lucia), TS-first. **-1.5 ses. vs original** (un seul Authenticator vs 5 stratégies). **LDAP/OpenID/GitHub/Google séparés ABANDONNÉS** (LDAP → plugin externe `@nodefony/auth-ldap` post-P6) |
| P6.9b  | 🆕 **`MTlsAuthenticator`** + `MTlsToken` (mutual TLS cert client pour zone `admin`) | NEW 2026-05-20 | 1 ses. | P6.5 | Double-facteur infra+app. Configuration via Node `tls.createServer({ requestCert: true, ca: [...] })`. Pour zones `admin` critiques |
| P6.10  | Logs auth (audit S1-S5) + **CSP stricte** `default-src 'self'` + nonces + security headers (HSTS, X-Content-Type-Options, X-Frame-Options) | — | 1 ses. | P3.1, P6.3 | Extension de 9.3 / 9.6 — OWASP A05:2021. Nonces CSP par requête. Aligné avec `project_csp_vite_security_todo.md` (API CSP origines dynamiques) |
| P6.11  | Tests intégration security complets (firewall-http/ws, cors, csrf double-submit, oauth2, mtls, decorators, voters, stack symbiose) | — | 2.5 ses. | P6.10 | `symbiose-stack.test.ts` couvre CORS→Firewall→ACL→CSRF→Authenticator chain→Controller. Tests `@CsrfProtect` HMAC, JWT rotation, OAuth2 arctic, mTLS handshake |

### P7 — ORM Drivers (consomment orm-core de P5.1-P5.4)

> Architecture refondue — voir [Phase 7](#phase-7--orm-multi-driver-architecture-refondée).

| #     | Tâche                                                                        | Effort  | Dépendances | Notes                                                  |
| ----- | ---------------------------------------------------------------------------- | ------- | ----------- | ------------------------------------------------------ |
| P7.1  | 🪦 `@nodefony/sequelize` — legacy maintenance uniquement (v6 figé, **pas nouveaux dev**) | 2 ses.  | P5.4        | Compat ascendante max. NE PLUS communiquer dessus. ⚠️ Voir mémoire `project_decisions_p5_p6_orm.md` |
| P7.2  | `@nodefony/mongoose` — `Orm` extends + connector                             | 1 ses.  | P5.4        | Module existe partiellement. Standard NoSQL acté       |
| P7.3  | Tests intégration Sequelize (SQLite memory)                                  | 1 ses.  | P7.1        | Filet de sécurité legacy                               |
| P7.4  | ⭐ **`@nodefony/drizzle` (NEW)** — `Orm` + connector + schema TS-first       | 3 ses.  | P5.4        | **Choix #1 SQL moderne 2026** — type-safe natif, SQL brut via tag `sql`` `` |
| P7.5  | Tests intégration Mongoose (mongodb-memory-server)                           | 1 ses.  | P7.2        |                                                        |
| P7.6  | Tests intégration Drizzle (SQLite/Postgres)                                  | 1 ses.  | P7.4        |                                                        |
| P7.7  | `@nodefony/redis` refactor (cache + session storage)                         | 1 ses.  | P5.12       | Existant — adapter à orm-core lifecycle si pertinent   |
| P7.8  | 🆕 **`@nodefony/mikroorm` (NEW)** — Data Mapper + Unit of Work + Identity Map | 3 ses. | P5.4        | 4ème ORM ajouté 2026-05-16 — apps complexes (Doctrine-like). Trappe SQL brut via `em.getConnection().execute()` |
| P7.9  | Tests intégration MikroORM (SQLite/Postgres)                                 | 1 ses.  | P7.8        |                                                        |

### P8 — CLI + Monitoring (Phase 8)

| #     | Tâche                                                          | Effort  | Dépendances | Notes                                          |
| ----- | -------------------------------------------------------------- | ------- | ----------- | ---------------------------------------------- |
| P8.1  | `bin/nodefony.ts` — shebang via rollup banner                  | 1 ses.  | —           | CLI principal                                  |
| P8.2  | Generators (`Module.ts`, `Controller.ts`, `Service.ts`)        | 1 ses.  | P8.1        |                                                |
| P8.3  | `DebugBar` (monitoring middleware HTML + JSON)                 | 2 ses.  | P3.1        | Consomme audit log                             |
| P8.4  | `Metrics` runtime (memory, requests, errors)                   | 1 ses.  | P3.1        |                                                |

### P11 — Tests commandes CLI + commandes par module (Phase 11)

> Voir [Phase 11](#phase-11--commandes-cli-par-module-non-testées-actuellement). 9 commandes existantes pas testées + commandes manquantes par module.

| #      | Tâche                                                                          | Effort  | Dépendances        | Notes                                          |
| ------ | ------------------------------------------------------------------------------ | ------- | ------------------ | ---------------------------------------------- |
| P11.1  | Tests intégration des 9 commandes CLI existantes                               | 1 ses.  | —                  | spawn sub-process + assertion stdout           |
| P11.2  | Commandes `http:*` (routes, sessions, cert, stats)                             | 1 ses.  | P10.3              | Couplée à API admin Studio                     |
| P11.3  | Commandes `framework:*` + `security:*` + `user:*`                              | 1 ses.  | P6.8, P5.6         |                                                |
| P11.4  | Commandes `orm:migrate/rollback/status/seed`                                   | 2 ses.  | P7.3, P7.5         | Délègue aux CLI ORM natifs                     |
| P11.5  | Commandes `logs:tail/filter` + bridge CLI ↔ Studio (`/cli/exec`)               | 1 ses.  | P3.10, P10.4       |                                                |

### P14 — `@nodefony/frontend` (builder Vite) + 🆕 **Core isomorphe** (voir [Phase 14](#phase-14--nodefonyfrontend-builder-vuereactsvelte-intégré))

> Bloquant pour P10.7 Studio frontend bootstrap. Vite par défaut, ESM natif.
> **REFONTE 2026-05-16** : P13.3 supprimée, le Core (Container/Syslog/Service) devient isomorphe et s'exporte côté navigateur.
> **REFONTE 2026-05-18** (POC `poc/frontend-child` mergé `f013b19`) : architecture finale = **`ViteProcessSupervisor` (child_process)** au lieu du `DevServerMiddleware integrate:true` initialement prévu. Décision documentée dans `docs/audits/poc-frontend-comparison.md` — isolation crash/OOM, multi-cluster PM2 compatible, observabilité supérieure. HMR p50=114ms identique aux 2 designs.

| #     | Tâche                                                            | Effort  | Dépendances        | Statut          | Notes                                                  |
| ----- | ---------------------------------------------------------------- | ------- | ------------------ | --------------- | ------------------------------------------------------ |
| P14.1 | Interfaces `IFrontBuilder`/`IFrontPreset` + décision Vite        | 1 ses.  | —                  | ✅ FAIT          | Vite par défaut. Interfaces dans `interfaces/`         |
| P14.2 | Preset `vue3-vite`                                                | 1 ses.  | P14.1              | ⏳ À FAIRE       | Pas encore implémenté (POC a fait react19 + vanilla)   |
| P14.3 | Preset `react19-vite`                                              | 1 ses.  | P14.2              | ✅ FAIT          | + preamble React Fast Refresh inline via TemplateHelper |
| P14.4 | ~~`DevServerMiddleware integrate:true`~~ → **`ViteProcessSupervisor`** | 3 ses.  | P14.1              | ✅ FAIT (refonte) | Child process isolé (poc/frontend-child mergé). Résilience built-in : auto-restart, port retry, health check, idempotence, cleanup listeners |
| P14.5 | `StaticMiddleware` build prod + manifest.json injection           | 1 ses.  | P14.4              | ⏳ À FAIRE       | `TemplateHelper.renderProdTags()` actuellement stub    |
| P14.6 | Multi-module frontend (N modules cohabitent) | 1 ses.  | P14.4              | ✅ FAIT          | **Multi-bundle FIX 2026-05-20** : `TemplateHelper` génère `/@fs/<absolute>` au lieu de `${baseUrl}/${entryFile}` + `ViteConfigGenerator.server.fs.allow` autorise chaque entry root + `process.cwd()`. Validé runtime avec 2 consumers (`test-frontend-react` + `studio`) : chacun charge son propre `main.tsx`. **Sous-tâche cluster PM2 ABANDONNÉE** (décision 2026-05-20) : Nodefony cible cloud-native, PM2 deprecated → retrait Phase 16. Cf `project_pm2_deprecation`. |
| P14.7 | Commands CLI `frontend:create/build/dev` + skill scaffold        | 1 ses.  | P14.2, P11.1       | 🟡 PARTIEL       | Commands existent mais bug CLI claude-ts (cf `project_cli_commands_broken_claude_ts`). **Skill `nodefony-create-frontend-react` ✅ disponible.** |
| P14.8 | Tests intégration                                                 | 1 ses.  | P14.3              | ✅ FAIT          | 14 unit `ViteConfigGenerator` + 3 integration `ViteProcessSupervisor` real spawn (~6s) |
| P14.9 | Presets optionnels Svelte 5 + Solid + **Angular** + Vue 3         | 2 ses.  | P14.3              | ⏳ À FAIRE       | Angular via `@analogjs/vite-plugin-angular`. Pattern preset = ajouter case dans `ViteConfigGenerator.toMjs()` |
| P14.10| Migration Studio sur `@nodefony/frontend`                          | 1 ses.  | P14.4              | ⏳ À FAIRE       | Studio = 1er consommateur prod                         |
| P14.11| 🆕 **Core isomorphe** : adapter `Container`, `Syslog`, `Service`, `EventEmitter` pour fonctionner sans Node natifs (export browser-compat via `package.json.exports.browser`) | 4 ses. | P14.4 | ⏳ À FAIRE       | EX-P13.3. ⚠️ Surveiller bundle size < 50 KB minified gzippé. Tree-shaking obligatoire |
| P14.12| 🆕 Plugin Vite Nodefony : alias auto (`@nodefony/core` etc.) + injection env vars (`__NODEFONY_CONFIG__` : wsUrl, env, instanceId) | 1 ses. | P14.11 | ⏳ À FAIRE       | Zéro config dev — transparent                          |
| P14.13| 🆕 Syslog isomorphe : transport WS qui pipe logs front → syslog back centralisé | 2 ses. | P14.11, P13.7 | ⏳ À FAIRE       | Traçabilité totale front prod                          |
| P14.14| 🆕 **TODO security** : API CSP origines dynamiques (cf `project_csp_vite_security_todo`) | 1 ses. | P14.4, P5 | ⏳ À FAIRE       | Remplace le hack POC dans le controller (`setHeader Content-Security-Policy` à la main) |

### P13 — Realtime distribué (refonte 2026-05-16 — voir mémoire `project_decisions_realtime_isomorphic.md`)

> **P13.3 SUPPRIMÉE** — Core devient isomorphe, intégré dans P14.
> Architecture **Pattern Hub** : `IRealtimeHub` interchangeable + `RealtimeService` central. Permet cluster K8s transparent.

| #     | Tâche                                                            | Effort  | Dépendances        | Notes                                                  |
| ----- | ---------------------------------------------------------------- | ------- | ------------------ | ------------------------------------------------------ |
| P13.1 | `@nodefony/realtime` (TCP/UDP/Unix sockets — IoT/IPC/protocoles) | 7 ses.  | P1 (Context hooks) | Indépendant. Chaque protocole crée un `RequestContext` Nodefony (ALS, logs, security) |
| P13.2 | `@nodefony/redis` refactor (cluster + pub/sub + storage)         | 8 ses.  | —                  | **Prioritaire** — débloque P5.12, apps prod cluster + driver `RedisRealtimeHub` |
| P13.4 | 🆕 `IRealtimeHub` interface + `LocalRealtimeHub` (dev) + `RealtimeService` central (façade, normalisation, dédup échos cluster) | 3 ses. | P1.4 (ALS) | NOUVEAU — fondation temps réel distribué              |
| P13.5 | 🆕 `RedisRealtimeHub` driver (cluster low-latency, Pub/Sub)      | 2 ses.  | P13.2, P13.4       | Sessions UI, chat, broadcast standard                  |
| P13.6 | 🆕 **`KafkaRealtimeHub`** driver (cluster massif, persistence, at-least-once) | 3 ses. | P13.4 | Apps massives + bus events agents IA (P12)            |
| P13.7 | 🆕 Protocole **JSON-RPC 2.0 maison** + RPC bidirectionnel (Promise) + HTTP long-polling fallback + types partagés `ServerToClientEvents`/`ClientToServerEvents` | 4 ses. | P13.4, P1.7 | Symbiose Socket.IO-like sans wrap. Type-safe E2E       |
| P13.8 | 🆕 Décorateurs `@RealtimeController(path)` + `@RealtimeEvent(name)` (lecture `Reflect.metadata`) | 2 ses. | P13.7 | Pattern @route mais pour events temps réel             |
| P13.9 | 🆕 Tests intégration cluster simulé (2+ instances + Hub + filtre écho) | 2 ses. | P13.5 ou P13.6 | Valide pas de duplication de messages cluster         |

### P12 — Couche IA agentic (DERNIÈRE phase — voir [Phase 12](#phase-12--couche-ia-agentic-dernière-phase-de-migration))

> NE PAS démarrer avant P10 (Studio MVP) ✅. C'est la **studio finale** de Nodefony.

| #       | Tâche                                                            | Effort  | Dépendances              | Notes                                              |
| ------- | ---------------------------------------------------------------- | ------- | ------------------------ | -------------------------------------------------- |
| P12.1   | Audit + refonte llm/vector/rag/memory (existants 🔶)              | 9 ses.  | P10 MVP ✅               | Standardiser interfaces, intégrer orm-core/ALS    |
| P12.2   | Finalisation `@nodefony/agent` (Orchestrator + decorators)        | 7 ses.  | P12.1                    | Boucle agentic + streaming + abort                |
| P12.3   | `@nodefony/mcp` (server + client, JSON-RPC 2.0)                  | 6 ses.  | P12.2                    | Interop Claude Desktop / Cursor / VS Code         |
| P12.4   | **`@nodefony/agent-guard`** (différenciateur AI Act)              | 14 ses. | P12.2, P6 ✅, P7 ✅      | Zones, PII, audit signé, circuit breaker, approval |
| P12.5   | Panels IA dans Studio (ex-`@nodefony/studio`)                     | 6 ses.  | P12.4, P10               | Fusion studio ↔ studio                            |
| P12.6   | Tests E2E IA + conformité AI Act                                  | 7 ses.  | P12.5                    | RAG sources, agent loop, MCP, gouvernance, souverain |

### 🆕 P15 — Mediasoup + SIP/Asterisk (test ultime archi 2026-05-16)

> NOUVEAU — voir mémoire `project_decisions_realtime_isomorphic.md`. NE PAS démarrer avant P12 (agents IA) + P13 (realtime base) solides.
> Cas d'usage cible : **agent IA vocal téléphone PSTN**. PAS du WebRTC navigateur — `PlainTransport` RTP brut uniquement.

| #     | Tâche                                                            | Effort  | Dépendances        | Notes                                                  |
| ----- | ---------------------------------------------------------------- | ------- | ------------------ | ------------------------------------------------------ |
| P15.1 | `@nodefony/mediasoup-bundle` — interfaces `IMediasoupConfig`, `IRoomManager`, `MediasoupService` (init Workers C++ selon CPU) | 3 ses. | P13 ✅, P12.2 ✅ | Codecs (Opus/VP8/H264), plages ports UDP/TCP |
| P15.2 | `RoomManager` — cartographie Routers mediasoup ↔ Rooms du `RealtimeService` (P13.4) | 2 ses. | P15.1 | Cycle de vie salons média                       |
| P15.3 | `SignalController` — décorateurs `@RealtimeController('/media')` + `@RealtimeEvent('media:joinRoom')` + RPC pour SDP/RTP capabilities | 2 ses. | P15.2, P13.8 | Pattern Symbiose JSON-RPC                  |
| P15.4 | `PlainTransport` Asterisk — gateway SIP via codec G.711/Opus     | 3 ses. | P15.3              | Cœur du pont télécom                                   |
| P15.5 | Connecteur `asterisk-ari` (ARI) + `asterisk-ami` (AMI) — intercepte appels SIP, pilote Bridges Asterisk | 3 ses. | P15.4 | Lib externe (`ari-client`, `asterisk-ami-client`)     |
| P15.6 | Pipeline agent IA vocal : Asterisk → mediasoup PlainTransport → STT → LLM (P12) → TTS → réinjection PlainTransport → retour client | 4 ses. | P15.5, P12.2 | Killer feature 2026 — agents IA vocaux PSTN          |
| P15.7 | Cluster K8s : `PipeTransports` mediasoup pour interconnexion pod-to-pod (bypass Redis/Kafka pour flux media binaires) | 3 ses. | P15.4, P13.5/6 | Routage media inter-pod direct UDP haut débit  |
| P15.8 | Tests E2E pont SIP + agent IA vocal (Asterisk + mediasoup + LLM) | 3 ses. | P15.6              | Validation crash-test absolu de l'archi               |

### 🆕 P16 — Cloud-Native (plan figé 2026-05-20, code différé après P6 security)

> Voir mémoires `project_cloud_native_plan.md` (plan détaillé) + `project_pm2_deprecation.md`. Sources de réflexion : `CLOUD-NATIVE.txt` + `SECURITY.txt` (section SecretProvider). Nodefony cible 1-process-par-pod / container. Plan en **7 axes, 26 sous-tâches**. **Démarrage du code attendu après P6 (couche security complète)** — la fondation SecretProvider vit dans `@nodefony/security`, donc nécessite que P6 soit en cours.

#### Décisions clés figées
- **healthz/readyz** → `@nodefony/http` (paths configurables, registre `IHealthCheck`)
- **Trusted proxies** → parser http + whitelist côté `@nodefony/security` (Symfony-like)
- **SecretProvider** → dans `@nodefony/security` (PAS core), absorbe la responsabilité config env-typed, contrat `ISecretProvider` (get / getRequired / getAs<T>) repris mot pour mot de SECURITY.txt
- **docker-compose** → progressif minimal (`nodefony-core` + `postgres` au début, profils pour le reste)
- **PID 1** → tini dans Dockerfile alpine

#### 16.A — Kernel & Lifecycle (~4 ses.)
| #       | Tâche                                                                                                | Effort | Dépendances | Notes                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------------ |
| P16.A.1 | Graceful shutdown SIGTERM (drain HTTP + WS + ORM, timeout configurable)                              | 1 ses. | —           | k8s grace period default 30s                                       |
| P16.A.2 | Événements DevOps nommés : `onPreShutdown`, `onDrain`, `onReady` (étend events kernel existants)     | 1 ses. | P16.A.1     | Vérifier patterns `EVENT KERNEL` actuels avant de nommer           |
| P16.A.3 | Bootstrap order : SecretProvider instancié AVANT DI complet (hook ultra-tôt dans `Kernel.boot()`)    | 1 ses. | P16.C.1     | Tous les autres services lisent leurs secrets via lui              |
| P16.A.4 | PID 1 awareness : warning au boot si `process.pid === 1` sans tini détecté                           | 0.5 ses. | —         | Évite les signals mal transmis en Docker sans init system          |

#### 16.B — HTTP cloud-native (~3 ses.)
| #       | Tâche                                                                                                | Effort | Dépendances | Notes                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------------ |
| P16.B.1 | Routes `/nodefony/healthz` + `/nodefony/readyz` dans `@nodefony/http`, paths configurables, registre `IHealthCheck` | 1 ses. | — | Chaque module enregistre son health pour readyz                    |
| P16.B.2 | Parser http lit `X-Forwarded-For`/`X-Forwarded-Proto`, expose `context.clientIp` + `context.scheme`  | 1 ses. | —           | Symfony-like : mécanique dans http                                 |
| P16.B.3 | Whitelist IPs proxy configurée côté `@nodefony/security`, consommée par http via DI                  | 1 ses. | P16.B.2, P6 | Politique côté security ; http reste agnostique                    |

#### 16.C — Secrets (~4 ses.) — fondation cloud-native
| #       | Tâche                                                                                                | Effort | Dépendances | Notes                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------------ |
| P16.C.1 | `ISecretProvider` interface + `EnvSecretProvider` dans `@nodefony/security/{contracts,providers}/`   | 1 ses. | P6 démarré  | Contrat figé : `get / getRequired / getAs<T>` (cf SECURITY.txt)    |
| P16.C.2 | `SecretManager` service injectable (résout le provider via config, `Container.get("secret-manager")`) | 1 ses. | P16.C.1     | Provider sélectionné via env `VAULT_ADDR` etc.                     |
| P16.C.3 | Hook Kernel pour initialiser SecretManager AVANT DI complet                                          | 1 ses. | P16.C.2     | Modifie boot order — voir `Kernel.boot()`                          |
| P16.C.4 | Migration progressive des secrets en dur → `secretManager.getRequired("KEY")` (pg/redis/mongo/JWT)   | 1 ses. | P16.C.3     | Au fur et à mesure, pas en bigbang                                 |

#### 16.D — Infra Docker (~5 ses.)
| #       | Tâche                                                                                                | Effort | Dépendances | Notes                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------------ |
| P16.D.1 | `Dockerfile.dev` (alpine + tini + bind mount HMR-friendly)                                           | 1 ses. | —           | Watcher Rollup + Vite dev doivent fonctionner                      |
| P16.D.2 | `Dockerfile` multi-stage prod (build + run distroless OU alpine slim + tini)                         | 1 ses. | P16.A.1     | Foreground mode, `tini` PID 1                                      |
| P16.D.3 | `docker-compose.yml` minimal (`nodefony-core` + `postgres` au début)                                 | 1 ses. | P16.D.1     | Pas tout d'un coup                                                 |
| P16.D.4 | Profils Compose : `--profile mongo`, `--profile redis`, `--profile keycloak`, `--profile opensearch` | 1 ses. | P16.D.3     | Activation progressive selon tests modules                         |
| P16.D.5 | Réseau bridge custom + alias DNS internes (`postgres`/`mongodb`/`redis`/`keycloak`/`opensearch`)     | 1 ses. | P16.D.3     | Jamais `localhost`/`127.0.0.1` dans les configs                    |

#### 16.E — Skills & Tooling Claude (~3 ses.)
| #       | Tâche                                                                                                | Effort | Dépendances | Notes                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------------ |
| P16.E.1 | Skill `docker-debug` (wrap MCP Docker Toolkit : logs, exec, restart, healthcheck)                    | 1 ses. | P16.D.3     | Permet à Claude de self-debug en environnement conteneurisé        |
| P16.E.2 | Skill `infra-up` (`docker compose up -d` ciblé + wait-healthy patterns)                              | 1 ses. | P16.D.4     | Démarrage progressif des profils                                   |
| P16.E.3 | Update skill `start-nodefony-server` : détection mode conteneurisé (override si `.docker` présent)   | 1 ses. | P16.E.1     | Aujourd'hui assume spawn local                                     |

#### 16.F — Cleanup PM2 (~3 ses., absorbe l'ancien P16.4)
| #       | Tâche                                                                                                | Effort | Dépendances | Notes                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------------ |
| P16.F.1 | Suppression `pm2Service`, `Pm2Command`, `pm2.config.ts`, refs `MODE_START === "PM2"` partout          | 1 ses. | P16.A.1, P16.D.2 | Breaking : `nodefony pm2:*` retiré, `--daemon` retiré         |
| P16.F.2 | Dep `pm2` retirée du `package.json` (+ `@types/pm2`)                                                  | 0.5 ses. | P16.F.1   | Bundle size                                                        |
| P16.F.3 | Doc migration utilisateurs (PM2 → systemd unit / docker compose simple / k8s deployment)              | 1 ses. | P16.F.1     | Évite de casser les users existants                                |

#### 16.G — Docs DevOps (~4 ses.)
| #       | Tâche                                                                                                | Effort | Dépendances | Notes                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------------ |
| P16.G.1 | `docs/devOps/env-vars.md` (catalogue env vars + type + obligatoire ?)                                | 1 ses. | P16.C.4     | Vérité unique pour les opérateurs                                  |
| P16.G.2 | `docs/devOps/health-endpoints.md` (comportement `/healthz` vs `/readyz`, codes HTTP, IHealthCheck)   | 1 ses. | P16.B.1     |                                                                    |
| P16.G.3 | `docs/devOps/quickstart-docker.md`                                                                   | 1 ses. | P16.D.4     | Démarrage local pas-à-pas                                          |
| P16.G.4 | `docs/devOps/quickstart-k8s.md` (manifests deployment/service/ingress + probes exemples)             | 1 ses. | P16.D.2, P16.B.1 | Manifests prêts à copier-coller                               |

#### Non-objectifs Phase 16 (Phase 17+ ou hors scope)
- Vault / AWS SM / GCP SM adapters concrets (seule l'interface est en P16)
- mTLS interne (Zero Trust local) — intégré à P6 ou Phase 17+
- Service Mesh (Istio, Linkerd) — hors scope framework
- Helm chart officiel — post-1.0
- WAF integration côté framework (cf SECURITY.txt) — décision en session security

### P10 — `@nodefony/studio` (admin web — successeur monitoring-bundle)

> Voir [Phase 10](#phase-10--nodefonystudio-successeur-monitoring-bundle). NE PAS démarrer avant P0-P7 + P11.2-P11.3 ✅.
> Préfixe route `/nodefony` réservé dans toutes les apps. Chaque module migré doit exposer son `IAdminApi` au préalable.
> **Routing tranché 2026-05-20** : UI Studio sur `/nodefony` + `/nodefony/{page}` (SPA mono-segment) ; data plane admin sur `/nodefony/<module>/api/*` (≥3 segments). `/studio` rejeté (collision app user). Cf mémoire `project_studio_routing_decision`.

| #      | Tâche                                                                          | Effort  | Dépendances        | Notes                                          |
| ------ | ------------------------------------------------------------------------------ | ------- | ------------------ | ---------------------------------------------- |
| ✅ P10.1  | Décision stack frontend (Vue 3 vs React 19) + bootstrap Vite                | 0.5 ses.| —                  | ✅ 2026-05-18 — React 19 acté pour Studio                                |
| ✅ P10.2  | `IAdminApi` + `AdminBroker` service                                         | 1 ses.  | —                  | ✅ 2026-05-20 — Contrat figé. Core : `IAdminApi`/`IAdminEndpoint`/`IAdminRequest`/`IAdminResponse`/`IAdminRegistry`. Framework : `IAdminBroker extends IAdminRegistry`, `AdminBroker` (Service), `AdminApiController` (pont). Inversion de dép : producteur ne dépend que du core. Indépendant de P5. Cf framework MEMORY.md |
| 🔶 P10.3  | `IAdminApi` dans http, framework, syslog                                    | 2 ses.  | P10.2              | 🔶 2026-05-20 — **kernel migré ✅** (`createKernelAdminApi` → `/nodefony/kernel/api/{health,info,modules}`, validé runtime). Reste : producteurs http/framework/syslog |
| P10.4  | `IAdminApi` dans user, orm-core, security                                      | 2 ses.  | P5.6, P6.8         |                                                |
| 🔶 P10.5  | Backend Studio — `DashboardController` + `api/*Controller`                  | 2 ses.  | P10.3, P10.4       | 🔶 2026-05-20 — `StudioController` : UI `/nodefony` + data plane `/nodefony/studio/api/*` (health/info/auth mock, `/info` expose `debug`). + `StudioRealtimeController` **WS `/nodefony/studio/api/realtime` JSON-RPC 2.0 pub/sub par canal** (`syslog:stream`, `dashboard:stats` 1/s) — providers transport-agnostiques, **précurseur RealtimeService P13.4**. Reste : remplacer mocks par IAdminApi (P10.2). Cf mémoire `project_studio_realtime_ws` |
| P10.6  | Auth admin (factory `studio-admin`, `ROLE_NODEFONY_ADMIN`)                     | 1 ses.  | P6.5               |                                                |
| 🔶 P10.7  | Frontend bootstrap + router + auth + layouts                                | 2 ses.  | P10.5, **P14.11**, **P14.4** | 🔶 2026-05-20 — React 19 + Mantine v8 + MobX 6 + Router 7 + TanStack Table 8. 5 stores MobX, AuthGuard, Login 4-step, AdminLayout. **WS realtime permanent** (`RealtimeClient` du **Core isomorphe `nodefony`** — PAS @nodefony/client, P13.3 supprimée — ouvert au montage du shell, re-subscribe au reconnect). **Logs en WS** (canal `syslog:stream`). **Dashboard widgets live + graphes SVG interactifs maison** (recharts2 KO sous React19) + `instanceId` (vue per-instance). Multi-bundle **résolu** (test-frontend-react actif). Reste : pages stub, auth réelle (P6) |
| 🔶 P10.8  | Vues prio : dashboard, routes, sessions, users                              | 3 ses.  | P10.7              | 🔶 Dashboard ✅ **live** (CPU %/mémoire/event-loop/logs-s, graphes interactifs, uptime, debug, instance) ; routes/sessions/users en attente (data-plane IAdminApi) |
| P10.9  | Vues : firewall, logs streaming, databases, migrate                            | 3 ses.  | P10.8              | SSE/WS pour logs — **Logs ✅ live via canal WS `syslog:stream`** (2026-05-20) ; firewall/databases/migrate en attente |
| P10.10 | Vues : npm, pm2, profiling, services                                           | 2 ses.  | P10.9              | Incrémental                                    |
| P10.11 | Tests intégration studio                                                       | 1 ses.  | P10.8              |                                                |

### P9 — Polish + clôture

| #     | Tâche                                                          | Effort   | Notes                                          |
| ----- | -------------------------------------------------------------- | -------- | ---------------------------------------------- |
| P9.1  | `@entities` decorator + tests (pattern `Decorators.test.ts`)   | 0.5 ses. | Phase 1.3 résiduel                             |
| P9.2  | Barrel `src/container/index.ts`, `src/bundles/index.ts`, etc. | 0.5 ses. | Phase 1.3, 2.2, 2.1 résiduels                  |
| P9.3  | README.md publics (http, framework, security)                  | 1 ses.   | Audience humaine                               |
| P9.4  | Vulnérabilités restantes (9 — twig/mocha)                      | 0.5 ses. | Audit dépendances + upgrades majeurs possibles |

### Synthèse effort total

| Bloc                                                     | Sessions estimées |
| -------------------------------------------------------- | ----------------- |
| ✅ P0 — Bugs bloquants                                    | ~2.5 ✅           |
| P1 — Fondations symbiose http↔framework                  | ~7.5 (P1.1 + P1.2 ✅) |
| P2 — Cycle de vie Context                                 | ~6                |
| P3 — Logs structurés                                      | ~6.5              |
| P4 — Tests symbiose                                       | ~6                |
| **P5 — Session + User + ORM Core (préalable Security)**  | **~14**           |
| P6 — Security (+ décorateurs panoplie + 3 niveaux Voters) | ~17               |
| P7 — Drivers ORM (Sequelize + Mongoose + Drizzle + 🆕 MikroORM) | ~14         |
| P8 — CLI + Monitoring local                               | ~5                |
| P9 — Polish                                               | ~2.5              |
| **P11 — Tests CLI + commandes par module**               | **~6**            |
| **P10 — Studio (admin web)**                              | **~19.5**         |
| **P13 — Realtime distribué (RealtimeHub + Service + RPC + Kafka)** | **~32**  |
| **P14 — `@nodefony/frontend` Vite + 🆕 Core isomorphe**  | **~19**           |
| **P12 — Couche IA agentic (studio finale)**              | **~49**           |
| 🆕 **P15 — Mediasoup + SIP/Asterisk (test ultime)**      | **~23**           |
| **TOTAL**                                                 | **~229 sessions** |

> Δ vs avant 2026-05-16 : +42.5 sessions (intégration analyse + realtime + mediasoup + Core isomorphe + MikroORM + décorateurs sécurité + Voters)
> Δ révision 2026-05-20 : net ~0 (P6.5 -1 ses., P6.9 -1.5 ses., P5.5a +1 ses., P6.3 +0.5 ses., P6.7 +0.5 ses., P6.9b mTLS +1 ses., P6.11 tests +0.5 ses.) ; scope clarifié (LDAP→plugin, OAuth2 unifié arctic, sessions HTTP deprecated, defineSecurityConfig+Zod)

### Chemin critique (MVP framework prod-ready avec security)

```
P0 (2.5) → P1.1-P1.7 (7.5) → P3.1+P3.4+P3.5 (2)            ← logs minimal
                            → P2.2-P2.5 (2.5)              ← context tear-down + abort
                            → P5.1-P5.6 (8)                ← ORM core + workspace user (P5.5a) + IUser + UserService + BcryptEncoder
                            → P5.7 ou P5.8 (1)             ← UN adapter ORM
                            → P5.11-P5.12 (2)              ← session refactor + storage
                            → P7.1 ou P7.2 (2)             ← UN driver ORM complet
                            → P6.1-P6.8b (10)              ← security minimal sans OAuth/mTLS (Authenticators + defineSecurityConfig + Voters)
                                                           = ~37.5 sessions vers MVP prod (inchangé : -2 P6.5/9, +1 P5.5a, +0.5 P6.3, +0.5 P6.7)
```

### Chemin Studio (admin web — étape suivante MVP)

```
MVP prod ✅ → P14.1-P14.5 (7)        ← @nodefony/frontend (Vite + middleware HTTP integrate:true)
            → P14.11 (4)             ← 🆕 Core isomorphe (Container/Syslog/Service browser-compat) — ex P13.3
            → P13.4 (3)              ← 🆕 IRealtimeHub + LocalRealtimeHub + RealtimeService
            → P13.7 (4)              ← 🆕 Protocole JSON-RPC 2.0 + RPC + types partagés E2E
            → P11.1-P11.3 (3)        ← Tests CLI existant + commandes core modules
            → P10.1-P10.7 (10.5)     ← IAdminApi dans http/framework/security/user/orm + backend + frontend bootstrap
            → P10.8 (3)              ← 4 vues prio (dashboard/routes/sessions/users)
                                     = ~34.5 sessions supplémentaires vers Studio MVP
```

**Notes** :
- `@nodefony/frontend` (P14) **bloque P10.7** Studio frontend — Studio en est le 1er consommateur prod.
- **P13.3 SUPPRIMÉE** (refonte 2026-05-16) — Core isomorphe (P14.11) la remplace, intégré DANS le code Vue/React de Studio via Vite alias automatique.
- `@nodefony/redis` (P13.2 — 8 ses.) peut être inséré dès P5.12 si cluster prod ciblé.
- `@nodefony/realtime` (P13.1) indépendant — peut être différé. Mais `RealtimeService` (P13.4) prioritaire pour Studio (logs streaming, métriques live).

### Chemin IA agentic (studio finale — phase FINALE)

```
Studio MVP ✅ → P12.1.1-P12.1.5 (9)  ← Refonte llm/vector/rag/memory propre
              → P12.2.1-P12.2.6 (7)  ← @nodefony/agent finalisé (orchestrateur)
              → P12.3.1-P12.3.5 (6)  ← @nodefony/mcp (interop Claude/Cursor)
              → P12.4.1-P12.4.4 (6)  ← agent-guard zones/PII/audit minimal
              → P12.5.1-P12.5.2 (3)  ← Studio panels Agents+Costs
                                     = ~31 sessions vers MVP IA agentic souverain
```

**Total framework + Studio + IA complet** : ~150.5 sessions estimées.
**Total MVP complet (prod + admin + IA agentic minimal)** : ~85 sessions estimées (~MVP prod 37.5 + Studio MVP 16.5 + IA MVP 31).

Le reste (Drizzle, OAuth/LDAP/OIDC, monitoring local DebugBar, polish, multi-ORM tests, vues Studio avancées, agent-guard avancé/approval/circuit breaker, conformité AI Act docs) peut être livré incrémentalement sans bloquer un déploiement.

**Décisions stratégiques** :
- **ORM Core AVANT Security** : sinon Security recrée un type User couplé à un seul ORM → impossible de switcher. 4 sessions de prérequis.
- **Un seul ORM suffit pour MVP** : choisir Sequelize (legacy compat) OU Drizzle (TS moderne) selon priorité business. Mongoose pour MongoDB en complément si besoin doc store.
- **Drizzle peut attendre P7.4** : c'est l'investissement long terme TS-first ; MVP peut sortir avec Sequelize.

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

### 5.2 Session (refactor — actuel partiel)

> **État actuel** : `@nodefony/http/nodefony/src/session/session.ts` (715 L) — fonctionne avec `FileSessionStorage` mais champ `user?: string` (juste username, non typé), storage filesystem only.
> **Améliorations à apporter** :
> - `session.user` → typé `IUser` (référence vers module User), pas juste string
> - Storage drivers additionnels (Redis pour prod, ORM-backed pour persistence forte)
> - Hook `onUserInvalidated` quand `user.enabled=false` ou `user.accountNonLocked=false` → force `session.destroy()`
> - Sérialisation : préserver `roles` + `metaData` pour éviter refetch DB à chaque requête (read-through cache)
> - Migration session entre stores (logout / fixation prevention via `regenerateId()`)

| Fichier TS cible                                                      | Source JS référence                          | Statut | Complexité | Notes                                                  |
| --------------------------------------------------------------------- | -------------------------------------------- | ------ | ---------- | ------------------------------------------------------ |
| `@nodefony/http/nodefony/src/session/session.ts`                      | actuel + `framework-bundle/session/`         | 🔶     | 3          | Refactor : `user: IUser`, hooks invalidation, regenerateId |
| `@nodefony/http/nodefony/service/sessions/sessions-service.ts`        | actuel                                       | 🔶     | 2          | Sélection storage par config, lifecycle GC global      |
| `@nodefony/http/nodefony/src/session/storage/FileSessionStorage.ts`   | actuel                                       | ✅     | —          | OK pour dev                                            |
| `@nodefony/http/nodefony/src/session/storage/MemorySessionStorage.ts` | nouveau                                      | ⬜     | 1          | Map en mémoire, pour tests                             |
| `@nodefony/http/nodefony/src/session/storage/RedisSessionStorage.ts`  | `bundles/redis-bundle/` (ref)                | ⬜     | 2          | TTL natif, prod-ready                                  |
| `@nodefony/http/nodefony/src/session/storage/OrmSessionStorage.ts`    | `bundles/framework-bundle/session/`          | ⬜     | 3          | Adapter générique via `@nodefony/orm-core`             |
| `@nodefony/http/nodefony/interfaces/ISessionStorage.ts`               | N/A                                          | ⬜     | 1          | Interface publique storage                             |
| `@nodefony/http/nodefony/interfaces/ISession.ts`                      | actuel                                       | 🔶     | 1          | Étendre avec `user: IUser`, `regenerate()`             |

### 5.3 User module (NEW — préalable à security)

> **Constat** : Le vieux framework avait `cli/builder/bundles/users-bundle/` (411 L service + entities Sequelize/Mongoose dupliquées) — bundle scaffold.
> **Problème** : entités User dupliquées par ORM → divergence garantie.
> **Solution** : `@nodefony/user` central avec **interface canonique IUser** + adapters ORM (via `@nodefony/orm-core`) + service provider.

> **Champs IUser canoniques** (extraits du legacy + standards 2026) :
> `id`, `username`, `email`, `password` (hashed), `roles: string[]`, `enabled`, `accountNonLocked`, `userNonExpired`, `credentialsNonExpired`, `twoFactorEnabled`, `twoFactorSecret`, `name`, `surname`, `lang`, `gender?`, `avatar?`, `url?`, `createdAt`, `updatedAt`, `lastLoginAt?`.
> **Méthodes IUser** : `hasRole(role)`, `isGranted(role)`, `verifyPassword(plain)`, `toSafeJson()` (sans password/secrets).

| Fichier TS cible                                       | Rôle                                                                 | Statut | Complexité | Notes                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------- | ------ | ---------- | ---------------------------------------------------- |
| `@nodefony/user/interfaces/IUser.ts`                   | Interface canonique IUser (champs + méthodes)                         | ⬜     | 2          | Lue par security, session, controllers                |
| `@nodefony/user/interfaces/IUserRepository.ts`         | Repository contract : `findByUsername/Email/Id`, `create`, `update`   | ⬜     | 2          | Implémenté par chaque driver ORM                      |
| `@nodefony/user/interfaces/IUserProvider.ts`           | Provider security (alimente le Firewall)                              | ⬜     | 2          | `loadByUsername(name): Promise<IUser>` etc.           |
| `@nodefony/user/src/User.ts`                           | Classe base (champs + `hasRole`, `isGranted`, `toSafeJson`)           | ⬜     | 2          | Code commun, indépendant de l'ORM                     |
| `@nodefony/user/src/AnonymousUser.ts`                  | User par défaut non authentifié — roles `["IS_AUTHENTICATED_ANONYMOUSLY"]` | ⬜ | 1          | Évite null partout                                    |
| `@nodefony/user/service/user-service.ts`               | Service `register/authenticate/disable/lock/unlock` + events          | ⬜     | 2          | Délègue au IUserRepository                            |
| `@nodefony/user/adapters/sequelize/UserEntity.ts`      | `@entity({ orm: "sequelize" })` — schema Sequelize                    | ⬜     | 2          | Ref : `users-bundle/Entity/sequelize/userEntity.js`   |
| `@nodefony/user/adapters/sequelize/UserRepository.ts`  | `implements IUserRepository`                                          | ⬜     | 2          |                                                      |
| `@nodefony/user/adapters/mongoose/UserEntity.ts`       | Schema Mongoose                                                       | ⬜     | 2          | Ref : `users-bundle/Entity/mongoose/userEntity.js`    |
| `@nodefony/user/adapters/mongoose/UserRepository.ts`   | `implements IUserRepository`                                          | ⬜     | 2          |                                                      |
| `@nodefony/user/adapters/drizzle/UserEntity.ts`        | Schema Drizzle (nouveau, type-safe)                                   | ⬜     | 2          | Sans précédent JS                                     |
| `@nodefony/user/adapters/drizzle/UserRepository.ts`    | `implements IUserRepository`                                          | ⬜     | 2          |                                                      |
| `@nodefony/user/index.ts`                              | Barrel exports                                                        | ⬜     | 1          |                                                      |

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

| ORM            | Type            | Statut prévu       | Raison                                                                            |
| -------------- | --------------- | ------------------ | --------------------------------------------------------------------------------- |
| **Mongoose**   | MongoDB ODM     | ✅ migration legacy | Leader incontesté MongoDB, pas de challenger                                      |
| **Drizzle**    | SQL builder TS  | ✅ nouveau          | Type-safe SQL, perf, ascendant 2024-2026, schemas TS natifs, migrations CLI       |
| **Sequelize**  | SQL ORM legacy  | 🔶 maintenance     | Compat existant — figer en v6, pas étendre — bridge minimal                       |
| **Prisma**     | Schema-first    | ⏭️ optionnel       | Très populaire mais code gen externe + Prisma engine binaire — complique le pkg  |
| **MikroORM**   | DataMapper      | ⏭️ optionnel       | Doctrine-like, supporte SQL + Mongo, à évaluer si Drizzle insuffisant             |
| **TypeORM**    | DataMapper      | ⏭️ skip            | En perte de vitesse, décorateurs lourds                                           |
| **Kysely**     | SQL builder     | ⏭️ skip            | Pas un ORM, déjà couvert par Drizzle                                              |

### 7.3 Module `@nodefony/orm-core` (nouveau — fondation)

| Fichier TS cible                                                | Rôle                                                                                | Statut | Complexité |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ | ---------- |
| `@nodefony/orm-core/interfaces/IOrm.ts`                         | Interface ORM : `connect()`, `disconnect()`, `getRepository(name)`, `transaction()` | ⬜     | 2          |
| `@nodefony/orm-core/interfaces/IEntity.ts`                      | Interface Entity : `name`, `schema`, `model`, `relations`                            | ⬜     | 2          |
| `@nodefony/orm-core/interfaces/IRepository.ts`                  | Interface Repository : `find/findOne/create/update/delete/count`                     | ⬜     | 2          |
| `@nodefony/orm-core/interfaces/ITransaction.ts`                 | UoW/transaction abstraite (commit/rollback/savepoint)                                | ⬜     | 2          |
| `@nodefony/orm-core/src/OrmRegistry.ts`                         | Singleton — `register(name, IOrm)`, `get(name): IOrm`, `list(): string[]`            | ⬜     | 2          |
| `@nodefony/orm-core/src/Orm.ts`                                 | Classe abstraite base extends Service, lifecycle `onOrmReady` event                  | ⬜     | 2          |
| `@nodefony/orm-core/src/Entity.ts`                              | Classe abstraite — registre dans OrmRegistry au boot                                 | ⬜     | 2          |
| `@nodefony/orm-core/src/EntityRegistry.ts`                      | Cross-ORM entity lookup `entities[name][ormName]`                                    | ⬜     | 2          |
| `@nodefony/orm-core/src/decorators/entityDecorator.ts`          | `@entity({ orm, name, schema })` — métadonnées + auto-register                       | ⬜     | 2          |
| `@nodefony/orm-core/src/decorators/repositoryDecorator.ts`      | `@repository("UserRepository", { entity: "User" })`                                  | ⬜     | 2          |
| `@nodefony/orm-core/index.ts`                                   | Barrel exports                                                                       | ⬜     | 1          |

### 7.4 Drivers ORM (consomment orm-core)

| Module                       | Fichier TS                                            | Source réf JS                          | Statut | Complexité |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------- | ------ | ---------- |
| `@nodefony/sequelize`        | `service/sequelize.ts` + `connector/SequelizeConnector.ts` | `bundles/sequelize-bundle/`          | 🔶     | 3          |
| `@nodefony/mongoose`         | `service/mongoose.ts` + `connector/MongooseConnector.ts`   | `bundles/mongoose-bundle/`           | 🔶     | 2          |
| `@nodefony/drizzle` (NEW)    | `service/drizzle.ts` + `connector/DrizzleConnector.ts`     | N/A                                    | ⬜     | 3          |
| `@nodefony/redis` (cache+session) | `service/redis.ts`                               | `bundles/redis-bundle/`                | 🔶     | 2          |

### 7.5 Tests ORM (critique — non couvert dans le core actuel)

| Fichier                                                  | Sujet                                                                                  | Statut |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------ |
| `@nodefony/orm-core/tests/unit/OrmRegistry.test.ts`      | register/get/list, doublon, cleanup                                                    | ⬜     |
| `@nodefony/orm-core/tests/unit/EntityRegistry.test.ts`   | Cross-ORM lookup, conflits noms                                                        | ⬜     |
| `@nodefony/orm-core/tests/unit/decorators.test.ts`       | `@entity` + `@repository` metadata                                                     | ⬜     |
| `@nodefony/sequelize/tests/integration/sequelize.test.ts` | Connect SQLite mem, CRUD, transactions, hooks                                          | ⬜     |
| `@nodefony/mongoose/tests/integration/mongoose.test.ts`  | Connect mongo-memory-server, CRUD, schemas                                             | ⬜     |
| `@nodefony/drizzle/tests/integration/drizzle.test.ts`    | Connect SQLite mem, CRUD, type-safe queries                                            | ⬜     |
| `@nodefony/orm-core/tests/integration/multi-orm.test.ts` | **CRITIQUE** : charger 2 ORM en parallèle, User défini une fois, persisté dans 2 stores | ⬜     |

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

## Phase 10 — `@nodefony/studio` (successeur monitoring-bundle)

> Application web d'administration du framework. Remplace `/Users/cci/repository/nodefony/src/nodefony/bundles/monitoring-bundle/` (Vue 2 legacy).
> Démarrera **après** un niveau satisfaisant de migration (P0→P6 + P5+P7+P8 minimum) — sinon consomme des API qui n'existent pas encore.
> **Convention** : préfixe route `/nodefony` réservé à ce module + sous-routes `/nodefony/<module>/*` pour les API d'admin que chaque module migré doit exposer.

### 10.1 Périmètre fonctionnel (inspiration legacy)

> Voir vues legacy `/monitoring-bundle/src/views/` : bundles, databases, documentation, firewall, logs, migrate, monitoring, npm, pm2, profiling, router, service, sessions, users.

| Vue                | Consomme module             | API requise                                                                |
| ------------------ | --------------------------- | -------------------------------------------------------------------------- |
| Dashboard          | core/http                   | `/nodefony/system/stats` (mem, uptime, requests/s, servers status)         |
| Routes             | framework                   | `/nodefony/framework/routes` — liste + détails route                       |
| Sessions           | http/session                | `/nodefony/http/sessions` — liste, destroy, regenerate                     |
| Users              | user + security             | `/nodefony/user/list`, `add/disable/lock/unlock/roles`                     |
| Firewall           | security                    | `/nodefony/security/areas`, `/nodefony/security/tokens` (actifs)           |
| Logs               | syslog (transports)         | `/nodefony/syslog/stream` (SSE/WS), `/nodefony/syslog/filter`              |
| Databases          | orm-core                    | `/nodefony/orm/connections`, status par ORM, liste entités                 |
| Migrations         | orm-* + CLI                 | `/nodefony/orm/migrations` — run/rollback/status                           |
| NPM                | core CLI                    | `/nodefony/npm/outdated`, `/nodefony/npm/audit`                            |
| PM2                | core CLI                    | `/nodefony/pm2/processes` — list/restart/stop                              |
| Profiling          | http + monitoring           | `/nodefony/profiling/request/{id}` — utilise axe 9.2.9 (`context.timing`) |
| Service / DI       | core                        | `/nodefony/services/list` — registre Injector                              |

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

| Module                | API admin minimale                                                     | Phase prérequis  |
| --------------------- | ---------------------------------------------------------------------- | ---------------- |
| `@nodefony/http`      | servers status + sessions list + request stats                         | P4 ✅ (post)     |
| `@nodefony/framework` | routes list + controllers list                                         | P4 ✅ (post)     |
| `@nodefony/security`  | users connectés + areas + access logs                                  | P6 ✅            |
| `@nodefony/user`      | CRUD users + roles                                                     | P5.6 ✅          |
| `@nodefony/orm-core`  | connections status + entities list                                     | P5.4 ✅          |
| Core (syslog)         | stream logs (SSE/WS) + filter                                          | P3.10 ✅         |

### 10.4 Tâches Phase 10

| #     | Tâche                                                                                | Effort  | Dépendances        | Notes                                                                  |
| ----- | ------------------------------------------------------------------------------------ | ------- | ------------------ | ---------------------------------------------------------------------- |
| P10.1 | Décision stack frontend (Vue 3 vs React 19) + bootstrap Vite                         | 0.5 ses.| —                  | Cohérence ou rupture — décision business                               |
| P10.2 | `IAdminApi` interface + `ApiBroker` service — contract module → studio               | 1 ses.  | P5.4               | Permet à chaque module de plug son API admin                           |
| P10.3 | Implémentation `IAdminApi` dans http, framework, syslog (core)                       | 2 ses.  | P10.2              | Endpoints REST + GraphQL schemas                                       |
| P10.4 | Implémentation `IAdminApi` dans user, orm-core, security                             | 2 ses.  | P10.2, P5.6, P6.8  | Dépend que ces modules existent                                        |
| P10.5 | Backend `@nodefony/studio` — `DashboardController` + `api/*Controller`               | 2 ses.  | P10.3, P10.4       | Routes prefix `/nodefony`                                              |
| P10.6 | Auth admin : factory `studio-admin` + role `ROLE_NODEFONY_ADMIN`                      | 1 ses.  | P6.5               | Login dédié, isolé de l'app                                            |
| P10.7 | Frontend bootstrap + router + auth + layouts                                          | 2 ses.  | P10.5              | Page Login + Dashboard de base                                         |
| P10.8 | Vues 10.1 (dashboard, routes, sessions, users) — 4 vues prio                          | 3 ses.  | P10.7              | MVP utile                                                              |
| P10.9 | Vues 10.1 (firewall, logs streaming, databases, migrate)                              | 3 ses.  | P10.8              | Logs streaming via SSE — nécessite Phase 3 ✅                          |
| P10.10| Vues 10.1 (npm, pm2, profiling, services)                                             | 2 ses.  | P10.9              | Niche, peut être livré incrémental                                     |
| P10.11| Tests intégration studio (smoke + auth + 4 vues prio)                                 | 1 ses.  | P10.8              |                                                                        |

**Effort total Phase 10 : ~19.5 sessions** (frontend inclus, vues complètes).

---

## Phase 11 — Commandes CLI par module (non testées actuellement)

> Constat : 9 commandes CLI implémentées (`Start/Dev/Build/Prod/Staging/Install/Outdated/Pm2/Kill`) — **non testées en intégration**. Aucun module métier (http, framework, user, security, orm) n'a encore enregistré ses commandes.

### 11.1 Commandes existantes — tests à créer

| Commande      | Module         | Test à créer                                              | Statut |
| ------------- | -------------- | --------------------------------------------------------- | ------ |
| `start`       | core/CliKernel | spawn child, vérifier 4 serveurs listen                    | ⬜     |
| `development` | core/CliKernel | idem `start` + watch mode actif                            | ⬜     |
| `build`       | core/CliKernel | exit code 0 + dist/ peuplé                                 | ⬜     |
| `production`  | core/CliKernel | PM2 daemon up, ports actifs                                | ⬜     |
| `staging`     | core/CliKernel | env staging chargé                                         | ⬜     |
| `install`     | core/CliKernel | npm install dans tous workspaces                           | ⬜     |
| `outdated`    | core/CliKernel | rapport JSON valide                                        | ⬜     |
| `pm2`         | core/CliKernel | list/start/stop                                            | ⬜     |
| `kill`        | core/CliKernel | tue process actif sur ports 5151/5152                      | ⬜     |

### 11.2 Commandes à ajouter par module (vues comme indispensables)

| Module                | Commandes prévues                                                                | Statut | Effort  |
| --------------------- | -------------------------------------------------------------------------------- | ------ | ------- |
| `@nodefony/http`      | `http:routes:list`, `http:sessions:clear`, `http:cert:generate`, `http:server:stats` | ⬜  | 1 ses.  |
| `@nodefony/framework` | `framework:route:list`, `framework:controller:list`                              | ⬜     | 0.5 ses.|
| `@nodefony/security`  | `security:user:list`, `security:area:list`, `security:token:revoke`              | ⬜     | 1 ses.  |
| `@nodefony/user`      | `user:add`, `user:disable`, `user:roles:set`, `user:password:reset`              | ⬜     | 1 ses.  |
| `@nodefony/orm-*`     | `orm:migrate`, `orm:rollback`, `orm:status`, `orm:seed`                          | ⬜     | 2 ses.  |
| Core / Syslog         | `logs:tail`, `logs:filter --requestId=...`                                       | ⬜     | 0.5 ses.|

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
    type: "vue3",                        // ou "react19", "svelte5", "solid"
    entry: "./frontend/src/main.ts",
    outDir: "./public/dist",              // build prod
    devPort: 5173,                        // port Vite dev (proxy-mode)
    integrate: true,                       // true = middleware dans @nodefony/http | false = proxy externe
    vite: { /* options Vite custom */ }
  }
}
```

**Lifecycle** :
- **Dev** (`npx nodefony development`) : kernel boot → `@nodefony/frontend` lit `module.options.frontend` pour chaque module → ViteBuilder en mode `middleware` → injecte dans `@nodefony/http` → HMR live via WS
- **Prod** (`npx nodefony build`) : ViteBuilder build → `dist/public/<module-name>/` → `@nodefony/http` sert en static
- **Hybrid mode** : `integrate: false` → Vite tourne en parallèle (port 5173), `@nodefony/http` proxy `/`→Vite en dev, static en prod

### 14.3 Tâches Phase 14

| #      | Tâche                                                                          | Effort  | Dépendances        | Notes                                                                  |
| ------ | ------------------------------------------------------------------------------ | ------- | ------------------ | ---------------------------------------------------------------------- |
| P14.1  | Décision Vite vs Webpack pour 2026 + interfaces `IFrontBuilder`/`IFrontPreset` | 1 ses.  | —                  | Vite par défaut. Webpack uniquement si demande legacy explicite        |
| P14.2  | `ViteBuilder` + preset `vue3-vite`                                              | 2 ses.  | P14.1              | Couvre 80% du cas d'usage immédiat (Studio)                            |
| P14.3  | Preset `react19-vite`                                                            | 1 ses.  | P14.2              | 2ème preset prioritaire                                                |
| P14.4  | `DevServerMiddleware` — intégration Vite dans `@nodefony/http`                  | 2 ses.  | P14.2, P1 (Context) | Mode `integrate: true` — Vite middleware dans pipeline HTTP            |
| P14.5  | `StaticMiddleware` — serve build prod via `@nodefony/http`                      | 1 ses.  | P14.2              | Mode prod, hash-cached assets                                          |
| P14.6  | Multi-module frontend — N modules avec frontend dans la même app                | 1 ses.  | P14.4              | Routes prefix par module, isolation HMR                                |
| P14.7  | Commands CLI : `frontend:create/build/dev`                                       | 1 ses.  | P14.2, P11.1       | Skeletons Vue/React, génère config + dépendances                       |
| P14.8  | Tests intégration build Vue 3 + React 19                                         | 1 ses.  | P14.3              | Vérifier output ESM hashed + sourcemaps                                |
| P14.9  | Presets optionnels Svelte 5 + Solid                                              | 1 ses.  | P14.3              | Différable                                                              |
| P14.10 | Migration Studio pour utiliser `@nodefony/frontend`                              | 1 ses.  | P14.4, P10.7       | Studio = 1er consommateur prod du module                                |

**Effort total Phase 14 : ~12 sessions**.

### 14.4 Décisions stratégiques

1. **Vite par défaut, Webpack uniquement sur demande** : standard 2026, perf imbattable, ESM natif.
2. **Pas de bundler propriétaire** : ne pas réinventer Vite. Wrapper minimal.
3. **Module frontend ≠ module backend** — un même `@nodefony/<module>` peut avoir les deux côtés cohabiter (`nodefony/` backend + `frontend/` UI).
4. **Studio = 1er consommateur prod** — son frontend (P10.7) utilisera Vite + Vue 3 (ou React 19, décision P10.1) via `@nodefony/frontend`.
5. **HMR via WS** : profite du WebSocket natif `@nodefony/http` — Vite HMR injecté directement, pas de port séparé en mode `integrate: true`.

### 14.5 ⚠️ MAJ 2026-05-16 — `@nodefony/frontend` + Core isomorphe (ex-`@nodefony/client`)

> **Refonte** : `@nodefony/client` SUPPRIMÉ comme module séparé. Voir mémoire `project_decisions_realtime_isomorphic.md`.

| Module                       | Rôle                                                                                          | Quand l'utiliser                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `@nodefony/frontend` (P14)   | **Builder + dev server Vite** — transpile/bundle les frontends des modules (Vue/React/Svelte) | Quand un module a un frontend à compiler              |
| Core isomorphe (P14.11)      | **Container DI + Syslog + Service + EventEmitter** exportés côté browser via `package.json.exports.browser` | Importé DANS le code Vue/React/Svelte des modules via alias automatique du plugin Vite Nodefony |
| Protocole RT (P13.7)         | **JSON-RPC 2.0 maison** — RPC bidirectionnel + types partagés `ServerToClientEvents`/`ClientToServerEvents` + HTTP long-polling fallback | Pour temps réel symbiose Socket.IO-like |

**Exemple Studio** : utilise `@nodefony/frontend` pour bundler son Vue 3, importe le Core isomorphe (Container + Syslog) pour structurer le code front exactement comme le back, consomme P13.7 pour les events temps réel typés vers backend.

---

## Phase 13 — Realtime + Redis cluster + Client navigateur

> **Trois sous-phases qui peuvent s'exécuter en parallèle d'autres phases selon leurs dépendances.**
> Référence JS : `realtime-bundle` (689 L `realTimeService` + sockets TCP/UDP/Unix) + `redis-bundle` (166 L `redisService`) — `/Users/cci/repository/nodefony/src/nodefony/bundles/{realtime,redis}-bundle/`.

### 13.1 `@nodefony/realtime` (nouveau module — sockets bas niveau)

> **Périmètre** : serveurs TCP / UDP / Unix domain sockets — protocoles bas niveau pour use cases IoT, télémétrie, ingestion devices, protocoles binaires internes.
> **Le WebSocket reste dans `@nodefony/http`** — pas de duplication. `realtime` complète avec les transports non-WS.

| Fichier TS cible                                            | Source JS référence                              | Statut | Complexité | Notes                                                  |
| ----------------------------------------------------------- | ------------------------------------------------ | ------ | ---------- | ------------------------------------------------------ |
| `@nodefony/realtime/interfaces/IRealtimeServer.ts`          | N/A                                              | ⬜     | 1          | Contract : `start/stop/onConnection/broadcast`         |
| `@nodefony/realtime/interfaces/IRealtimeConnection.ts`      | `realtime-bundle/src/connections.js`             | ⬜     | 1          | Connection abstraite avec id, type, send, close        |
| `@nodefony/realtime/src/TcpServer.ts`                       | `realtime-bundle/src/tcpSocket.js` (65 L)        | ⬜     | 2          | `node:net` — listen, connections Map, broadcast        |
| `@nodefony/realtime/src/UdpServer.ts`                       | `realtime-bundle/src/udpSocket.js` (84 L)        | ⬜     | 2          | `node:dgram` — udp4/udp6, multicast support            |
| `@nodefony/realtime/src/UnixServer.ts`                      | `realtime-bundle/src/unixSocket.js` (stub)       | ⬜     | 2          | `node:net` Unix socket — IPC local                     |
| `@nodefony/realtime/service/realtime-service.ts`            | `realtime-bundle/services/realTimeService.js` (689 L) | ⬜ | 3          | Orchestrateur : sélection protocole, lifecycle kernel |
| `@nodefony/realtime/src/ConnectionRegistry.ts`              | `realtime-bundle/src/connections.js`             | ⬜     | 2          | `Map<id, IRealtimeConnection>` cross-protocol          |
| `@nodefony/realtime/src/codecs/`                            | N/A                                              | ⬜     | 2          | Codecs pluggables : raw, line-delimited, length-prefix, MessagePack |
| `@nodefony/realtime/nodefony/config/config.ts`              | `realtime-bundle/Resources/config/`              | ⬜     | 1          | Ports, hosts, codecs par défaut                        |
| `@nodefony/realtime/tests/integration/tcp.test.ts`          | N/A                                              | ⬜     | 2          | Client TCP local → server, broadcast, disconnect       |
| `@nodefony/realtime/tests/integration/udp.test.ts`          | N/A                                              | ⬜     | 2          | Send/receive datagrammes, multicast                    |
| `@nodefony/realtime/tests/integration/unix.test.ts`         | N/A                                              | ⬜     | 1          | Socket file `/tmp/nodefony.sock`                       |
| `@nodefony/realtime/index.ts`                               | N/A                                              | ⬜     | 1          | Barrel                                                  |

**Cas d'usage** :
- IoT : devices envoient télémétrie via TCP/UDP → server pousse en Studio
- Microservices internes : IPC via Unix socket (plus rapide que HTTP loopback)
- Protocoles métier binaires (industrial, finance, gaming)

### 13.2 `@nodefony/redis` (refactor — cluster + pub/sub critique)

> **État actuel** : module existe (`src/packages/@nodefony/redis/`) mais minimal.
> **Refactor** : connection cluster + pub/sub + storage drivers (cache, session) + distributed lock.
> **Bloquant** : P5.12 (`RedisSessionStorage`) en dépend.

| Fichier TS cible                                            | Source JS référence                              | Statut | Complexité | Notes                                                          |
| ----------------------------------------------------------- | ------------------------------------------------ | ------ | ---------- | -------------------------------------------------------------- |
| `@nodefony/redis/interfaces/IRedisClient.ts`                | `redis-bundle/services/redisService.js`          | ⬜     | 1          | Contract : `get/set/del/expire/ttl/keys/scan`                  |
| `@nodefony/redis/interfaces/IRedisPubSub.ts`                | N/A                                              | ⬜     | 2          | `publish/subscribe/unsubscribe/pSubscribe`                     |
| `@nodefony/redis/interfaces/IRedisCluster.ts`               | N/A                                              | ⬜     | 2          | `nodes/slots/failover` — mode Cluster                          |
| `@nodefony/redis/service/redis.ts`                          | `redisService.js` (166 L)                        | 🔶     | 2          | Refactor — `node-redis@4` ou `ioredis` (décider)               |
| `@nodefony/redis/service/redis-pubsub.ts`                   | N/A (nouveau)                                    | ⬜     | 2          | **CRITIQUE** : publish/subscribe pour clusters + Studio WS     |
| `@nodefony/redis/service/redis-cluster.ts`                  | N/A (nouveau)                                    | ⬜     | 3          | Mode Cluster (sharding) + Sentinel (HA)                        |
| `@nodefony/redis/src/RedisCache.ts`                         | N/A                                              | ⬜     | 2          | Cache générique avec TTL — consommé par services Nodefony      |
| `@nodefony/redis/src/RedisLock.ts`                          | N/A                                              | ⬜     | 2          | Distributed lock (Redlock pattern) — anti double-trigger jobs  |
| `@nodefony/redis/src/RedisSessionStorage.ts`                | N/A                                              | ⬜     | 2          | **Implémente `ISessionStorage`** — débloque P5.12              |
| `@nodefony/redis/tests/integration/redis.test.ts`           | N/A                                              | ⬜     | 2          | redis-memory-server, CRUD + TTL + scan                         |
| `@nodefony/redis/tests/integration/pubsub.test.ts`          | N/A                                              | ⬜     | 2          | Pub/Sub local, channels, pattern subscribe                     |
| `@nodefony/redis/tests/integration/lock.test.ts`            | N/A                                              | ⬜     | 2          | Concurrence lock + expiration                                  |
| `@nodefony/redis/index.ts`                                  | actuel                                           | 🔶     | 1          | Barrel à compléter                                              |

**Décision client Redis** : `node-redis@4` (officiel Redis Labs, TS natif) vs `ioredis` (legacy, cluster support mature). À figer début Phase 13.2.

**Use cases pub/sub** :
- Cluster Nodefony multi-instance : sync state (broadcast Studio update à toutes les instances)
- Notifications cross-process : un worker Nodefony notifie les autres
- WS broadcast scalable : pub à Redis → toutes instances Nodefony forward aux WS clients

### 13.3 ⚠️ OBSOLÈTE 2026-05-16 — `@nodefony/client` ABANDONNÉ → Core isomorphe P14.11

> **REFONTE** : `@nodefony/client` n'est PLUS un module séparé. Le **Core Nodefony (Container/Syslog/Service)** devient isomorphe (back + front) — voir tâche **P14.11** dans la roadmap priorisée.
>
> La table ci-dessous est conservée comme **référence historique du périmètre fonctionnel** (HTTP/WS/auth/streaming clients), à redistribuer entre :
> - `@nodefony/http` (déjà migré) — HTTP/WS côté serveur, types partageables côté client via build conditionnel
> - **P14.11** Core isomorphe — Container, Syslog, Service, EventEmitter exportés côté browser
> - **P13.7** — Protocole JSON-RPC 2.0 maison (RPC bidirectionnel, types `ServerToClientEvents`/`ClientToServerEvents` partagés)
>
> Voir mémoire IA `project_decisions_realtime_isomorphic.md` pour la décision et les raisons.

| Fichier TS cible                                            | Rôle                                                                 | Statut | Complexité | Notes                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------ |
| `@nodefony/client/src/NodefonyClient.ts`                    | Entry point — initialize avec `baseUrl`, `token?`, `wsUrl?`           | ⬜     | 2          | Singleton optionnel, configurable                       |
| `@nodefony/client/src/http/HttpClient.ts`                   | Fetch wrapper avec auth, CSRF, propagation X-Request-Id               | ⬜     | 2          | Typed via interfaces partagées                          |
| `@nodefony/client/src/ws/WebSocketClient.ts`                | WS avec reconnect auto, protocol negotiation, requestId trace         | ⬜     | 3          | Backoff exponentiel, queue messages offline             |
| `@nodefony/client/src/ws/StreamClient.ts`                   | Lecture AsyncIterable de tokens LLM streamés (consomme `@nodefony/agent`) | ⬜ | 2          | Pour Studio panels LLM + apps consommatrices           |
| `@nodefony/client/src/auth/AuthClient.ts`                   | login/logout/refresh, stockage token (cookie httpOnly via API)        | ⬜     | 2          | Pas de token en localStorage                            |
| `@nodefony/client/src/auth/CsrfClient.ts`                   | Double-submit cookie pattern côté browser                              | ⬜     | 1          | Consomme `@nodefony/security/csrf`                      |
| `@nodefony/client/src/typed/` (DTO partagés)                | Types TS partagés client↔server (via npm workspaces ou monorepo path) | ⬜     | 2          | Lien direct vers `@nodefony/{http,framework,user}` interfaces |
| `@nodefony/client/rollup.config.ts`                         | Build ESM + UMD + CDN bundle (browser-ready)                          | ⬜     | 2          | Sortie multi-format pour usage non-bundler              |
| `@nodefony/client/tests/integration/client.test.ts`         | Playwright/jsdom — server Nodefony local + client browser headless    | ⬜     | 3          | HTTP + WS round-trip + auth flow                        |
| `@nodefony/client/index.ts`                                 | Exports publics                                                       | ⬜     | 1          | Barrel                                                  |

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

| Bloc       | Sessions estimées | Description                                       |
| ---------- | ----------------- | ------------------------------------------------- |
| P13.1      | ~7                | `@nodefony/realtime` (TCP/UDP/Unix sockets)        |
| P13.2      | ~8                | `@nodefony/redis` refactor (cluster + pub/sub)     |
| P13.3      | ~9                | `@nodefony/client` (lib navigateur)                |
| **TOTAL**  | **~24**           |                                                    |

**Ordre recommandé** :
1. **P13.2 prioritaire** (Redis) — bloque P5.12 (RedisSessionStorage) et apps prod cluster.
2. **P13.3 en parallèle ou avant P10.7** (Studio frontend bootstrap) — Studio en dépend.
3. **P13.1 en dernier** (Realtime) — indépendant, peut venir à n'importe quel moment après P1.

---

## Phase 12 — Couche IA agentic (DERNIÈRE phase de migration)

> **Démarrage uniquement après P10 (Studio MVP) validée.**
> Les modules existants (`llm`, `vector`, `rag`, `memory`, `agent`) ont été créés pendant la première phase exploratoire — ils sont **incomplets, non figés**, et doivent être audités/refondus pour s'intégrer proprement à la nouvelle architecture framework (multi-ORM, security, Studio, ALS requestId, logs structurés).
> Voir `VISION_IA.md` pour la mission, `CLAUDE_IA.md` pour les conventions techniques, `IA_STATUS.md` pour l'état précédent (à reseter en début de P12).

### 12.1 Audit + refonte des 4 modules existants

> Aucun de ces modules n'a été conçu en prenant en compte : multi-ORM (P5/P7), `@nodefony/security` (P6), `IUser` (P5.5), Studio admin (P10), `AsyncLocalStorage requestId` (P1.4), logs structurés (P3).
> Audit complet avant de continuer.

| Module                | État actuel TS                | Refonte nécessaire                                                                                                          |
| --------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@nodefony/llm`       | 10 fichiers, build ✅          | (a) Standardiser `ILLMProvider` (interface stable), (b) ajouter providers manquants (Mistral souverain, Groq), (c) intégrer ALS requestId dans logs LLM calls, (d) cost reporting hook (utilisé par agent-guard) |
| `@nodefony/vector`    | 7 fichiers                    | (a) Adapter pgvector **via `@nodefony/orm-core` + Drizzle** (pas client direct), (b) Qdrant via fetch natif, (c) Chroma local dev, (d) `IVectorStore` interface stable |
| `@nodefony/rag`       | 7 fichiers                    | (a) Pipeline ingestion async streamable, (b) chunking pluggable, (c) embedding via `ILLMProvider.embed`, (d) recherche multi-vector-store, (e) traçabilité sources (RAG citation) |
| `@nodefony/memory`    | 6 fichiers                    | (a) `IMemoryService` standardisé, (b) court/long/épisodique via stratégies, (c) storage via orm-core (table `agent_memory_*`) |

| #      | Tâche                                                                | Effort  | Dépendances              | Notes                                                                  |
| ------ | -------------------------------------------------------------------- | ------- | ------------------------ | ---------------------------------------------------------------------- |
| P12.1.1| Audit `@nodefony/llm` — refonte interface stable + tests             | 2 ses.  | P10 ✅                   | Locker `ILLMProvider` shape — base de tout le reste                    |
| P12.1.2| `@nodefony/llm` — ajouter providers Mistral (EU souverain) + Groq    | 1 ses.  | P12.1.1                  | Mistral pour conformité AI Act (LLM EU)                                |
| P12.1.3| Audit `@nodefony/vector` — adapter pgvector via orm-core + Drizzle   | 2 ses.  | P7.4 ✅ (Drizzle)        | Bascule de client SQL direct → ORM. Tests cross-store                  |
| P12.1.4| Audit `@nodefony/rag` — pipeline + sources citation                  | 2 ses.  | P12.1.1, P12.1.3         | Conformité AI Act = traçabilité sources                                |
| P12.1.5| Audit `@nodefony/memory` — storage orm-core + stratégies             | 2 ses.  | P12.1.4                  |                                                                        |

### 12.2 Finalisation `@nodefony/agent` (orchestrateur)

> Existant 🔶 — manque `AgentOrchestrator`, decorators `@Agent`/`@Tool`, tests.

| #      | Tâche                                                                | Effort  | Dépendances        | Notes                                                                       |
| ------ | -------------------------------------------------------------------- | ------- | ------------------ | --------------------------------------------------------------------------- |
| P12.2.1| `@Agent({ permissions, limits })` decorator + métadonnées            | 1 ses.  | P12.1.1            | Métadonnées Reflect, contract IAgent                                        |
| P12.2.2| `@Tool({ inputSchema, outputRules })` decorator + ToolRegistry       | 1 ses.  | P12.2.1            | Zod inputSchema pour validation runtime                                      |
| P12.2.3| `AgentOrchestrator.run()` — boucle agentic LLM ↔ tool calls          | 2 ses.  | P12.2.2            | `maxIterations` (10 par défaut), `AgentMaxIterationsError`                  |
| P12.2.4| `AgentOrchestrator.stream()` — AsyncGenerator avec events            | 1 ses.  | P12.2.3            | events: `started/thinking/tool_call/tool_result/token/completed`            |
| P12.2.5| `abort(sessionId)` + `shutdown()` — cleanup AbortController/Maps     | 1 ses.  | P12.2.4            | Map<sessionId, AbortController>                                             |
| P12.2.6| Tests integration AgentOrchestrator (loop, abort, timeout)            | 1 ses.  | P12.2.5            |                                                                              |

### 12.3 `@nodefony/mcp` — Model Context Protocol (Anthropic standard)

> Vide actuellement. Crée à partir de zéro.

| #      | Tâche                                                                | Effort  | Dépendances        | Notes                                                                       |
| ------ | -------------------------------------------------------------------- | ------- | ------------------ | --------------------------------------------------------------------------- |
| P12.3.1| `MCPProtocol.ts` — JSON-RPC 2.0 types + codes erreur                 | 0.5 ses.| —                  | -32700 parse, -32600 invalid req, -32601 method not found, etc.             |
| P12.3.2| `MCPServer.ts` — handleRequest() + méthodes initialize/tools/resources | 2 ses. | P12.3.1, P12.2.2  | Expose tools Nodefony à Claude Desktop / Cursor / VS Code                   |
| P12.3.3| `MCPClient.ts` — Nodefony consomme des MCP servers externes          | 2 ses.  | P12.3.1            | Pour étendre les agents avec des tools externes                             |
| P12.3.4| Validation strict noms tools (`/^[a-z][a-z0-9_]*$/`) + limites (256/1024) | 0.5 ses. | P12.3.2          |                                                                              |
| P12.3.5| Tests MCPServer + MCPClient (JSON-RPC compliance, edge cases)         | 1 ses.  | P12.3.3            |                                                                              |

### 12.4 `@nodefony/agent-guard` — Gouvernance + conformité AI Act (DIFFÉRENCIATEUR)

> Vide actuellement. **C'est le module qui distingue Nodefony de NestJS+LangChain**. Conformité AI Act dès la conception.

| #      | Tâche                                                                | Effort  | Dépendances              | Notes                                                                       |
| ------ | -------------------------------------------------------------------- | ------- | ------------------------ | --------------------------------------------------------------------------- |
| P12.4.1| Interfaces + decorators `@Agent/@AgentZone("sensitive")/@Tool`        | 1 ses.  | P12.2.2                  | 4 zones : public/sensitive/restricted/forbidden                             |
| P12.4.2| `ZoneResolverService` + `PermissionCheckerService` + `AgentRegistryService` | 2 ses. | P12.4.1, P6 ✅ (security) | Default deny si aucune zone match                                           |
| P12.4.3| `PIIMaskingService` — patterns FR (NIR, IBAN, CB, tel, email, SIRET) + custom | 1 ses. | —                | Conformité RGPD + AI Act                                                    |
| P12.4.4| `AuditService` — entités MikroORM→orm-core + audit trail signé        | 2 ses.  | P12.4.3, P7 ✅            | Conformité AI Act : audit signé, immuable                                   |
| P12.4.5| `CostTrackerService` — UPSERT par agent+date (1 ligne/jour)           | 1 ses.  | P12.4.4, P12.1.1         | Consommé par Studio panels (P12.5)                                          |
| P12.4.6| `CircuitBreakerService` — closed → open → half-open + cooldown        | 1 ses.  | P12.4.4                  |                                                                              |
| P12.4.7| `ApprovalService` — Promise en attente débloquée via WS Nodefony      | 2 ses.  | P12.4.6                  | Humain dans la boucle pour zones `restricted`                               |
| P12.4.8| `OutputValidatorService` — règles de sortie par tool                  | 1 ses.  | P12.4.7                  |                                                                              |
| P12.4.9| `AgentGuardMiddleware` — wire Orchestrator → checks → audit           | 1 ses.  | P12.4.8                  | Intercept toutes les LLM/tool calls                                          |
| P12.4.10| Tests intégration agent-guard (zones, PII, circuit breaker, approval) | 2 ses. | P12.4.9                  |                                                                              |

### 12.5 Panels IA intégrés dans `@nodefony/studio` (ex-`@nodefony/studio`)

> **Décision** : `studio` n'est PAS un module séparé. Ses panels (agents, costs, audit, approvals) sont intégrés à `@nodefony/studio` via le pattern `IAdminApi` (cohérence avec autres panels Studio).

| #      | Tâche                                                                | Effort  | Dépendances        | Notes                                                                       |
| ------ | -------------------------------------------------------------------- | ------- | ------------------ | --------------------------------------------------------------------------- |
| P12.5.1| `IAdminApi` pour `@nodefony/agent-guard` (audit, costs, approvals)   | 1 ses.  | P12.4.10, P10.4    | Endpoints `/nodefony/agent-guard/api/*`                                     |
| P12.5.2| Vues Studio : Agents (registry + état), Costs (UPSERT par jour)       | 2 ses.  | P12.5.1            |                                                                              |
| P12.5.3| Vues Studio : Audit trail (search + filter), PII patterns config      | 1.5 ses.| P12.5.2            |                                                                              |
| P12.5.4| Vue Studio : Approvals (queue WS realtime → approve/reject)            | 1.5 ses.| P12.5.3            | Critique pour humain dans la boucle                                          |

### 12.6 Tests cross-module IA + conformité AI Act

| #      | Tâche                                                                | Effort  | Dépendances        | Notes                                                                       |
| ------ | -------------------------------------------------------------------- | ------- | ------------------ | --------------------------------------------------------------------------- |
| P12.6.1| Test E2E RAG : ingest PDF → chunking → embed → vector store → query → réponse + sources | 1 ses. | P12.1.5     | Conformité AI Act traçabilité                                               |
| P12.6.2| Test E2E agent loop : LLM → tool → re-LLM → end_turn (avec abort)     | 1 ses.  | P12.2.6            |                                                                              |
| P12.6.3| Test E2E MCP server : Claude Desktop consomme un tool Nodefony       | 1 ses.  | P12.3.5            |                                                                              |
| P12.6.4| Test E2E gouvernance : zone restricted → PII mask → audit → approval | 2 ses.  | P12.4.10, P12.5.4  |                                                                              |
| P12.6.5| Test E2E mode souverain : Ollama + pgvector + air gap                | 1 ses.  | P12.1.5            | Aucune API externe ne doit être appelée                                     |
| P12.6.6| Documentation conformité AI Act (audit trail, sources, contrôle humain) | 1 ses. | P12.6.5            | Article 50+ AI Act — preuves opérationnelles                                |

### 12.7 Synthèse Phase 12

| Bloc       | Sessions estimées | Description                                    |
| ---------- | ----------------- | ---------------------------------------------- |
| P12.1      | ~9                | Audit + refonte 4 modules existants             |
| P12.2      | ~7                | Finalisation `@nodefony/agent`                  |
| P12.3      | ~6                | `@nodefony/mcp` (server + client)               |
| P12.4      | ~14               | `@nodefony/agent-guard` (différenciateur)       |
| P12.5      | ~6                | Panels IA dans Studio                           |
| P12.6      | ~7                | Tests E2E + conformité                          |
| **TOTAL**  | **~49 sessions**  | Couche IA complète                              |

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

## Blockers connus

| Module                          | Problème                                                  | Solution envisagée             | Résolu |
| ------------------------------- | --------------------------------------------------------- | ------------------------------ | ------ |
| `src/nodefony/rollup.config.ts` | `@ts-ignore` sur `rollup-sourcemap-path-transform`        | Créer `.d.ts` shim minimal     | ⬜     |
| `IKernel.ts`                    | `cli: object \| null` → devrait être `ICliKernel \| null` | Session dédiée ICliKernel      | ✅     |
| `IModule.ts`                    | `getController()` retourne `unknown` → `IController`      | P0.3 — `IControllerConstructor<T>` générique | ✅ (2026-05-16) |

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
| 2026-05-18 | Vision realtime Studio beta testeur + fix types CSS Mantine + commit POC | `vite-env.d.ts` (nouveau), `App.tsx` (nettoyé), memory `project_realtime_vision_studio_beta.md` | ~1h | **Vision figée** : Studio devient le beta testeur de l'archi temps réel. Chip topbar `<IconPlugConnected>` = point d'entrée hub : click → liste services subscribed + stats ; navigation → sub/unsub auto. `ConnectionStepper` +5ème étape WS réelle. `@nodefony/client` (P14.11) doit être polymorphe back/front (Container/Service/Syslog isomorphes, attention couleurs ANSI server-only). **Vision SIP/asterisk** : RealtimeService = pont protocolaire universel (WS browser → TCP/UDP server side). Widget Migration Status dans Studio Dashboard à venir (alimenté manuellement par Claude). Fix typing CSS Mantine via `vite-env.d.ts` + `/// <reference types="vite/client" />`. |
| 2026-05-18 | Rename Vision → Studio global + scaffold `@nodefony/studio` (frontend React 19 prêt à brancher) | `MIGRATION_STATUS.md`, `CLAUDE.md` racine, modules CLAUDE/MEMORY, 11 memory IA, `src/packages/@nodefony/studio/**` | ~3h | **Rename** : 63 occurrences MIGRATION_STATUS + memory files + renommage 2 fichiers (`project_vision_module.md`→`project_studio_module.md`, `project_ia_vision_final.md`→`project_ia_studio_final.md`). **Scaffold studio** : backend = `StudioController` `/nodefony` + 6 API mock (health, info, auth/{login,me,logout}, realtime/info). Frontend = React 19 + Mantine v8 + MobX 6 + Router 7 + TanStack Table 8 + Tabler Icons. 5 stores MobX (Auth/Connection/Ui/Chat/Root), AuthGuard, Login 4-step stepper, AdminLayout (sidebar groupée + theme toggle), Dashboard (heap V8 RingProgress + 5s polling), Chat IA (streaming mock), 13 pages stub. **`RealtimeClient`** stub préfigure `@nodefony/client` (JSON-RPC 2.0 + reconnect expo + streaming). **Bug détecté** : multi-bundle [[project_frontend_multibundle_bug]] — `@nodefony/test-frontend-react` commenté temporairement dans `@modules()`. Smoke test backend OK : 200 sur `/nodefony` + `/api/info` + `/api/health`. P10.1 ✅, P10.5/P10.7 🔶. |

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

**P0 — terminé (2026-05-16)** :

1. ✅ **P0.1** — RFC 9110 §15.5.6 ne s'applique pas aux WebSockets (commit d0f8ecf). Tests 370/0.
2. ✅ **P0.2** — WS binary séquentiels verts (vérifié 2026-05-16, 370 passing).
3. ✅ **P0.3** — `IControllerConstructor<T>` générique (commits f2208d2 + 83049fc).

**Démarrer ici (P1 — fondations symbiose, ~7.5 sessions)** : refactors techniques 9.5 dans cet ordre : `Context.lifecycle` (P1.1) → `onAfterResponse` (P1.2) → `AbortSignal` (P1.3) → `AsyncLocalStorage requestId` (P1.4) → `errorRenderer` (P1.5) → `logRequest` pluggable (P1.6) → hooks security (P1.7).

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
