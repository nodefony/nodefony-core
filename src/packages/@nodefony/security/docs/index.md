---
title: "@nodefony/security"
module: "@nodefony/security"
since: "10.0.0"
updated: "2026-07-05"
status: wip
order: 0
---

# @nodefony/security

> Couche de sécurité de Nodefony (P6) : **Firewall** par zones, **authentication**
> (pattern `IAuthenticator`), autorisation (rôles / voters), CORS, CSRF, en-têtes, JWT, clés API,
> WebAuthn/passkeys, OAuth2 social, 2FA TOTP, webhooks signés, audit persistant. Consomme
> `@nodefony/user` (jamais l'inverse).

## Vue d'ensemble

La sécurité est **fermée par défaut** (Zero Trust) : une zone protégée sans authentification
valide ni `@Anonymous` répond **401**. Le modèle d'identité est **hybride** (révisé 2026-06-06) :
le **web/Studio** ouvre une **session serveur** (cookie opaque BFF, révocable) ; les **API/agents**
portent leur preuve à chaque requête — **JWT** signé via `jose` ou clé API — pour le sans-état
machine-à-machine. Le WebSocket est stateful (identité portée par AsyncLocalStorage).

## Décisions structurantes

| Sujet           | Décision                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| Pattern auth    | `IAuthenticator` (supports/authenticate/onSuccess), pas Bridge/Factory     |
| HTTP            | hybride — session serveur (cookie opaque BFF) web/Studio + JWT/clé API M2M |
| Zero Trust      | zone protégée + anonyme + pas `@Anonymous` → **401**                       |
| Config          | `use("@nodefony/security", {…})` + Zod (18 sections, tout `enabled`)       |
| En-têtes        | natifs (pas `helmet`) — 0 dep, nonce CSP par requête                       |
| Crypto password | Argon2id (RFC 9106) par défaut ; bcrypt legacy — via `@nodefony/user`      |
| OAuth / JWT     | `arctic` (OAuth) + `jose` (JWT) — jamais `passport`/`jsonwebtoken`         |

## Composants

- **`Firewall`** (`service/firewall.ts`) : `isSecure` (hot-path, court-circuite si 0 zone) +
  `handleSecurity` (auth → ALS → Zero Trust). Branché au pipeline http via hook `beforeResolve`.
- **`SecuredArea`** : match pattern + host/vhost d'une zone.
- **`RoleHierarchyWalker`** : précompute DFS de la hiérarchie de rôles au boot (détection de cycles).
- **`AnonymousToken`** : jeton du visiteur non authentifié (singleton gelé, 0 alloc/requête).
- **Contrats** : `IToken`, `IAuthenticator`, `ISecuredArea`, `IFirewall`, `IAccessVoter`.

## Configuration

```typescript
import { defineConfig, use } from "nodefony";

export default defineConfig((ctx) => ({
  modules: [
    use(
      "@nodefony/security",
      {
        roleHierarchy: { ROLE_ADMIN: ["ROLE_USER"] },
        // Zones firewall : clé = nom de zone, valeur = pattern + authenticators.
        areas: {
          admin: { pattern: "^/nodefony", authenticators: ["session"] },
          api: {
            pattern: "^/api",
            authenticators: ["jwt", "apikey"],
            stateless: true, // API M2M : aucune session, preuve à chaque requête
          },
        },
      },
      { policy: "mandatory" },
    ),
  ],
}));
```

Chaque section porte `enabled` (désactivable à chaud) et est validée par Zod au boot
(`securityConfigJsonSchema()` alimente l'auto-form Studio). ⚠️ Il n'y a **pas** de clé
`firewall` : les zones vivent sous `areas` (record), au top-level de la config du module.

## État

Cœur P6 livré : firewall + zones, session serveur (NIST), JWT (`jose`), WebAuthn/passkeys, OAuth2
social (`arctic`), CSRF/CORS/en-têtes natifs, clés API/PAT, 2FA TOTP, webhooks signés, audit
persistant, rate-limit. Reste : voters d'autorisation, CSP nonce par requête, décorateurs CSRF
(`@CsrfProtect`/`@CsrfExempt`). Voir `MIGRATION_STATUS.md` (P6) et le `CLAUDE.md` du module.

## Liens

- [`CLAUDE.md`](../CLAUDE.md) · [`MEMORY.md`](../MEMORY.md)
- [`@nodefony/user`](../../user/) — contrat `IUser` consommé
- ADR autorisation / décisions P6 : `MIGRATION_STATUS.md`
