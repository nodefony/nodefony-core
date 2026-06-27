# Consommer le data-plane BFF (front Nodefony)

Référence GÉNÉRALE et autosuffisante pour **lire/écrire les données serveur** depuis un front
Nodefony (toute SPA servie par `@nodefony/frontend` : React / Vue / Angular). Signatures **exactes,
vérifiées sur le source**. Le spécifique Studio (Mantine, MobX, UI kit) → skill `nodefony-studio-dev`.

## Sommaire

- [1. Le modèle BFF — un seul pont front↔serveur](#1-le-modèle-bff--un-seul-pont-frontserveur)
- [2. `ApiClient` — API exacte](#2-apiclient--api-exacte)
- [3. Session BFF — cookie opaque, anti-XSS](#3-session-bff--cookie-opaque-anti-xss)
- [4. `useResource(fetcher)` — chargement réactif](#4-useresourcefetcher--chargement-réactif)
- [5. RBAC front — `roles` du DTO, jamais du token](#5-rbac-front--roles-du-dto-jamais-du-token)
- [6. Mutations — HTTP (CSRF) vs socket (`api.request`)](#6-mutations--http-csrf-vs-socket-apirequest)
- [7. Règles & anti-patterns](#7-règles--anti-patterns)

---

## 1. Le modèle BFF — un seul pont front↔serveur

**Le SEUL canal front↔serveur est le data-plane** `/nodefony/<module>/api/*` (JSON ; ≥3 segments ;
marqueur `/api/`). Chaque module porte son propre data-plane (kernel, framework, http, security…).
Le front n'invente **aucune** URL hors data-plane et n'embarque **aucune** logique/donnée serveur.

- **Forme des chemins** : `/nodefony/<module>/api/<ressource>` — toujours **absolu**. Le catalogue
  des producteurs est lui-même un endpoint (`/nodefony/framework/api/admin`) → on découvre les
  chemins, on ne les code pas en dur au petit bonheur.
- **Contrat = source de vérité unique** : les types d'un payload viennent des exports `nodefony`
  (isomorphes) ou des interfaces `I*Api` du module producteur. Côté front, si le type serveur ne peut
  pas être importé sans tirer du code serveur → **type miroir local** (jamais un import runtime d'un
  module serveur). Cf §[7] frontière isomorphe.
- **Redaction côté serveur** : tout secret/credential est masqué **avant** la sérialisation serveur.
  Le front affiche ce qu'il reçoit ; il ne « dé-redacte » jamais, il ne reçoit jamais le secret.

> Pourquoi un BFF et pas des appels directs : un seul point d'entrée authentifié (cookie de session),
> un seul endroit où le serveur filtre/redacte/autorise (RBAC), un format stable indépendant des vues.

---

## 2. `ApiClient` — API exacte

Classe TS **pure** (fetch) — agnostique du framework de vue, instanciable depuis n'importe quel front.
Wrappe `fetch`, gère l'auth (cookie), les erreurs typées, l'unwrap des réponses, l'idempotence.

```ts
new ApiClient(opts?: ApiClientOptions)

interface ApiClientOptions {
  baseUrl?: string;                       // défaut "/nodefony/studio/api" — préfixe des méthodes RELATIVES
  onUnauthorized?: () => void;            // appelé sur tout 401 (→ relancer le flux de login)
  onError?: (info: ApiErrorInfo) => void; // appelé sur TOUTE réponse non-2xx (→ centre de notifications)
  socket?: ApiSocketLike;                 // Socket Nodefony partagée → route les appels via le pont quand connectée
  socketEnabled?: () => boolean;          // kill-switch du pont (défaut : actif dès que `socket` fourni)
}
interface ApiErrorInfo { method: string; status: number; message: string; body: unknown }
```

### Méthodes ABSOLUES (data-plane d'un module — le cas courant)

```ts
api.getAbsolute<T>(absolutePath: string, init?: RequestInit): Promise<T>
api.postAbsolute<T>(absolutePath: string, body?: unknown, init?: RequestInit): Promise<T>
api.patchAbsolute<T>(absolutePath: string, body?: unknown, init?: RequestInit): Promise<T>
api.deleteAbsolute<T>(absolutePath: string, init?: RequestInit): Promise<T>
```

Appellent le chemin **tel quel**, hors `baseUrl`. C'est ce qu'on utilise pour `/nodefony/<module>/api/*`.

### Méthodes RELATIVES (préfixées par `baseUrl`)

```ts
api.get<T>(path, init?)            // GET  baseUrl+path
api.post<T>(path, body?, init?)    // POST
api.put<T>(path, body?, init?)
api.delete<T>(path, init?)
```

À réserver au data-plane du module qui possède l'`ApiClient` (son propre `baseUrl`).

### Erreurs — `ApiError`

```ts
class ApiError extends Error {
  readonly status: number; // code HTTP (ou status traduit depuis le pont socket)
  readonly body: unknown; // payload d'erreur brut
}
```

Toute réponse non-2xx **lève** `ApiError` (après avoir notifié `onError`). Un `401` déclenche en plus
`onUnauthorized`. Le message lisible est extrait du payload Nodefony (`{error:{message}}` ou `{message}`).

### Unwrap automatique

Le serveur enveloppe certaines réponses JSON en `{ result: … }`. `ApiClient` **déballe** : on récupère
directement la valeur métier, jamais l'enveloppe. (Le pont socket renvoie le même shape que le REST.)

---

## 3. Session BFF — cookie opaque, anti-XSS

L'identité est portée par un **cookie de session opaque `HttpOnly`** (`__Host-nodefony`) que le
navigateur joint **seul** à chaque requête. Conséquences, non négociables :

- **AUCUN token lisible par JS.** Pas de JWT/Bearer en `localStorage`/`sessionStorage` → surface XSS
  fermée (un script injecté ne peut pas exfiltrer un cookie `HttpOnly`). Rien à stocker côté client.
- `ApiClient` envoie le cookie via **`credentials: "same-origin"`** sur chaque appel. Le front n'ajoute
  **jamais** d'en-tête `Authorization` manuel.
- L'identité courante se relit **toujours** au serveur (`GET /…/auth/me`) au montage de l'app : c'est le
  cookie (invisible au JS) qui décide, pas un état local. `401` ⇒ non connecté (état normal, pas erreur).
- Flux d'auth standard (façade `AuthService`, endpoints `/nodefony/security/api/auth/*`) :
  `login` → soit `{user}` (session ouverte), soit `202 {mfaRequired}` (2ᵉ facteur attendu, **aucune
  session** tant qu'il n'est pas validé : Zero Trust) ; `login/totp` (2FA) ; `me` ; `logout`
  (idempotent). Passkey/WebAuthn = même résultat (cookie `HttpOnly`) sans mot de passe.

> Le « rebonjour » du login (dernier identifiant/méthode) peut vivre en `localStorage` car c'est un
> **username seul**, jamais un secret. Tout ce qui touche à l'identité réelle reste serveur.

---

## 4. `useResource(fetcher)` — chargement réactif

Le pattern UNIQUE de chargement de données serveur (matérialisation React ; pour le pattern
agnostique, cf `patterns.md`). Remplace le triptyque `useState(data/loading/error)`+`useEffect(fetch)`.

```ts
useResource<T>(fetcher: () => Promise<T>): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;     // relance ; toute requête plus ancienne est ignorée
}
```

Ce qu'il corrige (et qu'on ne doit PAS réécrire à la main) :

- **Annulation / race** : une réponse arrivée après démontage **ou** après changement de `fetcher` est
  ignorée (jeton de génération) → une réponse périmée n'écrase jamais une plus récente.
- **Double-montage de dev (StrictMode)** : n'écrit qu'une fois.

**Règle d'usage critique** : `fetcher` **DOIT être stable**. S'il capture des variables (l'`api`, un
id, un filtre), l'envelopper de `useCallback(..., [deps])`. Un `fetcher` recréé à chaque render =
refetch en boucle.

```ts
const fetcher = useCallback(
  () => api.getAbsolute<Thing[]>("/nodefony/<mod>/api/things"),
  [api],
);
const { data, loading, error, reload } = useResource(fetcher);
```

---

## 5. RBAC front — `roles` du DTO, jamais du token

Le DTO utilisateur **porte ses rôles**, résolus **côté serveur** :

```ts
interface AuthUser {
  id: number | string;
  username: string;
  email?: string;
  roles: string[];
  currentRole?: string;
}
```

Le contrôle des rôles utilise le **mécanisme isomorphe** `nodefony/roles` (même code front et serveur,
purs, zéro allocation — séparation **mécanisme / politique** : le core ne connaît aucun nom de rôle) :

```ts
import { hasRole, hasAnyRole, hasAllRoles } from "nodefony/roles";

hasRole(userRoles, role); // possède ce rôle ? (false si userRoles null)
hasAnyRole(userRoles, roles); // au moins un (OR) — false si `roles` vide
hasAllRoles(userRoles, roles); // tous (AND) — true si `roles` vide
// RoleSet (O(1) répété) pour tester N fois le même utilisateur (filtrage de nav…)
```

Les **noms** de rôles (`ROLE_*`) sont **applicatifs** → définis dans une source unique côté app, jamais
recopiés par page (la dérive vient des copies locales). Pattern de visibilité unifié recommandé :

```ts
// admin plateforme voit tout ; sinon `required` vide = visible ; sinon intersection
isVisibleForRoles(required: readonly string[] | undefined, userRoles: string[]): boolean
```

**Règles d'or RBAC front** :

- Les rôles se lisent **de la projection serveur** (`user.roles` du DTO `/auth/me`), **jamais décodés
  d'un token côté client** (il n'y a d'ailleurs aucun token JS — cf §3).
- **Le gating front = AFFICHAGE seulement.** Cacher un menu/bouton **n'empêche pas** d'appeler l'API.
  La défense réelle est le **RBAC serveur** (403 sur le data-plane). Ne jamais placer une donnée
  sensible derrière un seul gate front : elle doit être refusée par le serveur.
- Un composant qui lit les rôles d'un store réactif doit être réactif (ex. `observer` MobX en React)
  pour se re-rendre au changement d'identité.

---

## 6. Mutations — HTTP (CSRF) vs socket (`api.request`)

Deux transports pour une mutation, **même action serveur**, **même réponse** :

| Transport                             | Quand                                  | Protection double-effet   |
| ------------------------------------- | -------------------------------------- | ------------------------- |
| **HTTP**                              | défaut ; toujours dispo                | en-tête `Idempotency-Key` |
| **Socket** (`api.request` / `mutate`) | quand la Socket Nodefony est connectée | clé d'idempotence générée |

- **Lecture (GET)** : transparente. Si une socket est connectée, le GET passe par le **pont JSON-RPC**
  `api.request {path}` (même action controller, même snapshot que le REST) ; sinon `fetch`. Le pont ne
  sert que les **succès** : toute erreur du pont retombe sur le `fetch` (réponse de référence).
- **Mutation (POST/PUT/PATCH/DELETE)** : `ApiClient` génère **une clé d'idempotence** (UUID v4) par
  mutation. Elle est envoyée par la socket (`mutate`) **et** rejouée à l'identique sur le fallback
  `fetch` (en-tête `Idempotency-Key`) → un repli après échec socket **ne double jamais** l'effet (le
  serveur dédoublonne et rejoue la réponse mémorisée). Une mutation HTTP directe devient ainsi
  idempotente (anti double-soumission).
- **CSRF (mutations HTTP)** : les mutations passent par un cookie de session → soumises à la protection
  CSRF serveur (double-submit signé). Le front respecte le contrat du module security ; il **ne fabrique
  pas** de jeton. (Détail de l'enforcement = serveur → skill `nodefony-framework-dev`.)
- **`init` qui force le HTTP** : un `init.signal` (abort) ou des `init.headers` custom désactivent le
  pont socket pour cet appel (le chemin `fetch` est respecté).

> Le pont socket est une **optimisation transparente** : mêmes URL, même shape, mêmes `ApiError`. Un
> front peut l'ignorer totalement (ne pas passer `socket`) et tout marche en HTTP pur.

---

## 7. Règles & anti-patterns

- ✅ Toujours **`getAbsolute`/`postAbsolute`/…** pour le data-plane d'un module (`/nodefony/<m>/api/*`).
- ✅ `fetcher` de `useResource` **toujours** `useCallback` (sinon boucle de fetch).
- ✅ Rôles lus du **DTO serveur** + helpers **isomorphes** `nodefony/roles` ; gating = affichage seul.
- ✅ Auth = **cookie `HttpOnly`** (rien à stocker, `credentials:"same-origin"` automatique).
- 🚫 **Aucun import runtime d'un module serveur** dans le bundle front (`@nodefony/http`, `…/security`,
  `…/framework`, kernel, services, config, ORM, `.env`). L'import `nodefony` résout vers le build
  **client isomorphe** (condition `browser`) — n'y tirer que des **types** isomorphes ou des subpaths
  isomorphes (`nodefony/roles`). Besoin d'un type serveur → **type miroir local**. Un import qui tire
  `node:*` ou un service serveur = STOP (fuite de logique/secrets serveur dans le navigateur).
- 🚫 Pas de Bearer/JWT en `localStorage` ; pas d'en-tête `Authorization` manuel.
- 🚫 Pas d'URL serveur en dur hors data-plane.
- ⚠️ `ApiClient` cast le payload `as T` **sans validation runtime** → valider la forme au boundary
  (Zod) dès que la donnée est sensible ou non maîtrisée.
