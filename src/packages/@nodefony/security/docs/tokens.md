---
title: "Tokens — émission, clés (keystore), rotation et révocation"
navTitle: Tokens
lang: fr
module: "@nodefony/security"
topic: tokens
coverageModule: security
coverageFiles: "tokenService,JwtKeystore,MemoryTokenStore,jwtRuntime,tokenStoreRegistry"
section: "Sécurité"
audience: [developer, devops]
tags:
  [
    security,
    jwt,
    tokens,
    refresh,
    keystore,
    jwks,
    rotation,
    revocation,
    pagination,
    rfc9700,
    rfc6749,
    ed25519,
  ]
version: "doc"
status: stable
updated: 2026-10-05
source: "src/packages/@nodefony/security/docs/tokens.md"
---

# Tokens — émission, clés, rotation et révocation

> Les authenticators _vérifient_ des jetons ; cette page décrit leur **face émission** : comment
> Nodefony signe un access token JWT, gère la **clé** (keystore Ed25519 + JWKS), fait **tourner** les
> refresh tokens avec détection de rejeu (RFC 9700), et **révoque** — au-dessus d'un `ITokenStore`
> pluggable (memory/drizzle/mongoose/redis) désormais **paginé** pour l'admin. Ancré sur
> `src/packages/@nodefony/security/nodefony/service/tokenService.ts` et `nodefony/src/token/`.

📍 [Documentation](../../../../../docs/index.md) › [Sécurité](index.md) › **Jetons**

## 🧠 Le modèle mental — émission, rotation, révocation

```mermaid
flowchart TD
  CLI["POST /nodefony/security/api/token<br/>{username, password, scope?}"] --> VER["users.authenticate<br/>(+ throttle NIST)"]
  VER --> ISS["issueTokens"]
  ISS --> AT["access token<br/>JWT EdDSA, typ at+jwt, 15 min"]
  ISS --> RT["refresh token<br/>secret opaque nfr_…, stocké HACHÉ"]
  RT --> ST[("ITokenStore<br/>memory · drizzle · mongoose · redis")]
  AT -.->|kid| KS["JwtKeystore<br/>Ed25519 · JWKS public"]
  REF["POST …/api/token/refresh<br/>{refresh_token}"] --> ROT{"déjà révoqué ?"}
  ROT -->|"oui = rejeu"| FAM["revokeFamily<br/>toute la famille coupée"]
  ROT -->|non| NEW["rotation : nouveau couple<br/>ancien chaîné + révoqué"]
```

## 📖 Lexique

| Terme           | Sens                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Access token    | JWT court (15 min) signé EdDSA, porté en `Authorization: Bearer` — jamais en cookie/URL.            |
| Refresh token   | Secret opaque longue durée (`nfr_…`), stocké **haché**, échangé contre un nouvel access.            |
| PAT             | _Personal Access Token_ (clé API) — même store, autre page ([authenticators](./authenticators.md)). |
| Grant           | Échange d'un credential (identifiant/mot de passe) contre un couple access+refresh.                 |
| Keystore        | Gestionnaire des clés de signature Ed25519 + du JWKS public.                                        |
| JWKS            | _JSON Web Key Set_ : les clés **publiques** exposées pour vérifier les signatures.                  |
| `kid`           | Identifiant de clé (empreinte) posé dans l'en-tête du JWT → sélection de la bonne clé.              |
| `jti`           | Identifiant unique d'un JWT — clé de la denylist de révocation ciblée.                              |
| Rotation        | Émettre un nouveau refresh à chaque usage et révoquer l'ancien (RFC 9700).                          |
| Famille         | Chaîne de refresh liés par rotation ; un rejeu coupe toute la famille.                              |
| Downscoping     | Les scopes ne **montent** jamais le long d'une chaîne de refresh.                                   |
| `invalidBefore` | Seuil par porteur : tout access émis avant cet instant est rejeté (révocation en masse).            |

## Qu'est-ce que ce système résout — la faille

Un JWT est **auto-porté** : le serveur peut le vérifier sans état. Génial pour la scalabilité,
dangereux pour la révocation — un jeton volé reste valide jusqu'à son expiration si rien ne le suit
côté serveur. Deux attaques concrètes :

- le **vol de refresh token** — l'attaquant le rejoue pour obtenir des access frais indéfiniment ;
- l'**absence de révocation** — bannir un compte ne coupe pas ses jetons déjà émis.

Nodefony répond par un **store de vérité côté serveur** (denylist `jti` + `invalidBefore` + rotation
avec détection de rejeu) et une **gestion de clé** qui ne génère jamais de secret en clair « par
défaut » en prod.

