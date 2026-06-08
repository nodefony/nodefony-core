# CLAUDE.md — @nodefony/security

> Audience IA en session. Voir [`MEMORY.md`](./MEMORY.md) (internals concis) + [`README.md`](./README.md) (humain).
> **Kit de session** : mémoire IA `project_p6_security_kit` (LIRE EN PREMIER avant toute session security) — plan S1-S6, 9 slots anti-refonte, vision Studio.
>
> ⚠️ **REVUE 2026-06-08** — décisions ci-dessous **partiellement périmées** (détail + cible : `project_p6_security_kit` §REVUE) : « full stateless » → **hybride** (session BFF + JWT API, révisé 06-06) · **Symfony ≠ modèle** (garder les invariants, virer l'attribution) · ouvrir **Argon2id** · intégrer **Passkeys/WebAuthn + Token Exchange RFC 8693 (agents)** · identité = `IUser` racine + slot agent. **Gros travail = au démarrage P6.**

## Rôle

Couche de sécurité de Nodefony — **refonte 2026 (P6)**. Firewall (zones), authentication
(pattern `IAuthenticator`), autorisation (rôles/voters), CORS, CSRF, en-têtes, JWT, clés API,
webhooks, audit. Consomme `@nodefony/user` (jamais l'inverse).

## Décisions figées

| Sujet                  | Décision                                                                        | Pourquoi                                             |
| ---------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Pattern auth           | **`IAuthenticator`** (supports/authenticate/onSuccess), PAS Bridge/Factory      | lisible, extensible, plugins                         |
| HTTP                   | **hybride** : session serveur cookie opaque (BFF) web/Studio + JWT API/agents   | révocable + scaling via store partagé (révisé 06-06) |
| Zero Trust             | zone protégée + anonyme + pas `@Anonymous` → **401**                            | fermé par défaut                                     |
| Config                 | **`defineSecurityConfig()` + Zod** (12 sections, tout `enabled`, `.describe()`) | type-safe + Studio auto-form + désactivable à chaud  |
| En-têtes               | **natif** (pas la lib helmet)                                                   | 0 dep, contrôle total, nonce CSP par requête         |
| Identité machine       | un `ServiceAccount` implémente `IUser`                                          | pas de principal séparé                              |
| Coupling http→security | **type-only** (http importe `Firewall`/`Csrf`/`SecuredArea`)                    | conservé tel quel ; découplage = dette future        |

## Structure

```
index.ts                       Module Security (@services([Firewall])) + exports + defineSecurityConfig
nodefony/
├── contracts/                 IToken · IAuthenticator · ISecuredArea · IFirewall · IAccessVoter(+VoterVote)
├── errors/                    AuthenticationError(401) · AccessDeniedError(403)
├── config/
│   ├── defineSecurityConfig.ts  builder + Zod (12 sections) + securityConfigJsonSchema()
│   └── config.ts                défauts SÛRS, ENTIÈREMENT commenté (réf humaine)
├── src/
│   ├── SecuredArea.ts         match pattern + host/vhost
│   ├── RoleHierarchyWalker.ts précompute DFS au boot + détection cycles
│   └── token/AnonymousToken.ts
└── service/
    ├── firewall.ts            isSecure (hot-path) + handleSecurity (auth→ALS→Zero Trust)
    └── csrf.ts                placeholder (type Csrf pour http) — réécrit S4
```

## État (S1 livré 2026-05-23)

✅ Fondation : contrats, erreurs, firewall skeleton (Zero Trust), RoleHierarchyWalker, SecuredArea,
AnonymousToken, config best-in-class (Zod + config.ts documenté + JSON Schema introspection).
Build vert (security + http). Legacy Factory/Provider/stubs supprimés.

⬜ Reste S1 : **câblage http-kernel** (`firewall.handleSecurity()` + hook `beforeResolve`) → memory.test ;
tests (Zod/RoleHierarchy/Zero Trust) ; authenticators (S2+).

## Interdits

- Importer `@nodefony/http`/`@nodefony/framework` **runtime** (type-only OK) sauf via le pattern existant.
- `any`, `@ts-ignore`, `require()`. Allouer dans le hot-path sans lazy.
- Ajouter une dep runtime sans accord (zod validé). Modifier `rollup.config.ts`/`tsconfig.json` sans accord.
- Réintroduire la lib `helmet`, `passport*`, `csrf`, `jsonwebtoken` (supprimées). JWT = `jose` (S3), OAuth = `arctic` (S6).

## Perf — RÈGLE ABSOLUE

Toute modif du firewall/pipeline = lazy alloc + cleanup listeners + **memory.test** avant commit
(`@nodefony/http` `.mocharc.load.json --grep Memory`). `isSecure` court-circuite si 0 zone.
