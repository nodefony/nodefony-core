---
title: Audit P6 Security — état des lieux + état de l'art + plan
date: 2026-06-12
status: draft — section 3 (état de l'art) en cours de complétion
audience: dev + IA
---

# Audit P6 Security (effort max) — 2026-06-12

> Préparation du chantier P6 sur la branche `refactor/p6-security` (fenêtre de travail → 22 juin).
> Méthode : vérité terrain (code) → divergences décisions↔code → état de l'art RFC/normes 2026 →
> vision future (agents IA) → plan séquencé. Règle : **aucun droit à l'erreur** — chaque jalon
> porte ses gates (build, tests, memory.test, security-review).

## 1. Résumé exécutif

P6 n'est **pas** un départ à zéro : la fondation S1 est livrée et **déjà câblée** dans le pipeline
HTTP (contrairement à ce que disait le kit, en retard de 3 jours sur le code). Les seams realtime
(P13) sont livrés. Le module `@nodefony/user` est complet côté contrats/encoders/CRUD.

Ce qui manque pour un P6 utilisable : **les authenticators** (aucun n'existe), l'implémentation
d'`IUserProvider`, l'autorisation (niveaux B/C + décorateurs), CSRF/CORS/headers effectifs,
et le réalignement de la config sur la décision **hybride session BFF** (le code dit encore
« stateless défaut 2026 »).

## 2. Vérité terrain (code vérifié le 2026-06-12)

### 2.1 Ce qui EXISTE et fonctionne

| Brique                   | Où                                                         | État                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrats security        | `security/nodefony/contracts/`                             | ✅ `IToken`, `IAuthenticator`, `ISecuredArea`, `IFirewall`, `IAccessVoter`(+`VoterVote`)                                                                                                                                                                                                                                                                                               |
| Erreurs typées           | `security/nodefony/errors/`                                | ✅ `AuthenticationError`(401), `AccessDeniedError`(403)                                                                                                                                                                                                                                                                                                                                |
| Firewall skeleton        | `security/nodefony/service/firewall.ts` (176 L)            | ✅ `isSecure()` hot-path court-circuit, `handleSecurity()` → chaîne authenticators → ALS → Zero Trust 401, `registerAuthenticator()`, lazy partout                                                                                                                                                                                                                                     |
| Config Zod               | `security/nodefony/config/defineSecurityConfig.ts` (365 L) | ✅ 12 sections (`encoders/roleHierarchy/areas/cors/csrf/headers/rateLimit/jwt/apiKeys/webhooks/audit/studio`), `.describe()` partout, `securityConfigJsonSchema()` pour Studio, détection conflits de patterns au boot                                                                                                                                                                 |
| RoleHierarchy (niveau A) | `security/nodefony/src/RoleHierarchyWalker.ts`             | ✅ précompute DFS au boot + détection cycles                                                                                                                                                                                                                                                                                                                                           |
| SecuredArea              | `security/nodefony/src/SecuredArea.ts`                     | ✅ match pattern + host/vhost                                                                                                                                                                                                                                                                                                                                                          |
| AnonymousToken           | `security/nodefony/src/token/AnonymousToken.ts`            | ✅                                                                                                                                                                                                                                                                                                                                                                                     |
| **Câblage http-kernel**  | `http/nodefony/service/http-kernel.ts`                     | ✅ **DÉJÀ FAIT** (le kit P6 disait l'inverse) : hooks `beforeResolve`/`afterAuth`/`onAuthFailure` (P1.7, guard 0-listener = 0 microtask sans security) + `firewall.handleSecurity()` sous `phaseStart("firewall")` + seams CSRF commentés (2 points)                                                                                                                                   |
| Module user              | `@nodefony/user`                                           | ✅ `IUser` (3 couches), `IPasswordAuthenticatedUser` (split credential), `IUserProvider` (contrat : `loadUserByIdentifier`/`loadUserByOAuth`/`refreshUser`, Shadow User), `IUserRepository`, `BaseUser`, `AnonymousUser` singleton gelé, `BcryptEncoder` (@node-rs/bcrypt), `UserService extends AbstractCrudService` avec `authenticate()` (leurre anti-timing + re-hash transparent) |
| Adapters user            | drizzle + mongoose                                         | ✅ `userTable`+`DrizzleUserRepository`, `userEntity`+`MongooseUserRepository` (8+8 tests)                                                                                                                                                                                                                                                                                              |
| Session (P5.11)          | `@nodefony/http` session                                   | ✅ refonte livrée : ID CSPRNG opaque, cookie-only `__Host-`/SameSite, dirty-tracking, `@UseSession` opt-in lazy, `ISessionStorage` unifié, stores File/Redis/Drizzle/Mongoose, `absolute_timeout` OWASP                                                                                                                                                                                |
| Seams realtime (P13)     | `@nodefony/realtime`                                       | ✅ `IRealtimeAuthenticator` (handshake async cold-path, token caché sur peer, hot-path O(1)), `IRealtimeToken`, `IRealtimeAuthenticatorMatcher`, `IRealtimeHandshake`, `AnonymousRealtimeToken`, hooks `beforeDispatch`/`onFrameAudit`, close 4001 RFC 6455 §7.4.2                                                                                                                     |
| Data plane admin duplex  | POC souverain Ph.3 (mergé `65a34b9`)                       | ✅ pont `api.request` opt-in — **surface à sécuriser par P6**                                                                                                                                                                                                                                                                                                                          |

### 2.2 Divergences décisions ↔ code (à corriger en S0)

1. **`stateless: default(true)` + « défaut 2026 »** dans `defineSecurityConfig.ts` (`areaSchema`,
   `jwtSchema`) et `config.ts` — CONTREDIT la décision hybride 2026-06-06 (session serveur cookie
   opaque BFF par défaut web ; JWT réservé API/agents). À inverser : `stateless: default(false)`,
   TSDoc réécrite.
2. **`encoders.type: z.enum(["bcrypt"])`** — trop fermé. Ouvrir **Argon2id (RFC 9106)** comme défaut
   recommandé, bcrypt conservé.
3. **Attribution Symfony** dans les TSDoc (`firewall.ts` ok, mais `IRealtimeAuthenticator.ts` cite
   encore « Symfony 6 ») — purger l'attribution, garder les invariants.
4. **`IUserProvider` implémenté nulle part** — `UserService` ne l'implémente pas (vérifié : aucun
   `loadUserByIdentifier` dans le service). C'est LE pont user→security à poser avant les
   authenticators.
5. **Pas de section `passkeys`/`webauthn` ni `tokenExchange`** dans la config Zod — les auth
   modernes (revue 2026-06-08) n'ont pas leur slot.
6. **`csrf.ts`** = placeholder (type conservé pour http) — la défense réelle (SameSite + Origin +
   `@CsrfProtect` opt-in) reste à écrire (les 2 seams sont posés dans http-kernel).

### 2.3 Ce qui MANQUE (le travail P6 réel)

- **Authenticators** : aucun n'existe (Anonymous, UserPassword, Jwt, OAuth2/arctic, MTls, ApiKey,
  - realtime : AnonymousRealtime, JwtRealtime).
- **Autorisation** : niveau A seul (walker). Niveau B (RBAC ORM `IRole`/`IPermission`) et
  niveau C (voters + registre DI) à faire. `AuthorizationService.decide()` à écrire.
- **Décorateurs** : panoplie entière à écrire (`@IsGranted`, `@Anonymous`, `@CurrentUser`,
  `@CsrfProtect`, `@RateLimit`…) — mécanisme figé : `Reflect.metadata` + hook `beforeResolve`,
  401/403 court-circuite AVANT `newController()`.
- **CORS effectif** (service à brancher preflight 204), **headers natifs** (HSTS/CSP nonces/…),
  **rate-limit/lockout** login.
- **P6.12-15** : API Keys (PAT hashées), webhooks signés (HMAC + anti-SSRF + anti-replay),
  audit events (append-only + stream WS), section Studio Sécurité.
- **Dette realtime #3** : garde `#channelAllowed` (frontière inter-module des canaux) — design
  figé (`docs/audits/realtime-module-isolation-2026-06-05.md`), posture WARN → fail-closed avec P6.
- **Tests** : 0 test sur le module security (P6.11). Tests user OK (32+8+8).

### 2.4 Slots anti-refonte déjà réservés (forward-audit 2026-05-23 — kit §slots)

Multi-tenant (`organizationId?` nullable), JWT `kid`+JWKS dès le 1ᵉʳ code, révocation (`jti`+TTL
court+denylist optionnelle), webhook SSRF/replay/rotation, secret-at-rest (hash vs chiffré
réversible), audit immuable + `ROLE_SECURITY_AUDITOR`, data plane Zero-Trust (`@IsGranted` dès le
1ᵉʳ endpoint + mutations auto-auditées), rate-limit headers, step-up MFA, ingestion logs front.

## 3. État de l'art 2026 (RFC + normes) — synthèse veille

> ⚠️ **Veille réalisée hors-ligne** (accès réseau refusé à l'agent) = état des connaissances au
> **cutoff 2026-01**. Les RFC **publiées** ci-dessous sont stables ; les **drafts** sont à
> re-vérifier (n° de rev) avant de citer dans la doc publique.

### 3.1 Textes publiés (socle normatif fiable)

| Texte                               | Statut                             | Ce qu'on en retient pour P6                                                                                                                                                                                                                                      |
| ----------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC 9700** OAuth 2.0 Security BCP | ✅ BCP 240, janv. 2025             | PKCE partout ; implicit + ROPC bannis ; tokens **sender-constrained** recommandés (mTLS 8705 ou DPoP 9449) ; **audience-restricted** (RFC 8707 `resource`) ; jamais de token en URL ; `iss` anti-mix-up (RFC 9207)                                               |
| **NIST SP 800-63B-4**               | ✅ final ~août 2025                | Passwords : min 8 (15 reco), max ≥64, **zéro règle de composition**, **zéro rotation périodique**, blocklist compromis, paste autorisé ; **KBA interdit** ; throttling échecs obligatoire ; MFA **phishing-resistant** ; **passkeys synchronisées admises AAL2** |
| **RFC 8693** Token Exchange         | ✅ 2020                            | Délégation vs impersonation ; claim **`act`** chaîné auditable + `may_act` — base du on-behalf-of microservices **et agents IA**                                                                                                                                 |
| **RFC 9449** DPoP                   | ✅ 2023                            | Proof-of-possession applicatif (`cnf.jkt`, claim `ath`) — l'option sender-constrained par défaut hors infra mTLS (SPA, CLI, agents)                                                                                                                              |
| **RFC 9106** Argon2                 | ✅ 2021                            | **Argon2id** ; pratique OWASP : **m=19 MiB, t=2, p=1** minimum ; bcrypt = legacy (cost ≥10, limite 72 octets)                                                                                                                                                    |
| **WebAuthn Level 3**                | W3C CR (janv. 2025) → Rec en cours | **Related Origin Requests** (`/.well-known/webauthn`), conditional UI/create, flags BE/BS, Signal API ; **synced passkeys = défaut grand public**, device-bound = AAL3/régulé                                                                                    |

### 3.2 Drafts à suivre (ne pas figer d'API publique dessus)

- **draft-ietf-oauth-v2-1** (~draft-13) : consolidation 6749+6750+7636+8252+9700 — appliquer la
  posture sans attendre la RFC.
- **draft-ietf-oauth-browser-based-apps** (WGLC franchi) : hiérarchie normative **1) BFF**
  (tokens jamais dans le navigateur, cookie de session) — conforte la décision hybride Nodefony.
- **draft-ietf-httpbis-rfc6265bis** : normalise `__Host-`/`__Secure-` + SameSite (acquis
  navigateurs) ; CHIPS `Partitioned` à part.
- **draft-ietf-httpapi-ratelimit-headers** (~draft-09) : émettre `RateLimit-*` OK mais **derrière
  une abstraction** (noms de champs instables) ; seul `Retry-After` (RFC 9110) est stable.
- **draft-ietf-oauth-transaction-tokens** : JWT courts intra-chaîne microservices (contexte user
  préservé) — pertinent P12 agents.

### 3.3 CSRF 2026 — bascule de doctrine

OWASP (rev 2025) : framework d'abord ; défense en profondeur = **SameSite=Lax + Origin +
Fetch Metadata**. Précédent fort : **Go 1.25 `net/http.CrossOriginProtection`** (août 2025)
rejette les mutations cross-site via **`Sec-Fetch-Site`**/Origin **sans tokens** (supporté par
tous les navigateurs evergreen, Safari ≥16.4). → Nodefony adopte ce modèle par défaut,
synchronizer token (`@CsrfProtect`) en opt-in (vieux clients / cross-origin volontaire).

### 3.4 Les 10 défauts 2026 d'un framework moderne (cibles P6)

1. **BFF + cookie session opaque** (`__Host-`, Secure, HttpOnly, SameSite=Lax) = défaut web ;
   JWT réservé machine↔machine. _(= décision hybride déjà actée — le code doit suivre.)_
2. **Passkeys/WebAuthn first-class** — le password devient le fallback.
3. **Argon2id défaut** (19 MiB/2/1) + politique NIST (pas de composition, pas d'expiration).
4. **Posture OAuth 2.1 native** (PKCE, pas d'implicit/ROPC) + RFC 9700 comme contrat.
5. **CSRF par Fetch Metadata** (modèle Go 1.25), tokens en opt-in.
6. **Sessions** : ID ≥128 bits CSPRNG, régénération au login, timeouts idle+absolu — invariants
   non désactivables. _(P5.11 livré conforme.)_
7. **DPoP prêt à l'emploi** — abstraction « sender-constrained » (DPoP | mTLS).
8. **Throttling progressif** (pas de lockout dur = DoS) + `RateLimit-*` abstraits.
9. **MFA phishing-resistant par défaut** (TOTP = legacy, SMS/KBA interdits).
10. **Audience partout** : tokens émis audience-bound (RFC 8707), validation obligatoire.

## 4. Vision future — authentification des agents IA

### 4.1 Paysage 2026 (ce qui se fige)

- **MCP Authorization** (spec 2025-06/11) : OAuth 2.1, serveur MCP = resource server ; découverte
  RFC 9728 + 8414 ; **RFC 8707 obligatoire** (audience) ; **interdiction du token passthrough**.
- **Identity Assertion Authorization Grant** (adopté WG OAuth 2025) → Okta **Cross App Access** :
  SSO entreprise → ID-JAG → token exchange vers l'outil cible.
- **Microsoft Entra Agent ID** (2025→GA 2026) : l'agent = identité d'annuaire de première classe
  - conditional access. **Auth0 Auth for GenAI** : Token Vault, **CIBA human-in-the-loop**, FGA.
- **SPIFFE/SPIRE** = standard de facto identité workload (X.509/JWT SVID) ; agents long-vivants
  = workloads + délégation user par token exchange.

### 4.2 Patterns qui se figent (et que P6 doit RÉSERVER sans implémenter)

1. **Agent = principal de première classe** — identité PROPRE (jamais les credentials du user).
   → Slot Nodefony : `IUser` racine + discriminant `kind` (`"user" | "service" | "agent"`) +
   `onBehalfOf` (décision kit §REVUE — nom du concept à fixer avec le user, vocabulaire Nodefony).
2. **Délégation explicite RFC 8693** — chaîne `act` auditable, `onBehalfOf(user, agent, scopes)`.
   → P6 pose `IToken.getScopes()` (fait) + slot token exchange dans la config ; impl = P12.
3. **Scopes minimaux par outil, tokens courts audience-bound** — P6 : `aud` dans JwtAuthenticator
   dès le 1ᵉʳ jour.
4. **Approbation humaine asynchrone (CIBA-like)** pour actions sensibles d'agent — se marie
   nativement au duplex WS Nodefony (la demande d'approbation POUSSE sur la socket Studio).
   → Slot : event/canal réservé, impl P12.

### 4.3 Trajectoire passkeys

NIST admet les passkeys synchronisées à AAL2 ; Microsoft passwordless par défaut (mai 2025) ;

> 15 Md de comptes passkey-ready. La config S1 dit déjà `studio.requireMfa: true` (défaut) — **sans
> implémentation MFA phishing-resistant, ce défaut est un mensonge**. P6 doit livrer passkeys (ou
> dégrader le défaut explicitement). WebAuthn = la SEULE MFA phishing-resistant implémentable sans
> dépendance externe (TOTP = legacy non phishing-resistant).

## 5. Architecture cible P6 (révisée)

### 5.1 Principes (hérités S1 + veille)

- **Zero Trust** : zone protégée + anonyme → 401 ; tout data plane admin derrière `@IsGranted` ;
  deny-by-default voters ; mutations auto-auditées.
- **Hybride** : `SessionAuthenticator` (BFF cookie opaque) défaut web/Studio · `JwtAuthenticator`
  (EdDSA, kid+JWKS, aud, jti) réservé API/M2M/agents · WS stateful par handshake (token caché sur
  peer, hot-path O(1)).
- **1 garde = N transports** (dividende API souveraine) : la même action controller sert
  REST + socket (`api.request`) → la garde posée au niveau intention (décorateur/voter) couvre
  les deux SANS double implémentation. La sécu des DONNÉES (row-level/classification) reste au
  niveau service/repository (doc API §7.1) — postérieur à P6 (modèle à concevoir).
- **Perf** : règle absolue inchangée — lazy alloc, 0 listener sans cleanup, `memory.test` à
  chaque modif pipeline ; `isSecure` court-circuit 0 zone (fait) ; auth = cold path (login),
  vérification session = 1 lookup store/req max (L1 déjà en place P5.11).

### 5.2 Décisions à acter en S0 (divergences + 2 découvertes d'audit)

| #   | Sujet                                                                                                                   | Décision proposée                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `stateless: default(true)`                                                                                              | → `default(false)` + TSDoc « session BFF défaut, JWT = API »                                                                                                                         |
| 2   | `encoders.type: enum["bcrypt"]`                                                                                         | → `enum["argon2id","bcrypt"]`, défaut argon2id (19 MiB/2/1), `Argon2idEncoder` dans `@nodefony/user` (`@node-rs/argon2`, peerDep optionnelle externalisée — même pattern que bcrypt) |
| 3   | Attribution Symfony TSDoc                                                                                               | → purger (garder les invariants) — `IRealtimeAuthenticator.ts` notamment                                                                                                             |
| 4   | `IUserProvider` orphelin                                                                                                | → `UserService implements IUserProvider` (loadUserByIdentifier/loadUserByOAuth/refreshUser)                                                                                          |
| 5   | Slots config manquants                                                                                                  | → sections Zod `passkeys` (rpId, origins, attestation) + `tokenExchange` (enabled=false, P12) + `mfa` (stepUp)                                                                       |
| 6   | `csrf` schema                                                                                                           | → ajouter `fetchMetadata: default(true)` (Sec-Fetch-Site primaire), `checkOrigin` fallback                                                                                           |
| 7   | **Sémantique chaîne authenticators** (config dit « tous doivent passer », firewall fait « premier qui supporte gagne ») | → **`mode: "first" \| "all"`** par zone, défaut `"first"` (le cas « mtls+jwt » = `"all"`) — tranche l'ambiguïté MFA/step-up                                                          |
| 8   | `bypassFirewall` (Route, existe)                                                                                        | → réservé au décorateur `@Anonymous()` + routes système explicites ; audit des poseurs au moment du câblage                                                                          |

### 5.3 Hors-scope de la fenêtre (assumé, avec pourquoi)

- **OAuth2Authenticator (arctic)** : config-driven, mécanique, AUCUNE décision d'archi difficile
  → post-fenêtre (la fenêtre Fable 5 sert le DUR : pipeline, sémantique, crypto, passkeys).
- **P6.13 webhooks + P6.15 Studio UI complète** : CRUD mécanique sur des slots déjà réservés
  (schémas Zod posés). Post-fenêtre.
- **Row-level/classification des données** (doc API §7.1) : modèle À CONCEVOIR (session design
  dédiée) — P6 pose RBAC/voters, pas le MAC/MLS.
- **DPoP/Token Exchange impl** : slots+interfaces seulement, impl P12.

## 6. Plan 12 → 22 juin (fenêtre Fable 5)

> Règles d'exécution (TOUS les jours) : (a) chaque jour commence par la suite de la veille VERTE ;
> (b) build 0 erreur + tests module avant tout commit ; (c) `memory.test` à CHAQUE modif du
> pipeline request ; (d) commit par sous-tâche validée (`feat(security): …`) ; (e) skill
> `nodefony-security-review` sur le diff avant chaque fin de journée ; (f) ce qui glisse glisse —
> le 22 est un buffer, pas un jour de feature.

| Jour                         | Jalon                              | Livrables                                                                                                                                                                                                                                                                                                    | Gates spécifiques                                                          |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **J0 — 12/06** (aujourd'hui) | Audit + plan + **S0 réalignement** | Ce doc ; décisions §5.2 appliquées (config Zod, TSDoc, `mode` zone) ; `UserService implements IUserProvider` + tests                                                                                                                                                                                         | build + tests user/security                                                |
| **J1 — 13/06**               | **S2a socle authenticators**       | `AnonymousAuthenticator` + `UserPasswordAuthenticator` (→ `userService.authenticate()`) + sémantique `mode` + enregistrement au boot (registre module → firewall)                                                                                                                                            | 1ᵉʳ test intég 401/200 zone protégée ; **memory.test** (pipeline s'active) |
| **J2 — 14/06**               | **S2b Argon2id + politique NIST**  | `Argon2idEncoder` (@node-rs/argon2) + `needsRehash` (migration bcrypt→argon2 transparente au login) + blocklist hook + throttling login (compteur + backoff progressif, pas de lockout dur)                                                                                                                  | bench hash (~50-100 ms cible) ; tests unit encoders                        |
| **J3 — 15/06**               | **S3a session BFF**                | `SessionAuthenticator` (cookie opaque → session → user) ; flow login/logout (AuthController framework) ; **régénération ID au login** (anti-fixation) ; intégration `/auth/me` Studio existant                                                                                                               | tests intég login/logout/fixation ; memory.test                            |
| **J4 — 16/06**               | **S3b JWT API**                    | `JwtAuthenticator` (jose) : EdDSA, **kid+JWKS endpoint**, **aud RFC 8707**, jti + slot denylist, refresh rotation OWASP ; cookie `__Host-` si web                                                                                                                                                            | tests intég Bearer + audience reject ; pas de token en URL (gate grep)     |
| **J5 — 17/06**               | **S4 protections transverses**     | CSRF **Sec-Fetch-Site/Origin** middleware défaut (modèle Go 1.25) ; CORS preflight effectif (204 via firewall) ; headers natifs (HSTS/CSP+nonces/frameguard/noSniff…) ; `RateLimit-*` abstraits                                                                                                              | tests intég CSRF cross-site reject + preflight ; curl manuel headers       |
| **J6 — 18/06**               | **S5a autorisation**               | Niveau B : entités `IRole`/`IPermission` (orm-core, adapters Drizzle+Mongoose) ; niveau C : voters + registre DI auto ; `AuthorizationService.decide()` (affirmative + DENY veto, ABSTAIN→DENY) ; trancher les 10 sous-décisions [[project_security_authorization_pending]]                                  | tests unit decide() matrix                                                 |
| **J7 — 19/06**               | **S5b décorateurs**                | Panoplie : `@IsGranted`/`@Anonymous`(→bypassFirewall)/`@CurrentUser`/`@HasAnyRole`/`@HasAllRoles`/`@RateLimit`/`@CsrfProtect` — `Reflect.metadata` + `beforeResolve`, **401/403 AVANT `newController()`** ; trancher les 10 sous-décisions [[project_security_decorators_pending]] ; controller test combiné | tests intég décorateurs ; memory.test                                      |
| **J8 — 20/06**               | **S6 realtime + data plane**       | `SessionRealtimeAuthenticator` + `JwtRealtimeAuthenticator` (handshake) ; **dette #3 fail-closed** (`#channelAllowed`) ; zone `admin` sur `/nodefony/*` + `@IsGranted` sur `AdminApiController` → **le pont `api.request` hérite de la garde** (preuve « 1 garde = N transports »)                           | suite intég realtime + bridge souverain 9 tests ; memory WS                |
| **J9 — 21/06**               | **S7 passkeys WebAuthn**           | Registration + authentication ceremonies (`@simplewebauthn/server` OU impl native à trancher), entité credentials (BE/BS flags), related origins, conditional UI ready ; satisfait `studio.requireMfa`                                                                                                       | tests unit ceremonies (vecteurs) ; flow manuel Studio                      |
| **J10 — 22/06**              | **Clôture**                        | P6.11 suite intégration complète ; `/security-review` global ; docs module (CLAUDE/MEMORY/README) ; MAJ MIGRATION_STATUS ; **merge → claude-ts** ; si avance : API Keys (P6.12)                                                                                                                              | TOUTES gates + suite load/memory complète                                  |

### 6.1 Risques identifiés (aucun droit à l'erreur)

1. **memory.test = blocker** : les authenticators ajoutent du travail/req sur zones protégées —
   lazy partout, token POJO, pas d'alloc hors zone (S1 le garantit, à préserver).
2. **Sémantique chaîne (§5.2-7)** : si mal tranchée, MFA/step-up = refonte. Tranchée J0.
3. **@node-rs/argon2** : dep native nouvelle (peerDep optionnelle, même pattern que bcrypt) —
   **validation user requise** (règle module : pas de dep runtime sans accord).
4. **Passkeys** : la lib `@simplewebauthn/server` (dep) vs natif (WebCrypto Ed25519/ES256 +
   CBOR parsing maison) — arbitrage J9 à préparer J8 soir. Reco préliminaire : lib (auditée,
   maintenue, ~0 dep), natif = surface d'erreur crypto inacceptable en 1 jour.
5. **Veille offline** : statuts drafts à re-vérifier avant doc publique (README module).
6. **Studio auth existante** (`StudioController` `/auth/me`) : intégration S3a sans casser le
   front — dérouler les call-sites réels (leçon Ph.3 : gates vertes ≠ pas de régression).