## La vision Nodefony — un service propriétaire, des endpoints minces

`TokenService` est **propriétaire** du store et du keystore : à `TokenService.#build()`
(`tokenService.ts:158`), si `jwt.enabled` ou `apiKeys.enabled`, il résout le store pluggable, pose
`tokenStore` au container (`tokenService.ts:219`) puis crée le keystore et pose `jwtKeystore`
(`tokenService.ts:225-231`) — consommés par le `JwtAuthenticator` et les endpoints. Il arme un
**gc** via `GcScheduler` (timer `unref` + **jitter** de phase pour étaler les balayages entre pods,
`tokenService.ts:233-239`).

Les endpoints HTTP sont des **adaptateurs minces** portés par `@nodefony/framework`, couplés **par
nom de service** via le contrat structurel `ITokenIssuer` — framework n'importe jamais security
(`TokenAuthController.ts:11-22`).

Constat clé de cohérence : `iss`/`aud`/`ttl` sont dérivés **une seule fois** par
`resolveJwtRuntime()` (`jwtRuntime.ts:30-41`) et **partagés** entre l'émetteur et le vérificateur —
une divergence ferait tout rejeter. Fonction pure : les deux côtés obtiennent la même valeur sans la
partager par référence. `issuer` omis → `"nodefony"` (`jwtRuntime.ts:31`), à surcharger en prod.

### Être DÉCOUVRABLE — publier ses clés (RFC 8414)

Tant que Nodefony émet **et** vérifie ses propres jetons, `iss` n'est qu'une chaîne comparée à
elle-même. Dès qu'un **tiers** doit valider une signature émise ici (une autre application
Nodefony, un agent, un service), il lui faut deux documents publics :

| Route                                         | Contenu                                                        |
| --------------------------------------------- | -------------------------------------------------------------- |
| `GET /.well-known/oauth-authorization-server` | `issuer`, `jwks_uri` — RFC 8414 §2 (chemin **non négociable**) |
| `GET /.well-known/jwks.json`                  | clés publiques de signature (jamais `d`)                       |

Les deux sont montées par `@nodefony/framework` (`IssuerMetadataController.ts`) **uniquement si**
`TokenService.publishedIssuer()` répond — soit `jwt.enabled`, `jwt.jwks`, **et** `jwt.issuer` écrit
sous forme d'URL https. Sinon : aucune route (`404`) et un avertissement au boot.

🔴 **L'URL ne se devine pas.** Derrière un relais (HAProxy, ingress, CDN), `Host` et
`X-Forwarded-*` viennent de la requête, donc du client : un document dérivé de l'en-tête ferait
servir, par le vrai serveur, l'identité d'un attaquant — et empoisonnerait tout cache mutualisé.
L'exploitant l'écrit, comme il écrit son domaine (`NF_JWT_ISSUER` dans `env.ts`).

```ts
use("@nodefony/security", { jwt: { issuer: ctx.env.NF_JWT_ISSUER } });
```

Le document publié n'annonce **aucun** flux d'autorisation (`response_types_supported: []`,
`grant_types_supported: []`) : Nodefony n'est pas un serveur d'autorisation OAuth 2.1, elle rend
seulement ses signatures vérifiables. Omettre `grant_types_supported` annoncerait
`["authorization_code", "implicit"]` par défaut (RFC 8414 §2) — deux flux inexistants.

## 🚀 Démarrage rapide

### Les endpoints d'émission sont FOURNIS

Dans une app `nodefony create app`, dès que le module security est chargé avec `jwt.enabled` (défaut),
le framework monte deux routes (`mountTokenAuthRoutes()`, `TokenAuthController.ts:161-176`) :

- `POST /nodefony/security/api/token` — body `{username, password, scope?}` → couple access/refresh ;
- `POST /nodefony/security/api/token/refresh` — body `{refresh_token}` → rotation.

> [!IMPORTANT]
> Ces routes n'existent **que si** `@nodefony/security` est chargé — sinon 404, zéro surface
> (`framework/index.ts:415`). Module chargé mais JWT désactivé : elles existent et répondent
> `503 Token issuance unavailable` (`TokenAuthController.ts:69`). Elles sont `bypassFirewall: true` (`TokenAuthController.ts:188`) :
> elles SONT le mécanisme d'émission — protégées, obtenir un token exigerait d'être déjà
> authentifié (deadlock). Le JWT part en **réponse JSON** (Bearer), jamais en cookie ni en URL.

### La config : une zone protégée par `jwt` + une clé qui survit au redémarrage

