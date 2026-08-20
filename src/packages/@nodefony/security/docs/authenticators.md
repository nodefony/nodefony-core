---
title: "Authenticators — prouver l'identité (session, mot de passe, JWT, clé API)"
lang: fr
module: "@nodefony/security"
topic: authenticators
coverageModule: security
section: "Sécurité"
audience: [developer]
tags:
  [
    security,
    authentication,
    jwt,
    apikey,
    session,
    basic,
    bearer,
    rfc6750,
    rfc8725,
    nist,
  ]
version: "doc"
status: stable
updated: 2026-07-19
source: "src/packages/@nodefony/security/docs/authenticators.md"
---

# Authenticators — prouver l'identité

> Un **authenticator** répond à une seule question : _« qui es-tu, et peux-tu le prouver ? »_. Il ne
> décide **pas** des droits (ça, c'est l'autorisation / les voters) — il établit une **identité**.
> Le firewall enchaîne les authenticators déclarés par une zone jusqu'à obtenir une preuve valide,
> sinon il ferme en 401 (Zero Trust). Nodefony en fournit **six** intégrés, tous ancrés ici sur le
> code (`src/packages/@nodefony/security/nodefony/src/authenticator/`).

📍 [Documentation](../../../../../docs/index.md) › [Sécurité](index.md) › **Authenticators**

## 🧠 Le cycle d'un authenticator

```mermaid
flowchart TD
  REQ["Requête (HTTP ou WS)"] --> SUP{"supports(ctx) ?<br/>credential présent ?"}
  SUP -->|non| NEXT["maillon suivant<br/>(ou 401 Zero Trust)"]
  SUP -->|oui| CT["createToken()<br/>credential brut, non vérifié"]
  CT --> AU["authenticate(token)<br/>vérifie · révocation · sujet"]
  AU -->|échec| F["onFailure → 401 + challenge<br/>(message UNIFORME)"]
  AU -->|succès| S["onSuccess → user + token dans l'ALS"]
  S --> CTRL["→ autorisation → contrôleur"]
```

C'est `Firewall.#authenticate()` (`firewall.ts:1013`) qui déroule ce cycle pour chaque maillon de la
zone, dans l'ordre déclaré. Le succès pose l'identité dans l'ALS ; l'échec remonte au firewall qui
pose le 401 et son challenge — l'authenticator, lui, ne touche jamais à la réponse.

## 📖 Lexique

| Terme            | Sens                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Authentification | Établir **qui** est l'appelant (≠ autorisation, qui établit ce qu'il a le **droit** de faire).                     |
| Authenticator    | Une stratégie de preuve d'identité (`session`, `jwt`…) implémentant `IAuthenticator`.                              |
| BFF              | _Backend For Frontend_ : le web s'authentifie par **session serveur** (cookie opaque), pas par jeton exposé au JS. |
| Bearer           | Schéma `Authorization: Bearer <jeton>` (RFC 6750) — porté par les API.                                             |
| PAT              | _Personal Access Token_ : une clé API personnelle, bearer **opaque** révocable.                                    |
| JWS/JWT          | Jeton signé auto-porté (structure compacte `a.b.c`).                                                               |
| JWKS             | _JSON Web Key Set_ : le trousseau de clés publiques qui vérifie les signatures JWT.                                |
| EdDSA            | Algorithme de signature asymétrique (Ed25519) — le seul accepté par le vérificateur JWT.                           |
| CRC              | Somme de contrôle embarquée dans une clé API — filtre les valeurs malformées avant la base.                        |
| ALS              | _AsyncLocalStorage_ : le contexte ambiant de la requête où le firewall pose `user` + `token`.                      |
| Challenge        | En-tête `WWW-Authenticate` renvoyé avec un 401 (RFC 7235) indiquant comment s'authentifier.                        |
| Zero Trust       | Sur une zone protégée, **aucune preuve valide ⇒ 401** ; l'anonymat n'est accepté que s'il est déclaré.             |

## Qu'est-ce qu'un authenticator — et quelle faille il ferme

