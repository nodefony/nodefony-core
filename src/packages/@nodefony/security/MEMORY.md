# MEMORY.md — @nodefony/security (IA, concis)

## Purpose

Sécurité Nodefony (P6, refonte from scratch). Firewall + IAuthenticator + Zero Trust + config Zod.
Consomme `@nodefony/user`. Coupling http→security = **type-only** (`Firewall`/`Csrf`/`SecuredArea`).

## Core Components

- `Firewall` (service) : `isSecure(ctx)` = match zone, pose `context.security` (court-circuit si 0 zone).
  `handleSecurity(ctx)` = authenticate → `RequestContext.set("user")` → Zero Trust 401. `registerAuthenticator()`.
- `SecuredArea` : `match(ctx)` = host (`ctx.domain`) puis pattern. Champs : pattern/security/stateless/authenticators/host.
- `RoleHierarchyWalker` : `hasRole(roles, required)` O(1) (flat précalc DFS), `#detectCycles` throw au boot.
- `AnonymousToken` : `getUser()=anonymousUser` (gelé, 0 alloc), `isAuthenticated()=false`, `getScopes()=[]`.
- `AuthFlow` (service "authFlow", J3) : login/logout/me session BFF. login = throttle partagé →
  verifier → `regenerateId()` INCONDITIONNEL + `storage.destroy(oldId)` (anti-fixation OWASP) +
  `save(identifier)`. Session stocke l'IDENTIFIANT seul ; me/SessionAuthenticator re-fetch provider
  à CHAQUE requête (`resolveSessionIdentity` — rôles frais, révocation immédiate). `ISafeUser`
  projection {id, username, roles} — JAMAIS l'entité (hash).
- `SessionAuthenticator` ("session", J3) : supports = `context.session?.user` non vide (session
  reprise par le pipeline AVANT firewall) ; pas de `challenge()` (401 nu, pas de popup).
- Endpoints HTTP : `SessionAuthController` (@nodefony/framework) `/nodefony/security/api/auth/
{login,logout,me}` — montés à onKernelReady SI "authFlow" présent ; duck-typing code 401/429.
- **JWT (J4)** — `JwtAuthenticator` ("jwt") : Bearer (RFC 6750), jose **lazy import**, `jwtVerify`
  allowlist `["EdDSA"]`+issuer+audience+`typ:"at+jwt"` (RFC 8725 §3.1/3.8/3.9/3.11), denylist `jti` +
  `invalidBefore` (révocation), `loadUserByIdentifier(sub)` (sub revalidé §3.10), `challenge()="Bearer"`.
  Résout `jwtKeystore`/`tokenStore`/`users` LAZY du container. **UserToken réutilisé** (pas de JwtToken).
- `JwtKeystore` (Ed25519) : source PRIORISÉE env (`keystore.keySetJson`) → fichier (`keystore.dir/
keyset.json` chmod 600, généré si absent) → mémoire+WARNING (éphémère). `kid`=thumbprint RFC 7638.
  JWKS public via `createLocalJWKSet` (jamais `jku`/`jwk` header — §3.5) — JAMAIS `d`. Lazy async mémoïsé.
  ⚠️ jose v6 : `generateKeyPair("Ed25519",{extractable:true})` (pas `"EdDSA"`) ; header/verify = `"EdDSA"`.
- `TokenService` (service "tokenService", J4) : `issueForCredentials`(password grant → access JWT +
  refresh opaque **haché sha256** stocké), `refresh`(rotation + **reuse detection** RFC 9700 §4.14 →
  `revokeFamily`), downscoping (scopes ne montent jamais). **Orchestrateur du seam `ITokenStore.gc()`** :
  `runGc()` PUBLIC + timer `setInterval(base).unref()` à **phase jittérée** (`onBoot`/`onTerminate`) ;
  `gcIntervalS:0` délègue à un ordonnanceur externe (cron P5.0b). Pose `tokenStore`+`jwtKeystore` container.
- Endpoints JWT : `TokenAuthController` (@nodefony/framework) `/nodefony/security/api/token{,/refresh}`
  (`bypassFirewall`, montés si "tokenService"). Réponse RFC 6749 §5.1 (Bearer JSON, JAMAIS cookie/URL).