```typescript
// nodefony.config.ts (extrait) — la zone API machine + la source de clé
use("@nodefony/security", {
  jwt: {
    // dev : persiste la clé Ed25519 sous var/ (sinon clé ÉPHÉMÈRE + warning).
    // prod : NF_JWT_KEYSET, la même clé sur tous les pods — voir la section keystore.
    keystore: {
      keySetJson: process.env.NF_JWT_KEYSET,
      dir: "var/keys",
    },
  },
  areas: {
    // Le firewall vérifie le Bearer JWT sur CHAQUE requête de la zone.
    api: { pattern: "^/api/v1", authenticators: ["jwt"] },
  },
});
```

### Ce que TU écris : le controller scopé

```typescript
// nodefony/controllers/OrdersController.ts — complet, compile tel quel
import {
  controller,
  Controller,
  Get,
  RequireScope,
  CurrentUser,
} from "@nodefony/framework";
import type { IUser } from "@nodefony/user";

@controller("/api/v1/orders")
class OrdersController extends Controller {
  // Zone `api` : le firewall a déjà validé le JWT (signature, exp, aud/iss,
  // denylist, sujet actif). @RequireScope borne ce que la CLÉ a le droit de
  // faire — un token émis sans `orders:read` reçoit 403, même sujet valide.
  @RequireScope("orders:read")
  @Get("/list")
  async list(@CurrentUser() user: IUser) {
    return this.renderJson({ subject: user.identifier, orders: [] });
  }
}

export default OrdersController;
```

### Ce qu'on observe

```bash
# 0) Un compte (mot de passe demandé MASQUÉ — jamais en dur dans un script)
npx nodefony security:user:add ci-bot

# 1) Grant : credential → couple access/refresh (réponse RFC 6749 §5.1)
curl -s -H 'Content-Type: application/json' \
  -d "{\"username\":\"ci-bot\",\"password\":\"$NF_PASS\",\"scope\":\"orders:read\"}" \
  http://localhost:5151/nodefony/security/api/token
# {"access_token":"eyJ…","refresh_token":"nfr_…","token_type":"Bearer",
#  "expires_in":900,"scope":"orders:read"}

# 2) L'access token en Bearer → 200 (zone api, scope vérifié)
curl -s -H "Authorization: Bearer $ACCESS" \
  http://localhost:5151/api/v1/orders/list
# {"subject":"ci-bot","orders":[]}

# 3) Rotation : le refresh → NOUVEAU couple (l'ancien refresh est révoqué)
curl -s -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH\"}" \
  http://localhost:5151/nodefony/security/api/token/refresh

# 4) Rejouer l'ANCIEN refresh → 401 {"error":"invalid_grant"} + famille coupée
```

Erreurs mappées par duck-typing dans `#renderAuthError()` (`TokenAuthController.ts:108-120`) :
401 message uniforme `invalid_grant` (anti-énumération), 429 avec `Retry-After` du throttler NIST.
Émission indisponible (JWT désactivé, store absent) → 503 `isEnabled()`
(`TokenAuthController.ts:67-69`).

## 🏗️ Architecture interne — la vie d'un couple access/refresh

### Émission (grant M2M/CLI)

`issueForCredentials()` (`tokenService.ts:387`) vérifie l'identifiant/mot de passe via le
service `users`, avec le **throttling NIST partagé** — `ThrottledError` avant tout hachage
(`tokenService.ts:398`). Chaque tentative échouée est auditée `login.failure`/`login.throttled`
par `#auditGrant()` (`tokenService.ts:414-426`). Puis `issueTokens()` (`tokenService.ts:582`)
produit :

- un **access token** : JWT signé EdDSA, en-tête `typ:"at+jwt"` + `kid`, claims
  `iss`/`sub`/`aud`/`exp` (15 min) + `jti` — `#signAccess()` (`tokenService.ts:694-707`) ;
- un **refresh token** : secret opaque haute entropie `nfr_<32 octets base64url>`, **stocké haché**
  `sha256` (le clair n'existe qu'en réponse, jamais au repos) — `#buildRefresh()`
  (`tokenService.ts:726-761`).

La réponse suit RFC 6749 §5.1 — `ITokenResponse` (`tokenService.ts:50-58`). Tout succès est audité
`token.issued` via `recordAudit` avec le `tokenId` corrélable (`tokenService.ts:357-363`).

### Rotation & détection de rejeu (RFC 9700 §4.14)

`refresh()` (`tokenService.ts:647`) est le cœur défensif, dans l'ordre :

1. Lookup par hash — `findByHash`, refus uniforme si inconnu/mauvais type (`tokenService.ts:653`).
2. **Détection de rejeu** : refresh **déjà révoqué** re-présenté → `revokeFamily` coupe toute la
   famille + audit `token.reuse_detected`, signal d'attaque fort (`tokenService.ts:622-636`).
