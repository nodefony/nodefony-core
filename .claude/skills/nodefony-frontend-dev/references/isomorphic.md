# Cœur isomorphe `nodefony` côté navigateur

Référence du **paquet `nodefony` partagé front/back** : comment le même paquet npm sert un build serveur ET un build navigateur, quels sous-chemins (subpaths) le front consomme, où passe la frontière (interdit d'importer le serveur), et le RBAC isomorphe `nodefony/roles`. Ancres `fichier:ligne` vérifiées (chemins relatifs à la racine du repo).

> Pour le client temps réel (`RealtimeClient`) et les hooks React → voir [`realtime-client.md`](./realtime-client.md).

## Sommaire

1. [Le principe isomorphe](#1-le-principe-isomorphe)
2. [Le champ `exports` (dual-build node/browser)](#2-le-champ-exports-dual-build-nodebrowser)
3. [`customConditions: ["browser"]` — la clé de résolution front](#3-customconditions-browser--la-cle-de-resolution-front)
4. [La frontière : jamais le serveur côté front](#4-la-frontiere--jamais-le-serveur-cote-front)
5. [Les subpaths exposés et leur contenu](#5-les-subpaths-exposes-et-leur-contenu)
6. [`nodefony/roles` — RBAC isomorphe](#6-nodefonyroles--rbac-isomorphe)
7. [Consommer le cœur isomorphe (imports réels)](#7-consommer-le-cur-isomorphe-imports-reels)
8. [Gotchas](#8-gotchas)

---

## 1. Le principe isomorphe

Le paquet npm s'appelle **`nodefony`** (pas `@nodefony/core` — héritage JS). Un SEUL paquet est publié, mais il porte **deux faces** :

- une face **serveur** (Node.js) — Kernel, Container, http, etc. ;
- une face **navigateur** (browser) — `RealtimeClient`, `Syslog`/`Pdu` (pour le rendu de logs), roles, hooks React, debug bar.

Le code « plan de contrôle » réellement partagé (protocole JSON-RPC 2.0, contrats de socket, convention de cadence, RBAC) est écrit **une seule fois** et tourne **des deux côtés** — c'est le pari isomorphe de Nodefony. Le seul maillon qui diffère est le transport des octets (`IRealtimeTransport`, cf [`realtime-client.md`](./realtime-client.md)).

Un front (Studio, ou n'importe quelle app servie par `@nodefony/frontend`) écrit simplement :

```ts
import { RealtimeClient } from "nodefony"; // face browser (cf §3)
import { NodefonyProvider, useNodefonyState } from "nodefony/react";
import { hasRole, RoleSet } from "nodefony/roles";
```

et obtient la lib cliente — **pas** un paquet `@nodefony/client` séparé (cette piste a été abandonnée : la lib cliente EST le cœur, sous condition d'export `browser`).

Sources des subpaths front : `src/nodefony/src/client/` (barrel `src/client/index.ts`), `src/client/react/`, `src/client/roles/`, `src/client/debugbar/`, plus le code protocole partagé `src/nodefony/src/realtime/` (consommé par les deux faces).

---

## 2. Le champ `exports` (dual-build node/browser)

`src/nodefony/package.json:6-37` — le champ `exports` aiguille chaque import vers le bon build :

```jsonc
"exports": {
  ".": {
    "browser": {                                          // ← face NAVIGATEUR
      "import": {
        "types":   "./dist/client/types/src/client/index.d.ts",
        "default": "./dist/client/client/index.js"
      }
    },
    "import": {                                            // ← face NODE (défaut)
      "types":   "./dist/types/index.d.ts",
      "default": "./dist/node/index.js"
    }
  },
  "./client":      { "types": "…/dist/client/types/src/client/index.d.ts",          "default": "./dist/client/client/index.js" },
  "./debugbar":    { "types": "…/dist/client/types/src/client/debugbar/index.d.ts", "default": "./dist/client/client/debugbar/index.js" },
  "./react":       { "types": "…/dist/client/types/src/client/react/index.d.ts",    "default": "./dist/client/client/react/index.js" },
  "./roles":       { "types": "…/dist/client/types/src/client/roles/index.d.ts",    "default": "./dist/client/client/roles/index.js" },
  "./debugbar.js": "./dist/client/debugbar.standalone.js",  // bundle IIFE autonome (script tag)
  "./package.json": "./package.json"
}
```

Deux dossiers de sortie distincts (Rollup, `preserveModules`) :

| Build       | Dossier        | Contenu                                                             |
| ----------- | -------------- | ------------------------------------------------------------------- |
| **node**    | `dist/node/`   | face serveur complète (Kernel, Container, http binding, CLI…)       |
| **browser** | `dist/client/` | face navigateur : barrel client + `react/` + `roles/` + `debugbar/` |

Point clé : **seul `"."` a une bifurcation `browser` vs `import`**. Les subpaths `./client`, `./react`, `./roles`, `./debugbar` pointent TOUJOURS vers `dist/client/` (ils sont client-only par nature — pas de face node). `./debugbar.js` est un bundle autonome (IIFE) injectable par `<script>` sans bundler.

---

## 3. `customConditions: ["browser"]` — la clé de résolution front

Comme `"."` a deux faces, le front DOIT forcer la condition `browser` pour que `import … from "nodefony"` résolve la face navigateur (`dist/client/…`) et non la face node (`dist/node/…`).

`src/packages/@nodefony/studio/frontend/tsconfig.json:10` :

```jsonc
"moduleResolution": "bundler",
"customConditions": ["browser"],   // aligne tsc sur Vite
```

Explication figée dans le commentaire du fichier (`tsconfig.json:3`) :

> « `customConditions:['browser']` aligne tsc sur Vite : l'import `nodefony` résout vers le build client isomorphe (condition d'export `browser`) qui expose `RealtimeClient`/`RealtimeState` et **ne tire PAS la source serveur http/security**. Sans ça, tsc prenait les types node (33 erreurs cross-package). »

- **Vite** (le bundler runtime du front) applique nativement la condition `browser` → il résout la face navigateur tout seul.
- **`tsc --noEmit`** (le filet de typage, `npm run typecheck`) ne le fait PAS par défaut → sans `customConditions: ["browser"]` il prend la face node, importe transitivement la source serveur, et part en erreurs cross-package.

> Règle : tout `tsconfig.json` d'un front qui consomme `nodefony` doit poser `moduleResolution: "bundler"` + `customConditions: ["browser"]`. C'est le pendant tsc de ce que Vite fait à l'exécution.

Le build navigateur lui-même est isolé via `src/nodefony/tsconfigClient.json` : il ne compile QUE `./src/client` (`tsconfigClient.json:2`), **exclut** `kernel/finder/command/service` (`tsconfigClient.json:9-12`), et **shime les built-ins Node** par des stubs navigateur (`tsconfigClient.json:31-35`) :

```jsonc
"paths": {
  "node:util":   ["./src/client/shim/util.ts"],
  "node:events": ["./src/client/shim/events.ts"],
  "cli-color":   ["./src/client/shim/cli-color.ts"]
}
```

→ le bundle navigateur ne tire aucun module Node natif (les rares besoins — `EventEmitter`, formatage couleur — passent par les shims `src/client/shim/`).

---

## 4. La frontière : jamais le serveur côté front

La règle d'or : **du code front n'importe jamais la face serveur**. Concrètement :

- Importer depuis `"nodefony"` est OK **uniquement** sous condition `browser` (§3) — sinon on tire `dist/node/` (Kernel, http, security) dans le bundle navigateur.
- Les subpaths `nodefony/client`, `nodefony/react`, `nodefony/roles`, `nodefony/debugbar` sont **toujours sûrs** (pas de face node).
- Le code protocole partagé (`src/nodefony/src/realtime/*` : `JsonRpcPeer`, `IRealtimeSocket`, `IRealtimeTransport`, `RealtimeEventMap`, `channelRate`) est **sans dépendance Node** (browser-safe par construction) — c'est ce qui rend l'isomorphisme possible.
- Le barrel client (`src/client/index.ts`) ne réexporte QUE des briques browser-safe : `Service`, `Container`, `Syslog`, `Pdu`, helpers `Tools`, `RealtimeClient`, `JsonRpcPeer`, transports, AdaptiveRate, drivers Pdu. Il N'expose PAS `Kernel`/`Module`/http.

Côté types, `peerDependencies` (`src/nodefony/package.json:93-105`) : `react`/`react-dom` sont **optionnels** (`peerDependenciesMeta`, lignes 98-104) — tirés seulement si on importe `nodefony/react` ; `zod` reste requis. Aucun JSX dans le build Core : le provider React est créé via `React.createElement` (cf `src/client/react/index.ts:53`) → le build Core ne dépend d'aucun transform JSX.

---

## 5. Les subpaths exposés et leur contenu

<!-- prettier-ignore -->
| Subpath | Source | Contient |
| --- | --- | --- |
| `nodefony` (browser) | `src/client/index.ts` | Barrel client = tout `nodefony/client` (alias) ; c'est l'import « par défaut » du front. |
| `nodefony/client` | `src/client/index.ts` | `RealtimeClient`, `JsonRpcPeer`, `RpcError`, `TransportState`, `BrowserWsTransport`, `AdaptiveRate`, `bindAdaptiveChannel`, `closeCodeToNotice`, `rateChannel`/`parseRate`/`isRateChannel`, drivers `pduProtocol`/`pduFlowStep`/`FLOW_STEPS`, et `Service`/`Container`/`Syslog`/`Pdu` + helpers `Tools` (`extend`, `typeOf`, `isArray`…). Default export = singleton `Nodefony` (`generateId`, `generateV5Id`). |
| `nodefony/react` | `src/client/react/index.ts` | `NodefonyProvider` + hooks `useNodefony*` (état, canaux, identité, syslog, notifications). Réexporte `rateChannel`/`parseRate`/`isRateChannel`. Voir [`realtime-client.md`](./realtime-client.md). |
| `nodefony/roles` | `src/client/roles/index.ts` | RBAC pur isomorphe : `hasRole`/`hasAnyRole`/`hasAllRoles`, `RoleSet`, `RoleRegistry`, `ROLE_MASK_CAPACITY`. Voir §6. |
| `nodefony/debugbar` | `src/client/debugbar/index.ts` | Debug bar Nodefony (vanilla TS + Shadow DOM, dev-only — ≠ React/Mantine). Détails dans le skill `nodefony-studio-dev`. |
| `nodefony/debugbar.js` | bundle `dist/client/debugbar.standalone.js` | Variante IIFE autonome de la debug bar, injectable par `<script>` sans bundler. |

Barrel client — points d'ancrage (`src/client/index.ts`) :

- Réexports nommés (`RealtimeClient`, `JsonRpcPeer`, `RpcError`, `TransportState`, `BrowserWsTransport`, `closeCodeToNotice`, `rateChannel`, `parseRate`, `isRateChannel`, `AdaptiveRate`, `bindAdaptiveChannel`, `pduProtocol`, `pduFlowStep`, `FLOW_STEPS`, `Service`, `Container`, `Pdu`, `Syslog`, helpers) → lignes 83-113.
- Singleton `Nodefony` (default export) avec `generateId()`/`generateV5Id()` → lignes 58-82.

---

## 6. `nodefony/roles` — RBAC isomorphe

Source : `src/client/roles/` — barrel `index.ts`, fonctions `roles.ts`, masque `registry.ts`. **Pur, sans état global, sans dépendance** → identique front et serveur (un voter serveur et un rendu conditionnel front partagent la MÊME logique).

Convention : la source de vérité = les chaînes `ROLE_*` (ce que transportent JWT/OAuth/claims, `roles.ts:1-5`). Le mécanisme reste agnostique (n'importe quelle chaîne fait office de rôle) ; les rôles applicatifs (`ROLE_DEV`…) sont définis par le consommateur, **jamais par le core** (`index.ts:1-12`).

### Trois niveaux selon le coût

| Brique                                   | Quand                                               | Coût                                | Ancre                              |
| ---------------------------------------- | --------------------------------------------------- | ----------------------------------- | ---------------------------------- |
| `hasRole` / `hasAnyRole` / `hasAllRoles` | Contrôle **ponctuel** (1 test)                      | Zéro allocation (parcours linéaire) | `roles.ts:19-24`, `34-41`, `51-59` |
| `RoleSet`                                | Contrôles **répétés** (filtrer une nav, N panneaux) | 1 alloc `Set`, puis O(1)/O(k)       | `roles.ts:69-112`                  |
| `RoleRegistry` (+ masque)                | Ensemble **FIXE** en hot path serveur (voters)      | Masque binaire `&`/`\|`, 0 alloc    | `registry.ts:27-107`               |

### Signatures (vérifiées au source)

```ts
// roles.ts
type Role = string; // :5
function hasRole(
  userRoles: readonly Role[] | null | undefined,
  role: Role,
): boolean; // :19
function hasAnyRole(
  userRoles: readonly Role[] | null | undefined,
  roles: readonly Role[],
): boolean; // :34  (OR ; [] ⇒ false)
function hasAllRoles(
  userRoles: readonly Role[] | null | undefined,
  roles: readonly Role[],
): boolean; // :51 (AND ; [] ⇒ true)

class RoleSet {
  // :69
  constructor(roles?: Iterable<Role> | null); // dédoublonne (:73)
  get size(): number; // :78
  has(role: Role): boolean; // O(1) (:86)
  hasAny(roles: readonly Role[]): boolean; // OR (:94)
  hasAll(roles: readonly Role[]): boolean; // AND ; [] ⇒ true (:103)
  toArray(): Role[]; // copie TRIÉE (:109)
}
```

### `RoleRegistry` — bitmask O(1), cap 31 rôles

`registry.ts:11` : `ROLE_MASK_CAPACITY = 31`. **Pourquoi 31** : les opérateurs bit-à-bit de JS travaillent sur des entiers **32 bits signés** — `1 << 31` devient négatif, `1 << 32` repart à `1`. On réserve donc les bits 0..30 (31 rôles) pour rester sur des masques positifs sûrs. Au-delà → rester sur les chaînes (`RoleSet`) ou un futur registre `BigInt`.

```ts
class RoleRegistry {
  // :27
  define(...roles: Role[]): this; // assigne 1 bit/rôle (idempotent) ; throw RangeError si > 31 (:39)
  bit(role: Role): number; // bit du rôle (puissance de 2) ou 0 si inconnu (:57)
  mask(roles: readonly Role[]): number; // OR des bits (rôles inconnus ignorés) (:68)
  roles(mask: number): Role[]; // décode un masque → liste (:80)
  static hasAny(userMask: number, requiredMask: number): boolean; // (userMask & requiredMask) !== 0 (:93)
  static hasAll(userMask: number, requiredMask: number): boolean; // (userMask & requiredMask) === requiredMask (:104)
}
```

⚠️ `RoleRegistry` est inadapté aux rôles **dynamiques** (créés en base à l'exécution) : ils n'ont pas de bit fixe → rester sur les chaînes. Côté front, on utilise quasi exclusivement `hasRole`/`hasAnyRole`/`RoleSet` (chaînes) ; `RoleRegistry` vise le hot path serveur (pipeline sécurité) mais reste importable côté front car pur.

### RBAC isomorphe : les rôles viennent du SERVEUR, jamais du token client

Règle de sécurité centrale. Le front teste des rôles **résolus et annoncés par le serveur**, il ne décode **jamais** un JWT côté client pour en extraire des rôles.

La connexion temps réel annonce l'identité résolue au handshake via `realtime:welcome` → `RealtimeIdentity` (`src/realtime/RealtimeEventMap.ts:127-138`) :

```ts
interface RealtimeIdentity {
  type: string; // "anonymous" | "session" | "jwt" | …
  authenticated: boolean; // false pour anonyme (Zero Trust : toujours présent, jamais null)
  userIdentifier: string; // "anonymous" | "user-42" | …
  roles: string[]; // rôles PLATS résolus serveur — ["ROLE_ANONYMOUS"] si anonyme
  scopes: string[]; // clés API / OAuth — [] en session BFF web
}
```

Le commentaire du contrat (`RealtimeEventMap.ts:120-126`) le pose : c'est une vue « sur soi » (équivalent `/auth/me`), **aucun secret** — seulement l'état d'auth et les rôles/scopes que le porteur connaît déjà. Le pattern front :

```ts
const identity = useNodefonyIdentity();              // rôles résolus serveur (cf realtime-client.md)
if (!identity?.authenticated) return <Login />;
const canAdmin = hasAnyRole(identity.roles, ["ROLE_NODEFONY_ADMIN", "ROLE_DEV"]);
```

→ le gating UI est **dérivé du serveur**. Conséquence : le RBAC front est **cosmétique** (griser un bouton, masquer une nav). L'**autorité reste serveur** : chaque endpoint data plane re-vérifie (firewall RBAC), et le serveur ne renvoie que ce que le porteur a le droit de voir. Bricoler `identity.roles` dans la console ne donne aucun accès — le serveur refuse.

---

## 7. Consommer le cœur isomorphe (imports réels)

Exemples vérifiés dans le front Studio (`src/packages/@nodefony/studio/frontend/`) :

```ts
// stores/RootStore.ts:4 — le client (face browser, via customConditions)
import { RealtimeClient } from "nodefony";
// …
this.realtime = RealtimeClient.shared({ /* url, token… */ });   // RootStore.ts:54 — singleton par URL

// App.tsx:12 + :278 — le provider React au-dessus du shell
import { NodefonyProvider } from "nodefony/react";
<NodefonyProvider client={rootStore.realtime}> … </NodefonyProvider>

// auth/roles.ts:480 — RBAC isomorphe
import { hasAnyRole, hasRole } from "nodefony/roles";
```

Pattern :

1. L'**app** est maîtresse du cycle de connexion : elle crée/partage le client (`RealtimeClient.shared`) et appelle `connect()` une fois (au shell).
2. Elle monte `<NodefonyProvider client={…}>` une fois au-dessus de l'arbre.
3. Les composants consomment les hooks `useNodefony*` (état, canaux, identité) et `nodefony/roles` (gating).

---

## 8. Gotchas

- **`tsc` rouge cross-package** (« Cannot find module 'http'/'security' » depuis un front) → `customConditions: ["browser"]` + `moduleResolution: "bundler"` manquants dans le tsconfig du front (§3). Vite passera quand même (il applique `browser` nativement) — le rouge est tsc-only.
- **`nodefony/react` introuvable au build** → `react`/`react-dom` sont des peerDeps **optionnelles** ; l'app qui importe `nodefony/react` doit les avoir installées.
- **Ne jamais importer la face serveur côté front** : pas d'`import { Kernel } from "nodefony"` dans un composant. Le barrel client n'expose volontairement aucune brique serveur (§4).
- **Pas de `@nodefony/client` séparé** : la lib cliente EST `nodefony` sous condition `browser`. Tout doc/réflexe parlant d'un paquet client distinct est périmé.
- **Cap 31 rôles** pour `RoleRegistry` (bitmask 32-bit signé) — au-delà, chaînes (`RoleSet`). N'affecte pas le front (rôles dynamiques = chaînes).
- **RBAC front = cosmétique** : ne jamais traiter `hasRole(...)` comme une barrière de sécurité ; l'autorité est serveur (re-vérif à chaque endpoint).
