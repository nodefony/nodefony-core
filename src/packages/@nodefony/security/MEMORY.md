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
- Contrats : `IToken` (getUser/isAuthenticated/getRoles/getCredentials/**getScopes**/get-setAttribute),
  `IAuthenticator` (supports/createToken/authenticate/onSuccess/onFailure), `ISecuredArea`, `IFirewall`,
  `IAccessVoter` + `VoterVote` (GRANT/DENY/ABSTAIN).
- Erreurs : `AuthenticationError`=401, `AccessDeniedError`=403 (extends `nodefonyError(msg, code)`).

## Config

- `defineSecurityConfig(input={})` → Zod parse → `Object.freeze`. 12 sections : encoders, roleHierarchy,
  areas, cors, csrf, headers, rateLimit, jwt, apiKeys, webhooks, audit, studio. Tout `enabled` (désactivable).
- `securityConfigJsonSchema()` = `z.toJSONSchema(schema)` → **Studio génère son formulaire**.
- `config.ts` = défauts SÛRS ENTIÈREMENT commentés (réf humaine). Zones : champ `host?` (vhost).
- Défauts : Zero Trust, CORS strict (jamais `*`+credentials), headers natifs (avancés COOP/COEP/CORP optionnels),
  Studio `enabled:false`/`exposure:localhost`.

## Behaviors

- `areas: {}` (défaut) → firewall = no-op (perf max). Zone protégée + anonyme → 401.
- `authenticators` = schéma OUVERT (`z.string()`) → plugins (apikey/ldap) sans éditer le core ; validés au runtime.
- En-têtes = **natif** (pas helmet). JWT = jose (S3), OAuth = arctic (S6), bcrypt = `@nodefony/user`.

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