3. Expiration `expiresAt` vérifiée (`tokenService.ts:793`).
4. **Sujet revérifié** — compte disparu/inactif/verrouillé rejeté sans attendre l'exp,
   `#resolveUserForRefresh()` (`tokenService.ts:852`).
5. **Downscoping** : les `scopes` du nouveau couple sont ceux de l'ancien, jamais plus
   (`tokenService.ts:684`).
6. **Rotation** : nouveau refresh (même famille), l'ancien chaîné `replacedBy` + révoqué
   `"rotated"` (`tokenService.ts:716-718`). Si `rotateRefresh` est désactivé, l'access est réémis
   et le refresh courant reste valide (`tokenService.ts:702`).

### Mise en situation — ton refresh token a été volé

Besoin vécu : le refresh d'un poste compromis est exfiltré. Rotation active (défaut) — voici ce que
chacun vit, requête par requête :

| #   | Qui présente quoi               | Ce que fait `refresh()`                                     | Résultat client                     |
| --- | ------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| 1   | Client légitime → refresh R1    | rotation : R2 émis, R1 révoqué `rotated`                    | 200, nouveau couple                 |
| 2   | Voleur → R1 (volé, déjà tourné) | R1 révoqué re-présenté = **rejeu** → famille entière coupée | 401 `invalid_grant`                 |
| 3   | Client légitime → R2            | famille coupée : R2 est révoqué aussi                       | 401 → se reconnecte (nouveau grant) |

Si le **voleur joue en premier**, la rotation lui répond normalement (le serveur ne peut pas encore
le distinguer) — mais dès que le légitime rejoue son vieux refresh, le rejeu est détecté et le
voleur perd aussi son couple. Dans les deux ordres, **l'attaque est bornée à une fenêtre courte** et
la victime est déconnectée (signal visible) au lieu d'un vol silencieux indéfini.

## 🔐 Le keystore Ed25519 — la clé ne fuit pas, pas de secret « par défaut » en prod

`JwtKeystore.#load()` résout la source de clé par **priorité** (`JwtKeystore.ts:219`), pensée
pour ne jamais auto-générer une clé en clair silencieusement en prod :

1. **env** — `keySetJson` (`NF_JWT_KEYSET` dans une application générée) : la MÊME clé pour tous
   les process qui servent l'application (`JwtKeystore.ts:222`).
2. **fichier** — `dir/keyset.json`, généré si absent, en mode 600, par une création **exclusive**
   (`createSecretExclusive`, `secretFile.ts:188`) : quand plusieurs workers de `nodefony cluster`
   démarrent ensemble, un seul crée la clé et les autres relisent la sienne (`JwtKeystore.ts:242`).
   Source de développement, ou d'un serveur unique à disque persistant.
3. **mémoire** — aucune source → clé **éphémère**, propre au process (`JwtKeystore.ts:263`). En
   développement : un WARNING au premier jeton. En production, un process qui sert **refuse de
   démarrer** (§ suivant).

Le JWKS servi par `getPublicJWKS()` est **public** — `JwtKeystore.ts:209`.
La composante privée `d` en est retirée à l'import, par liste BLANCHE de paramètres
(`#importKeyset()`, `JwtKeystore.ts:275`, RFC 8037/7517).
C'est ce JWKS qu'utilise le vérificateur local (`createLocalJWKSet`, `JwtAuthenticator.ts:174`),
jamais une clé venue du jeton. Le chargement est mémoïsé — `#ensureLoaded()` (`JwtKeystore.ts:215`).

### Plusieurs pods ou workers — UNE clé pour tous

Chaque jeton porte le `kid` de la clé qui l'a signé. Deux process qui ont chacun la leur refusent
les jetons l'un de l'autre : derrière un répartiteur, l'utilisateur est déconnecté au hasard (401),
et tout redémarrage invalide les jetons en vol.

**En production, un process qui SERT sans source partagée refuse de démarrer**
(`#requireSharedSigningKey`, `tokenService.ts:123`), avec le motif et les trois issues dans le
journal. Une commande de console (`orm:migrate`, `security:user:add`) n'est pas concernée : elle
ne signe aucun jeton. Sous `nodefony cluster`, un worker refusé ne se relance pas — le master
arrête le cluster et sort en **78** (`ClusterManager.ts:212`), le code d'une faute de configuration.

Le déploiement, de bout en bout :

