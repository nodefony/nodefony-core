---
adr: 7
title: ClientKernel isomorphe — geler le contrat runtime client du framework (design only)
lang: fr
date: 2026-07-03
status: accepted
deciders: [Christophe CAMENSULI]
tags:
  [
    client,
    isomorphisme,
    kernel,
    realtime,
    observabilite,
    securite,
    dx,
    release-10,
  ]
---

# ADR-0007 — ClientKernel isomorphe : geler le contrat runtime client (design only, implémentation Phase 3.2)

## Statut

Accepté (2026-07-03). **Design only** : cet ADR gèle le **contrat** (nom, périmètre, surface API,
budgets, invariants) qui sera publié avec `nodefony@10.0.0`. **L'implémentation est différée en
Phase 3.2 post-MVP** (1ᵉʳ consommateur = le debug-client). Comme l'ADR-0006, ce document EST la
spécification à respecter le jour de l'implémentation.

## Contexte (vérifié dans le code le 2026-07-03)

### 1. L'isomorphisme est l'ADN de Nodefony — et il est déjà à moitié construit

Le package `nodefony` a **deux visages compilés depuis la même source** :

- condition `browser` sur l'export racine + subpaths client dédiés `./client`, `./react`,
  `./roles`, `./debugbar`, `./debugbar.js` (standalone) — `src/nodefony/package.json` ;
- un build client séparé (`rollup.config.ts:156` `createClientConfig`, 4 entries + standalone) ;
- une **garantie compilateur** « zéro node-ism » : `tsconfigClient.json` → `"types": []`,
  `lib DOM`, et 3 shims d'alias (`node:util`, `node:events`, `cli-color` →
  `src/client/shim/*`) ;
- des primitives **déjà isomorphes** : `Container`, `Service`, `Syslog`/`Pdu`, `Tools`
  (zéro import `node:` direct — vérifié), `Event` (via shim `EventEmitter`), `RealtimeClient`,
  `JsonRpcPeer`, `AdaptiveRate`, `Storage`, la debug bar ;
- le pattern « 1 source, N consommateurs » **fonctionne déjà** : le modèle pur du profiler
  (`NetworkModel`, `computeWaterfall` — `src/client/debugbar/index.ts`) est consommé à la fois
  par la debug bar et par la page Profiler de Studio, sans duplication.

### 2. Le déséquilibre : un Kernel côté serveur, rien côté client

Côté serveur, le `Kernel` orchestre tout : lifecycle en 11 hooks ordonnés (`onInit` →
`onPreStart` → `onStart` → `onPreRegister` → `onRegister` → `onPreBoot` → `onBoot` → `onReady` →
`onServersReady` → `onPostReady` → `onTerminate`, bitmask documenté
`src/nodefony/src/kernel/MEMORY.md:40`), DI, config, logs, modules. Tout composant s'y accroche —
c'est ce qui rend le back cohérent.

Côté navigateur, **aucun équivalent**. Chaque app front doit recâbler à la main la composition,
le lifecycle et l'observabilité. La preuve vivante est Studio :

- `frontend/src/stores/` = **1 511 lignes** de glue MobX, dont `RootStore.ts` (173 l) =
  composition root manuelle (instancie `RealtimeClient.shared`, `ApiClient`, `AuthService`,
  8 stores, câble les erreurs API → notifications, l'URL WS dérivée de l'origine, etc.) ;
- `ConnectionStore.ts` (326 l) = gestion connexion/reconnexion/abonnements/stats ;
- `AuthStore.ts` (265 l) = identité.

### 3. Le drift front est déjà mesurable — et il a déjà produit un trou de sécurité

Trois faits, vérifiés :

1. **`ApiClient` et `AuthService` vivent dans Studio**
   (`studio/frontend/src/services/ApiClient.ts`), pas dans le core. La prochaine app front (ou le
   debug-client) devra les réécrire — le wrapper `fetch` (cookies BFF `same-origin`, gestion 401
   non-destructive, pont « API souveraine » via la socket) n'est **pas réutilisable** aujourd'hui.
