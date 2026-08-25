# @nodefony/security

Couche de sécurité de Nodefony.

Firewall par zones, authentication (pattern `IAuthenticator`), autorisation (rôles + voters),
CORS, CSRF, en-têtes de sécurité, JWT, clés API, WebAuthn/passkeys, OAuth2 social, 2FA TOTP,
webhooks signés, audit persistant. **Modèle d'identité hybride**, **Zero Trust** par défaut.
Consomme [`@nodefony/user`](../user).

> **Statut** : cœur livré — firewall + zones, session serveur (NIST), JWT (`jose`), WebAuthn,
> OAuth2 social, CSRF/CORS/en-têtes natifs, clés API/PAT, 2FA TOTP, webhooks, audit persistant,
> rate-limit, **voters d'autorisation** (`RoleVoter` + `ScopeVoter`, jury affirmatif à véto
> `DENY`, découverts au boot par le `voterRegistry`) et les décorateurs **`@IsGranted`** et
> **`@CsrfProtect`**, appliqués par le `Resolver` avant l'action.
>
> Reste : ACL fine par ressource (niveau B de `authorization.ts`), journal d'authentification
> dédié, `rpId` WebAuthn dérivé du `Host` (multi-vhost), `MTlsAuthenticator` (niche). Le serveur
> d'autorisation OAuth 2.1 est tranché **après** la 10.0.0.

## Principes

- **Pattern `IAuthenticator`** (supports / authenticate / onSuccess) — pas de Bridge/Factory.
- **Zero Trust** : une zone protégée sans utilisateur authentifié → `401`.
- **Identité hybride** (révisé 2026-06-06) : le **web/Studio** ouvre une **session serveur**
  (cookie opaque BFF, révocable, `HttpOnly; Secure; SameSite`) ; les **API/agents** portent leur
  preuve à chaque requête (**JWT** signé / clé API). Jamais « full stateless » : la session reste
  la fondation web (révocation immédiate), le JWT est réservé au sans-état machine-à-machine.