```bash
# 1. Générer la valeur UNE fois par environnement (staging ≠ production)
npx nodefony security:secrets --jwt-keyset > keyset.json

# 2. La ranger dans le gestionnaire de secrets — ici un Secret Kubernetes
kubectl create secret generic app-jwt --from-file=NF_JWT_KEYSET=keyset.json
rm keyset.json   # elle porte la clé PRIVÉE : aucun exemplaire ne traîne

# 3. L'injecter dans CHAQUE pod (extrait du Deployment)
#   env:
#     - name: NF_JWT_KEYSET
#       valueFrom: { secretKeyRef: { name: app-jwt, key: NF_JWT_KEYSET } }
```

Le câblage, que le gabarit d'application écrit déjà :

```typescript
jwt: {
  keystore: {
    keySetJson: ctx.env.NF_JWT_KEYSET, // présente : l'emporte partout
    dir: ctx.isProd ? undefined : "var/keys", // développement
  },
},
```

- **Jamais dans un fichier du poste, jamais dans git** : en développement la clé vit dans `var/keys/` ;
  une clé privée de production sur un poste n'apporte que le risque de fuir.
- **Dans un fichier `.env`** (Docker Compose `env_file`), l'entourer de quotes simples :
  `NF_JWT_KEYSET='{"active":"…","keys":[…]}'`.
- **Valeur illisible** : la configuration security est refusée au démarrage, le chemin
  `jwt.keystore.keySetJson` nommé, la valeur **jamais** recopiée dans le message.
- **Rotation** : la valeur est STABLE — la remplacer refuse les jetons en vol. Ajouter la nouvelle
  clé au tableau `keys`, la désigner dans `active`, garder l'ancienne le temps que ses jetons
  expirent (`accessTtlS`, `refreshTtlS`), puis la retirer.

## 🧩 Le store pluggable — durable par défaut, jamais de faux durable silencieux

### Le contrat et l'enregistrement

Le `tokenStore` héberge **trois structures** : les records (refresh + PAT), la denylist `jti` et le
seuil `invalidBefore` par porteur (`ITokenStore.ts:11-15`). Les backends s'enregistrent par
fabrique — `registerTokenStore()` (`tokenStoreRegistry.ts:41-46`) : les adapters lourds importent
`import type { ITokenStore }` (effacé à la compilation), zéro couplage runtime.

Sa résolution au boot (`tokenService.ts:156-207`) suit la doctrine `store:"auto"` du framework :

- `auto` (défaut) → suit l'infra database déclarée via `resolveAutoStore` — **borné aux backends
  réellement enregistrés**, repli memory **annoncé** (`tokenService.ts:160-168`) ;
- store explicite **inconnu** → en prod, **boot avorté** (fail-loud) ; en dev, brique désactivée et
  annoncée avec la liste `listTokenStores()` (`tokenService.ts:171-182`) — jamais de fallback
  memory silencieux pour du durable ;
- store `memory` **en prod** → `WARNING` nommant l'impact : denylist/refresh/clés API per-pod et
  volatils, révocation non partagée (`tokenService.ts:186-193`).

La décision (configuré → résolu, raison) est publiée au kernel par `registerStoreResolution()`
(`tokenService.ts:195-204`) — visible dans Studio.

### Mise en situation — quel store pour quelle app ?

| Ta situation                                        | Store            | Pourquoi                                                              |
| --------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| Dev / tests mono-process                            | `memory` (auto)  | 0 dépendance ; volatil — un redémarrage déconnecte tout le monde      |
| Prod, base SQL déclarée (`NF_DATABASE_URL`)         | `auto` → drizzle | durable + partagé entre pods : révocation et rejeu vus PARTOUT        |
| Prod, MongoDB                                       | `mongoose`       | même contrat, même banc, sur Mongo                                    |
| Flotte de pods, Redis déjà présent, denylist chaude | `redis`          | TTL natif, lecture O(1) ; listing par curseur SCAN (capacité réduite) |
| Prod **sans** infra durable                         | ❌ `memory`      | ça boote, mais WARNING mérité : la révocation ne traverse pas un pod  |

### Les backends (catalogue)

### `memory` — la référence 0 dépendance

- Builtin, enregistré à l'import du module via `registerTokenStore` (`tokenStoreRegistry.ts:63-68`).
- `listPage` : tri `createdAt` DESC + tiebreaker `id`, déterministe pour l'offset — parité SQL
  (`MemoryTokenStore.ts:165-185`).
- Denylist bornée : purge **amortie** tous les 256 ajouts — `#maybeSweep()`
  (`MemoryTokenStore.ts:393`) + expiration paresseuse à la lecture. Pas de minuterie, pas de fuite.
- `snapshot()`/`restore()` sérialisables — base d'une persistance fichier, index reconstruits
  (`MemoryTokenStore.ts:324-354`).