2. **Une règle de SÉCURITÉ vit dans la glue d'une seule app** : `RootStore.ts:140-148` — au
   changement d'identité, la socket WebSocket doit être re-handshakée (`disconnect()` +
   `connect()`), sinon le pont `api.request` rejoue des requêtes avec le token de l'**ancienne**
   identité gravée au handshake → fuite de données (**vécu en prod**). Toute app qui recâble sa
   glue sans reproduire cette reaction MobX **reproduit la faille**. Une règle de sécurité ne doit
   pas dépendre de la qualité du câblage artisanal de chaque app.
3. **La façade client viole les règles du core** : `src/client/index.ts:57-78` = `class Nodefony`
   singleton + **`export default`** (règle « named exports only » violée), et cette façade est
   **incohérente** avec le node (`Nodefony` statique, `getKernel()`). Audit client de mai
   (points B/C), jamais soldé. Fait nouveau vérifié ce jour : **aucun consommateur n'importe ce
   default** (Studio importe `{ RealtimeClient }` en named) → le retirer coûte ~0 aujourd'hui,
   une major demain.

### 4. La release 10 rend le contrat public — c'est maintenant ou dans une major

Le modèle de release tranché (§6bis `docs/release/nodefony-10.md`, modèle B N-packages lockstep)
publie les subpaths client **dans** `nodefony@10.0.0`. Tout ce qui sort par `nodefony/client` et
`nodefony/react` devient une promesse SemVer. Geler le contrat avant de publier coûte un
document ; après, une major.

## Décision

> Nommage : **`ClientKernel`** (classe), **`IClientKernel`** (contrat), conventions `I*` du repo.
> Le terme « kernel » est assumé : c'est le **même modèle mental** que le back — un chef
> d'orchestre de la couche technique — appliqué au navigateur. L'isomorphisme de Nodefony n'est
> pas « le même code partout », c'est **« le même modèle mental partout, le même code quand c'est
> pertinent »**.

### D1 — Périmètre fermé : le ClientKernel possède l'INFRA, jamais la VUE

**Il possède** (liste fermée) :

1. **La composition** des services techniques : registre de services nommés typés (log, api,
   realtime, storage, notifications).
2. **Le lifecycle client** mappé sur le navigateur (D5).
3. **L'observabilité** : `Syslog`/`Pdu` client de série, corrélation front→back (D8).
4. **Le cycle d'identité runtime** : réaction au changement d'identité → re-handshake socket +
   purge des caches enregistrés (D9).
5. **Le pont d'événements navigateur** : `visibilitychange`, `online`/`offline`,
   `beforeunload`/`pagehide`, exposés comme événements kernel.

**Il ne possédera JAMAIS** (clause anti-dérive) : le rendu, le routing, l'état métier, les
composants UI. React (ou Vue/Angular) + React Router + MobX restent maîtres de la vue. Les stores
deviennent des **adaptateurs minces** au-dessus des services du kernel. Un framework front qui
possède le rendu se bat contre React — ligne rouge. Sont exclus aussi, par définition : routeur
HTTP, firewall, ORM, serveurs — ces concepts n'existent pas dans un navigateur.

### D2 — Contrat d'abord : `IClientKernel` publié types-only en 10.0.0, implémentation différée

La 10.0.0 publie **l'interface** (`src/client/IClientKernel.ts`, exportée `export type` depuis le
barrel client) : **0 octet de runtime, 0 risque, et le nom + la surface sont gelés SemVer**.
C'est le pattern déjà éprouvé par le realtime : le contrat `IRealtimeSocket`/`IRealtimeChannel` a
été publié et stabilisé avant que le hub serveur ne soit complet — les consommateurs ont codé
contre le contrat, l'implémentation a suivi par incréments verts.

Surface gelée (v1 du contrat — volontairement minimale) :

