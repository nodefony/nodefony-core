---
title: Feuille de route de la migration — archive intégrale
lang: fr
status: ARCHIVE (photo du 2026-08-27 — ne plus éditer)
audience: Lead Architect / mainteneur
publish: false
---

# Feuille de route de la migration — archive intégrale

> **Photo, pas document vivant.** Cette page conserve la feuille de route ligne à ligne telle
> qu'elle existait le 27 août 2026, **cases faites comprises**. Elle a été sortie de
> `MIGRATION_STATUS.md` parce que 112 de ses lignes racontaient du travail TERMINÉ : cette
> histoire-là, `git log` la porte mieux qu'un tableau coché à la main, et sa relecture coûtait
> à chaque session.
>
> **Ne rien mettre à jour ici.** Ce qui reste à faire vit dans le jalon
> [`10.0.0`](https://github.com/nodefony/nodefony-core/milestone/1) ; les tâches non faites sont
> restées dans `MIGRATION_STATUS.md`, et les dettes encore ouvertes aussi.
>
> ⚠️ Les états `✅`/`🔶`/`⬜` de cette photo ont été posés à la main, dernier audit le 20 août —
> **208 commits `feat`/`fix` plus tard**. Une confrontation au code menée le 27 août a montré
> qu'une partie des cases non cochées correspond à du travail déjà livré. Ne pas se fier à un
> état d'ici sans le vérifier dans le code.

## 🗺️ Roadmap priorisée (dette technique d'abord)

> Spécifications détaillées : mémoire IA `core-dev/migration/phases-details.md`.

### 🟠 Dette AVANT RELEASE — préfixe `NF_` sur toutes les variables d'environnement

Le framework lit **122** noms de variables. **Cette dette est SOLDÉE** : les deux familles qui
restaient — génériques revendiqués par d'autres outils, interrupteurs de coût des bancs — portent
désormais `NF_`. Les **17** noms encore sans préfixe sont tous **délibérés** : on ne les possède pas,
ou les lire EST le contrat.

**Pourquoi AVANT la release, et non après** — la justification initiale (« renommer est une rupture
pour toute application déjà déployée ») supposait des applications déployées. La 10.0.0 est la
première release : il n'y en a aucune. Faire le renommage APRÈS obligerait à écrire un repli
transitoire (lire l'ancien nom, avertir, documenter le nouveau) qu'il faudrait ensuite supprimer —
deux chantiers au lieu d'un, et un intervalle où deux noms vivent en parallèle, exactement le motif
« 1 RÈGLE = 1 implémentation » qu'on s'interdit ailleurs. Avant la release, la rupture coûte zéro.

<!-- prettier-ignore -->
| Famille | Nb | Traitement |
| --- | --- | --- |
| ~~`NODEFONY_*`~~ | ~~18~~ **0** | ✅ **SOLDÉ** — renommées en `NF_*` (8 publiques, 10 internes), rupture nette sans alias |
| ~~Génériques revendiqués par d'autres outils~~ : `NF_REDIS_HOST/PORT/PASSWORD/TEST_URL`, `NF_MONGO_TEST_URI`, `NF_MONGODB_DEBUG`, `NF_BCRYPT_COST/N`, `NF_POD_NAME`, `NF_MODE_START`, `NF_NO_TTY` | ~~12~~ **0** | ✅ **SOLDÉ** — renommées, sans alias. `REDIS_URL` a été SORTI du lot : `resolveInfra` l'accepte volontairement comme alias plateforme (Heroku/Render/Upstash le posent), `NF_REDIS_URL` restant prioritaire |
| ~~Interrupteurs de coût des bancs~~ : `NF_RUN_PERF`, `NF_RUN_CLI_BOOT`, `NF_RUN_CLUSTER_E2E`, `NF_RUN_WS_RUPTURE`, `NF_WS_RUPTURE_CAP/STEP` | ~~6~~ **0** | ✅ **SOLDÉ** — preuve NÉGATIVE exécutée : `RUN_PERF=1` laisse 4 tests sautés (mort), `NF_RUN_PERF=1` rend 89/89 (vivant) |
| Conventions d'écosystème qu'on LIT sans les posséder : `APP_ENV` (12-factor/Symfony), `DATABASE_URL`, `MONGODB_URI`, `REDIS_URL` (PaaS) | 4 | **ne pas renommer** — les lire est le contrat ; la forme `NF_` reste PRIORITAIRE (`resolveInfra`, `APP_ENV \|\| NF_ENV`) |
| Standards tiers : `NODE_ENV`, `NODE_DEBUG`, `NODE_NO_WARNINGS`, `UV_THREADPOOL_SIZE`, `BABEL_ENV`, `SHELL`, `PORT` | 7 | **ne pas toucher** — on ne les possède pas |
| Posées par l'orchestrateur : `KUBERNETES_SERVICE_HOST`, `KUBERNETES_SERVICE_PORT` (détection « je tourne dans un pod ») | 2 | **ne pas toucher** — c'est Kubernetes qui les écrit, les renommer les rendrait introuvables |
| Fixtures de test (`LOADENV_A…D`, noms fictifs d'un test de `loadEnv`) | 4 | hors périmètre — ne sont pas des variables du produit |

**La règle vaut pour tout ce qui est ÉCRIT** : cf `CLAUDE.md`, section des invariants — aucune
variable neuve sans `NF_`, y compris pour les tests, les bancs et les interrupteurs de coût.

**Deux limites de périmètre, assumées.** (1) `docker/docker-compose.yml` garde `REDIS_PASSWORD` /
`REDIS_PORT` : ce sont des **substitutions Compose**, voisines de `POSTGRES_PASSWORD` et
`MARIADB_*` que les images officielles lisent elles-mêmes et qui, elles, ne peuvent pas changer.
`vitest.gates.ts` fait le pont — il LIT ces clés du compose et POSE des `NF_*`. (2) Les paramètres
des scripts de bancs (`.claude/skills/**`, ~60 noms : `CONC`, `RATE`, `WS_URL`…) ne sont pas
publiés et n'entrent en collision chez personne.

### P0 — Bugs bloquants ✅ (6/6)

Tous résolus : 11 fails RFC HTTP, 2 fails WS binary, `getController()` typé, **BUG-001→004** (propagation ALS WS,
leaks scope DI sur erreur/session WS). Tests preuve présents (`http-rfc-errors`, comptage scopes).

### P1 — Fondations symbiose ✅ (8/8)

`Context.phases`, `onAfterResponse`, `signal` (AbortSignal lazy), **`RequestContext` ALS** (requestId/user), `errorRenderer`
unifié HTTP+WS, `logRequest` pluggable, hooks security (`beforeResolve`/`afterAuth`/`onAuthFailure`), graphe symbolique `.ai/symbols.json`.

### P2 — Cycle de vie Context (100 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P2.1 | Boundary timing phase-by-phase | via P1.1 (`Context.phases`, lazy) ; **waterfall COMPLET (`a23b36d5`)** : `initialize` (DI + hook controller) / `render` (moteur de vue) / `send` (saveSession + write) désormais ÉMISES — le profil s'arrêtait à la fin de `action` ; sonde `timing.enabled` allumable EN PROD (`NF__APP__TIMING__ENABLED=true`, ~2-4 % RPS mesurés, 0 coût éteinte) |
| ✅ P2.2 | Tear-down déterministe (finish+close) | via P1.2 (dedup race) |
| ✅ P2.3 | Aborted cleanup + 499 interne | `client-abort-499.test.ts` |
| ✅ P2.4 | `initialize()` error boundary | crash → onError → 500 JSON cohérent |
| ✅ P2.5 | Request timeout (408/504) | 2 couches (Node natif + `onTimeout` Nodefony) |
| ✅ P2.6 | Idempotency keys (`X-Idempotency-Key`) | livré via `@Idempotent` (P6.8) + stores Redis/Drizzle |
| ✅ P2.7 | W3C `traceparent` honor + génère | `service/trace.ts` |
| ✅ P2.8 | Backpressure doc + tests streaming | `write()===false` → attend `'drain'` (Node stream) ; CL⊥TE RFC 9112 §6.1 ; tests unit |
| ✅ P2.9 | Body streaming (`@Body({stream})`) | flux brut (`Readable`), parse sauté ; route-match avant parse (A/B 0 régression) ; HTTP/1+2 |

### P3 — Logs structurés (85 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P3.1 | Audit log canonique (1 PDU JSON/req) | `JsonAuditLogger` |
| ✅ P3.2 | Pretty formatter dev | `PrettyRequestLogger` |
| ✅ P3.3 | Severity selon HTTP status | `severityFromStatus()` |
| ✅ P3.4 | Header redaction (Authz/Cookie) | flags booléens, valeurs jamais loggées |
| ✅ P3.5 | Erreur enrichie (cause chain + stack) | `AuditErrorEntry` récursif |
| 🔶 P3.6 | Filtrage par requestId (CLI) | `Pdu.requestId` livré ; reste le CLI tool (LB.3b) |
| ✅ P3.7 | Mode trace verbose (phase DEBUG) | `logPhasesVerbose()` opt-in `timing.verbose`, perf-gate (0 coût off), teardown |
| 🔶 P3.8 | Rate limit logs par requestId | anti-flood livré ; reste clé par requestId |
| ✅ P3.9 | WS logs (handshake/close/error + wsId) | per-message volontairement écarté (hot path) |
| ⏭️ P3.10 | Transport NCSA/Combined dédié | absorbé par P3.11 (driver `file`) |
| 🔶 P3.11 | **Log Backplane** (write↔read pluggable) | LB.W+LB.0→LB.5+LB.4 ✅ ; défaut `queryDriver:auto` cluster-aware + garde-fou k8s multi-pod (`83f8b9ff`/`a0408f10`) ; reste LB.3b CLI |

### P4 — Tests symbiose ✅ (6/6)

`forward` cross-module, decorators × pipeline, **concurrence 100 req** (unicité ALS), WS pipeline (7 fichiers),
DI scopes (singleton/transient), lifecycle session.

### P5 — Session + User + ORM Core (85 %) ◀ chemin critique

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| 🔶 P5.0 | Gate batch/console (`initServers` par type) | `isConsole()` + dispatch 0-serveur OK ; reste `BatchCommand` |
| ⬜ P5.0b | Service Cron/Worker (worker dédié) | décision : gardé, découplé serveur |
| ✅ P5.1 | `@nodefony/orm-core` + interfaces | `IOrm/IRepository/IEntity` + trappe SQL brut |
| ✅ P5.2 | `OrmRegistry`/`EntityRegistry` + base class | 15 tests |
| ✅ P5.3 | `@entity`/`@repository` decorators | WeakMap, sans reflect-metadata |
| ✅ P5.3b | `AbstractCrudService<T,R>` | socle CRUD générique (hooks template) |
| ✅ P5.4 | Tests orm-core + adapter réel | portabilité prouvée (orm-core 22 tests) |
| ✅ P5.5a | Workspace `@nodefony/user` | lib pure, peerDeps |
| ✅ P5.5 | Contrats `IUser`/`BaseUser`/`IUserProvider` | 11 tests, split credential |
| ✅ P5.6 | `UserService` + `BcryptEncoder` | `@node-rs/bcrypt`, 32 tests |
| ⏭️ P5.7 | ~~Adapter Sequelize User~~ | **caduc (virage ORM : sequelize supprimé)** |
| ✅ P5.8 | Adapter Mongoose User | `MongooseUserRepository implements IUserRepository` + `userSchema`/`registerUserEntity` (parité Drizzle, binding ORM dynamique) ; `findBySocialProvider` via `$elemMatch`. **8 tests** (ReplSet : CRUD/finders/tx rollback) |
| ✅ P5.9 | Adapter Drizzle User | ORM par défaut, 8 tests |
| 🔶 P5.10 | Tests User cross-ORM | couvert **de facto** par 2 bancs miroirs même contrat `IUserRepository` (Drizzle 8 + Mongoose 8) ; banc paramétré unifié = optionnel |
| ✅ P5.11 | **Refonte cœur + plug runtime session** | TS strict, ID CSPRNG opaque, dirty-tracking, cookie-only, contrat `ISessionStorage` unifié ; **plug runtime** `@UseSession` opt-in + lazy + L1 + point unique HTTP/WS (tue le ×23) ; cookie RFC 6265bis `__Host-`/SameSite/None⇒Secure + `cookie.hostPrefix` ; `readOnly` + `absolute_timeout` (OWASP). Tests unit+intég+load+mémoire. (chantier session 2026-06-06/07) |
| 🔶 P5.12 | `Redis` SessionStorage | File + **Redis livrés** (TTL natif IoC) ; reste câblage prod |
| ✅ P5.13 | `OrmSessionStorage` générique | Drizzle + **Mongoose livrés** (contrat `ISessionStorage` portable ; sequelize supprimé) |
| ✅ P5.14 | `session.user` + régén ID post-auth | J3 `00ee6631` : câblé via `AuthFlow.login` (regen INCONDITIONNEL + destroy old, anti-fixation prouvée au banc) ; session porte l'IDENTIFIANT, re-fetch provider par requête |

### P6 — Security (87 %) — ✅ cœur MVP LIVRÉ (bloqueur MVP LEVÉ) ; reste durcissement/niches HORS MVP

> **CŒUR P6 BOUCLÉ** — J0→J9 (`1634f09e`→`1df19b93`) + CSRF/CORS/en-têtes (`ebe7e915`/`0724a8c6`/`f4f9ead8`) + CSP nonce (`eb59daf6`). Authenticators Anonymous/Password/Session-BFF/JWT/OAuth2-social/WebAuthn ; autorisation voters + `@IsGranted` (HTTP **et** WS) ; Argon2id + throttle NIST. **Détail-journal = `git log` + mémoires IA + audit vérité `core-dev/migration/AUDIT-verite-2026-06.md` + plan P6 `core-dev/audits/p6-security-audit-2026-06-12.md`.** ✅ **modèle session NIST-aligné** (idle+absolute+touch HTTP+WS, retrait du reliquat PHP `maxLifetimeS`, red-team 11/11, `e27de035`). Reste : P6.16 rpId multi-vhost · P6.9b mTLS (niches). App pose `users` en prod (`3d140de1`, auth prod réparée). Audit persistant P6.18 ✅ (multi-dialecte S3/S4).

<!-- prettier-ignore -->
| # | Tâche | Preuve / état (détail → git log + mémoires IA) |
| --- | --- | --- |
| ✅ P6.1 | `AccessControl` (RBAC walker) | `RoleHierarchyWalker.ts` câblé J6 (firewall→container→`RoleVoter`) |
| ✅ P6.2 | `cors.ts` service | J5 `Cors` (Fetch Standard) ; `handleCors` en tête de `handleHttp` |
| ✅ P6.3 | `firewall.ts` + `SecuredArea` + `defineSecurityConfig` | J1 `c84c0ba3` : Zod fail-closed, mode first\|all, WWW-Authenticate RFC 7235 |
| ✅ P6.4 | `AnonymousAuthenticator` + token | J1 `c84c0ba3` : anonymat opt-in (Zero Trust sinon) |
| ✅ P6.5 | `UserPasswordAuthenticator` | J1 `c84c0ba3`+`25e90b29` : Basic RFC 7617 → `IPasswordVerifier` |
| ✅ P6.5b | Argon2id + migration + throttling NIST | J2 `08ae659e`+`a7e2520e`+`bd9cd602` : RFC 9106, MigratingEncoder, LoginThrottler 429 |
| ✅ P6.5c | **Session BFF** : SessionAuthenticator + AuthFlow | J3 : login/logout/me, anti-fixation OWASP, throttler partagé entre portes |
| ✅ P6.6 | `JwtAuthenticator` (Bearer EdDSA, `jose`) | J4 : allowlist EdDSA+aud+iss RFC 8725, Ed25519 keystore JWKS, TokenService |
| ✅ P6.7 | `csrf.ts` + `@CsrfProtect`/`@CsrfExempt` | J5 : Sec-Fetch-Site primaire + Origin/Referer ; double-submit HMAC stateless |
| 🔶 P6.8 | `authorization.ts` (3 niveaux) | J6 `4e336d50` : RoleVoter + `decide()` affirmative+DENY véto, voterRegistry ; reste niveau B (ACL fine par ressource) |
| ✅ P6.8b | Décorateurs sécu (`@IsGranted`/`@Anonymous`/`@CurrentUser`) | J7 `df673ef8`+`4a11523b` : dans @nodefony/framework (0 cycle, moteur par nom) |
| ✅ P6.9 | OAuth2 social login (`arctic`) | BFF Google/Keycloak/GitHub `oauth2-flow` 6/6 (J9 `41c702f2`→`1df19b93`). |
| ✅ P6.9.1 | Resource server — protocole au CŒUR + porte MCP | **Resource server : protocole + porte LIVRÉS** (`6296fdaa`) — `nodefony/src/oauth/` (RFC 9728 métadonnées, 6750 défi, 8707 audience) en fonctions pures HORS de `mcp/`, porte MCP sous `mcp.authorization` (éteint par défaut). |
| ✅ P6.9.2 | Vérificateur de jetons TIERS (`RemoteJwtVerifier`) | **VÉRIFICATEUR LIVRÉ** — `RemoteJwtVerifier` + service `accessTokenVerifier` dans `@nodefony/security` : accepte un jeton émis par un serveur d'autorisation TIERS (Keycloak/Auth0/Entra/agents) là où `JwtAuthenticator` ne connaît que le keyset LOCAL. Découverte RFC 8414 (3 URL, ordre normatif, `issuer` du document ≡ celui demandé §3.3), clés par `createRemoteJWKSet` (jamais `jku`/`jwk` d'en-tête), allowlist d'émetteurs FERMÉE consultée AVANT toute requête sortante, `HS*` impossible en config (les clés viennent d'un jeu public). 🔴 **Refus ⇒ `null`, PANNE ⇒ `throw`** : liste BLANCHE des fautes du jeton, car jose lève une erreur générique ou SANS code sur un JWKS en `500`, un corps non-JSON ou un `fetch` qui rejette — une liste noire aurait rendu ces trois pannes comme « jeton invalide » (démontré : le débranchement produit 3 rouges). `fetch` injectable (`jose.customFetch`) → 40 cas sans réseau ni port. Le NOM du point de rendez-vous vit au cœur (`ACCESS_TOKEN_VERIFIER`) et non en littéral de chaque côté : il existait en 2 exemplaires, qu'aucun test ne couvrait. |
| ✅ P6.9.3 | Authenticator firewall (`ExternalJwtAuthenticator`) | **LIVRÉ** — la zone `external-jwt` rattache un sujet externe à un `IUser` local. Invariants : `subjectPolicy:"require"` par défaut — un jeton d'IdP vaut pour des milliers de comptes, l'accepter d'office ferait de l'IdP l'unique autorité et supprimerait la seconde décision, locale, qui EST le pare-feu · l'audience vient de la ZONE (`area.resource`, RFC 8707 §2), exigée au boot par `IAuthenticator.validateArea?()` : aucun nom en dur dans le pare-feu · aiguillage `jwt`/`external-jwt` par `iss`, sinon l'ordre d'une liste de config devient une décision de sécurité · `supports()` ne lève JAMAIS (un `iss` non-URL donnait une **500 provoquée par un anonyme**) · **panne ⇒ 503**, jamais le 401 du fail-closed, sinon le client renouvelle en boucle un jeton valide et la panne se range dans la statistique des échecs d'auth. Débranchements joués. |
| ✅ P6.9.4 | Porte MCP branchée et éprouvée | **LIVRÉ** (`bf798eec`, `dc5f1bc0`, `5c4771c1`) — `mcp.authorization` déclare l'URI canonique de la porte et son émetteur ; `jwt.audiences` la rend demandable, sans quoi la serrure n'aurait aucune clé. Mode `anonymous` en développement (`false` en prod) : l'ABSENCE de jeton est tolérée, un jeton PRÉSENTÉ est vérifié strictement. Invariants : l'application lit son PROPRE JWKS en LOCAL (`ITrustedIssuer.localJwks`) — le réseau n'a rien à faire dans une vérification dont la clé est en mémoire · une ressource peut avoir deux adresses (`acceptedResources`), écrites, jamais dérivées du `Host` · le jeton va **où l'agent le lit**, emplacement CONSTATÉ outil par outil · la porte se déclare **en appelant la CLI de chaque agent** (`ai:mcp --agent`), jamais en écrivant son fichier : Nodefony possède le jeton et l'URL, l'agent possède le format ; `shell:false` fait arriver `${NF_MCP_TOKEN}` littéral · « aucun agent » est un CHOIX. Quatre défauts d'agents tiers MUETS côté code de sortie ⇒ **verdict pris au CONSTAT**, en relisant par leur propre commande. |
| ✅ P6.9.5 | Rôle ÉMETTEUR (RFC 8414) — publier ses clés | **LIVRÉ** — `/.well-known/oauth-authorization-server` + `/.well-known/jwks.json`, montés seulement si `jwt.enabled ∧ jwt.jwks ∧ issuer https` (sinon 404 + WARNING nommant la cause). Protocole au CŒUR (`nodefony/src/oauth/authorizationServer.ts`) : framework n'importe jamais security. Invariants : **la publication fait autorité, la lecture en dérive** — deux copies produiraient un 404 lu comme « pas d'autorisation ici » · **l'URL publique s'ÉCRIT** (`NF_JWT_ISSUER`), jamais dérivée du `Host` : derrière un relais elle vient du client, et `iss` est gravé dans chaque jeton déjà émis · document réduit à ce qui est VRAI (`grant_types_supported` vide plutôt qu'un défaut implicite) · liste BLANCHE des champs du JWKS (`createdAt` y fuyait par un spread). |
| ✅ P6.9.6 | e2e du SUCCÈS, sans IdP tiers | **LIVRÉ** — le chemin `authenticated` se joue sur un vrai serveur sans IdP tiers : l'app se déclare dans sa propre allowlist **sans `jwksUri`**, donc la découverte est réellement exercée (document → `jwks_uri` → JWKS → signature Ed25519 → audience → rattachement local). Une zone jumelle à préfixe DISJOINT refuse le MÊME jeton sur la seule foi de l'audience — deux zones qui se recouvrent feraient dépendre le verdict de leur ORDRE. Scope absent ⇒ **403** et non 401 : le porteur est authentifié, c'est le pouvoir qui manque. Signature altérée ⇒ 401 et jamais 503 : la distinction refus/panne tranche dans les DEUX sens. Trois débranchements, compte annoncé AVANT de couper. |
| ✅ P6.9.7 | Red-team / blue-team — 2 failles fermées | **2 FAILLES FERMÉES** — campagne threat-first (SSRF par `iss`, confusion d'algorithme, `jku`/`jwk` d'en-tête, audience étrangère, signature altérée, scope absent, ponts). (1) Le document d'émetteur était servi sur TOUTE autorité écoutée. (2) 🔴 Une socket WS adossée à un jeton TIERS ne mourait jamais : l'authenticator posait `scopes`/`subject` mais ni `claims` ni `jti`, si bien que ni `exp`, ni révocation ciblée, ni révocation en masse n'atteignaient la connexion — atteignable dès qu'une zone `external-jwt` garde `realtime` à son défaut. **Cause racine : une donnée qui s'ARRÊTE à la frontière du vérificateur** (`IAccessPrincipal` ne portait que `{subject, scopes}`). Fix en deux temps — la cause au contrat du cœur, ET le filet (le fail-closed porte sur ce qu'on PEUT vérifier), qui attrapera le prochain authenticator oublieux. |
| ✅ P6.9.8 | Audience DEMANDABLE (RFC 8707) | **LIVRÉ** — le client NOMME sa cible (`resource` sur le grant) : une application peut avoir une porte MCP, une API interne et un back-office dont les jetons ne se confondent pas. `jwt.audiences` devient une liste blanche de ressources demandables ; hors liste, multiple, non-URI absolue ou avec fragment ⇒ **400 `invalid_target`**, jamais servi avec l'audience par défaut — un `resource` accepté puis jeté rendrait un jeton valide POUR QUELQU'UN D'AUTRE, faute qui ne se manifesterait que chez la ressource. **Une seule ressource par jeton** (§3). L'audience accordée est stockée au record refresh et **rejouée à la rotation** : une restriction qui s'annulerait au premier renouvellement n'en serait pas une. Red-team du lot : le refus n'est pas un oracle (credential vérifié AVANT la ressource) ; 🔴 la rotation était une porte dérobée (`resource` transmis puis ignoré) — fermée par le contrôle §2.2. |
| ✅ P6.9.9 | Espace de noms du sujet externe | **FERMÉ** — en `require`, le `sub` d'un émetteur tiers était mappé DIRECTEMENT sur l'espace des identifiants locaux : un annuaire où l'utilisateur choisit son identifiant permettait de présenter `sub:"admin"` et de recevoir le compte local homonyme, jeton valide et zéro anomalie. **Même cause racine que la socket WS** : une donnée qui s'arrête à la frontière du vérificateur — `IAccessPrincipal` ne portait pas `iss`, alors que `sub` n'est unique QUE chez son émetteur (OIDC Core §2 : l'identité est la PAIRE). Fix en deux temps : `IAccessPrincipal.issuer` **requis** (un vérificateur incapable de dire d'où vient une identité ne doit pas pouvoir en produire une) et `subjectMapping` par émetteur, défaut `prefixed` ⇒ `<issuer>#<sub>`, séparateur injectif puisque RFC 8414 §2 interdit le fragment dans un `issuer`. Émetteur absent de la table ⇒ 503, jamais un rattachement deviné. |
| ✅ P6.9.10 | Défi RFC 9728 — le refus devient apprenable | **LIVRÉ** (`08a3f3f8`) — `WWW-Authenticate` porte `resource_metadata`, seul mécanisme normalisé qui dise à un client où obtenir un jeton. Le blocage n'était pas le calcul mais le CONTRAT : `challenge()` ne recevait rien alors qu'une instance est partagée entre zones et que le pointeur nomme UNE ressource — il prend désormais l'`area`. Aucun `error` joint : le firewall pose le défi sur TOUT 401 sans savoir si un jeton était présent, et RFC 6750 §3 l'interdit alors. Défaut annexe trouvé en live : les descriptions partaient ACCENTUÉES dans un en-tête HTTP, qui n'est pas de l'UTF-8 — filtre au point de composition selon la grammaire RFC 6750 §3. ⚠️ Un test purement négatif ne prouve rien (il restait vert sur un `Bearer` nu) : assertion positive ajoutée. |
| ✅ P6.9.11 | Document de ressource protégée — le pointeur mène quelque part | **LIVRÉ** (`fde3d850`, `71228441`) — un document par ressource déclarée. 🔴 **La source est la MÊME que celle du défi** (les zones du pare-feu), donc pointeur et document ne peuvent pas diverger ; `authorization_servers` dérive de `resourceServer.issuers`, pas d'une seconde liste — publier autre chose enverrait le client demander un jeton à un émetteur dont on refuse ensuite la signature. Le montage **BALAIE le conteneur** au lieu d'interroger le seul pare-feu (un module déclare aussi ses ressources) : un registre aurait imposé une dépendance d'ordre, un module enregistré trop tard n'étant jamais publié, en silence. Le controller MCP dédié est RETIRÉ — deux implémentations d'une même règle divergent et se disputent un chemin que le routeur attribue au premier arrivé. Garde d'autorité partagée avec le document d'émetteur : un document servi sur une autorité dont la ressource ne se réclame pas fait s'ARRÊTER un client conforme, là où un 404 le laisse continuer. |
| ✅ P6.9.12 | Plan d'administration — porte UNIQUE d'exécution | **UNE PORTE, PLUS DEUX CHEMINS** (`41c340ab`) — `runAdmin` était `private` : l'exécution d'un endpoint (RBAC → idempotence → handler → normalisation → erreurs) était prisonnière d'un adaptateur de TRANSPORT, pendant qu'un second chemin refaisait le geste en dégradé. Extraite au cœur (`kernel/adminPlane/executeAdmin.ts`), avec le RBAC et la règle de rôle effectif — qui vivait dans le broker, donc les portes sans Router ne la traversaient jamais. Ce que la duplication coûtait : un refus joint le corps qui dit quoi demander à la place, et la porte pauvre n'en gardait que le STATUT — un agent lisait « introuvable » et concluait que la page n'existait pas, l'inverse de la vérité. L'idempotence n'est PAS déplacée (son second consommateur est franchement framework) : paramètre `gate`, où `null` est un choix qu'on lit. |
| ✅ P6.9.13 | L'appelant porte son IDENTITÉ jusqu'à la porte | **LE RÔLE CESSE D'ÊTRE FABRIQUÉ** (`df7a965a`) — `callAdminEndpoint` posait `roles:["ROLE_NODEFONY_ADMIN"]` en dur : le contrôle s'appliquait à un sujet inventé, donc **tout porteur d'un jeton d'audience valide obtenait la lecture d'administration complète**. L'identité se PRÉSENTE (`IAdminCaller`, 3ᵉ paramètre OBLIGATOIRE : le compilateur force chaque porte à dire au nom de qui elle appelle). **Les DEUX bornes existent** : `rolesFromScopes` n'accorde le rôle qu'à un jeton portant `admin:read`/`admin:write`, et `refusedAdminScopes` empêche un non-administrateur de les OBTENIR — sans la seconde, « tout jeton vaut admin » devenait « tout jeton QUI DEMANDE ». Doctrine : **droits du sujet ∩ portée déléguée** ; une session cookie n'a pas de tiers donc pas de scope (Studio inchangé). Généricité au cœur (`mcpCallerRoles`) pour les portes MCP de P12. ⚠️ Asymétrie NOMMÉE, non fermée : un jeton sur la porte HTTP hérite des rôles du compte sans intersecter ses scopes ; et un seul rôle ouvre les 94 endpoints — c'est du RBAC **fail-closed**, pas du moindre privilège. |
| ✅ P6.9.14 | Le plan d'administration s'ouvre en LECTURE par MCP — deux outils, jamais 98 | **DEUX OUTILS GÉNÉRIQUES** (`4dbcd164`, `53a297b4`) — `admin_list` + `admin_call`, coût de contexte CONSTANT au lieu des ~12 k tokens permanents qu'aurait coûtés un outil par endpoint. **68 lectures atteignables sur 98**, sans allowlist : le catalogue naît du registre, donc un producteur qui ajoute un endpoint le publie sans qu'on écrive une ligne. 🔴 Règle UNIQUE — **ce qui est listé est appelable, et rien d'autre** : `admin_call` ne re-décide rien (deux points de décision, c'est celui qu'on relit le moins qui devient permissif). Trois exclusions, toutes COMPTÉES donc dicibles. Défaut latent : la résolution par le seul CHEMIN alors que 8 chemins portent 2-3 méthodes — la lecture gagnait *par chance*. Red-team (21 vecteurs) : le pont recopiait `error.message` que HTTP masque (chemin de disque et requête fuyaient par MCP) ; et l'évaluation des capacités pouvait lever en emportant le catalogue ENTIER — un module en panne fermait la porte pour toute l'application. |
| ✅ P6.9.15 | La porte publie ce qu'elle EXIGE — et ne punit plus qui présente MAL | **`scopesSupported` DÉRIVÉ** (`d2bd59ca`, `741dcb84`) — la clé de configuration est SUPPRIMÉE : ce que la porte publie et nomme dans son défi est l'union des `IMcpTool.scopes` des outils DÉCLARÉS. Elle mentait dans les DEUX sens sans qu'aucun contrôle ne l'aperçoive — publiant `admin:write` qu'aucun outil n'exige, taisant le scope d'un outil de module. Un scope se pose sur l'outil qu'il ouvre, seul endroit où il a un EFFET. 🔴 Le vocabulaire ne dépend PAS de l'appelant : le document se lit SANS jeton, un catalogue filtré n'annoncerait à l'anonyme que ce dont il n'a pas besoin — il ne demanderait jamais de jeton. 🔴 Défaut trouvé par le USER en s'en servant : **présenter MAL valait moins que ne rien présenter** — un jeton expiré ou un gabarit non substitué rendait 401 et ZÉRO outil quand le même client MUET en recevait 6, et un client MCP marque alors le serveur « failed » pour TOUTE la session. `readBearerHeader` à trois verdicts, et un jeton rejeté sur une porte anonyme est servi en ANONYME (journal `WARNING`), les réservés restant retenus. |
| ✅ P6.9.16 | Le CÂBLAGE d'un agent se choisit, et une app générée peut ouvrir SA porte | **LIVRÉ** (`fbe3b92c`, `5c11a658`, `ce931e99`) — `create app` demandait de câbler un PROTOCOLE ; personne n'installe un protocole, on se sert d'un assistant. La question vit dans la SPEC, donc servie par les trois fronts (terminal, `--agents`, **Studio**). Ce qui autorise l'écriture chez un tiers n'est plus « un humain est devant un terminal » mais un **choix EXPLICITE** — sans quoi Studio, sans TTY, restait muet par construction ; rien de coché ⇒ rien d'écrit. 🔴 Trou produit fermé : **une application générée ne pouvait pas obtenir le jeton de SA porte** (`invalid_target`) — le gabarit n'avait aucun bloc `jwt`. Le dépôt marchait grâce à `src/modules/test`, qui déclarait `security.jwt.audiences` pour toute l'application : un module de BANC s'était arrogé une décision d'APPLICATION, et c'est ce qui rendait le trou invisible ici. Ce que chaque agent lit est une donnée de la table, ancrée dans son SOURCE. |
| ✅ P6.9c | Passkeys / WebAuthn (FIDO2) | `@simplewebauthn` lazy, stores memory/file/Drizzle/Mongoose/Redis, 34 tests (J9) |
| ⬜ P6.9d | **Serveur d'autorisation OAuth 2.1** (code flow + PKCE) | **NON FAIT — TRANCHÉ (décision user) : APRÈS la release 10.0.0.** Conséquence assumée : la 10.0.0 sort avec un MCP dont la sécurité est complète et prouvée, mais dont le jeton s'obtient **hors bande**. Le report déplace la charge sur la DOCUMENTATION (comment obtenir et poser le porteur). Nodefony ÉMET des jetons et publie de quoi les vérifier (RFC 8414 + JWKS), mais n'offre aucun **flux d'obtention** normatif : ni `authorization_endpoint`, ni `token_endpoint`. Conséquence CONSTATÉE sur un vrai client : le SDK MCP exige les deux champs et refuse la connexion — alors que le document est LÉGAL sans eux (RFC 8414 §2). **Ce n'est PAS un prérequis du MCP authentifié** : la spec impose le porteur, pas le moyen de l'obtenir. C'en est un pour un client qui doit obtenir son jeton SEUL. |
| ⬜ P6.9b | `MTlsAuthenticator` | zones admin (niche, non démarré) |
| 🔶 P6.10 | Logs auth + CSP stricte + headers | J5-A `SecurityHeaders` (CSP + Referrer + COOP/COEP/CORP + Permissions-Policy) ; reste logs auth dédiés |
| ✅ P6.11 | Tests intégration security complets | 23 fichiers test + 7 bancs E2E live ; chantier red-team (matrice d'attaque par brique) |
| ✅ P6.12 | API Keys (PAT) | `2c3e252c` : `ApiKeyAuthenticator` (`nf_…` CRC anti-DoS, sha256, révoqué/expiré) |
| ✅ P6.13 | Webhooks (backend + data plane + stores ORM + Studio) | **COMPLET** `4d9006c5`→`486eb75b` — SSRF+secret chiffré+dispatcher Standard Webhooks v1+livraison bornée anti-DoS ; data plane `WebhookAdminApi` (broker) + stores Drizzle/Mongoose + page Studio + livraisons récentes + récepteur sink ; e2e live 25/25, 765 security. [[project_p6_webhooks_slice_c_kit]] |
| ✅ P6.14 | Audit events + stream WS | `6f028fbe` : `IAuditEvent` + `MemoryAuditStore` FIFO + query curseur (lots 1-4) |
| 🔶 P6.15 | Studio — section Sécurité | Pages LIVRÉES : Sessions/Users/API Keys/Firewall/Audit/Profil self+admin (`8d54bf4a`→`486eb75b`) ; reste live `security:audit` (canal OFF) |
| ✅ P6.17 | 2FA / TOTP (step-up login) | `e5d47a73`→`52a18811` : RFC 6238 step-up du login mot de passe + Studio + passkeys CRUD |
| ✅ P6.18 | Audit — store PERSISTANT (dette de P6.14) | `audit.driver` pluggable via `auditStoreRegistry` + **`DrizzleAuditStore`** append-only (curseur exact `(ts,id)`, gc rétention) — **porté sqlite+pg+mysql via S3/S4 multi-dialecte** (`40fa5aba`/`0ac019ef`, e2e PG+MySQL réels). Adapters mongoose/redis = CHOIX différé (couverture « adaptée, pas parité ») |
| ⬜ P6.16 | WebAuthn — `rpId` dynamique par Host (multi-vhost) | `#rpID` figé au boot (`webAuthn.ts`) → dériver du `Host` de la requête |

### P7 — ORM Drivers (64 %) ◀ **BLOQUEUR RELEASE** — multi-dialecte sqlite/pg/mysql = condition de release ; **comparatif froid ✅ (`a370b5a1`) → Drizzle CONFIRMÉ**, portage débloqué (`orm-comparatif-froid-2026-07`, mémoire IA `core-dev/audits/`)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ⏭️ P7.1 | ~~Sequelize (legacy)~~ | **SUPPRESSION COMPLÈTE** (virage ORM, `716fce6`) |
| ✅ P7.2 | Mongoose — adapter orm-core | **refait (Ph.2)** : `MongooseService extends Service` + `describeConnection`/flow tap |
| ⏭️ P7.3 | ~~Tests intégration Sequelize~~ | caduc |
| ✅ P7.4 | ⭐ **`@nodefony/drizzle`** (référence) | `DrizzleOrm`/`DrizzleRepository`, 8 tests |
| 🔶 P7.5 | Tests Mongoose | **156 verts / 12 fichiers contre un MongoDB 8 RÉEL** (docker `--profile mongo`, replica set — mesuré 07-23 ; `MONGO_GATE` pose `NF_MONGO_TEST_URI`, `gateReporter` confirme « cible exercée »). Les 5 briques déclarées sont exercées par LEUR store : session 37 · webhooks 20 · jetons 24 · passkeys 24 · user 17 · orm-core 13 · transactions/eager-load/cycle de vie 14. ⚠️ **La mention « 0 E2E / memory-server seulement » qui figurait ici était FAUSSE** — corrigée en la LANÇANT (le décor docker existe depuis le début ; `mongodb-memory-server` n'est que le repli hors ligne). **Reste** → tout est porté par **P7.11** : parité de contrat (4 suites partagées ne tournent que sur drizzle) et E2E système (aucun serveur Nodefony bootté sur Mongo — les bancs montent les services à la main, sans Kernel). Étude complète : mémoire IA `project_orm_multidialect_chantier_kit` |  |
| ✅ P7.6 | Tests Drizzle (SQLite/PG) | banc orm-core 8 tests |
| 🔶 P7.7 | `@nodefony/redis` refactor | conventions/config Zod faites |
| 🔶 P7.10 | ⭐ **Portabilité multi-dialecte (CRITIQUE RELEASE)** | **Slice 0 + S1→S4 ✅** (`5bcd2d7f`→`0ac019ef`, 06-26→07-08) : `connector.dialect` sqlite/postgres/mysql, repository **PK-portable**, **colKit** (spec logique → table du dialecte, G1) + **queryKit** (SQL natif routé : `json_each`/`@>` jsonb/`JSON_CONTAINS`, bindé), chemins sans-RETURNING mysql, idempotence `INSERT IGNORE`+vol, `mysqlJsonCompat` (LONGTEXT MariaDB). **LES 8 BRIQUES × 3 DIALECTES** — preuves : **drizzle 274/274** dont **banc de parité de contrat `IRepository` 14×3** + 41 e2e PG réel + 33 e2e MySQL 8.4 ET MariaDB 11.4 (gatés `NF_PG_URL`/`NF_MYSQL_URL`). Comparatif froid ✅ Drizzle CONFIRMÉ (`a370b5a1`, garde-fous G1-G3). **Reste : S5 DDL prod** — design ✅ VALIDÉ 07-10 (`orm-migrations-design-2026-07`, mémoire IA `core-dev/audits/` : drizzle-kit + applicateur MAISON `DrizzleMigrator`, table `nodefony_migrations(source,tag)`, lock natif, modes ddl auto/migrate/none), **implémentation GELÉE → après P8+P11** (lots S5a-d). Détail-journal = `git log` + `project_orm_multidialect_chantier_kit` |
| ⏭️ P7.8 | ~~`@nodefony/mikroorm`~~ | **abandonné** (jamais commencé, module absent) |
| ⏭️ P7.9 | ~~Tests MikroORM~~ | caduc |
| ⬜ P7.11 | 🔴 **FULL NoSQL — 3 stores mongoose + parité de contrat** | **Objectif tranché 07-23 : une app doit tourner SANS `@nodefony/drizzle`** — mongoose est un chemin durable, donc complet 8/8. Manquent `totp`, `audit`, `idempotency` : aujourd'hui `auto` se replie sur `memory` (secrets 2FA perdus au redémarrage, journal d'audit volatil). Détail → snapshot mémoire IA + git log. |

> ✅ **Gap intégration SQL COMBLÉ (S1-S4)** : e2e **PG réel** (41, gatés `NF_PG_URL`) + **MySQL/MariaDB réels**
> (33, `NF_MYSQL_URL`) + boot serveur réel (users/session drizzle) + e2e PG cross-pod (Slice 0).
>
> ⚠️ **Correction 07-23 — le « gap mongoose » décrit ici était FAUX.** Il annonçait « `mongodb-memory-server`
> seulement, 0 E2E contre un MongoDB Docker persistant » : la suite tourne en réalité contre un **MongoDB 8
> docker en replica set** (profil `mongo`, `MONGO_GATE`), **156 tests verts**, session comprise (37).
> Corrigé en LANÇANT la suite, pas en relisant le tableau — cf **P7.5** et l'étude complète (mémoire IA
> `project_orm_multidialect_chantier_kit`). Ce qui reste est plus précis et plus utile : **parité de
> contrat** (4 contrats partagés ne tournent que sur drizzle) et **E2E système** (aucun serveur Nodefony
> bootté sur Mongo). ⭐ Le mot « E2E » recouvrait deux choses — « contre un vrai serveur de base » (fait)
> et « à travers le framework bootté » (absent) : toujours dire lequel.
>
> ⚠️ **Correction 07-23 — « mongoose 5/8 = CHOIX » était FAUX.** La règle « couverture adaptée à la
> nature, pas parité SQL×NoSQL » reste juste pour un **cache** ; elle avait servi à couvrir un trou sur
> un chemin **durable**. Le bon critère n'est pas la nature de chaque brique mais : **peut-on tourner
> sans drizzle ?** Un backend durable est un chemin complet ou n'en est pas un — un utilisateur choisit
> sa base de données, il ne choisit pas de perdre le 2FA, l'audit ou l'idempotence. `totp`, `audit`,
> `idempotency` côté mongoose = **trou**, planifié en **P7.11** (objectif : full NoSQL, 8/8). Ce qui
> reste un vrai choix : `redis` sans `user`/`audit`/`webhooks` — pas parce qu'il « évince », mais parce
> que ces données croissent sans borne, se conservent des mois et se consultent (la RAM n'est pas leur
> support). `redis` gagne en revanche `totp`, au régime opt-in de ses `tokens`/`passkeys`.

### P8 — CLI + Monitoring (88 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P8.1 | `bin/nodefony.ts` | banner rolldown (shebang), CLI fonctionnel + **complétion shell bash/zsh/fish** (`completion [install\|uninstall]` + `__complete` standalone 0-boot, manifest cache — commandes de module incluses ; install = bloc rc marqué idempotent/réversible) + **`man nodefony`** (`f8679d46` — page GÉNÉRÉE depuis commander, 3ᵉ porte de la même source que `--help` et la complétion ; champ npm `man`, gate de fraîcheur `scripts/generate-man.mjs --check`, Windows sans `man` natif ÉNONCÉ). 🔴 **Le manifest s'autodétruisait** (`fa7bc4b9`) : `writeFile` en fire-and-forget tronquait le fichier à **0 octet** quand le process sortait — chaque commande détruisait le cache de la précédente, d'où menu amputé ET complétion fausse ; temporaire + `rename`. Écriture élargie aux commandes ponctuelles (`9dbfb468`, profil et non environnement) et TAB **0,46 s → 0,14 s** (fast-path AVANT le chargement du cœur) |
| ✅ P8.2 | Generators Module/Controller | **commande CLI `nodefony create` livrée** — 7 types (`app/module/controller/service/front/entity/command`, `CREATE_TYPES` `src/nodefony/src/cli/create.ts`) + skills scaffold (vérif audit 08-06) |
| ✅ P8.3 | `DebugBar` (monitoring) | `src/nodefony/src/client/debugbar/` |
| ✅ P8.5 | **Chaîne de publication npm** | `scripts/release/` — elle appartient au PRODUIT, plus à l'outillage d'agent (un CYCLE existait : `release.mjs` appelait un script du skill, qui réimportait le cœur). `npm run release` (prépare et REFUSE : semver, préversion sans tag npm, arbre sale, planchers OIDC, graphe symbolique gitignoré, métadonnées, version déjà prise, lot non estampillé, contenu des tarballs, répétition `--dry-run` sur le lot ENTIER) · `release:pack` · `release:smoke` · `test:release` **114 tests** sur un cœur PUR. **La LICENCE voyage** (`81a5ee01`) : les quinze paquets déclaraient — ou pas — leur licence sans qu'aucun tarball n'en porte le texte, le seul `LICENSE.txt` vivant à la racine du MONOREPO, hors de tout paquet ; constaté sur l'artefact reçu (tarball `@nodefony/http` : 154 fichiers, ZÉRO licence) et quatre paquets sans champ `license` auraient été affichés « UNLICENSED ». Le texte est COMMITÉ dans chaque paquet — un tarball doit être légalement autonome — et `auditerMetadonnees` refuse désormais un paquet sans champ ou sans texte, AUX DEUX points d'entrée (`pack-all.mjs` ne transmettait pas `location` : la garde y aurait été aveugle). **PUBLIER n'implique plus ÉCRIRE** : préparer et publier sont deux gestes, la forge ne corrige pas ce qu'elle publie. Changelog conforme à **Common Changelog** (catégories fermées et ordonnées, entrées d'une ligne référençant leur commit, ruptures préfixées `**Breaking:**` en tête de catégorie, types no-op écartés et comptés) — 11 tests VUS ROUGES par 6 mutations, une par clause. **`release.yml`** : épreuve → publication OIDC (aucun jeton) → vitrine · image · annonce → bilan, avec un **CRAN D'ARMEMENT** (`NF_RELEASE_ARMED`) qui laisse tout tourner sans rien publier, et la garde R6.1 (branche `v7` de la vitrine) devenue EXÉCUTABLE. **La chaîne a TOURNÉ EN ENTIER, cran non armé** (tag d'essai `v10.0.0-essai.1`, run 32895215924) : trois scénarios d'épreuve verts, répétition complète, trois jobs irréversibles sautés — constaté après coup, `nodefony` toujours en 7.0.2 sur le registre. Elle a trouvé ce qui aurait tué la publication réelle : `ENOBUFS` sur le journal (le dépôt en pèse 3,4 Mo, `execSync` plafonne à 1 Mio, et faute de tag `v*` la borne repart du premier commit) et un workflow qui ne savait publier QUE des versions finales (jamais de `--npm-tag`, que `release.mjs` exige pour toute préversion). ⚠️ Un tag d'essai se SUPPRIME après son run, sinon la vraie `v10.0.0` calcule son changelog depuis lui. **`create-nodefony`** publié (15ᵉ paquet) : `npm create nodefony <app>` supprime le `npm i -g`. **La politique de compatibilité est ÉCRITE** (`df52aebc`, [`docs/guides/compatibilite.md`](../guides/compatibilite.md)) : garantie portée par `exports` seul, quinze paquets qui montent ENSEMBLE, dépréciation `@deprecated` une mineure au moins avant retrait à la majeure SUIVANTE, plancher Node relevé = majeure, et **seule la dernière majeure reçoit des correctifs** — étroit et tenable, plutôt qu'une garantie qui serait rompue. Mode d'emploi : [`docs/guides/publier-une-release.md`](../guides/publier-une-release.md) ; plan de version : [`docs/release/nodefony-10.md`](../release/nodefony-10.md). **Reste (R6, gestes GitHub hors dépôt) — DETTE ASSUMÉE, jouée d'un bloc JUSTE AVANT la publication, jamais à l'avance** (gestes irréversibles et publiquement visibles : ils exposeraient une version qui n'existe pas encore et figeraient un état que le dépôt peut encore contredire) : brancher `v7` sur `nodefony/nodefony` AVANT tout écrasement, archiver les 2 dépôts docker en doublon, poser les variables/secrets, puis publier les 13 neufs À LA MAIN (l'OIDC ne peut pas faire naître un paquet) et déclarer les publieurs de confiance |
| 🔶 P8.4 | `Metrics` runtime | via Studio (ticker stats → canal `nodefony:supervision`, `studio/nodefony/realtime/providers.ts`), pas service standalone ; `/metrics` Prometheus = 16.J repoussé |

### P9 — Polish + clôture (75 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P9.1 | `@entities` decorator + tests | `kernelDecorator.ts` |
| ⬜ P9.2 | Barrels `index.ts` | résiduel |
| ✅ P9.3 | README publics | http + framework + security présents (vérif 06-28) |
| ✅ P9.4 | Vulnérabilités npm | **0 vulnérabilité** (`npm audit`, 08-20 `42147fc3`) · **0 alerte Dependabot** · code scanning en `security-extended` (89 → 105 requêtes) : 4 TOCTOU `js/file-system-race` fermés (`3559d32e`), restent 2 `medium` `js/file-access-to-http` dev-only. 46 deps montées ; `typescript` 7 ÉCARTÉ (= palier P3 décorateurs, pas un bump) |

### P10 — Studio admin web (84 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P10.1 | Stack frontend (React 19) + Vite | acté |
| ✅ P10.2 | `IAdminApi` + `AdminBroker` | contrat figé, inversion de dép |
| ✅ P10.3 | `IAdminApi` http/framework/syslog/frontend | 5 producteurs, data plane `/nodefony/<m>/api/*` |
| ✅ P10.4 | `IAdminApi` user/orm-core/security | livrés — `SecurityAdminApi.ts` + `UserAdminApi.ts` + orm (vérif code 07-10) |
| ✅ P10.5 | Backend Studio + WS realtime | StudioController + JSON-RPC pub/sub + broker IAdminApi complet (7 producteurs) |
| 🔶 P10.6 | Auth admin (`ROLE_NODEFONY_ADMIN`) | rôle actif sur `/studio/api/create/*` (`@IsGranted`, `StudioCreateController.ts`) ; reste : le généraliser à toute la surface `/nodefony` (vérif audit 08-06) |
| ✅ P10.7 | Frontend bootstrap + router + layouts | React 19 + Mantine + MobX + WS permanent + auth réelle (P6) |
| ✅ P10.8 | Vues prio (dashboard/routes/sessions/users) | Dashboard/Modules/Routes/Cluster/Runtime/Sessions/Users ✅ livrées |
| ✅ P10.16 | Docs+API modules dans Studio | onglets Docs/API + carte Core (ex-`P10.x`, renuméroté pour entrer au comptage) |
| 🔶 P10.9 | Vues firewall/logs/databases/migrate | Logs ✅ (WS) + Databases ✅ + Firewall ✅ (cf P6.15) ; reste migrate (S5d, gelé) |
| 🔶 P10.10 | Vues services/profiling | incrémental (~~pm2~~ retiré C6) |
| ⬜ P10.11 | Tests intégration studio | 0 test studio (vérif 06-28) — back couvert e2e via security |
| ✅ P10.12 | Workspace composable (bureau) | fenêtres libres + espaces nommés + Mission Control + catalogue à facettes (taxonomie tags) + widgets supervision (mémoire/handles/erreurs/health/gc) ; remplace dashboard Dev |
| ✅ P10.13 | Jumeau vivant (Twin) | explorateur archi runtime + registre de blocs unifié + forages Realtime/ORM/HTTP |
| ✅ P10.14 | Portail doc (`@nodefony/documentation`) | DocLayout/MarkdownDoc/FlowGraph + data plane `/nodefony/documentation/api` (COMPLET, 14 src) |
| ✅ P10.15 | Écran Stores (persistance runtime) | `a6ec2dec`→`2014e0e3` (0.8 lot 6 + Palier 3) : couverture DÉCLARÉE par adapter (« adaptée, pas parité »), endpoint réseau redacté, emplacement physique (`kernel.varDir`), brique user 1ʳᵉ classe, provenance → fichier réel |

### P11 — CLI par module (50 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| 🔶 P11.1 | Tests intégration commandes existantes | filet spawn livré (`NF_RUN_CLI_BOOT=1`) + **renforcé `0b883854`** (typo=EX_USAGE 64, happy-path commande de module `http:network` 1-Kernel/0-serveur, point d'arrêt `onReady`, `status` standalone 0-Kernel) ; **refacto parse-pur `4a7d46ae`** (resolveCommand point unique, `runProfile` déclaratif → commande de module SERVER possible, `finishOrPark` uniforme) ; **lancement détaché natif `be9ca8b2`** (`--detach --wait --health`, fast-path standalone, `start.sh` = wrapper mince) ; reste commandes métier |
| ⬜ P11.2 | Commandes `http:*` | couplée API admin Studio |
| 🔶 P11.3 | Commandes `framework:*`/`security:*`/`user:*` | **`security:secrets` ✅ (`ac095e38`→`faa743eb`)** : génère les clés (TOTP/webhook/CSRF, 32 o base64) + câblage 3 fichiers `.env.local`→`env.ts`→`use()`, détection par clé, `--write` gardé (refus si tracké git) — référencée par les 3 warnings « clé ÉPHÉMÈRE » ; **`security:user:add` ✅ (`4ac7245e`)** : création de compte (hash Argon2id via UserService, prompt masqué TTY, `--admin` = rôles Studio), fix kernel `finishOrPark` console à `onPostReady` (process fantôme). Reste `framework:*` + `user:*` métier (dont `security:user:password`) |
| ⬜ P11.4 | Commandes `orm:migrate/…` | **design ✅ 07-10** (`orm-migrations-design-2026-07`, mémoire IA `core-dev/audits/`) : `orm:migrate`/`:status`/`:baseline`/`:repair`/`orm:generate --custom` — applicateur MAISON `DrizzleMigrator` (~~délégation aux CLI ORM natifs~~ REJETÉE : migrator drizzle prouvé insuffisant au code) ; implémentation = chantier S5 drizzle (S5c), après P8+P11 |
| ⬜ P11.5 | Commandes `logs:tail/filter` + bridge Studio | LB.3b |
| ✅ P11.6 | Boot UX dev — BootReporter + diagnostic (`58c15d8`/`74b4c8c`/`b140855`) | spinner/checklist dev-only + help modules + Vite checklist ; **diagnostic de boot** : `BootReport` (vérité unique) + **garde-fou 0-serveur** → CRITIC + `terminate(EX_UNAVAILABLE)` (visible k8s + DevSupervisor, plus de mort silencieuse) + résilience par-entrée `loadModulesFromManifest` ; **boot pro** : serveurs `➜ HTTP/HTTP2/WS/WSS` URLs cliquables, digest **Modules**, section **Données** (ORM `describeConnection` sans credential, via canal neutre `reportBootLine`), gate TTY `kernel.isTTY`, rien sur les commandes ; `await onServersReady` ; **bilan de FIN de boot (`e8cca076`)** : bloc « Bilan » du verdict (modules ignorés policy/when AVEC raison via `modulesGated`, échecs fail-soft, topologie process pid+RSS scopée projet, journal WARNING/ERROR du ring figé à postReady) — même `IBootReport` pour le futur endpoint Studio ; complétion TAB des arguments positionnels (`c48ce8be`) |
| ✅ P11.7 | Commande `proxy:generate nginx\|haproxy` (`6ac8562`) | dérive la conf de l'introspection (statiques, domaines sans IP, ports) ; nginx résout le trou statics multi-modules (chaîne `try_files`) ; haproxy proxy + Forwarded + `--reencrypt` ; générateurs purs (12 tests) |
| ✅ P11.8 | Préfixe natif statique + CDN (`e735544`/`29203c1`/`6918f89`) | `server-static.mountModulePublics` monte `public/` de chaque module sous `/<module>/` (configurable `publicMount`, défaut basename) ; `frontend.assetBaseUrl` + helper `asset()` préfixent les URLs prod (CDN) sans toucher au mount ; commande `assets:publish` assemble l'arbre `dist-assets/` (carte préfixe→dossier, provider-agnostic, 0 dep cloud) |

### P12 — Couche IA agentic (14 %) — 🧪 différé (dernière phase de la roadmap, cf skill `nodefony-roadmap`)

> Section créée à l'audit 08-20 : le bandeau comptait P12 sans qu'aucune section n'existe.
> État VÉRIFIÉ au code (sources hors dist ; règle « ne pas auditer/supprimer sans demande »).
> ⭐ Acquis structurel : le protocole MCP, ses gardes et son catalogue vivent **AU CŒUR**
> (`src/nodefony/src/mcp/`, livré lot 7 devkit) — P12.6 n'aura pas une ligne de protocole à écrire.

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| 🔶 P12.1 | `@nodefony/llm` | module réel (11 src, tests **vitest** `130f7386`) — non intégré au kernel |
| ⬜ P12.2 | `@nodefony/vector` | 7 src, tests `bun:test` inertes (aucun script `test`) |
| ⬜ P12.3 | `@nodefony/rag` | 7 src, tests `bun:test` inertes |
| ⬜ P12.4 | `@nodefony/memory` | 6 src, tests `bun:test` inertes |
| ⬜ P12.5 | `@nodefony/agent` | 5 src, tests `bun:test` inertes |
| 🔶 P12.6 | `@nodefony/mcp` | module vide (0 src, pas de package.json) MAIS protocole/gardes/catalogue déjà AU CŒUR + porte éprouvée (devkit lot 7, P6.9.1→9.4) |
| ⬜ P12.7 | `@nodefony/agent-guard` | vide (0 src, pas de package.json) |

### P13 — Realtime distribué (77 %)

> **5 seams sécurité (P13.4a/4b/4c/7a/8a) tous ✅** → P6 se branchera sans refonte. Setup infra docker (Redis/Kafka) livré.

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P13.0 | Rapatriement framework → `@nodefony/realtime` | cycle cassé, 10 src + 5 tests `git mv` |
| 🔶 P13.1 | TCP/UDP/Unix sockets | scaffold ; code protocoles reste (niche différable) |
| 🔶 P13.2 | `@nodefony/redis` refactor | fondation conventions faite ; **cloison des clés par application** `e43530ae`+`2820a219` (`keyNamespace` — sessions, jetons, WebAuthn, idempotence) ; 110 tests |
| ✅ P13.4 | `IRealtimeHub` + `RealtimeService` | façade + `defineRealtimeConfig` Zod |
| ✅ P13.5 | `RedisBackplane` | **prouvé cluster live -w2** ; registre drivers ; **bus authentifié (sceau HMAC) + banc multi-apps** |
| ⬜ P13.6a | `KafkaBackplane` (driver seul) | 4 briques réutilisées telles quelles ; seam transport injectable, 0 dep ajoutée |
| ⬜ P13.6b | Module `@nodefony/kafka` | connexions + config + santé ; **attend un 2ᵉ consommateur** (bus events métier / P12 agents) |
| ✅ P13.7 | Protocole JSON-RPC 2.0 + types partagés | RPC bidirectionnel ; long-polling droppé |
| 🔶 P13.8 | Décorateurs `@RealtimeAction`/`@RealtimeChannel` | 3 décorateurs livrés ; reste pattern RegExp |
| ✅ P13.9 | Tests cluster simulé (IPC) | e2e `child_process.fork`, 5 tests |
| ✅ P13.10 | Granularité + cadence AIMD | différenciateur, client-driven |
| ✅ P13.11 | Sonde « socket Nodefony » | `RealtimeHub.probe()` + endpoint health |
| ✅ P13.12 | Namespace `nodefony:` des canaux de plateforme | `e24692f7` — 9 namespaces → **1** ; table isomorphe `platformChannels.ts` + gate pre-commit anti-littéral |
| ✅ P13.13 | Révocation realtime par MODE d'authentification | `b20c9640` — le mode agent (JWT/clé) ne s'appuie plus sur une session ; scopes propagés à la socket (élévation de privilège fermée) |
| ✅ P13.14 | Harnais de test publié `@nodefony/realtime/testing` | `21f74bf0` — `createRealtimeHarness` : ~100 l. de plomberie framework (faux `ContextType`, pont `handleRealtime`, reset du hub, identité) sortent des apps ; `create controller --kind realtime` pose son test |

> **Dettes backplane multi-pod / multi-app** (détail : [`@nodefony/realtime` — configuration](../../src/packages/@nodefony/realtime/docs/configuration.md)) :
>
> - ✅ **#1 + #2 RÉSOLUES (`c082560`, 2026-06-12)** : `resolveBackplaneOriginId()` = `(NF_POD_NAME ?? hostname):pid` (anti-écho fiable cross-pod k8s) + champ `backplane.namespace` (Zod) → canal `nodefony:realtime:<ns>` dérivé de `kernel.projectName` (fin du cross-talk multi-app Redis mutualisé). +9 tests.
> - ⬜ **#3 (moyenne)** Frontière inter-module des canaux — le mécanisme livré n'est PAS celui du design de 2026-06-05 : realtime **déclare** (`RealtimeHub.registerChannelPolicy()`) et security **décide** (`buildFrameAuthorizer()`) ; il n'a jamais existé de garde `#channelAllowed`. La dette restante : le registre est global et indexé par NOM, donc un module peut redéclarer le canal d'un autre avec une politique plus faible. Détail : `realtime-module-isolation-2026-06-05` (mémoire IA `core-dev/audits/`).
> - ⬜ **Banc de conformité ventilation** (prouve le drop-in `IBackplane`) : scénarios paramétrés par driver (loopback/IPC/redis/kafka), comportement identique. Matrice : audit isolation § Banc de conformité.

> **P13.6 — cadrage Kafka** (design complet : mémoire IA `project_kafka_backplane_kit`) : le coût n'est PAS
> le driver. Quatre briques se réutilisent telles quelles — admission par canal (elle vit dans le **hub**,
> aucun driver ne s'y soustrait), sceau HMAC (`envelope.ts`, déjà mutualisé pour les transports partagés),
> `originId` anti-écho, file d'envoi bornée (`publishQueue.ts`). Ce qui change est la **sémantique** : Kafka
> est un journal persistant partitionné, pas un pub/sub éphémère → **un groupe de consommation par pod**
> (sinon les partitions se répartissent et un message broadcast n'atteint qu'UN pod — fan-out cassé en
> silence) et lecture depuis `latest` (jamais `earliest` : le port est at-most-once, le client
> re-synchronise). Le vrai coût est **P13.6b** : Redis a un module qui porte connexions/config/santé,
> Kafka n'en a aucun. D'où la séparation — 6a livre le driver avec un seam injectable (l'app câble son
> client, 0 dépendance ajoutée à realtime, testable sans infra) ; 6b ne se déclenche qu'avec un **2ᵉ**
> consommateur. Choix de bibliothèque volontairement **reporté** au banc de 6a (le seam le rend
> indolore). ⚠️ Tant que 6a n'est pas livré, le littéral `"kafka"` reste **interdit** dans le registre de
> drivers (`backplaneRegistry.test.ts` le garde) : pas de nom mort.

### P14 — Frontend Vite + Core isomorphe (81 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P14.1 | Interfaces + décision Vite | — |
| ✅ P14.2 | Preset `vue3-vite` | + module test-frontend-vue |
| ✅ P14.3 | Preset `react19-vite` | + Fast Refresh |
| ✅ P14.4 | `ViteProcessSupervisor` | child process isolé, résilience ; **repli de port réparé (`6ca77b2f`)** : le retry sur `port+1` existait mais l'échéance de démarrage le contournait (un vite qui annonce « Port 5173 is already in use » puis reste pendu sortait en `timeout after …`, libellé que le détecteur ne reconnaît pas) → `startupTimeoutMessage` y reporte le constat, en fonction pure ; 1ᵉʳ test du conflit de port en vrai spawn (2 superviseurs, même port de base) |
| ✅ P14.5 | Build prod (manifest) + statique | page blanche prod/cluster résolue (`renderProdTags`) |
| ✅ P14.6 | Multi-module frontend | N bundles cohabitent |
| 🔶 P14.7 | CLI `frontend:create/build/dev` | commands existent (bug CLI) ; skill scaffold ✓ |
| ✅ P14.8 | Tests intégration | 14 unit + 3 real spawn |
| ✅ P14.9 | Presets **Angular**/Vue/**Svelte** | **Angular ✅** (instance isolée) · **Vue3 ✅** (P14.2) · **Svelte5 ✅** (`63c9b05f`) — preset enregistré `ViteBuilder.ts:28`, plugin + `resolve.dedupe` émis `ViteConfigGenerator.ts:132`/`:281`, type `IFrontPreset.ts:11`, test d'extensibilité `ViteConfigGenerator.test.ts:305`, scaffold CLI. **`solid` RETIRÉ de la surface** (décision user) : la valeur était annoncée par le type `FrontPresetType` sans qu'aucun preset ne soit enregistré. Le runtime, lui, ne se taisait PAS — `ViteBuilder.ts:59` et `ViteConfigGenerator.ts:144` lèvent tous deux `FrontendPresetUnknownError` — mais l'échec tombait au DÉMARRAGE là où le compilateur pouvait le refuser, et le `.d.ts` publié promettait un preset inexistant. Le retrait déplace le refus à la compilation. Ajouter Solid après la release reste local : l'extensibilité est prouvée par le test écrit pour svelte5 (`ViteConfigGenerator.test.ts:305`) |
| ✅ P14.10 | Migration Studio sur `@nodefony/frontend` | 1er consommateur prod |
| ✅ P14.11 | **Core isomorphe** | Container/Service/Event/Syslog/Pdu runnable browser — shim `node:events` complété (`rawListeners`/`prepend*`, hot path `emitAsync`) ; 0 `node:` runtime dans le bundle client |
| ⬜ P14.12 | Plugin Vite Nodefony (alias + env) | zéro config dev |
| ✅ P14.13 | Multi-instance Vite résilient | familles d'isolation (default/angular) |
| ⬜ P14.14 | API CSP origines dynamiques | remplace hack POC |
| ✅ P14.15 | DevSupervisor auto-restart | group-kill anti-orphelin, rebuild ciblé ; **introspection process MULTI-MODE** (`1bd57a7d`) : `nodefony status`/`stop` voient dev/prod/cluster (champ `mode`), gardes anti-collision fail-loud (dev refuse sur prod/cluster & inverse), `start.sh` délègue à `nodefony stop` ; **watch réparé (`de3dd07d`)** : le paquet SERVEUR `@nodefony/frontend` était ignoré (segment `frontend` = rôle ET nom de paquet) → aveugle, jamais de rebuild ; règle extraite en fonction pure `isIgnoredWatchPath` + 12 tests ; **scoping projet unifié (`9748a330`)** : `status` rendait les process d'un AUTRE projet comme les siens (« 4 process · 2/2 ports UP » sur une app arrêtée) et `stop` marquait `✗ encore occupé` des ports qui ne sont pas les siens — une seule partition, faite là où les syscalls ont lieu ; ports ATTRIBUÉS à leur projet, runtimes étrangers NOMMÉS ; cécité du rattachement CONSTATÉE (`lsof` absent → liste globale annoncée, jamais « aucune instance ») ; **projets NOMMÉS et CIBLABLES (`493de57a`, `26c3c2b5`, `f6ff1233`, `53628bc7`)** : `status` rend un bloc par projet (nom du `package.json`, process, ports SONDÉS — ceux d'un voisin aussi) + un résumé qui explique le cloisonnement, `stop <nom\|chemin>` arrête un autre projet sans `cd` et REFUSE (sortie `1`, rien de tué) une cible inconnue, homonyme ou combinée à `--all` ; `--all` sonde désormais les ports de TOUS les projets qu'il arrête (il en prouvait 2 sur 4) ; sous Windows le rattachement est impossible (`lsof` absent) → la cécité est ÉNONCÉE au lieu de nier le projet, et la grammaire de chemins est injectable (`path.win32`) pour l'éprouver depuis un poste UNIX |
| ⬜ P14.16 | Syslog isomorphe (logs front → back) | traçabilité front |
| ✅ P14.17 | **HMR joignable hors loopback** (dev déporté) | `devHost` = ÉCOUTE seule ; origine PUBLIQUE dissociée (`frontend.publicOrigin`, template `{port}` suivi par famille et par retry de port) + détection AUTO Codespaces/Gitpod (`remoteDev.ts`, pur+testé) + `server.allowedHosts` dérivé de `trustedHosts` http (1 liste) + `server.hmr` client (host/clientPort/protocol, 443/wss forwarder). `status().origin` = source unique des URLs (TemplateHelper, boot line, CSP, admin API, Studio Runtime). Résilience superviseur durcie : kill de l'orphelin au timeout de boot, drain des listeners au retry, budget restarts réarmé après stabilité prouvée, ping loopback (0.0.0.0 Windows), verdict npx win32, arrêt-pendant-boot nommé. Preuve : 403 témoin sans allowedHosts / 200 avec + origin au port réel (intégration spawn réel). En PLUS : preset `svelte5` (framework + scaffold complet). |
| ✅ P14.18 | **Origine des assets dérivée du `Host`** | En développement, chaque page annonce ses assets sur l'hôte par lequel le client est arrivé (NOM seul ; scheme et port restent ceux de Vite) : un poste et un navigateur en conteneur sont servis EN MÊME TEMPS par une seule instance, sans variable ni `/etc/hosts`. `originWithHostname` (pur) + `FrontendService.derivableHost` (3 gardes : origine non épinglée, `HttpKernel.isTrustedHostname` — règle UNIQUE résolue par nom —, barrière non déléguée). `NF_FRONTEND_PUBLIC_ORIGIN` SUPPRIMÉE (dépôt + 3 gabarits) : posée pour observer un écran puis oubliée, elle avait rendu Studio inaccessible depuis le poste. Preuve : HMR reçu des DEUX côtés simultanément (`connected`/`file-changed`/`js-update` sur `wss://127.0.0.1:5173` ET `wss://host.docker.internal:5173`), CSP couvrant les deux origines, 18 tests neufs dont 3 vus rouges au débranchement. |

### P15 — Mediasoup + SIP/Asterisk (0 %)

> ⚠️ `src/modules/mediasoup` = **banc test ORM** (schémas Drizzle), **PAS** l'implé P15. Le pont télécom vocal n'est pas commencé.

P15.1 `MediasoupService`/`RoomManager` · P15.2 mapping Routers↔Rooms · P15.3 `SignalController` · P15.4 `PlainTransport` Asterisk ·
P15.5 ARI/AMI · P15.6 pipeline agent IA vocal (STT→LLM→TTS) · P15.7 cluster `PipeTransports` · P15.8 tests E2E. **Après P12+P13.**

### P16 — Cloud-Native (45 %) — décomposition VÉRIFIÉE au code (audit 08-20)

> Comptage par SOUS-ITEM (plan `project_cloud_native_plan` + axes H/I/J ajoutés depuis) : chaque
> ✅/⬜ ci-dessous a été confronté au code le 08-20 — **15✅ 18⬜ = 33 sous-items, 45 %**.
> L'axe 16.A affiché « ✅ » jusqu'ici ne l'était que pour A.1 : A.2/A.3/A.4 n'existent pas (0 occurrence).

<!-- prettier-ignore -->
| Axe | Sous-items (vérifiés 08-20) |
| --- | --- |
| 16.A Kernel/Lifecycle | ✅ A.1 graceful drain COMPLET (`b94af814`→`d494730d` : http-terminator ×3, `shutdownTimeout`, WS 1001 avant drain, deadline `shutdownDeadline`, preuve `docker stop` → 200 + exit 0) · ⬜ A.2 événements `onPreShutdown`/`onDrain` (0 occurrence) · ⬜ A.3 bootstrap secrets avant DI (dépend 16.C) · ⬜ A.4 warning PID 1 sans tini (0 occurrence) |
| 16.B HTTP | ✅ B.1 `/livez`+`/readyz` natifs (court-circuit `http-kernel.ts:973`, readiness 503 au SIGTERM) · ✅ B.2 `Forwarded` RFC 7239 + XFF anti-spoof (chantier clos 06-07, banc Docker E2E) · ✅ B.3 `trustProxy` gate (`config.ts:980`) |
| 16.C Secrets | ⬜ C.1 `ISecretProvider` · ⬜ C.2 `SecretManager` · ⬜ C.3 hook boot · ⬜ C.4 migration des secrets — 0 occurrence des symboles (vérifié 08-20) ; dépend P6, design au kit |
| 16.D Docker | ⬜ D.1 `Dockerfile.dev` · ✅ D.2 Dockerfile PROD multi-stage (gabarit `create app` : HEALTHCHECK `/readyz`, USER node, node PID 1 — prouvé sur app générée depuis le tarball) · ✅ D.3 compose (`docker/docker-compose.yml`) · ✅ D.4 profils (postgres/mongo/redis/kafka/tools/loki/opensearch/proxy/browser) · ✅ D.5 réseau bridge + alias DNS |
| 16.E Skills/Tooling | ⬜ E.1 `docker-debug` · ⬜ E.2 `infra-up` · ⬜ E.3 détection conteneur dans start-server — absents de `.claude/skills/` |
| 16.F Cleanup PM2 | ✅ F.1 code retiré (0 occurrence `pm2Service`/`Pm2Command`/`NF_MODE_START==="PM2"`) · ✅ F.2 dep npm retirée · ⬜ F.3 doc migration PM2→systemd/docker |
| 16.G Docs DevOps | ⬜ G.1 env-vars · ⬜ G.2 health-endpoints · ⬜ G.3 quickstart-docker · ⬜ G.4 quickstart-k8s — seul `docs/guides/docker-cloud-native.md` existe (partiel) |
| 16.H Scaling multi-process | ✅ H.1 topologie `workers` · ✅ H.2 `cluster -w N` (`ClusterManager`, cgroup-aware) · ✅ H.3 sonde/worker · ✅ H.4 Studio cluster · ⬜ H.6 banc backplane cross-pod k8s (l'anti-écho `resolveBackplaneOriginId` = `(NF_POD_NAME ?? hostname):pid` EST livré, `originId.ts:24`) |
| 16.I Liveness/Readiness | ✅ route PUBLIQUE graduée `/nodefony/kernel/api/livez` (`95bb221f`, zone `nodefony-liveness`, pattern Actuator) |
| 16.J Métriques | ⬜ `/metrics` Prometheus (0 occurrence — repoussé, décidé 06-15 ; données déjà dispo `dashboard:stats`) |

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

---

## Dettes retirées du tableau le 2026-08-27 — et pourquoi

Douze lignes ont quitté le tableau des dettes de `MIGRATION_STATUS.md`. Aucune n'a été retirée sur
une impression : chacune a été confrontée **au code ET au git**.

- **Neuf lignes déjà barrées** — soldées de longue date, chacune citant son commit ; les hashes
  cités ont été vérifiés existants.
- **`@services` avalait tout échec** — corrigée : le `catch` du décorateur appelle
  `handleServiceBootError` (`src/nodefony/src/kernel/Module.ts:417`), qui applique la politique de
  criticité `serviceBootErrorFatal`. Commit `4e08619e`, « la prod démarrait amputée en se déclarant
  saine ».
- **Deux bancs jamais exécutés dans `src/modules/test`** — corrigée : le script `test` est
  `vitest run --passWithNoTests` et le motif `nodefony/**/*.test.ts` couvre les deux fichiers.
  Commit `3b942771`.
- **`NF__HTTP__TRUSTPROXY=1` faisait échouer le boot** — corrigée, commit `902791fe`, ligne déjà
  marquée soldée dans le tableau.

**Une ligne a été retirée pour une autre raison** : « `bun:test` inertes » (`agent`, `memory`,
`rag`, `vector`). Ces modules n'ont effectivement aucun script `test` — mais ce n'est **pas une
dette** : ce sont des modules de la phase 12, différée par décision et non câblée. Le `CLAUDE.md`
le dit déjà. Une phase future n'est pas du retard.

**Un faux verdict a été rattrapé au passage** : une première confrontation avait classé cette même
ligne « corrigée » en se fondant sur `llm` — le seul module IA effectivement migré vers vitest, ce
que la ligne indiquait elle-même entre parenthèses. Ni le code ni le git ne montraient de script
`test` pour les quatre autres.

### La ligne « phase future », retirée pour n'être pas une dette

```markdown
| **`bun:test` inertes** — `agent`/`memory`/`rag`/`vector` : aucun script `test`, donc jamais exécutés (llm migré vitest `130f7386`) | 🟡 | à migrer au câblage de P12, pas avant |
```

### Le texte intégral des douze lignes

```markdown
| ~~**`transaction()` ne marche QU'EN SQLITE**~~ — **RÉSOLU `3dabb5ae`** : transaction portée aux 3 dialectes via `ITxDriver` (connexion DÉDIÉE empruntée au pool en pg/mysql — un `BEGIN` sur le pool n'est pas atomique) ; 2ᵉ bug de dialecte trouvé au passage (`SAVEPOINT "x"` = chaîne en mysql → `quoteIdent` par dialecte). **Le test manquant ÉTAIT la dette** → 5 cas transaction au banc de contrat (19/19 × sqlite/PG 17/MariaDB 11.4/MySQL 8.4 réels ; preuve négative faite) | ✅ | `3dabb5ae` · banc `repository-contract.ts` · les tx sont désormais dans le contrat 3 dialectes |
| ~~**Le scope `singleton` du DI n'est pas un singleton**~~ — **SOLDÉ**. Le diagnostic était FAUX (« il manque une mémoïsation ») : la racine = **deux annuaires, un seul nom** — `@injectable(nom)` indexe des CLASSES, `super(nom, …)` indexe des INSTANCES, et rien ne les reliait (le décorateur tourne au CHARGEMENT de la classe, `super()` à la CONSTRUCTION → il ne PEUT pas connaître la clé). Corrigé, dans l'ordre où l'attaque les a trouvés : (1) propagation d'`argsClass` parent→dépendance SUPPRIMÉE — elle interdisait toute mémoïsation ET donnait à `Fetch(module: Module)` un `HttpContext` (ne tenait que par duck-typing sur `.container`) ; (2) `singleton` MÉMOÏSE, sous la clé CANONIQUE (`instance.name`) — mémoïser sous le nom demandé aurait créé le doublon qu'on tuait ; (3) `Fetch` POSÉ au container — 1 instance/kernel au lieu d'**une par requête** (mesuré : 10 req = 10 instances) ; (4) registre en `Object.create(null)` → 6 vecteurs de pollution de prototype fermés ; (5) **TOKEN = la CLASSE** : la clé container est APPRISE au moment où le service est posé (`addService`), le nom écrit dans `@inject` ne sert plus qu'à retrouver la classe — c'est ELLE qui dit où l'instance vit. **1 seul des 7 `@injectable` round-trippait → 7/7** (vérifié en runtime : `allRoundTrip: true`). API publique inchangée (0 breaking) | ✅ | `injector.attack.test.ts` (13 vecteurs, 0 `it.fails` restant) + intégration `di-singleton.test.ts` (sonde `/nodefony/test/di/tokens` sur serveur réel) · preuves NÉGATIVES faites (relais débranché → C3/H1/H3 rouges) |
| ~~**DI ordre-dépendant**~~ — **SOLDÉ**. Les 6 `@inject("HttpKernel")` ne résolvaient que parce que `HttpKernel` était **1ᵉʳ** dans `@services([...])` (instanciation séquentielle). Le descendre de 3 lignes → serveur « UP », **499 sur chaque requête**, aucune dégradation annoncée. **L'ordre se CALCULE désormais** (`serviceOrder.ts`, tri topologique STABLE des dépendances déclarées `@inject` + `design:paramtypes`) → l'ordre écrit n'a plus d'effet, comme chez Symfony (container compilé) / NestJS (graphe). Cycle → erreur explicite qui nomme le cycle. **Preuve en conditions réelles** : ordre volontairement inversé → `HEALTH 200`, **579/579 intégration**, `httpKernelShared: true`, 0 erreur (avant : TIMEOUT + 499). Preuve NÉGATIVE faite (tri débranché → G1/G2/G3 rouges) | ✅ | `serviceOrder.test.ts` (11) + `services.attack.test.ts` G1/G2/G3 + intégration `di-singleton.test.ts` (3, serveur réel via sonde `/nodefony/test/di/probe`) |
| **`@services` avalait TOUT échec** — le `catch` du décorateur se contentait de `log(e, "ERROR")` : l'échec n'atteignait NI la politique de criticité (`isBootErrorFatal` → donc **jamais fatal, même en PRODUCTION** : un service critique impossible à construire laissait le pod démarrer amputé et se déclarer sain) NI le BootReport (donc pas de « boot DÉGRADÉ » — un boot cassé s'affichait « UP »). C'était le chemin de **tous** les modules (30 services). **RÉSOLU** : `Module.handleServiceBootError` → `Kernel.serviceBootErrorFatal` → la MÊME politique que `guardServiceInitialize`. Asymétrie corrigée : on gardait l'`init` d'un service et pas sa **construction** | ✅ | `services.attack.test.ts` (rouge → vert) · vérifié en runtime : « BOOT dégradé — 14 module(s) chargé(s), 1 en échec » |
| ~~**`CliIntegration` flake sous charge**~~ — **RÉSOLU** (constaté audit 08-20) : la readiness n'est plus 45 s en dur — budget par env `NF_CLI_READY_TIMEOUT_MS`, défaut 80 s (`CliIntegration.test.ts:54`) = le fix que la dette réclamait | ✅ | `CliIntegration.test.ts:54` |
| ~~**9 « check-then-act » dans les stores de SÉCURITÉ**~~ — **RÉSOLU `025b8b06` + `6dc17bd3` + `0cacbe7d` + `a017cb2d`** : la classe entière, sur les **DEUX** adapters (le diagnostic ne voyait que drizzle — `MongooseTokenStore` portait les mêmes, `put`/`denyJti` compris). Corrigés : faux upserts → `repo.upsert()` (`denyJti`, `TotpSecret.save`, `WebAuthnCredential.save`, `Webhook.save`) · `revoke`/`revokeFamily`/`gc` → la condition passe au `WHERE` via `$null` (`revokeFamily` : N+1 requêtes → 1 ; `gc` : la dette `listAll()` disparaît) · `revokeAllForSubject` → `$max` (le seuil ne recule plus). **1 faux positif** : `DrizzleTokenStore.put` — race inatteignable (les 3 appelants posent un id `randomUUID`/`#randomId`), fix gardé pour le round-trip et l'uniformité. Chaque race PROUVÉE avant fix (test rouge, puis vert). `grep` de contrôle : plus aucun `findOne`→`create`/`update` conditionnel dans les stores | ✅ | 4 commits · banc de PARITÉ 3 dialectes + Mongo réel · ⚠️ limite gravée sur `DrizzleTokenStore.put` : `access_token` a DEUX uniques (`id` PK + `secretHash`) et un `ON CONFLICT` n'arbitre qu'UN index |
| ~~**`IRepository` ne sait pas exprimer `IS NULL` ni un upsert CONDITIONNEL**~~ — **RÉSOLU `6dc17bd3` + `a017cb2d`** : deux familles d'opérateurs, chacune avec son détecteur + tests. **Lecture** — `$null` (10ᵉ de `FieldOperators`) ; la **valeur nue** `{ champ: null }` signifie désormais `IS NULL` au lieu de matcher 0 ligne en silence (`eq(col, NULL)` toujours faux en SQL = LA cause racine), ouverte seulement sur un champ typé nullable. **Écriture** — `UpdateOperators` `$max`/`$min` dans le `update` d'`upsert` (`UpdateData<T>`). ⚠️ **La clause `where` prévue par le kit a été ÉCARTÉE** : MySQL n'a ni `RETURNING` ni `WHERE` sur son `ON DUPLICATE KEY UPDATE` → 2-3 requêtes, donc une course. La condition vit dans la VALEUR (`GREATEST`/`MAX`/`$max` natif Mongo) = 1 instruction atomique sur les 4 backends, vérifiée en SQL pur avant de coder | ✅ | `orm-core/interfaces/IRepository.ts` · banc de contrat 3 dialectes (`$null` + `$max`/`$min` + concurrence ×10 en ordre dispersé) · parité Mongo |
| ~~**Les stores de sécurité n'ont d'e2e QUE sur PostgreSQL**~~ — **RÉSOLU** : les **5** stores (`token`/`totp`/`webauthn`/`webhook`/`session`) ont un **banc de parité partagé** joué sur les **3 dialectes** (pattern `repository-contract` : 1 banc + 3 consommateurs minces) au lieu de 2 implémentations sqlite/pg divergentes. 85 cas × 3 (concurrence pool chaud, bornes exactes `$lt`/`$lte`, round-trip unicode/JSON, no-op sur clé inconnue, isolation par porteur, `createdAt` insert-only, redaction `listAll`). Les 5 anciens fichiers doublons supprimés (4 sqlite + `session-postgres.e2e`), chaque cas reporté ; `session-storage.test.ts` réduit à ce qui lui est PROPRE (registre IoC + compteur de requêtes — « write = 1 UPSERT, 0 SELECT » n'est pas portable : mysql en coûte 2). **Le banc a immédiatement sorti 2 bugs** invisibles à la couverture PG-seule (2 lignes ci-dessous). **548/548, 0 skip** sur PG 16 + MariaDB 11.4 ET PG 16 + MySQL 8.4 | ✅ | `tests/integration/{token,totp,webauthn,webhook,session}-store-contract.ts` + `*-{sqlite,postgres,mysql}*` |
| ~~**Boot resilience Ph.3** — `emitAsync` = `for await` nu~~ — **RÉSOLU** (constaté audit 08-20) : tout le cycle (`onPreRegister`→`onPostReady`) passe par `fireLifecycle` → `emitAsyncGuarded` — isolation par listener + `timeoutMs`/`warnMs` + politique `isBootErrorFatal` par module | ✅ | `Kernel.ts:896-1058` (appels) · `Kernel.ts:2891` · `Event.ts:266` |
| **Deux bancs jamais exécutés dans `src/modules/test`** — son script `test` est `node -e "console.log('test')"`, un no-op : `dolibarr.complex-query.test.ts` et `dolibarr.load.test.ts` ne tournent NULLE PART (ni en local, ni en intégration continue). Trouvés en cherchant, après le cas `jwt.attack`, ce que l'inventaire des tests rate encore. Trancher : les câbler à vitest, ou les retirer s'ils sont périmés — mais pas les laisser dans cet état, qui donne l'apparence d'une couverture | 🟠 | trancher : câbler ou retirer |
| ~~**Mode strict des gates de test en CI**~~ — **RÉSOLU** (constaté audit 08-20) : la CI EXISTE (7 workflows) et `vitest.gates.ts` fait ÉCHOUER la passe quand `CI` est posé et qu'une cible déclarée n'a pas tourné ; une absence voulue s'énonce (`NF_GATES_ALLOW`) | ✅ | `vitest.gates.ts:83` · `.github/workflows/` (7) |
| ✅ **`NF__HTTP__TRUSTPROXY=1` fait ÉCHOUER le boot** — SOLDÉ : la valeur REMPLACÉE guide la conversion (`coerceEnvValueLike`, appelée par `applyResolvedPath` — seul endroit qui connaît la chaîne brute ET le type attendu). `1/0/on/off/yes/no` sur une clé booléenne, chaîne brute sur une clé chaîne ; **une CIDR n'est JAMAIS promue en `true`** (elle vaudrait confiance totale aux `X-Forwarded-*` — test de sécurité dédié). Cibles nombre/tableau inchangées (le CSV → tableau documenté survit) | ✅ | `902791fe` |
```

---

## Le chapitre « dette `NF_` » retiré le 2026-08-27

Soldé : les 122 variables lues portent le préfixe, sauf 17 délibérées. Commit du renommage :
`d517db28`, `refactor(env)!: renommage des variables NODEFONY_* vers NF_*`. Vérifié le même jour :
plus aucune variable d'environnement `NODEFONY_*` dans les sources — les occurrences restantes sont
`NODEFONY_CONSOLE` (une valeur de type) et `ROLE_NODEFONY_ADMIN` (un nom de rôle). La **règle**,
elle, reste vivante dans `CLAUDE.md`.

### Le texte intégral du chapitre

```markdown
### 🟠 Dette AVANT RELEASE — préfixe `NF_` sur toutes les variables d'environnement

Le framework lit **122** noms de variables. **Cette dette est SOLDÉE** : les deux familles qui
restaient — génériques revendiqués par d'autres outils, interrupteurs de coût des bancs — portent
désormais `NF_`. Les **17** noms encore sans préfixe sont tous **délibérés** : on ne les possède pas,
ou les lire EST le contrat.

**Pourquoi AVANT la release, et non après** — la justification initiale (« renommer est une rupture
pour toute application déjà déployée ») supposait des applications déployées. La 10.0.0 est la
première release : il n'y en a aucune. Faire le renommage APRÈS obligerait à écrire un repli
transitoire (lire l'ancien nom, avertir, documenter le nouveau) qu'il faudrait ensuite supprimer —
deux chantiers au lieu d'un, et un intervalle où deux noms vivent en parallèle, exactement le motif
« 1 RÈGLE = 1 implémentation » qu'on s'interdit ailleurs. Avant la release, la rupture coûte zéro.

<!-- prettier-ignore -->
| Famille | Nb | Traitement |
| --- | --- | --- |
| ~~`NODEFONY_*`~~ | ~~18~~ **0** | ✅ **SOLDÉ** — renommées en `NF_*` (8 publiques, 10 internes), rupture nette sans alias |
| ~~Génériques revendiqués par d'autres outils~~ : `NF_REDIS_HOST/PORT/PASSWORD/TEST_URL`, `NF_MONGO_TEST_URI`, `NF_MONGODB_DEBUG`, `NF_BCRYPT_COST/N`, `NF_POD_NAME`, `NF_MODE_START`, `NF_NO_TTY` | ~~12~~ **0** | ✅ **SOLDÉ** — renommées, sans alias. `REDIS_URL` a été SORTI du lot : `resolveInfra` l'accepte volontairement comme alias plateforme (Heroku/Render/Upstash le posent), `NF_REDIS_URL` restant prioritaire |
| ~~Interrupteurs de coût des bancs~~ : `NF_RUN_PERF`, `NF_RUN_CLI_BOOT`, `NF_RUN_CLUSTER_E2E`, `NF_RUN_WS_RUPTURE`, `NF_WS_RUPTURE_CAP/STEP` | ~~6~~ **0** | ✅ **SOLDÉ** — preuve NÉGATIVE exécutée : `RUN_PERF=1` laisse 4 tests sautés (mort), `NF_RUN_PERF=1` rend 89/89 (vivant) |
| Conventions d'écosystème qu'on LIT sans les posséder : `APP_ENV` (12-factor/Symfony), `DATABASE_URL`, `MONGODB_URI`, `REDIS_URL` (PaaS) | 4 | **ne pas renommer** — les lire est le contrat ; la forme `NF_` reste PRIORITAIRE (`resolveInfra`, `APP_ENV \|\| NF_ENV`) |
| Standards tiers : `NODE_ENV`, `NODE_DEBUG`, `NODE_NO_WARNINGS`, `UV_THREADPOOL_SIZE`, `BABEL_ENV`, `SHELL`, `PORT` | 7 | **ne pas toucher** — on ne les possède pas |
| Posées par l'orchestrateur : `KUBERNETES_SERVICE_HOST`, `KUBERNETES_SERVICE_PORT` (détection « je tourne dans un pod ») | 2 | **ne pas toucher** — c'est Kubernetes qui les écrit, les renommer les rendrait introuvables |
| Fixtures de test (`LOADENV_A…D`, noms fictifs d'un test de `loadEnv`) | 4 | hors périmètre — ne sont pas des variables du produit |

**La règle vaut pour tout ce qui est ÉCRIT** : cf `CLAUDE.md`, section des invariants — aucune
variable neuve sans `NF_`, y compris pour les tests, les bancs et les interrupteurs de coût.

**Deux limites de périmètre, assumées.** (1) `docker/docker-compose.yml` garde `REDIS_PASSWORD` /
`REDIS_PORT` : ce sont des **substitutions Compose**, voisines de `POSTGRES_PASSWORD` et
`MARIADB_*` que les images officielles lisent elles-mêmes et qui, elles, ne peuvent pas changer.
`vitest.gates.ts` fait le pont — il LIT ces clés du compose et POSE des `NF_*`. (2) Les paramètres
des scripts de bancs (`.claude/skills/**`, ~60 noms : `CONC`, `RATE`, `WS_URL`…) ne sont pas
publiés et n'entrent en collision chez personne.
```
