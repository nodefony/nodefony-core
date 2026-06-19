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
    ├── firewall.ts            isSecure (hot-path) + handleSecurity (auth→ALS→Zero Trust) + enforceCsrf + handleCors
    ├── csrf.ts                Csrf — Fetch Metadata + repli Origin (logique pure, J5)
    ├── cors.ts                Cors — preflight/actual headers, reflet origine + Vary (logique pure, J5)
    └── securityHeaders.ts     SecurityHeaders — CSP/Referrer/COOP/COEP/CORP (applicatif ; transport=http, J5)
```

## État (S1→J9 livrés ; J5 CSRF étape 1 livrée ; P6.12 API Keys livré)

✅ Fondation S1 + authenticators (Anonymous/Password/Session/JWT/**apikey**) + Argon2id + throttle NIST +
session BFF (J3) + JWT jose (J4) + WebAuthn/passkeys (J9) + OAuth2 social (J9) + **CSRF J5 étape 1** +
**API Keys/PAT (P6.12)** : `ApiKeyAuthenticator` + `ApiKeyService` (bearer opaque `nf_…`+CRC, `sha256` au
repos, store partagé JWT, endpoints session-protégés, anti-énum/anti-DoS). Détail : `MEMORY.md` + kit P6.

✅ **CSRF (J5)** : `Csrf` (Fetch Metadata `Sec-Fetch-Site` PRIMAIRE + repli `Origin`/`Referer`), flag
`strictSameSite`, liste `trustedOrigins` (alias multi-domaine). Câblé `Firewall.enforceCsrf()` → http-kernel
(global, rejet précoce). Gates : security 281, banc intégration live `http/csrf.test.ts` 11/11, mémoire 9/9.

✅ **CORS (J5, P6.2)** : `Cors` (Fetch Standard — preflight/actual, reflet origine + `Vary`, `*`+credentials
INTERDIT au boot). `Firewall.handleCors()` câblé **EN TÊTE de `handleHttp` avant le routing** (le preflight n'a
pas de route → 405 sinon). Gates : security 293, banc live `http/cors.test.ts` 6/6, mémoire 9/9.

✅ **En-têtes (J5, étape A)** : **séparation transport/applicatif** (raison vérifiée : http pose nosniff/frame/HSTS
à `onHttpRequest` → couvre statics+erreurs ; security ne ré-émet PAS). `SecurityHeaders` émet CSP statique +
Referrer-Policy + COOP/COEP/CORP/OAC/Permissions ; `Firewall.applySecurityHeaders()` câblé `handleHttp`. **DX** :
`referrerPolicy` → enum W3C, et `declare module NodefonyModuleConfig` → `use()` complète clés+valeurs. Gates :
security 303, banc live `http/security-headers.test.ts` 7/7, mémoire 9/9.

⬜ Reste J5 : **CSP nonce par requête** (étape B — pont template/Vite, cf `csp_vite`). Étape 2 CSRF :
décorateurs `@CsrfProtect` (token synchronizer HMAC) + `@CsrfExempt` (+ per-controller `trustedOrigins`/`@Domain`).

## Interdits

- Importer `@nodefony/http`/`@nodefony/framework` **runtime** (type-only OK) sauf via le pattern existant.
- `any`, `@ts-ignore`, `require()`. Allouer dans le hot-path sans lazy.
- Ajouter une dep runtime sans accord (zod validé). Modifier `rollup.config.ts`/`tsconfig.json` sans accord.
- Réintroduire la lib `helmet`, `passport*`, `csrf`, `jsonwebtoken` (supprimées). JWT = `jose` (S3), OAuth = `arctic` (S6).

## Perf — RÈGLE ABSOLUE

Toute modif du firewall/pipeline = lazy alloc + cleanup listeners + **memory.test** avant commit
(`@nodefony/http` `.mocharc.load.json --grep Memory`). `isSecure` court-circuite si 0 zone.