```typescript
export interface IClientKernel {
  // ── Composition (registre de services nommés, typé par augmentation) ──
  get<K extends keyof NodefonyClientServices>(
    name: K,
  ): NodefonyClientServices[K];
  set<K extends keyof NodefonyClientServices>(
    name: K,
    svc: NodefonyClientServices[K],
  ): void;
  has(name: string): boolean;

  // ── Lifecycle (D5) ──
  boot(): Promise<void>; // compose + connecte (idempotent)
  terminate(): Promise<void>; // flush + disconnect (best-effort sur pagehide)
  readonly state: "created" | "booting" | "ready" | "terminated";

  // ── Événements (mêmes noms nominaux que le back quand le sens est le même) ──
  on(event: ClientKernelEvent, handler: (...args: unknown[]) => void): this;
  // "onBoot" | "onReady" | "onTerminate" | "onIdentityChange" | "onVisibility" | "onOnline"

  // ── Observabilité (D8) ──
  readonly log: Syslog; // logger client de série (Pdu isomorphes)
}

/** Registre typé par augmentation de module — même mécanique que NodefonyModuleConfig back. */
export interface NodefonyClientServices {
  realtime?: IRealtimeSocket;
  // "api", "storage", "notifications"… : ajoutés par augmentation, pas par le contrat v1.
}
```

**Pourquoi minimal** : chaque méthode publiée est une promesse de major. Le registre typé par
**augmentation de module** (`declare module "nodefony"`) réutilise la mécanique validée par
`NodefonyModuleConfig` (ADR-0006) : extensible sans jamais casser le contrat.

### D3 — Composition explicite, PAS de DI à décorateurs côté client

Le kernel client est une **composition root explicite** (comme `RootStore` aujourd'hui, mais
contractuelle), **pas** un container à décorateurs :

- les décorateurs `@injectable`/`@inject` + `reflect-metadata` restent **back-only** — ils sont
  déjà exclus du build client (`tsconfigClient.json` exclut `src/kernel/**`), et n'ont rien à y
  faire : le poids (`reflect-metadata` ≈ 3 KB gzip + metadata emit sur chaque classe) n'achète
  rien qu'une factory explicite ne donne pas dans une app front ;
- cette décision **entérine** le choix déjà posé par Studio (`RootStore.ts:31` : « Pas de DI lib
  côté front : MobX + un objet RootStore suffit, durable, facile à mocker en test ») — le
  ClientKernel formalise ce qui marche, il n'impose pas ce qui manque ;
- le `Container` isomorphe existant (déjà exporté par le barrel client) reste disponible pour qui
  en veut, mais le contrat `IClientKernel` n'expose que le registre `get`/`set` typé.

### D4 — Façade unique : mort de l'export default et du singleton `class Nodefony` client

La 10.0.0 supprime du barrel client (`src/client/index.ts:57-78`) la `class Nodefony` singleton
et son `export default`. Une seule forme d'accès : **named exports** + factory
**`createClientKernel(options)`**.

- **Pourquoi une factory et pas un singleton** : testabilité (N kernels en test), pas d'état de
  module global (piège HMR Vite vécu : un contexte dédoublé par réévaluation de module —
  gotcha StoreContext Studio), et symétrie avec le back où le singleton `kernel` exporté a déjà
  été supprimé pendant la migration TS (`import { kernel }` → `Nodefony.getKernel()`).
- **Pourquoi maintenant** : coût mesuré aujourd'hui = **zéro consommateur** de ce default
  (vérifié repo entier) ; après publication = une major.
- La façade utilitaire (`generateId`…) devient des named exports plats — ce qu'elle aurait
  toujours dû être.

### D5 — Lifecycle client : symétrie nominale avec le back, sémantique navigateur

Mapping gelé (noms alignés sur les hooks kernel back **quand le sens est le même**, jamais de
hook back singé sans équivalent réel) :

| Événement kernel client | Déclencheur navigateur                         | Équivalent back     |
| ----------------------- | ---------------------------------------------- | ------------------- |
| `onBoot`                | `boot()` appelé (composition faite)            | `onBoot`            |
| `onReady`               | services connectés (socket ouverte ou opt-out) | `onReady`           |
| `onIdentityChange`      | identité runtime change (login/logout/switch)  | — (client-specific) |
| `onVisibility`          | `document.visibilitychange`                    | — (client-specific) |
| `onOnline`              | `online`/`offline`                             | — (client-specific) |
| `onTerminate`           | `pagehide`/`beforeunload` (best-effort)        | `onTerminate`       |