- **Config type-safe** : schéma **Zod** (18 sections, tout `enabled`), **introspectable** (Studio
  génère son formulaire d'édition). L'app configure via `use("@nodefony/security", { … })`.
- **En-têtes natifs** (sans la lib `helmet`) — 0 dépendance, nonce CSP par requête.

## Configuration

La sécurité se configure dans le **`nodefony.config.ts`** de l'app via `use()` — colocalisée
avec le chargement du module, jamais dans un fichier séparé :

```ts
// nodefony.config.ts
import { defineConfig, use } from "nodefony";

export default defineConfig((ctx) => ({
  modules: [
    "@nodefony/http",
    "@nodefony/framework",
    use(
      "@nodefony/security",
      {
        // Hiérarchie de rôles (RBAC) — ROLE_X hérite des rôles listés (DFS au boot).
        roleHierarchy: { ROLE_ADMIN: ["ROLE_USER"] },
        // Zones firewall — clé = nom de zone, valeur = pattern + authenticators.
        areas: {
          // Web/Studio : session serveur (cookie opaque BFF).
          admin: { pattern: "^/admin", authenticators: ["session"] },
          // API machine-à-machine : preuve à chaque requête, aucune session.
          "api-m2m": {
            pattern: "^/api",
            authenticators: ["jwt", "apikey"],
            stateless: true,
          },
        },
      },
      { policy: "mandatory" }, // sécurité = requise dès qu'on sert du trafic
    ),
  ],
}));
```

> Une zone se déclare idéalement **par module** (override `module-security`, dans la config du
> module) pour vivre au plus près de ses routes. Authenticators fournis : `anonymous`, `session`,
> `userpassword`, `jwt`, `apikey`, `webauthn`, plus les providers OAuth2. La chaîne est validée
> au boot (`mode: "first"` par défaut = le premier qui reconnaît authentifie ; `"all"` = tous
> requis, ex. mTLS + JWT). Config invalide → firewall **fail-closed** (tout rejeté).

Toutes les sections (`cors`, `csrf`, `headers`, `rateLimit`, `jwt`, `apiKeys`, `webhooks`,
`audit`, `studio`…) ont des **défauts sûrs** et sont **désactivables** via `enabled`.
Voir [`nodefony/config/config.ts`](./nodefony/config/config.ts) — chaque option y est
documentée (explication + défaut + reco).

### Sections

<!-- prettier-ignore -->
| Section | Rôle | Défaut |
| --- | --- | --- |
| `encoders` | hash mot de passe | Argon2id (OWASP) ; bcrypt legacy |
| `roleHierarchy` | héritage de rôles | `{}` (plats) |
| `areas` | zones firewall (pattern + host + authenticators) | `{}` (aucune route protégée) |
| `cors` | Cross-Origin | strict (jamais `*`+credentials) |
| `csrf` | Fetch Metadata (`Sec-Fetch-Site`) + repli Origin (OWASP 2025) | activé ; `strictSameSite:false`, `trustedOrigins:[]` |
| `headers` | HSTS/CSP+nonces/frameguard/noSniff… (natif) | activé ; avancés (COOP/COEP/CORP…) en option |
| `rateLimit` | anti brute-force + lockout | activé |
| `jwt` | jetons API/agents (sans-état) | EdDSA, access 15 min / refresh 7 j, rotation |
| `apiKeys` | clés API (PAT) hashées | préfixe `nf`, expiry 90 j |
| `webhooks` | sortants signés HMAC | anti-replay + anti-SSRF |
| `audit` | journal sécurité (append-only) | activé, stream Studio |
| `studio` | durcissement console admin | **OFF**, `localhost` (durcissement réservé) |

### CSRF — Fetch Metadata d'abord

La défense CSRF est **globale** (toute requête qui modifie l'état : `POST`/`PUT`/`PATCH`/`DELETE` ;
les méthodes sûres `GET`/`HEAD`/`OPTIONS` ne sont jamais bloquées). Trois couches, dans l'ordre :

1. **`Sec-Fetch-Site`** (défense primaire) — le navigateur tamponne lui-même la provenance de la
   requête, un script attaquant ne peut pas la falsifier. `same-origin` et `none` (navigation directe
   ou client non-navigateur) passent ; `cross-site` est **rejeté en 403**.
2. **Repli `Origin`/`Referer`** — pour les vieux navigateurs sans `Sec-Fetch-*` : l'origine doit
   correspondre à l'hôte de l'app. Ni l'un ni l'autre (client non-navigateur) → autorisé (hors vecteur).
3. **Cookie `SameSite=Lax`** — défense en profondeur sur le cookie de session.

```ts
csrf: {
  strictSameSite: false,            // true → bloque aussi les sous-domaines (same-site) : multi-tenant
  trustedOrigins: ["https://app.example.org"], // alias multi-domaine légitimes (autorisés même cross-site)
}
```

> `trustedOrigins` est **distinct** de `cors.origins` : déclarer un simple alias de domaine ne doit pas
> ouvrir la lecture CORS des réponses au JavaScript tiers. Une origine listée dans `cors.origins` est
> toutefois aussi acceptée (ce que CORS autorise explicitement n'est pas du CSRF).

Le token synchronizer renforcé (`@CsrfProtect` / `@CsrfExempt`) arrive à l'étape suivante.

### CORS — l'inverse du CSRF

CORS **assouplit** la Same-Origin Policy : il autorise un site tiers à _lire_ la réponse de l'app en
JavaScript (le CSRF, lui, _empêche_ un tiers de déclencher une mutation). La politique est globale :

- **Preflight** `OPTIONS` (Fetch Standard) court-circuité **avant le routing** → `204` + en-têtes
  `Access-Control-Allow-*`. Il ne s'authentifie jamais (il ne porte pas de credentials).
- **Origine autorisée** → l'origine est **reflétée** (`Access-Control-Allow-Origin: <origine>` + `Vary: Origin`).
  `*` n'est émis que sans `credentials`. Origine non autorisée → aucun en-tête (le navigateur bloque).
- **`origins:["*"]` + `credentials:true` est refusé au démarrage** (refine Zod) : le navigateur l'interdit,
  et c'est une faille classique. Pour les credentials, lister les origines explicitement.

### Introspection (Studio)

```ts
import { securityConfigJsonSchema } from "@nodefony/security";
const schema = securityConfigJsonSchema(); // JSON Schema → formulaire d'édition Studio
```

## Journal d'audit (événements de sécurité)

Le journal trace les **transitions d'état** de sécurité (login, refus, jeton émis/révoqué, verrou
WS) — distinct du log de trafic (1 PDU/requête). Émission **explicite** par point sensible ; le
**chemin de succès reste muet** (le volume n'est pas un signal), seul l'échec/refus émet (cold-path)
→ aucun coût ajouté au hot-path nominal. Activé par défaut (`audit.enabled`, OWASP A09), coût nul si
désactivé. Lecture : `GET /nodefony/security/api/audit/events` (RBAC `ROLE_NODEFONY_ADMIN`).

**Flux temps réel** (lot 4) : canal WS **`nodefony:audit`**, réservé `ROLE_NODEFONY_ADMIN`
(plancher système, un cran au-dessus de l'observabilité générique `ROLE_ADMIN`). Enregistré comme
**canal système** sur le hub realtime (servable par tout endpoint, sans couplage à Studio) ;
**lazy** : le pont ne s'abonne au journal qu'au 1ᵉʳ auditeur connecté et s'en détache au dernier.
Coalescé (1 frame `{ events, dropped }` toutes les ~250 ms, ring borné) → un pic d'échecs sous
attaque ne noie pas la console. Un user non habilité qui tente de s'y abonner est refusé **et audité**
(`frame.denied`).

Un **secret n'entre jamais** dans un événement — seule sa _présence_ est tracée (`flags`).

| `action`               | `category` | `outcome` | Émis par                         |
| ---------------------- | ---------- | --------- | -------------------------------- |
| `login.success`        | `auth`     | success   | `AuthFlow` (BFF) / fédéré        |
| `login.failure`        | `auth`     | failure   | `AuthFlow`, `TokenService` grant |
| `login.throttled`      | `auth`     | failure   | `AuthFlow`, `TokenService` grant |
| `logout`               | `session`  | success   | `AuthFlow`                       |
| `auth.failure`         | `auth`     | failure   | `Firewall` (credential invalide) |
| `auth.throttled`       | `auth`     | failure   | `Firewall` (backoff NIST)        |
| `auth.denied`          | `auth`     | denied    | `Firewall` (Zero Trust)          |
| `access.denied`        | `authz`    | denied    | `Authorization` (voters/RBAC)    |
| `frame.denied`         | `ws`       | denied    | verrou de frame WS               |
| `token.issued`         | `token`    | success   | `TokenService`                   |
| `token.reuse_detected` | `token`    | denied    | `TokenService` (RFC 9700)        |
| `apikey.created`       | `token`    | success   | `ApiKeyService`                  |
| `apikey.revoked`       | `token`    | success   | `ApiKeyService`                  |

## Erreurs

- `AuthenticationError` → `401` (non authentifié).
- `AccessDeniedError` → `403` (authentifié mais non autorisé).

## Licence

CeCILL-B — Christophe CAMENSULI.