- **WebAuthn / Passkeys (J9)** — `WebAuthnService` (service "webauthn") : cérémonies FIDO2 (WebAuthn L3
  §7.1 registration / §7.2 authentication) déléguées à **`@simplewebauthn/server`** (lazy `import()`,
  externalisé rollup, vendorless côté `/browser`). `generateRegistrationOptions`/`verifyRegistration`
  (stocke le credential) + `generateAuthenticationOptions`/`verifyAuthentication` (vérifie sig + counter
  anti-clone, MAJ état). RP résolu au boot : `rpId` = config ?? kernel.domain, **IP→`localhost`** auto
  (le navigateur refuse une IP). `#expectedOrigin` = liste blanche config, sinon **origine requête SI
  hostname===rpId** (dev localhost:port sûr). `authenticatorAttachment:"platform"` (défaut) = Touch ID/
  Hello **sans QR** ; `"cross-platform"`=clé/tél, `"any"`=les deux. Lazy import = règle gravée.
- `IWebAuthnCredential` (id b64url, **publicKey COSE** b64url, signCount, transports, BE/BS, userId,
  lastUsedAt) + `IWebAuthnCredentialStore` (findById/findByUser/save/update/delete). Store **pluggable**
  (`webAuthnCredentialStoreRegistry`, convention-frère tokenStore) : `memory` (volatile) + **`file`**
  (`FileWebAuthnCredentialStore` = Memory + persistance JSON **atomique** tmp+rename, flush coalescé +
  **`flushNow` à `onTerminate`** = 0 perte au restart). Driver = `config.passkeys.store` (`z.string()`
  pluggable, J9). **Adapters cluster ✅ J9** (approche B, `import type` seul → 0 dép runtime, l'app câble) :
  `RedisWebAuthnCredentialStore` (HASH+SET, pas de TTL), `DrizzleWebAuthnCredentialStore` +
  `MongooseWebAuthnCredentialStore` (au-dessus de `IRepository`, mapping `Row↔contrat` car `nickname?`+
  readonly ; entité `webauthn_credential` `module:"security"`). Câblage app (idem tokenStore) :
  `registerWebAuthnStore("redis", ({container})=>RedisWebAuthnCredentialStore.from(container.get("redis")))` ;
  ORM = `registerWebAuthnCredentialEntity(orm)` **avant** `orm.connect()` + `registerWebAuthnStore("drizzle", …from(orm))`.
- Endpoints WebAuthn : `WebAuthnController` (@nodefony/framework) `/nodefony/security/api/webauthn/
{register,login}/{options,verify}` (`bypassFirewall`, montés si "webauthn"). **register exige session**
  (me() → 401, Zero Trust) ; **login démarre une session ANONYME** (`AuthFlow.ensureSession`) pour porter
  le **challenge anti-replay** (`session.set`+**`save()` explicite** = persistance storage, sinon « No
  challenge » au verify déconnecté — bug clé) ; challenge à **usage unique** (lu→`set(null)`+save).
  login/verify OK → `AuthFlow.establishSessionFor` (session BFF, **anti-fixation regenerateId**, revalide
  actif/locked). Front Studio : bouton « Passkey/empreinte » au login + « Enregistrer une empreinte »
  (menu user), `@simplewebauthn/browser` `startAuthentication`/`startRegistration`.
- Contrats : `IToken` (getUser/isAuthenticated/getRoles/getCredentials/**getScopes**/get-setAttribute),
  `IAuthenticator` (supports/createToken/authenticate/onSuccess/onFailure), `ISecuredArea`, `IFirewall`,
  `IAccessVoter` + `VoterVote` (GRANT/DENY/ABSTAIN).
- **OAuth2 social login (J9)** — `OAuth2Service` (service "oauth2") : flux Authorization Code **BFF**
  au-dessus d'**arctic v3.7.0** (`import()` LAZY au 1er login, cold path). `createAuthorization` (génère
  state + code_verifier PKCE, URL) / `exchangeAndProvision` (valide **iss** RFC 9207 → `validateAuthorizationCode`
  → `fetchProfile` → provisionne). `IOAuthProvider` = façade par fournisseur masquant la divergence arctic
  (Google PKCE 3-args / GitHub 2-args) + **normalise le profil qu'arctic ne lit JAMAIS**. Registry pluggable
  `registerOAuthProvider` — builtins **google/keycloak/github** : google+keycloak via **helper OIDC générique**
  `createOidcProvider` (decode idToken ; Keycloak self-hosted = `issuer`=URL realm en config) ; github = mapping
  custom non-OIDC (`/user`+`/user/emails`). Provisioning délégué au service `users` SI capability
  `IOAuthUserProvisioner` (duck-type, **fail-closed** sinon). Le social login produit une **session BFF**, PAS
  d'authenticator firewall (calque WebAuthn login). Décision identité : [[project_oauth2_social_identity]].