**Pourquoi `pagehide` et pas seulement `beforeunload`** : `beforeunload` n'est pas fiable sur
mobile (bfcache) ; `pagehide` est le signal moderne recommandé. Le contrat nomme l'événement
kernel (`onTerminate`), l'implémentation choisira les listeners exacts — le contrat ne fige pas
un détail navigateur susceptible d'évoluer.

### D6 — Habitat : le subpath `nodefony/client` existant — pas de nouveau subpath

`IClientKernel` (types) et, en Phase 3.2, `createClientKernel` (runtime) vivent dans le barrel
`nodefony/client`. Pas de `nodefony/kernel-client`. **Pourquoi** : le kernel est le cœur du
client, pas une option périphérique ; les subpaths séparés (`react`, `debugbar`, `roles`,
futurs `sip`/`media`) restent réservés à ce qui doit être tree-shaké à 0 octet. Les deux règles
de fer existantes sont **reconduites telles quelles** : ① jamais de réexport sip/media/debugbar
depuis `client/index.ts` ; ② le barrel node (`src/index.ts`) ne tire jamais `src/client`.

### D7 — Opt-in strict : le kernel compose, il n'impose pas

Chaque primitive reste utilisable **nue**, sans kernel : `RealtimeClient.shared()` (utilisé par
Studio et la debug bar aujourd'hui — `RealtimeClient.ts:236`) continue de fonctionner tel quel,
de même que `mountDebugBar()`, les hooks `nodefony/react`, `Storage`. Le ClientKernel est la
**voie recommandée** pour une app complète, jamais un péage. **Pourquoi** : la DX des cas simples
(un widget, une page, un POC) est un actif — un kernel obligatoire pour afficher 3 stats serait
un échec produit, et c'est la même philosophie que le hub realtime (« le hub c'est le patron »
n'a jamais signifié « le hub est obligatoire pour ouvrir une socket »).

### D8 — L'observabilité full-stack est LE différenciateur embarqué

Deux briques, dans cet ordre :

1. **`ApiClient` remonte dans le core client** (généralisation de
   `studio/frontend/src/services/ApiClient.ts`) : wrapper `fetch` avec cookies BFF
   `same-origin`, gestion 401 **non-destructive** (ne jamais détruire une session
   potentiellement valide sur un 401 transitoire — leçon Studio), pont « API souveraine » via la
   socket (optionnel), et **corrélation native** : chaque requête émet
   `traceparent`/`x-request-id`, corrélés au `Pdu.requestId` back.
2. **Le bus de debug isomorphe** (canal `syslog:front`) : les `Pdu` émis par le `Syslog` client
   remontent par la socket, réinjectés dans le Syslog back → **une seule trace
   clic → route → ORM → render**, corrélée par `requestId`. C'est la 1ʳᵉ brique consommatrice du
   kernel (Phase 3.2, avec le debug-client), et l'aboutissement front de la vision Log Backplane.

**Pourquoi c'est le différenciateur** : aucun framework front/back JS n'offre la trace
full-stack corrélée out-of-the-box — c'est exactement le genre de propriété qui n'émerge que
d'un framework où client et serveur partagent le même modèle (`Pdu` isomorphe + socket native).
Et c'est la matière première de la couche IA (Phase 12) : un flux d'événements unifié et corrélé.

### D9 — La sécurité d'identité devient structurelle (sort de la glue applicative)

Le cycle « identité change → re-handshake socket + purge des états scopés utilisateur »
(aujourd'hui `RootStore.ts:104-156`, règle née d'une **fuite vécue en prod**) devient un
comportement **du kernel** (`onIdentityChange`) :

- le kernel re-négocie la socket (`disconnect()`/`connect()` — relecture du cookie courant, les
  abonnements se rejouent par ref-counting déjà dans `RealtimeClient`) ;
- il notifie `onIdentityChange` pour que l'app purge ses propres caches ;
- il applique les gardes déjà apprises : jamais de `disconnect()` au boot (couperait les
  requêtes en vol via le pont), purge uniquement sur un **vrai** changement de compte.

**Pourquoi** : une propriété de sécurité (anti-élévation de privilège sur socket à identité
figée) doit valoir **par construction** pour toute app Nodefony, pas par la vigilance du dev qui
recopie la glue. C'est le même principe que le firewall back : la sécurité est dans le
framework, pas dans chaque controller.

### D10 — Budgets bundle chiffrés + gate outillée

Mesures du jour (gzip, dist réel, 21 fichiers `preserveModules`) : total entries client
≈ 50 KB, dont debug bar ≈ 26,4 KB, react+roles ≈ 6 KB → **cœur `nodefony/client` ≈ 17,6 KB**.
Budgets gelés :

| Entry                         | Aujourd'hui        | Budget 10.x (gzip) |
| ----------------------------- | ------------------ | ------------------ |
| `nodefony/client` (barrel)    | ~17,6 KB           | **≤ 30 KB**        |
| dont ClientKernel (Phase 3.2) | 0 (types)          | **≤ +6 KB**        |
| `nodefony/react`              | ~6 KB (avec roles) | ≤ 10 KB            |
| `nodefony/debugbar`           | ~26,4 KB           | ≤ 35 KB (dev-only) |

Gate : **`size-limit` par entry câblé dans le pipeline release** (`scripts/release.mjs`, à côté
de la bascule `exports.types` déjà actée §6bis) — il n'existe **aucune** gate de taille
aujourd'hui (vérifié). Un dépassement de budget = blocker de release, pas un warning.
L'implémentation Phase 3.2 commence par un **prototype + mesure** avant tout engagement de code
définitif (garde-fou déjà acté dans la vision).

### D11 — Convergence Studio par incréments — jamais de big-bang

Ordre gelé (chaque étape livre un produit vert, méthode realtime) :

1. **10.0.0 (design only)** : publier `IClientKernel` (types) + D4 (façade nettoyée) + budgets
   D10 outillés. Studio inchangé.
2. **Phase 3.2a** : `ApiClient` core (D8.1) — Studio le consomme via un alias local le temps de
   migrer ses imports ; le debug-client naît directement dessus.
3. **Phase 3.2b** : `createClientKernel` minimal (registre + lifecycle + identité D9) — le
   **debug-client est le 1ᵉʳ consommateur pur** (client neuf, zéro legacy).
4. **Phase 3.2c** : `RootStore` Studio devient un consommateur du kernel (la reaction identité
   et la composition migrent dans le kernel ; les stores restent, amincis en adaptateurs).
   Critère : suite e2e Studio verte sans régression.

**Pourquoi le debug-client en premier** : un consommateur neuf valide le contrat sans le biais
du legacy ; Studio migre ensuite sur un kernel déjà rodé — le contraire (migrer Studio d'abord)
ferait du kernel un moule du legacy Studio.

## Alternatives écartées

| Alternative                                              | Pourquoi écartée                                                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Transplanter le Kernel serveur dans le navigateur** | Routeur/firewall/ORM/serveurs n'ont pas d'existence navigateur ; le Kernel back pèse et suppose un process. L'isomorphisme de Nodefony = même modèle mental, pas même binaire.                                            |
| **B. DI à décorateurs côté client**                      | `reflect-metadata` + metadata emit = poids et complexité sans gain vs composition explicite ; contredit la décision Studio éprouvée (`RootStore.ts:31`) ; l'injector est déjà exclu du build client.                      |
| **C. Package séparé `@nodefony/client`**                 | Déjà tranché (2026-05-21, [[project_client_lib_subpaths_decision]]) : subpaths du core = tree-shaking par entry, couplage de version = avantage (type-safety end-to-end), 1 package à maintenir (solo). P13.3 supprimé.   |
| **D. Statu quo — chaque app garde sa glue**              | C'est le drift qu'on tue : 1 511 lignes non réutilisables, `ApiClient` à réécrire par app, et une règle de sécurité (D9) dont la présence dépend du copier-coller. Inacceptable une fois le contrat publié.               |
| **E. Framework front complet (routing/rendu possédés)**  | Ligne rouge D1 : se battre contre React/Vue/Angular est perdu d'avance ; la valeur de Nodefony côté client est l'infra (socket, api, observabilité, identité), pas la vue.                                                |
| **F. Implémenter maintenant (pas design only)**          | La Phase 0 release a un chemin critique (0.6 revue realtime, 0.7 Dockerfile DoD) ; le contrat suffit à stopper le drift et ne bloque personne. L'implémentation sans consommateur neuf (debug-client) serait spéculative. |

## Conséquences

**Positives**

- Le contrat client est **gelé avant** d'être rendu public — plus de câblage artisanal érigé en
  API de fait ; le drift front s'arrête à la source.
- Symétrie back/front assumée : même modèle mental (kernel, services, lifecycle, événements),
  même mécanique d'extension typée (augmentation de module, comme ADR-0006).
- La sécurité d'identité (D9) et l'hygiène 401 (D8) valent **par construction** pour toute app.
- L'observabilité full-stack corrélée devient une propriété du framework — et le socle de la
  Phase 12 (IA).
- Studio cesse d'être « la référence de fait qui dérive » pour devenir le consommateur de
  référence d'un contrat.

**Négatives / risques assumés**

- Un contrat types-only peut diverger du besoin réel tant qu'aucun runtime ne l'éprouve →
  mitigé par D11 (debug-client 1ᵉʳ consommateur, contrat minimal v1, extension par augmentation).
- La remontée d'`ApiClient` dans le core est une généralisation délicate (il embarque des choix
  Studio : notifications, pont socket) → mitigée par l'ordre D11.2 (alias local, migration douce)
  et par le découpage options/callbacks déjà présent dans son constructeur.
- Budget bundle : +1 brique dans le barrel client → gate D10 **avant** tout merge Phase 3.2.
- Breaking 10.0.0 (D4, suppression du default client) → coût mesuré nul aujourd'hui, à noter
  dans le changelog de la 10.

**Critères d'acceptation de l'implémentation (Phase 3.2 — repris de cet ADR)**

1. Prototype + `size-limit` : budgets D10 tenus, mesures dans le message de commit.
2. Le debug-client consomme `createClientKernel` sans importer un seul module Studio.
3. Studio migré (D11.4) : e2e vertes, `RootStore` ≤ ~80 lignes (composition déléguée au kernel),
   la reaction identité supprimée au profit d'`onIdentityChange`.
4. Le smoke test de parité release (npm pack → install vierge → `tsc --noEmit`) type-check un
   `import type { IClientKernel } from "nodefony/client"`.

## Références

- Code (ancrages vérifiés 2026-07-03) : `src/nodefony/package.json` (exports browser+subpaths) ·
  `src/nodefony/src/client/index.ts:57-78` (façade à supprimer) · `tsconfigClient.json`
  (garantie `types:[]` + shims) · `src/nodefony/rollup.config.ts:156` (`createClientConfig`) ·
  `studio/frontend/src/stores/RootStore.ts` (composition manuelle ; :31 pas de DI front ;
  :104-156 cycle identité) · `studio/frontend/src/services/ApiClient.ts` (à remonter) ·
  `src/nodefony/src/kernel/MEMORY.md:40` (hooks lifecycle back).
- ADR : [0003](0003-orm-core-abstraction-repository-multi-orm.md) (abstraction par contrat),
  [0006](0006-configuration-unifiee-env-override.md) (augmentation de module typée, format spec).
- Mémoires IA : `project_realtime_nodefony_socket_vision` (North Star socket, contrat d'abord) ·
  `project_client_lib_subpaths_decision` (subpaths, règles de fer, audit B/C) ·
  `project_release_nodefony10` (modèle B, DoD) · session 2026-06-29 (vision ClientKernel affinée).
- Release : `docs/release/nodefony-10.md` §6bis (pipeline pack, smoke test de parité).
