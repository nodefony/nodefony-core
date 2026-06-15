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
- Erreurs : `AuthenticationError`=401, `AccessDeniedError`=403 (extends `nodefonyError(msg, code)`).

## Config

- `defineSecurityConfig(input={})` → Zod parse → `Object.freeze`. 12 sections : encoders, roleHierarchy,
  areas, cors, csrf, headers, rateLimit, jwt, apiKeys, webhooks, audit, studio. Tout `enabled` (désactivable).
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