- Endpoints OAuth2 : `OAuth2Controller` (@nodefony/framework, dans `nodefony/controller/`) `/nodefony/security/
api/oauth2/{provider}/{authorize,callback}` (`bypassFirewall`, montés si service "oauth2") : authorize pose
  state+verifier en **session anonyme** → 302 fournisseur ; callback **compare state** (anti-CSRF, usage unique)
  → `exchangeAndProvision` → `AuthFlow.establishSessionFor` (anti-fixation) → 302 successRedirect (échec →
  failureRedirect). Banc E2E réel `oauth2-flow` 6/6 (@nodefony/http).
- **`IOAuthUserProvisioner` / `IOAuthProfile`** (@nodefony/user) : capability de provisioning **Shadow User JIT**
  (find-or-create). `UserService.provisionOAuthUser(profile, {defaultRoles, allowSignup})` = défaut : crée
  `password:null` + rôles `policy.defaultRoles` (ROLE_USER) + `addSocialProvider` ; **zéro liaison-email auto**
  (anti account-takeover). OAuth = authn pas authz (rôles à la création, base=vérité). user n'importe RIEN de security.
- **API Keys / PAT (P6.12)** — clé = bearer **opaque** `nf_<pubid(8)><secret(43)><crc(6)>` (base64url
  positionnel, 1 seul `_`). `apiKeyFormat.ts` (PUR) : `generateApiKey`/`parseApiKey`/`hashApiKey`/
  `looksLikeApiKey` + **CRC32 local** (checksum PUBLIC : rejet O(1) sans store = anti-DoS + secret-scanning).
  Repos = `sha256(token entier)` (secret 256 bits → pas de pepper/argon2, raison : non brute-forçable).
  `ApiKeyAuthenticator` (`apikey`) : `supports`=Bearer+préfixe `nf_` ; `authenticate`=`parseApiKey` (forme+CRC
  AVANT store) → `findByHash` → checks `kind:"pat"`/révoqué/expiré/**ban `invalidBefore`** → `loadUserByIdentifier`
  (rôles frais) → `markUsed` **throttlé** (`lastUsedThrottleS`, 0 write hot path) → promote + `scopes`/`apiKeyId`
  en attribut ; 401 **uniforme** (anti-énum). **Discrimination JWT/PAT par FORME** : `JwtAuthenticator.supports()`
  resserré à `a.b.c` (JWS compact, 3ᵉ `*` → `alg=none` reste routé jose) → les deux cohabitent dans une zone.
  `ApiKeyService` (`apiKeys`) : `createForSubject`/`listForSubject`/`revokeForSubject` sur le **même `ITokenStore`**
  que JWT (record `kind:"pat"`, secret affiché **1×**) ; cap `maxPerSubject`→409, scopes ⊆ `allowedScopes`→400,
  expiry `defaultExpiryDays`, IDOR→`false`. **TokenService possède le store+gc** : boot étendu `jwt.enabled ‖
apiKeys.enabled` (keystore JWT seulement si jwt) ; `isEnabled()`=capacité JWT (keystore). Endpoints =
  `ApiKeyController` (@nodefony/framework, couplé par nom `apiKeys`+`authFlow`) `/nodefony/security/api/keys`
  POST/GET/DELETE — **PAS `bypassFirewall`** (zone data plane session BFF ; porteur = `authFlow.me`, jamais autrui ;
  DELETE clé d'autrui→**404** anti-énum). Builtin `registerAuthenticatorFactory("apikey", …)`. Banc : 44 unit + e2e
  `http/apikey-flow.test.ts` (8, matrice d'attaques + IDOR + coexistence JWT/PAT). RFC 6750/7009/6749.
- **Journal d'audit (P6.14)** — événements de sécurité = **transitions d'état** (≠ trafic `JsonAuditLogger`
  P3.1). `AuditService` (`auditService`, `IAuditSink`) : `record` **no-op coût NUL si off** (`audit.enabled`,
  ON défaut OWASP A09), stamp `id`+`ts` centralisé, fan-out live **lazy** (`subscribe`, lot 4), `gc` rétention
  `unref` ; pose `auditStore`. **Store PLUGGABLE** (`audit.driver`, défaut `memory`) résolu par
  `auditStoreRegistry` (`registerAuditStore`/`getAuditStoreFactory`/`listAuditStores`, calque
  `tokenStoreRegistry` ; driver inconnu → WARNING + audit désactivé, jamais de crash) : builtin `memory`
  (`MemoryAuditStore` FIFO borné, query curseur récent→ancien) ; `drizzle` = `DrizzleAuditStore` persistant
  append-only (P6.18, câblé approche B par l'app). **Secret jamais dans l'event** → presence-only `flags`. **Émission EXPLICITE par point** (pas EventEmitter firewall : Token/
  ApiKey/OAuth émettent hors chaîne). Helpers `recordAudit(container, draft)` (résout `auditService`, no-op si
  absent) + `readAuditContext(ctx)` (ip/ua/requestId+flags). **Lot 2** (cold) : `AuthFlow` login.success/
  failure/throttled/logout ; `Authorization` access.denied (`#auditDeny`). **Lot 2b** (HOT-PATH, succès MUET) :
  `Firewall.handleSecurity` auth.failure/throttled/denied (helper `#recordAuth`, 4 sorties d'échec seulement) ;
  verrou WS `frame.denied` (`buildFrameAuthorizer({onDeny})` tiré sur refus only → 0 alloc hot-path ; câblé
  `#wireRealtime`) ; `TokenService` token.issued/reuse_detected + login.failure/throttled (grant) ;
  `ApiKeyService` apikey.created/revoked. **Data plane lot 3** : `SecurityAdminApi` (`IAdminApi` ns "security")
  `GET /nodefony/security/api/audit/events` RBAC `ROLE_NODEFONY_ADMIN`, 503 si off. Table actions = README
  §Audit. **Stream live lot 4** : canal WS `security:audit` (`createAuditBridge` calque `createSyslogBridge`,
  coalescé `{events,dropped}` ring borné, **lazy** : s'abonne à `AuditService.subscribe` au 1ᵉʳ auditeur,
  détache au dernier). Gardé **ROLE_NODEFONY_ADMIN** (plancher `security:` ajouté à `frameAuthorizer`,
  `SECURITY_CHANNEL_POLICY`, 1 cran au-dessus de `SYSTEM_CHANNEL_POLICY`). Enregistré comme **canal système**
  sur le hub (`RealtimeHub.registerSystemChannel` + `RealtimeService.registerSystemChannel` — fallback dans
  `subscribe` quand la factory du controller → null → servable par TOUT endpoint, ZÉRO couplage Studio). Câblé
  `Firewall.#wireRealtime` (couplé au verrou : jamais de canal d'audit non gardé). Seam multi-tenant : event
  portera `tenantId` (futur). Bancs : `auditService`/`auditEmission`/`auditEmissionHotPath`/`auditBridge` (25,
  dont 0-émission-succès + câblage WS bout-en-bout + bridge lazy/coalescing + garde super-admin). memory 9/9.
  ➡️ Console auditeur Studio P6.15 LIVRÉE.
- **Introspection firewall (data plane P6.15)** — `Firewall.describe()` + `describeRoleHierarchy()` (contrat
  `IFirewall`, DTO `contracts/IFirewallDescription.ts`) projettent l'état **RUNTIME** (zones montées /
  authenticators registre∪montés / défenses CSRF-CORS-headers-throttle résolues / hiérarchie transitive),
  PAS un re-parse de config. **Secret CSRF jamais exposé** (présence `synchronizerToken`, pas la valeur — règle
  audit). `SecurityAdminApi` ajoute `GET /nodefony/security/api/{firewall,roleHierarchy}` RBAC
  `ROLE_NODEFONY_ADMIN`, 503 sans service. ⚠️ 401 via curl = gate broker AVANT le handler → test
  `firewallIntrospection.test.ts` (10) prouve le handler lui-même + redaction secret. Conso = Studio page Firewall.
- **CSRF (J5)** — `Csrf` (`service/csrf.ts`, logique PURE sync, testable sans serveur) : défense **Fetch
  Metadata d'abord** (modèle Go 1.25 / OWASP 2025) + repli `Origin`/`Referer`. `enforce(req)` sur méthode
  state-changing (RFC 9110 §9.2.1 ; GET/HEAD/OPTIONS/TRACE = no-op) ; chaîne : (1) origine de confiance
  (`trustedOrigins` ∪ `cors.origins`) → OK même cross-site ; (2) `Sec-Fetch-Site` same-origin/none → OK,
  same-site → OK sauf `strictSameSite`, **cross-site → `CsrfError` 403**, inconnu → repli (W3C "SHOULD
  ignore") ; (3) repli : ni Origin ni Referer → OK (non-navigateur), sinon same-host requis. `Csrf.isStateChanging()`
  static = court-circuit hot-path. **`Firewall.enforceCsrf(ctx)`** : `#csrf` lazy (null si désactivé), court-circuit
  GET AVANT toute lecture d'en-tête, exempte `resolver.bypassFirewall` (calque OAuth), Host **brut avec port**
  (`headers.host`/`:authority`, PAS `ctx.domain` sans port). Câblé http-kernel **1 point** (après resolver,
  avant session/auth = rejet précoce). `CsrfError(403)` (RFC 9110 §15.5.4). Différé : `@CsrfProtect`/`@CsrfExempt`.
- **CORS (J5)** — `Cors` (`service/cors.ts`, pure, Fetch Standard) : `preflightHeaders(origin)` (Allow-Methods/
  Headers/Max-Age) / `actualHeaders(origin)` (Expose-Headers) → `null` si origine non whitelistée (0 en-tête =
  réponse non partageable). `*` SEULEMENT si `!credentials` ; sinon **reflète l'origine** + `Vary: Origin`
  (`reflectsOrigin()`). **`Firewall.handleCors(ctx): number|undefined`** : pose les en-têtes, **204** si preflight
  (`OPTIONS` + `Access-Control-Request-Method`). **⚠️ Câblé EN TÊTE de `handleHttp`, AVANT le routing** (un
  preflight n'a pas de route → le router lèverait 405 au pré-match → handleCors jamais atteint ; PROUVÉ par log).
  Donc PAS dans `handleFrontController` (bonus : le WS n'a pas de CORS). Court-circuit 204 = `writeHead(204)+end()`,
  ni parse ni firewall (preflight jamais authentifié, Fetch). **`*`+credentials INTERDIT au boot** (refine Zod fail-fast).
- **En-têtes de sécurité (J5, étape A)** — **SÉPARATION transport/applicatif** : le **socle transport**
  (nosniff/X-Frame-Options/HSTS) reste dans `@nodefony/http` (`onHttpRequest`, AVANT le pipeline → couvre statics
  - erreurs + serveur nu = secure-by-default) ; security ne le ré-émet PAS (1 source/en-tête, raison vérifiée par
    log). `SecurityHeaders` (`service/securityHeaders.ts`, pure) émet l'**applicatif** : CSP (statique ; nonce =
    étape B), Referrer-Policy, COOP/COEP/CORP, Origin-Agent-Cluster (`?1` RFC 8941), Permissions-Policy — table figée
    pré-calculée au boot. **`Firewall.applySecurityHeaders(ctx)`** câblé `handleHttp` après handleCors (avant routing
    → couvre 404/405/static). `headers.{hsts,frameguard,noSniff}` = délégués transport (describe). `hidePoweredBy` =
    no-op (Nodefony n'émet pas X-Powered-By). `referrerPolicy` = **enum W3C** (complétion+validation).
- **DX config (J5)** — security **augmente `NodefonyModuleConfig`** (`declare module "nodefony"`, recette frère
  drizzle/mongoose) → `use("@nodefony/security", {…})` complète CLÉS + VALEURS enum + valide les types (sinon
  `Record<string,unknown>`). Enums complétés : coop/coep/corp/frameguard/referrerPolicy/sameSite/jwt.alg.

## Config

- `defineSecurityConfig(input={})` → Zod parse → `Object.freeze`. 12 sections : encoders, roleHierarchy,
  areas, cors, csrf, headers, rateLimit, jwt, **oauth2** (J9), apiKeys, webhooks, audit, studio (+ tokenStore/
  passkeys/tokenExchange/realtimeChannels). Tout `enabled` (désactivable). `oauth2` : `{enabled, defaultRoles:
["ROLE_USER"], allowSignup, successRedirect, failureRedirect, providers:{<name>:{clientId, clientSecret,
redirectUri, issuer?, scopes}}}` — `issuer` requis pour keycloak (URL realm).
- `securityConfigJsonSchema()` = `z.toJSONSchema(schema)` → **Studio génère son formulaire**.
- `config.ts` = défauts SÛRS ENTIÈREMENT commentés (réf humaine). Zones : champ `host?` (vhost).
- `tokenStore` (J4) : `{driver:"memory", gcIntervalS:600, gcJitter:true, retentionRevokedDays:30}` —
  store de jetons pluggable. `jwt.{issuer?, keystore:{keySetJson?,dir?}}` (issuer omis → `"nodefony"`).
- Défauts : Zero Trust, CORS strict (jamais `*`+credentials), headers natifs (avancés COOP/COEP/CORP optionnels),
  Studio `enabled:false`/`exposure:localhost`.

## Behaviors

- `areas: {}` (défaut) → firewall = no-op (perf max). Zone protégée + anonyme → 401.
- `authenticators` = schéma OUVERT (`z.string()`) → plugins (apikey/ldap) sans éditer le core ; validés au runtime.
- En-têtes = **natif** (pas helmet). JWT = jose **(J4 ✅, EdDSA)**, OAuth = arctic (S6), bcrypt = `@nodefony/user`.
- **CSRF GLOBAL** (J5) : appliqué à TOUTE requête mutante (zone ou non) — défense gratuite sur GET (court-circuit
  méthode). `csrf.{enabled, fetchMetadata, sameSite(cookie), checkOrigin, strictSameSite:false, trustedOrigins:[]}`.
  `strictSameSite` (≠ attribut cookie `sameSite`) : same-site → 403 si true (multi-tenant). `trustedOrigins` (≠
  `cors.origins`) = alias multi-domaine, n'ouvre PAS la lecture CORS des réponses.

## Gotchas

- **Zod v4** : `.default(()=>S.parse({}))` sur sections objet (`.default({})` refusé : TS2769).
- **Build** : `cd <pkg> && npm run build` (pas `npx rollup -c`, flaky). zod + @nodefony/user en `external`.
- **Câblage http-kernel FAIT (J1)** : `handleSecurity` appelé HTTP + WS ; `startSession` AVANT le
  firewall (J3) — lazy inchangé. Hooks `beforeResolve`/`afterAuth`/`onAuthFailure` existent (P1.7).
- **Pont container (firewall `#provisionSharedServices`, au boot)** : `passwordEncoder`
  (= `encoderFromConfig(Object.values(config.encoders))`, 1re entrée = primary) + `loginThrottler`
  (UNE instance pour TOUTES les portes — Basic + JSON, même compteur NIST). L'app résout
  `passwordEncoder` pour construire son UserService.
- **Résurrection de session** : `session.destroy()` pose `mutated=false` (sinon le saveSession de
  fin de requête RE-CRÉE le blob détruit — vu au banc logout J3). `AuthFlow.logout` pose aussi
  `context.session = null`.
- **macOS case-insensitif** : `securedArea.ts`→`SecuredArea.ts` via `git mv` (sinon casse Linux CI).
- 9 slots anti-refonte + plan S1-S6 + vision Studio : mémoire `project_p6_security_kit`.
