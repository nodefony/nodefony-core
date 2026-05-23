# @nodefony/security

Couche de sécurité de Nodefony — **refonte 2026 (en cours, P6)**.

Firewall par zones, authentication (pattern `IAuthenticator`), autorisation (rôles + voters),
CORS, CSRF, en-têtes de sécurité, JWT, clés API, webhooks, audit. **HTTP full stateless**
(JWT en cookie), **Zero Trust** par défaut. Consomme [`@nodefony/user`](../user).

> ⚠️ **Statut** : S1 (fondation) livré. L'authentication concrète (authenticators), le câblage
> du pipeline, l'autorisation par décorateurs et la console Studio arrivent aux sessions suivantes.

## Principes

- **Pattern `IAuthenticator`** (style Symfony 6) — pas de Bridge/Factory.
- **Zero Trust** : une zone protégée sans utilisateur authentifié → `401`.
- **Stateless** : identité via JWT signé (cookie `HttpOnly; Secure; SameSite=Strict`).
- **Config type-safe** : `defineSecurityConfig()` validée par Zod, **tout désactivable**,
  **introspectable** (Studio génère son formulaire d'édition).
- **En-têtes natifs** (sans la lib `helmet`) — 0 dépendance, nonce CSP par requête.

## Configuration

```ts
// config/security.ts
import { defineSecurityConfig } from "@nodefony/security";

export default defineSecurityConfig({
  encoders: { user: { type: "bcrypt", rounds: 12 } },

  roleHierarchy: {
    ROLE_ADMIN: ["ROLE_USER"],
  },

  areas: {
    // API publique sauf /admin — protégée par JWT
    main_api: { pattern: "^/api/(?!admin)", authenticators: ["jwt"] },
    // Zone admin sur un domaine dédié, double-facteur infra+app
    admin: {
      pattern: "^/api/admin",
      authenticators: ["mtls", "jwt"],
      host: "admin.exemple.com",
    },
  },
});
```

Toutes les sections (`cors`, `csrf`, `headers`, `rateLimit`, `jwt`, `apiKeys`, `webhooks`,
`audit`, `studio`) ont des **défauts sûrs** et sont **désactivables** via `enabled`.
Voir [`nodefony/config/config.ts`](./nodefony/config/config.ts) — chaque option y est
documentée (explication + défaut + reco).

### Sections

| Section         | Rôle                                             | Défaut                                       |
| --------------- | ------------------------------------------------ | -------------------------------------------- |
| `encoders`      | hash mot de passe                                | bcrypt rounds 12                             |
| `roleHierarchy` | héritage de rôles                                | `{}` (plats)                                 |
| `areas`         | zones firewall (pattern + host + authenticators) | `{}` (aucune route protégée)                 |
| `cors`          | Cross-Origin                                     | strict (jamais `*`+credentials)              |
| `csrf`          | SameSite + Origin (OWASP 2024)                   | activé, `Strict`                             |
| `headers`       | HSTS/CSP+nonces/frameguard/noSniff… (natif)      | activé ; avancés (COOP/COEP/CORP…) en option |
| `rateLimit`     | anti brute-force + lockout                       | activé                                       |
| `jwt`           | jetons stateless en cookie                       | EdDSA, access 15 min / refresh 7 j, rotation |
| `apiKeys`       | clés API (PAT) hashées                           | préfixe `nf`, expiry 90 j                    |
| `webhooks`      | sortants signés HMAC                             | anti-replay + anti-SSRF                      |
| `audit`         | journal sécurité (append-only)                   | activé, stream Studio                        |
| `studio`        | durcissement console admin                       | **OFF**, `localhost`, MFA requise            |

### Introspection (Studio)

```ts
import { securityConfigJsonSchema } from "@nodefony/security";
const schema = securityConfigJsonSchema(); // JSON Schema → formulaire d'édition Studio
```

## Erreurs

- `AuthenticationError` → `401` (non authentifié).
- `AccessDeniedError` → `403` (authentifié mais non autorisé).

## Licence

CeCILL-B — Christophe CAMENSULI.
