---
title: "@nodefony/security"
module: "@nodefony/security"
since: "10.0.0"
updated: "2026-06-05"
status: wip
order: 0
---

# @nodefony/security

> Couche de sécurité de Nodefony (refonte P6) : **Firewall** par zones, **authentication**
> (pattern `IAuthenticator`), autorisation (rôles / voters), CORS, CSRF, en-têtes, JWT, clés API,
> webhooks, audit. Consomme `@nodefony/user` (jamais l'inverse).

## Vue d'ensemble

La sécurité est **fermée par défaut** (Zero Trust) : une zone protégée sans authentification
valide ni `@Anonymous` répond **401**. HTTP est **full stateless** — l'identité transite par un
**JWT** cookie `HttpOnly; Secure; SameSite=Strict` (signé via `jose`), adapté au scaling horizontal
cloud-native. Le WebSocket, lui, est stateful (identité portée par AsyncLocalStorage).

## Décisions structurantes

| Sujet           | Décision                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| Pattern auth    | `IAuthenticator` (style Symfony 6), pas Bridge/Factory                      |
| HTTP            | stateless — JWT cookie `HttpOnly;Secure;SameSite=Strict`                    |
| Zero Trust      | zone protégée + anonyme + pas `@Anonymous` → **401**                        |
| Config          | `defineSecurityConfig()` + Zod (12 sections, tout `enabled`, `.describe()`) |
| En-têtes        | natifs (pas `helmet`) — 0 dep, nonce CSP par requête                        |
| Crypto password | `@node-rs/bcrypt` (peerDep optionnelle), via `@nodefony/user`               |
| OAuth / JWT     | `arctic` (OAuth) + `jose` (JWT) — jamais `passport`/`jsonwebtoken`          |

## Composants

- **`Firewall`** (`service/firewall.ts`) : `isSecure` (hot-path, court-circuite si 0 zone) +
  `handleSecurity` (auth → ALS → Zero Trust). Branché au pipeline http via hook `beforeResolve`.
- **`SecuredArea`** : match pattern + host/vhost d'une zone.
- **`RoleHierarchyWalker`** : précompute DFS de la hiérarchie de rôles au boot (détection de cycles).
- **`AnonymousToken`** : jeton du visiteur non authentifié (singleton gelé, 0 alloc/requête).
- **Contrats** : `IToken`, `IAuthenticator`, `ISecuredArea`, `IFirewall`, `IAccessVoter`.

## Configuration

```typescript
import { defineSecurityConfig } from "@nodefony/security";

export default defineSecurityConfig((ctx) => ({
  firewall: {
    enabled: true,
    areas: [{ name: "admin", pattern: "^/nodefony", anonymous: false }],
  },
  jwt: { enabled: true, cookie: { name: "nf_token", sameSite: "strict" } },
  headers: { enabled: true, csp: { enabled: true } },
}));
```

Chaque section porte `enabled` (désactivable à chaud) et est validée par Zod au boot
(`securityConfigJsonSchema()` alimente l'auto-form Studio).

## État

S1 livré (fondation : contrats, firewall skeleton Zero Trust, RoleHierarchyWalker, SecuredArea,
config Zod). Reste : câblage http-kernel complet, authenticators (S2+), JWT (S3), CSRF (S4),
OAuth `arctic` (S6). Voir `MIGRATION_STATUS.md` (P6) et le `CLAUDE.md` du module.

## Liens

- [`CLAUDE.md`](../CLAUDE.md) · [`MEMORY.md`](../MEMORY.md)
- [`@nodefony/user`](../../user/) — contrat `IUser` consommé
- ADR autorisation / décisions P6 : `MIGRATION_STATUS.md`