- Volatil, par-process : dev/tests. Pilote le banc de contrat commun.

### `drizzle` — SQL, le défaut durable

- Enregistré par le module drizzle (`drizzle/nodefony/registerStores.ts:261`).
- Élu par `store:"auto"` dès qu'une infra database SQL est déclarée ; sinon sqlite local si drizzle
  est chargé (`config.ts:446-451`).
- Pagination **offset + total** (helper `paginate()` d'orm-core) ; e2e sur PostgreSQL et MySQL réels.

### `mongoose` — MongoDB

- Enregistré par le module mongoose (`mongoose/nodefony/registerStores.ts:170`).
- Pagination **offset + total** via `listPage` (`MongooseTokenStore.ts:236-246`).
- Purge par `gc()` explicite sur `expiresAt` (`MongooseTokenStore.ts:170`).

### `redis` — cluster, TTL natif

- Enregistré par le module redis (`redis/nodefony/registerStores.ts:75`).
- TTL natif : `expire()` posé à l'écriture du record (`RedisTokenStore.ts:94`) — l'expiration ne
  dépend pas du gc.
- Listing par `SCAN` : curseur opaque `skip:scanCursor`, `decodeCursor()`
  (`RedisTokenStore.ts:428`) — sans ordre global ni total, capacité réduite **assumée**.
- `countTokens()` renvoie `-1` : un comptage exact exigerait un SCAN complet O(N), refusé
  (`RedisTokenStore.ts:529`).

### Le record — une seule table pour PAT et refresh

`IAccessTokenRecord` (`ITokenStore.ts:69`) est **single-table** : un même schéma porte PAT et
refresh, champs non pertinents à `null`, horodatages epoch ms (`ITokenStore.ts:60-64`). Deux
constats de design :

- `subjectId` est une **référence logique souple, PAS une FK SQL** : porteur polymorphe
  (user/service), store multi-backend, découplage des modules — intégrité assurée à l'usage
  (`ITokenStore.ts:80-95`) ;
- slots prêts sans migration : `resources` (permissions fine-grained façon GitHub) et `cnf`
  (sender-constrained DPoP/mTLS) (`ITokenStore.ts:101-119`).

Les colonnes par dialecte vivent dans la doc de chaque adapter (règle anti-triple-vérité).

### Lister pour l'admin — pagination native

- `listPage()` ne matérialise **jamais** plus d'une page (`ITokenStore.ts:233`) — capacité par
  backend : **offset + total** (SQL/Mongo/mémoire) ou **curseur** (`nextCursor`, Redis).
- `countTokens()` donne le `total` ; Redis répond `-1` (`ITokenStore.ts:238`).
- Filtres portables `ITokenListQuery` : `subjectId`, `kind`, `revoked` (`ITokenStore.ts:154-161`) —
  prédicat partagé `matchesTokenQuery()` (`MemoryTokenStore.ts:11-26`).
- `listAll()` reste réservé au **dump d'incident** cross-porteur, cold-path admin
  (`ITokenStore.ts:222`).
- Consommateur type : le data plane des clés API — `ApiKeyService.listPagePat()`
  (`apiKeys.ts:209`), jamais un listAll matérialisé.

### Révoquer — trois portées

- **Un access** avant son `exp` : denylist `denyJti()`/`isJtiDenied()` (`ITokenStore.ts:251`).
- **Un refresh/PAT** : `revoke()` idempotent, `revokeFamily()` pour la chaîne de rotation
  (`ITokenStore.ts:242`).
- **Tout un porteur** (logout global, ban) : seuil `revokeAllForSubject()` — tout access dont
  `iat < invalidBefore` est rejeté (`ITokenStore.ts:259-263`) ; le seuil est **monotone**, deux
  logouts successifs ne le reculent pas (`MemoryTokenStore.ts:262-267`).

### La maintenance (gc)

Le `gc()` du store purge la `denylist` expirée, les records à terme, les PAT révoqués au-delà de
la rétention (`ITokenStore.ts:274-280`). Orchestré par le `GcScheduler` du service ; `runGc()` reste public pour
un futur worker cron — poser alors `gcIntervalS: 0` (`tokenService.ts:338`).

> [!TIP]
> Un refresh révoqué **par rotation** n'est PAS purgé tout de suite : il est conservé jusqu'à son
> `expiresAt` — c'est la **fenêtre de détection de rejeu** — puis tombe au gc, `#isPurgeable()`
> (`MemoryTokenStore.ts:301-310`). Un store **local** (memory) est par-process : seul SON process
> peut le purger → ne déléguez le gc au cron QUE pour un store partagé.

## ⚙️ Configuration

Tables dérivées du schéma Zod — `jwtSchema` (`config.ts:367-443`) et `tokenStoreSchema`
(`config.ts:444-476`), défauts inclus.

### `jwt.*`

<!-- prettier-ignore -->
| Option | Type | Défaut | Effet |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Active signature + refresh (`config.ts:369`) |
| `alg` | `EdDSA` \| `RS256` | `EdDSA` | `RS256` = slot non câblé (`jwtRuntime.ts:21`) |
| `accessTtlS` | number (s) | `900` | TTL de l'access token — 15 min (`config.ts:371`) |
| `refreshTtlS` | number (s) | `604800` | TTL du refresh — 7 jours (`config.ts:376`) |
| `rotateRefresh` | boolean | `true` | Rotation du refresh à chaque usage, OWASP (`config.ts:381`) |
| `jwks` | boolean | `true` | Publie `/.well-known/jwks.json` + les métadonnées RFC 8414 — sans `issuer` en URL https, rien n'est publié |
| `audiences` | string[] | `[]` | `aud` acceptées (RFC 8707) ; vide = `[issuer]` (`config.ts:397`) |
| `issuer` | string? | — | Claim `iss`, **STABLE** après émission ; omis → repli `"nodefony"`, qui n'est PAS publiable (RFC 8414 §2 exige une URL https) |
| `keystore.keySetJson` | string? | — | JWK Set privé partagé par tous les process (`NF_JWT_KEYSET`) — SECRET, forme vérifiée au démarrage (`security/nodefony/config/config.ts:405`) |
| `keystore.dir` | string? | — | Dossier `keyset.json` chmod 600, création exclusive — dev, ou serveur unique à disque persistant (`config.ts:428`) |

### `tokenStore.*`

| Option                 | Type       | Défaut   | Effet                                                                                 |
| ---------------------- | ---------- | -------- | ------------------------------------------------------------------------------------- |
| `store`                | string     | `"auto"` | `auto`\|`memory`\|`drizzle`\|`mongoose`\|`redis` — pluggable (`config.ts:446-451`)    |
| `gcIntervalS`          | number (s) | `600`    | Purge périodique ; `0` = désactivé — chaque process purge SON store (`config.ts:452`) |
| `gcJitter`             | boolean    | `true`   | Étale le gc d'un délai aléatoire par process — cluster (`config.ts:460`)              |
| `retentionRevokedDays` | number (j) | `30`     | Rétention d'un PAT révoqué SANS expiration avant purge (`config.ts:466`)              |

## 📜 Normes appliquées

| Domaine                          | Norme           | Ancrage                                                 |
| -------------------------------- | --------------- | ------------------------------------------------------- |
| Réponse d'émission               | RFC 6749 §5.1   | `ITokenResponse` (`tokenService.ts:50-58`)              |
| Rotation + détection de rejeu    | RFC 9700 §4.14  | `refresh()` (`tokenService.ts:647`)                     |
| Profil access token `typ:at+jwt` | RFC 9068        | `#signAccess()` (`tokenService.ts:694-707`)             |
| Claims JWT (`iss/sub/aud/exp`)   | RFC 7519        | `#signAccess()` (`tokenService.ts:731-739`)             |
| Ed25519 / JWK / JWKS public      | RFC 8037 · 7517 | `#importKeyset()` (`JwtKeystore.ts:275`)                |
| Audiences liées à la ressource   | RFC 8707        | `audience` du record (`ITokenStore.ts:104-105`)         |
| 429 + `Retry-After`              | RFC 6585        | `#renderAuthError()` (`TokenAuthController.ts:111-118`) |
| Backoff de login                 | NIST SP 800-63B | `ThrottledError` avant hachage (`tokenService.ts:433`)  |

## ⚡ Performance & mémoire

- **`jose` importé lazy** (dep lourde) : `#ensureJose()` au premier usage (`tokenService.ts:826`)
  — le boot ne paie rien si le JWT n'est jamais sollicité ; keystore mémoïsé pareil.
- **Rien sur le hot path requête** : émission et rotation sont des endpoints cold-path ; la
  vérification (hot path) vit chez le `JwtAuthenticator`.
- **Timers civilisés** : `GcScheduler` `unref` (n'empêche pas l'arrêt) + jitter anti-balayages
  simultanés (`tokenService.ts:233-239`) ; denylist mémoire bornée par purge amortie
  (`MemoryTokenStore.ts:331-341`).
- **Jamais N en RAM** : `listPage()` borne toute lecture admin à une page (`ITokenStore.ts:233`).

## 📡 Observabilité — Studio

- **Écran Stores** (`/nodefony/stores`) : la résolution du store de jetons (configuré → résolu +
  raison) publiée par `registerStoreResolution()` (`tokenService.ts:195-204`).
- **Écran Audit** (`/nodefony/audit`) : événements `token.issued`, `token.reuse_detected` (signal d'attaque),
  `login.failure`/`login.throttled` du grant — corrélables par `tokenId`.
- **Écran ApiKeys** : le même store côté PAT, listing paginé serveur.

## ⚠️ Pièges (symptôme → cause → correction)

| Symptôme                                                   | Cause (dans le code)                                           | Correction                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| 404 sur `/nodefony/security/api/token`                     | Module `@nodefony/security` non chargé                         | Charger `@nodefony/security` + `jwt.enabled: true`         |
| 503 « Token issuance unavailable »                         | Service non initialisé (JWT désactivé, store indisponible)     | Vérifier config `jwt`/`tokenStore` + logs de boot          |
| Refresh tokens invalidés à chaque redémarrage              | Keystore en mémoire (aucune source configurée)                 | `NF_JWT_KEYSET` (prod) ou `jwt.keystore.dir` (dev)         |
| Boot refusé « DÉMARRAGE REFUSÉ — aucune clé de signature » | Production, process qui sert, ni `keySetJson` ni `dir`         | `security:secrets --jwt-keyset` → secret → `NF_JWT_KEYSET` |
| Cluster arrêté « cluster master down (exit 78) »           | Un worker a refusé de démarrer (faute de configuration)        | Lire le motif du worker juste au-dessus, le corriger       |
| JWT rejeté après un déploiement multi-pod                  | Clés différentes par pod (pas de clé partagée)                 | La même `NF_JWT_KEYSET` injectée dans chaque pod           |
| Tout rejeté après changement de config                     | `issuer`/`audiences` divergents entre émission et vérification | `issuer` STABLE — ne pas le changer après émission         |
| Révocation sans effet entre pods                           | `tokenStore:"memory"` en prod (per-pod)                        | Store durable (`NF_DATABASE_URL` → drizzle, ou redis)      |
| Reconnexion forcée inattendue                              | Détection de rejeu : un vieux refresh révoqué a été rejoué     | Attendu (anti-vol) — la famille est coupée                 |
| Boot avorté « token store inconnu »                        | `tokenStore.store` explicite introuvable (fail-loud prod)      | Corriger le nom / enregistrer le store                     |
| Scopes qui n'augmentent pas au refresh                     | Downscoping volontaire                                         | Réémettre via un nouveau grant pour élargir                |
| Listing admin sans `total` sur Redis                       | `countTokens()` = `-1` (comptage O(N) refusé), curseur SCAN    | Attendu — capacité réduite annoncée, paginer par curseur   |

## 🧪 Tests & couverture

Cinq familles couvrent la brique — les **chiffres exacts vivent dans la carte de l'aperçu**
(régénérée par `gen-counters.mjs` depuis vitest, jamais figée ici) :

- **unit** : `tokenService` (émission, rotation, rejeu, downscoping), `tokenStore` (révocation,
  denylist, gc, rétention), `jwtKeystore` (les 3 priorités de source), `jwtPipeline` (bout en bout
  signature → vérification), `tokenPagination` (le banc de contrat piloté par le store mémoire) ;
- **banc de contrat** : `tokenPaginationContract` — invariants `listPage`/`countTokens` tenus par
  **tous** les backends (tri, offset, filtres, curseur) ;
- **intégration adapters** : token-store + token-pagination chez drizzle (sqlite), mongoose et
  redis — le MÊME banc rejoué sur chaque backend ;
- **e2e base réelle** : drizzle sur PostgreSQL et MySQL ;
- **manque assumé** : pas de banc d'attaque dédié à l'émission (le rejeu est couvert en unit) ni de
  test de charge sur le grant.

Les bancs sur serveur réel se **skippent sans leurs variables d'infra** — un skip compte comme
vert : lire le bloc gates (`scripts/test/vitest/gates.ts`, affiché en fin de run) avant de conclure.
Couverture : `npm run coverage` dans `@nodefony/security`.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Sécurité — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
- 🧭 **Pages sœurs** : [api-keys](api-keys.md) · [Authenticators](authenticators.md)

- La vérification de ces jetons (JWT/PAT) → [authenticators](./authenticators.md)
- Le firewall qui applique la zone → [firewall](./firewall.md) · L'autorisation par scopes → [authorization](./authorization.md)
- La doctrine `store:"auto"` → [configuration](../../../../../docs/architecture/configuration.md)
- Vue d'ensemble sécurité → [index](./index.md)