Un serveur qui expose des données doit distinguer un appelant légitime d'un inconnu. Le faire « à la
main » dans chaque contrôleur, c'est garantir qu'un endpoint finira par être oublié — la faille la
plus banale et la plus grave.

Nodefony **centralise** la preuve d'identité dans le firewall : une zone déclare _quelles preuves
elle accepte_, et rien n'atteint le contrôleur sans être passé par là. Chaque authenticator ferme une
classe d'attaque précise — détaillées brique par brique dans le catalogue :

- **énumération de comptes** (messages d'échec uniformes) ;
- **brute-force et DoS par hachage** (backoff NIST avant tout hash) ;
- **algorithm confusion / injection de clé JWT** (allowlist + JWKS local) ;
- **jeton volé non révocable** (denylist `jti`, PAT opaque révocable) ;
- **identité périmée** (sujet re-vérifié à chaque requête).

## La vision Nodefony — un contrat, un registre, un firewall agnostique

### Le contrat `IAuthenticator`

Tout authenticator implémente le même cycle (`IAuthenticator.ts:18`), ce qui rend le firewall
totalement agnostique de la stratégie :

| Méthode               | Rôle                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `supports(ctx)`       | Test **bon marché** : le credential de cette stratégie est-il présent ? (sinon, maillon suivant)           |
| `createToken(ctx)`    | Extrait le credential **brut, non vérifié**, dans un `UserToken`.                                          |
| `authenticate(token)` | **Vérifie** (signature/hash/session), applique la **révocation**, **re-résout le sujet** — ou lève un 401. |
| `onSuccess(ctx,tok)`  | Effet de bord au succès (poser l'identité en session, audit).                                              |
| `onFailure(ctx,err)`  | Slot d'audit (le 401 + challenge sont posés par le firewall).                                              |
| `challenge()`         | **Optionnel** (`IAuthenticator.ts:42`) — la valeur `WWW-Authenticate` (RFC 7235) des 401 de la zone.       |

### Le registre pluggable

Les authenticators sont résolus par **nom** : `Firewall.#instantiateAuthenticators()`
(`firewall.ts:402`) interroge `getAuthenticatorFactory()` (`authenticatorRegistry.ts:59`) — jamais
un `if (name === "jwt")` dans le firewall, qui trahirait la promesse « pluggable ».

- Les **cinq builtins HTTP** (`anonymous`, `userpassword`, `session`, `jwt`, `apikey`)
  s'enregistrent à l'import du module via `registerAuthenticatorFactory()`
  (`authenticatorRegistry.ts:72-125`) — donc toujours avant le boot.
- Le sixième, `firewall-realtime`, n'est **pas dans le registre** : c'est le firewall qui le câble
  lui-même au handshake WS des zones protégées (`Firewall.#wireRealtime()`, `firewall.ts:268`).
- La fabrique ne fait que **construire** ; les résolutions de services coûteuses (`users`,
  `tokenStore`, keystore) restent **lazy** dans l'instance (cold path).
- Un nom inconnu en config = boot **fail-closed** — `#configError` posé + log CRITIC
  (`firewall.ts:369-377`) : jamais de zone « protégée » silencieusement ouverte à cause d'une
  faute de frappe.

## 🚀 Démarrage rapide

### Une zone, trois preuves — la même API pour le web et les machines

Dans une app `nodefony create app`, on déclare quelles preuves une zone accepte — un **objet par
nom**, validé Zod au boot (`areas: z.record(...)`, `config.ts:902`) :

```typescript
// nodefony.config.ts (extrait)
use("@nodefony/security", {
  areas: {
    // Une seule zone, trois preuves : le navigateur (cookie de session),
    // un service (JWT), un script CI (clé API). `mode: "first"` (défaut) :
    // le premier maillon qui reconnaît la requête authentifie.
    api: {
      pattern: "^/api",
      authenticators: ["session", "jwt", "apikey"],
    },
  },
});
```

> [!IMPORTANT]
> **Le login est FOURNI** : `POST /nodefony/security/api/auth/login` (body `{ username, password }`
> → `Set-Cookie` de session, ID régénéré anti-fixation), avec `logout` et `me`
> (`SessionAuthController.ts:37-39`). Pas de LoginController à écrire — tes routes ne font que
> consommer l'identité.

### Ce que TU écris : le controller qui consomme l'identité

```typescript
// nodefony/controllers/WhoAmIController.ts — complet, compile tel quel
import {
  controller,
  Controller,
  Get,
  IsGranted,
  CurrentUser,
} from "@nodefony/framework";
import type { IUser } from "@nodefony/user";

@controller("/api/v1")
class WhoAmIController extends Controller {
  // Zone `api` : le firewall a DÉJÀ validé une des trois preuves (session,
  // JWT ou clé API) — sinon 401 avant ce code. @IsGranted ajoute le rôle.
  @IsGranted(["ROLE_USER"])
  @Get("/whoami")
  async whoami(@CurrentUser() user: IUser) {
    // La même réponse quelle que soit la preuve présentée par le client.
    return this.renderJson({ identifier: user.identifier, roles: user.roles });
  }
}

export default WhoAmIController;
```

### Ce qu'on observe

```bash
# 1) Sans preuve : Zero Trust → 401 + challenge du premier maillon qui en déclare
curl -si http://localhost:5151/api/v1/whoami | grep -E "^(HTTP|WWW)"
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer

# 2) Web — login BFF (compte dev seedé admin/admin) → cookie de session
curl -si -c /tmp/jar -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' \
  http://localhost:5151/nodefony/security/api/auth/login | head -1
# HTTP/1.1 200 OK

# 3) La même route, deux preuves différentes → la même identité
curl -s -b /tmp/jar http://localhost:5151/api/v1/whoami            # session (web)
curl -s -H 'Authorization: Bearer nf_…' \
  http://localhost:5151/api/v1/whoami                              # clé API (CI)
# {"identifier":"admin","roles":["ROLE_NODEFONY_ADMIN", …]}
```

Requête par requête, qui répond :

| Le client envoie…                    | Maillon (`supports()`) | Résultat                                                 |
| ------------------------------------ | ---------------------- | -------------------------------------------------------- |
| le cookie de session                 | `session`              | identifié — rôles frais re-résolus en base               |
| `Authorization: Bearer eyJ…` (a.b.c) | `jwt`                  | identifié — signature EdDSA + claims vérifiés            |
| `Authorization: Bearer nf_…`         | `apikey`               | identifié — clé vérifiée au store, révocable             |
| rien                                 | aucun                  | **401** + `WWW-Authenticate: Bearer` (`firewall.ts:981`) |

## 🔐 Les six authenticators intégrés

| Nom                 | Credential                               | Vérité     | Révocable | Pour…                              |
| ------------------- | ---------------------------------------- | ---------- | :-------: | ---------------------------------- |
| `anonymous`         | (aucun)                                  | —          |     —     | accepter l'anonymat explicitement  |
| `userpassword`      | `Authorization: Basic base64(id:mdp)`    | verifier   |    n/a    | outils/scripts, brique login       |
| `session`           | cookie de session (identifiant en blob)  | serveur    | immédiate | le **web** après login (BFF)       |
| `jwt`               | `Authorization: Bearer <a.b.c>`          | auto-porté | via état  | API service↔service, agents        |
| `apikey`            | `Authorization: Bearer nf_…`             | serveur    | immédiate | API/CI/scripts d'un user           |
| `firewall-realtime` | identité déjà résolue au handshake (ALS) | serveur    | 1 fenêtre | le **WebSocket** de toute identité |

### `anonymous` — accepter explicitement l'anonymat

Le seul authenticator autorisé à produire un token **non authentifié** sans déclencher le Zero Trust
(`AnonymousAuthenticator.ts:19`).

- `supports()` accepte tout (`AnonymousAuthenticator.ts:22`) ; le token porte le **singleton gelé**
  `anonymousUser` — zéro allocation d'utilisateur (`AnonymousToken.ts:9`).
- À ne lister **que volontairement** : `["jwt", "anonymous"]` en mode `first` signifie « identifié
  si preuve présente, sinon visiteur anonyme accepté ». En mode `all`, utile en **dernier** :
  « canal prouvé (ex. mTLS), identité utilisateur optionnelle ».
- Sans lui, zone protégée + aucune preuve = 401 : la défense en profondeur du firewall n'accepte un
  token non authentifié que si `anonymous` est le maillon déclaré (`firewall.ts:634-636`).
- **Faille fermée** : l'anonymat _implicite_ — ici il est un choix explicite et auditable, jamais un
  défaut.

### `userpassword` — HTTP Basic + backoff NIST

Schéma **HTTP Basic** (RFC 7617) : `Authorization: Basic base64(id:mdp)`, charset UTF-8, scheme
case-insensitive (`UserPasswordAuthenticator.ts:11`) ; `createToken()` split au **premier** `:` —
le mot de passe peut en contenir (`UserPasswordAuthenticator.ts:74`).

- **La vérification est déléguée** au `IPasswordVerifier` (le `UserService`) : hash, comparaison,
  leurre anti-timing, re-hash transparent — l'authenticator ne voit que le verdict.
- **Message uniforme** `INVALID_CREDENTIALS` quelle que soit la cause — identifiant inconnu, compte
  verrouillé, mot de passe faux (`UserPasswordAuthenticator.ts:16`) → anti-énumération de comptes.
- **Throttling NIST SP 800-63B AVANT le verifier** : `#throttler.check()` sur l'identifiant saisi
  (`UserPasswordAuthenticator.ts:101-103`) — un identifiant bloqué ne coûte **aucun hash** → le
  throttle protège aussi le serveur du **DoS argon2**. Échec compté, succès remis à zéro
  (`UserPasswordAuthenticator.ts:111-114`). `ThrottledError` → **429 + `Retry-After`**
  (`firewall.ts:584-587`).
- **Le throttler est PARTAGÉ** avec le login JSON du BFF — même `loginThrottler` du container : un
  attaquant ne contourne pas le backoff en changeant de porte (`authenticatorRegistry.ts:75-79`).
- Challenge : `Basic realm="nodefony", charset="UTF-8"` (`UserPasswordAuthenticator.ts:130`).
- **Piège** : le login par formulaire (JSON) n'est **pas** ici — c'est le BFF
  (`/nodefony/security/api/auth/login`). Basic sert l'outillage (scripts, CLI).

### `session` — la preuve du web (BFF)

Après le login, chaque requête web prouve son identité par la **session serveur** (cookie opaque).
Credential = l'**identifiant** posé dans le blob de session, jamais un secret.

- **N'ouvre jamais la session lui-même** : `supports()` exige une session **déjà reprise** porteuse
  d'un utilisateur (`SessionAuthenticator.ts:43-46`) — le pipeline http démarre la session _avant_
  le firewall ; c'est `AuthFlow.login()` qui ouvre et régénère l'ID (anti-fixation).
- **L'identité est re-résolue à CHAQUE requête** via `resolveSessionIdentity`
  (`SessionAuthenticator.ts:70`) → rôles frais, révocation immédiate. Les contrôles d'état sont
  partagés avec `AuthFlow.me()` : `isLocked()`/`isActive()` → rejet (`sessionIdentity.ts:40`).
- `onSuccess()` pose l'identifiant sur le contexte — la persistance de session lie le blob au
  principal courant (`SessionAuthenticator.ts:78-80`).
- **Pas de `challenge()`** : session absente = 401 nu → le front redirige vers son écran de login,
  jamais une popup Basic (`SessionAuthenticator.ts:25-27`).

### `jwt` — Bearer signé pour les API (RFC 6750 + BCP RFC 8725)

Réservé aux **API service↔service / agents** (le web reste sur la session). Vérifie un access token
**EdDSA** signé par le keystore du serveur ; `supports()` ne réclame que la structure compacte
`a.b.c` (`COMPACT_JWS`, `JwtAuthenticator.ts:20`). Les défenses **dures** du JWT BCP, toutes
prouvées en test :

| Défense                                | Comment                                                                                          | Attaque fermée                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **Allowlist d'algorithmes**            | `algorithms: ["EdDSA"]` — jamais l'algo de l'en-tête du token (`JwtAuthenticator.ts:104`)        | `alg=none`, algorithm confusion (§3.1)                             |
| **Clé par `kid` du keyset LOCAL**      | `createLocalJWKSet` — jamais `jku`/`jwk` de l'en-tête (`JwtAuthenticator.ts:158`)                | injection de clé / SSRF (§3.5)                                     |
| **`aud` + `iss` + `typ` obligatoires** | `typ: "at+jwt"` (§3.11) sépare access et refresh (`JwtAuthenticator.ts:105-107`)                 | refresh présenté comme access, token d'un autre service (§3.8-3.9) |
| **Révocation**                         | denylist `isJtiDenied` + seuil `invalidBefore` par porteur (`JwtAuthenticator.ts:123-131`)       | jeton auto-porté volé, logout global                               |
| **Sujet revérifié**                    | `loadUserByIdentifier(sub)` → disparu/inactif/verrouillé = rejet (`JwtAuthenticator.ts:174-186`) | compte banni encore « valide » via son token (§3.10)               |

Le **message d'échec est uniforme** (`INVALID_TOKEN`, `JwtAuthenticator.ts:24`) : la cause fine
(expiré, `aud`, signature, sujet banni) part en **audit**, jamais au client — anti-oracle. Le token
promu porte `scopes`, `jti`, `claims` en attributs (`JwtAuthenticator.ts:162-171`). `jose` est
importé **lazy** — dépendance lourde (`JwtAuthenticator.ts:96`).

### `apikey` — PAT opaque révocable

Clé API personnelle en `Authorization: Bearer nf_…` (préfixe `apiKeys.prefix`, défaut `nf`).
Contrairement au JWT (auto-porté), un PAT est un **bearer opaque** dont la vérité vit **côté
serveur** (`ITokenStore`) → **révocable immédiatement**. Défenses :

- **Forme + CRC validés AVANT tout accès au store** (`parseApiKey`, `ApiKeyAuthenticator.ts:99-101`)
  → une valeur malformée n'atteint jamais la base (**anti-DoS**).
- **Lookup par hash SHA-256** (`findByHash`, `ApiKeyAuthenticator.ts:105`) — le secret n'existe
  **nulle part au repos**.
- **Révocation** (`revokedAt`) + **expiration** (`expiresAt`) (`ApiKeyAuthenticator.ts:109-111`) +
  **ban en masse** du porteur (`invalidBefore` vs `createdAt`, `ApiKeyAuthenticator.ts:117-118`).
- **Sujet revérifié** à chaque requête → rôles frais (`ApiKeyAuthenticator.ts:123`).
- **`lastUsedAt` throttlé** : aucune écriture sur le hot path tant que la fenêtre
  `apiKeys.lastUsedThrottleS` n'est pas dépassée (`ApiKeyAuthenticator.ts:127-133`).

Le token promu porte `scopes`, `apiKeyId`, `tenantId` (`ApiKeyAuthenticator.ts:138-140`).

### `firewall-realtime` — la promotion, en WebSocket, de l'identité déjà posée

> [!IMPORTANT]
> Ce n'est **pas** « l'authenticator de la session ». Il promeut **toute** identité que le firewall
> a résolue — y compris un agent authentifié par jeton porteur, sans cookie ni session. Son nom
> d'origine (`SessionRealtimeAuthenticator`) décrivait le premier mode branché, pas son rôle ; la
> confusion a coûté un durcissement pensé pour la session appliqué à toutes les identités
> (`FirewallRealtimeAuthenticator.ts:32-39`).

Sur un handshake WS (une requête upgrade HTTP qui traverse **le même pipeline**), `startSession`
puis `handleSecurity` ont **déjà** tourné : session chargée, identité re-résolue, `IUser` posé dans
l'ALS. `FirewallRealtimeAuthenticator.supports()` ne fait que le constater
(`FirewallRealtimeAuthenticator.ts:80`).

- **Perf : il ne relit pas la base.** `authenticate()` réutilise l'identité de l'ALS
  (`FirewallRealtimeAuthenticator.ts:91`) au lieu de refaire deux lectures base par connexion —
  un coût évitable sur le différenciateur temps réel.
- **Câblé automatiquement** par `Firewall.#wireRealtime()` (`firewall.ts:268`) pour toute zone
  protégée `realtime !== false` — une instance par zone au handshake (`firewall.ts:289`).
- **Le mode de preuve suit le jeton du firewall**, il n'est pas deviné : absent (zone historique),
  on retombe sur le mode le plus strict, la session (`FirewallRealtimeAuthenticator.ts:101-103`).
- **Filet Zero Trust** : il câble un revalidateur appelé avant chaque action data plane
  (`FirewallRealtimeAuthenticator.ts:105-107`) — la socket peut survivre à l'identité qui l'a
  ouverte (logout, changement de compte, `jti` denylisté). En mode session,
  `buildSessionRevalidator()` re-lit `storage.read(id)` et compare l'identifiant ; toute erreur de
  lecture invalide, fail-closed (`FirewallRealtimeAuthenticator.ts:227`). En mode jeton porteur, la
  preuve est autre : `exp`, `jti` denylisté, `invalidBefore`
  (`FirewallRealtimeAuthenticator.ts:127`).

> [!NOTE]
> **Asymétrie de révocation HTTP↔WS (assumée)** : le jeton realtime est figé au handshake (les
> frames lisent un cache O(1)) → une révocation prend effet **à la reconnexion**, pas à la frame
> suivante. C'est l'état de l'art (Socket.IO/Phoenix figent aussi au handshake) ; la révocation
> immédiate forte passe par le JWT + un canal « token révoqué ».

## ⚙️ Composer une zone — ordre, mode, cohabitation

La liste `area.authenticators` se lit **dans l'ordre**, déroulée par `Firewall.#authenticate()`
(`firewall.ts:1013`) selon le `mode` de la zone (`first` par défaut, `config.ts:87-92`).

### Situation 1 — humains ET machines sur la même API (`first`)

Ton back-office est appelé par le **navigateur** des utilisateurs connectés ET par un **script CI**.
Deux preuves différentes, mêmes routes — c'est la config du Démarrage rapide ci-dessus. Deux règles
de lecture :

- un maillon dont `supports()` est faux est simplement **sauté** en mode `first`
  (`firewall.ts:935`) ;
- un credential **présenté mais invalide échoue immédiatement** — l'échec d'`authenticate()`
  remonte, jamais de fallback silencieux vers le maillon suivant (`firewall.ts:947-952`). Une clé
  API révoquée donne un 401 direct, même si un autre maillon aurait pu réussir.
- aucune preuve présentée sur toute la chaîne → `handleSecurity()` lève l'`AuthenticationError`
  Zero Trust (`firewall.ts:613-626`).

### Situation 2 — le piège de l'ordre (`anonymous` toujours EN DERNIER)

Tu veux « identifié si connecté, sinon visiteur » :

```typescript
authenticators: ["session", "anonymous"],   // ✅ session d'abord
authenticators: ["anonymous", "session"],   // ❌ anonymous accepte TOUT le monde
```

> [!WARNING]
> `AnonymousAuthenticator.supports()` accepte **toutes** les requêtes — placé en premier en mode
> `first`, il court-circuite la liste : **personne n'est jamais identifié**, même avec un cookie
> valide. L'ordre est ta politique.

### Situation 3 — empiler les preuves (`all`)

En mode `all`, **chaque** maillon est obligatoire : `supports()` faux = 401 immédiat
(`firewall.ts:937`) et le **dernier** token de la chaîne porte l'identité (`firewall.ts:973`) —
utile pour exiger une preuve de canal (mTLS) **et** une identité, ou un « sudo mode » session +
re-saisie du mot de passe. Scénario complet côté zones : [firewall](./firewall.md).

### Cohabitation JWT + clé API dans une même zone

Les deux sont des `Bearer`, mais Nodefony les **discrimine sur la forme** — un JWT a la structure
compacte `a.b.c` (`COMPACT_JWS`, `JwtAuthenticator.ts:20`), un PAT porte le préfixe `nf_` sans
point (`looksLikeApiKey`, `ApiKeyAuthenticator.ts:72`). Chaque `supports()` ne réclame que _son_
format → aucun conflit, aucune double vérification.

## Le fil rouge : le message d'échec uniforme

Les cinq authenticators vérifiants renvoient **le même message** (`"Invalid credentials"` /
`"Invalid token"` / `"Invalid session"`) quelle que soit la cause réelle. Ce n'est pas de la
paresse : c'est une **défense anti-énumération / anti-oracle**.

Distinguer « compte inconnu » de « mot de passe faux », ou « token expiré » de « signature
invalide », donnerait à un attaquant une sonde. La cause fine part **toujours** en log d'audit ; le
client n'obtient qu'un 401 + son challenge — posé par le firewall, premier maillon de la zone qui
en déclare un (`Firewall.#setChallenge()`, `firewall.ts:1076`).

## 🧩 Ajouter un authenticator maison

```typescript
import { registerAuthenticatorFactory } from "@nodefony/security";

registerAuthenticatorFactory("ldap", ({ container, config }) => {
  return new LdapAuthenticator(() => container.get("ldapClient"));
});
// puis en config : areas.<zone>.authenticators = ["ldap", "anonymous"]
```

À faire au chargement du module (avant le boot). Trois règles, calquées sur les builtins :

- implémenter le contrat `IAuthenticator` (`IAuthenticator.ts:18`) — `challenge()` seulement si
  un en-tête `WWW-Authenticate` a du sens pour la stratégie ;
- renvoyer le **message uniforme** en cas d'échec (la cause fine part en audit) ;
- laisser les résolutions de services **lazy** dans l'instance — la fabrique ne fait que
  construire (`authenticatorRegistry.ts:29-31`).

## 📜 Normes appliquées

<!-- prettier-ignore -->
| Domaine | Norme | Ancrage |
| --- | --- | --- |
| Challenge d'auth (401) | RFC 7235 | `Firewall.#setChallenge()` (`firewall.ts:1076`) |
| Bearer | RFC 6750 | `BEARER_SCHEME` (`JwtAuthenticator.ts:14` · `ApiKeyAuthenticator.ts:12`) |
| JWT (BCP) | RFC 7519, 8725 | `jwtVerify` durci : allowlist + claims (`JwtAuthenticator.ts:103-107`) |
| HTTP Basic | RFC 7617 | `UserPasswordAuthenticator` (`UserPasswordAuthenticator.ts:25-27`) |
| Backoff de login | NIST SP 800-63B | `#throttler.check()` avant le verifier (`UserPasswordAuthenticator.ts:101-103`) |
| Rate limit (429) | RFC 6585 | `Retry-After` posé par le firewall (`firewall.ts:584-587`) |
| Anti-énumération | OWASP | `INVALID_TOKEN` (`JwtAuthenticator.ts:24`) · `INVALID_CREDENTIALS` (`UserPasswordAuthenticator.ts:16`) |

## ⚡ Performance & mémoire

- `supports()` est un test **bon marché** (en-tête + regex) — et n'est payé que sur zone protégée
  (le chemin chaud/froid vit dans le [firewall](./firewall.md)).
- Résolutions **lazy** : le verifier `#resolveVerifier` est mémoïsé au premier login
  (`UserPasswordAuthenticator.ts:105`) ; keystore, `tokenStore` et `users` sont résolus du
  container au premier usage ; `jose` est importé lazy (`JwtAuthenticator.ts:96`).
- `anonymous` : singleton gelé `anonymousUser`, zéro allocation d'utilisateur
  (`AnonymousToken.ts:9`).
- `apikey` : écriture `lastUsedAt` **coalescée** — pas une écriture par requête
  (`ApiKeyAuthenticator.ts:127-133`).
- `firewall-realtime` : **zéro lecture base** au handshake — réutilise l'ALS
  (`FirewallRealtimeAuthenticator.ts:91`).
- Le throttle NIST **avant** le hash : un 429 ne coûte aucun argon2.

## ⚠️ Pièges (symptôme → cause → correction)

<!-- prettier-ignore -->
| Symptôme | Cause (dans le code) | Correction |
| --- | --- | --- |
| 401 systématique sur une zone protégée | Aucune preuve + `anonymous` non listé — Zero Trust (`firewall.ts:613-626`) | Ajouter `anonymous` en dernier si l'anonymat est voulu |
| 401 générique + log ERROR « service `users` » | Câblage : pas de `UserService` au container (`authenticatorRegistry.ts:85-88`) | Enregistrer un `UserService` au boot de l'app |
| JWT rejeté alors qu'il « semble » valide | `aud`/`iss`/`typ` non conformes, ou `alg` ≠ EdDSA (`JwtAuthenticator.ts:103-107`) | Émettre via le `TokenService` (mêmes iss/aud/typ) |
| Clé API révoquée encore acceptée quelques secondes | Confusion avec un JWT (auto-porté) — `revokedAt` est lu à chaque requête (`ApiKeyAuthenticator.ts:110`) | Un PAT est révoqué immédiatement ; vérifier `revokedAt` |
| Révocation WS pas immédiate | Identité figée au handshake — asymétrie assumée du `FirewallRealtimeAuthenticator` (`FirewallRealtimeAuthenticator.ts:51-55`) | Attendre la fenêtre de re-validation, ou utiliser JWT + canal révocation |
| Brute-force pas ralenti | `loginThrottler` absent du container — `rateLimit.enabled` off (`firewall.ts:346-349`) | Configurer `rateLimit` pour poser le throttler |

## 🧪 Tests & couverture

Trois familles couvrent la brique — les **chiffres exacts vivent dans la carte de l'aperçu**
(régénérée par `gen-counters.mjs` depuis vitest, jamais figée ici) :

- **unit** (`security/tests/unit/`) : la chaîne + les modes (`authenticators`), les défenses JWT
  RFC 8725 (`jwt.attack`) et le pipeline JWT bout en bout (`jwtPipeline`), la clé API — flux,
  service et forme/CRC (`apiKeyAuthenticator`, `apiKeyService`, `apiKeyFormat`), la session
  (`sessionAuthenticator`), le backoff NIST (`loginThrottler`), le step-up 2FA (`mfaStepUp`) ;
- **intégration** (serveur réel, `@nodefony/http`) : le flux clé API de bout en bout
  (`apikey-flow`), un JWT autorisé sur WebSocket (`ws-isgranted-jwt`) ;
- l'**émission** des jetons (keystore, tokenStore) est couverte sur la page
  [tokens](./tokens.md) ; les bancs d'attaque transverses (csrf, cors) sur leurs pages.

Couverture : `npm run coverage` dans `@nodefony/security`.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Sécurité — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
- 🧭 **Pages sœurs** : [Firewall](firewall.md) · [Jetons](tokens.md)

- Le firewall qui enchaîne les authenticators (zones, modes, en-têtes) → [firewall](./firewall.md)
- L'autorisation (voters, rôles, scopes) après l'authentification → [authorization](./authorization.md)
- Émission/révocation des jetons (keystore, tokenStore) → [tokens](./tokens.md)
- Les autres preuves — flux BFF, pas des authenticators de zone : [oauth2](./oauth2.md) ·
  [webauthn](./webauthn.md) · [totp](./totp.md)
- Vue d'ensemble sécurité → [index](./index.md)
