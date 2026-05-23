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
- **Câblage http-kernel PAS fait** : `handleSecurity` jamais appelé (http-kernel:256 fait juste `isSecure`).
  Hook `beforeResolve` **inexistant** (pipeline = onRequest/onAfterResponse/onFinish) → à créer pour `@IsGranted`.
- **macOS case-insensitif** : `securedArea.ts`→`SecuredArea.ts` via `git mv` (sinon casse Linux CI).
- 9 slots anti-refonte + plan S1-S6 + vision Studio : mémoire `project_p6_security_kit`.
