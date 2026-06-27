# Référence — Back-end Studio (controller · data plane · auth · realtime serveur)

> Studio a un **back-end Nodefony** (≠ front React). TS serveur (`Controller` de `@nodefony/framework`,
> `Context` de `@nodefony/http`). La règle **perf/mémoire Core** s'applique (cf `nodefony-framework-dev`).

## Sommaire

- 1. Fichiers + partition du namespace `/nodefony`
- 2. Ajouter un endpoint data plane
- 3. Lire la requête (décorateurs)
- 4. Sécurité back Studio (firewall réel, Zero Trust)
- 5. Realtime serveur (push WS)
- 6. Cycle de build (≠ front) + piège #1 cluster

## 1. Fichiers + partition du namespace

Fichiers : `nodefony/controller/StudioController.ts` (pages UI SPA + data plane utilitaire studio ;
**l'auth N'est PLUS ici** — cf §4), `nodefony/controller/StudioRealtimeController.ts` (WS JSON-RPC),
`nodefony/realtime/providers.ts` (providers de canaux). La frontière isomorphe ne s'applique PAS ici
(c'est le serveur), mais la **règle perf/mémoire Core** oui.

**Partition du namespace `/nodefony` (FIGÉE — cf studio/CLAUDE.md)** :

- UI SPA (humain) = **mono-segment** `/nodefony` + `/nodefony/{page}`, portée par Studio.
- Data plane (machine) = `/nodefony/<module>/api/*` (**≥3 segments**, marqueur `/api/`), porté par
  CHAQUE module (vit dans le module propriétaire : kernel/framework/http…, PAS dans Studio).
- Règle : un module n'expose JAMAIS une route admin mono-segment `/nodefony/<module>`. Toujours `/api/*`.

## 2. Ajouter un endpoint data plane

Dans le module propriétaire (pas Studio si possible) :

```ts
// @controller("/nodefony") dans le module ; renvoyer du JSON
@Get("/<module>/api/things")
listThings(@Query("limit") limit?: string) {
  return this.renderJson({ things: [...] });   // jamais de couplage à la vue
}
```

Le front consomme via `store.api.getAbsolute<T>("/nodefony/<module>/api/things")`.

## 3. Lire la requête — décorateurs, PAS `this.context.body`

- `@Body() body: T` (corps parsé), `@Param("x")`, `@Query("x")`, `@Header("x")`.
  ⚠️ **`this.context.body` est vide/non parsé** → un POST lu ainsi tombe sur le défaut silencieusement
  (bug vécu sur un handler de login : renvoyait toujours le compte par défaut, jamais le username envoyé).
  Toujours `@Body()`.
- En-têtes bruts (ex. `Authorization`) : `this.context.request.headers.authorization` (clé **minuscule**,
  Node lowercase ; peut être `string | string[]`).
- Réponses : `this.renderJson(obj)` (API), `this.setContextHtml()` + `this.render(html)` (page).

## 4. Sécurité back Studio (firewall réel, Zero Trust, priorité max)

L'auth Studio est **RÉELLE** : firewall `@nodefony/security` (zone `nodefony-admin`), **session BFF**
(cookie opaque) servie par `SessionAuthController` + `AuthFlow` sur `/nodefony/security/api/auth/{login,me,logout}`.
**Aucun mock dans `StudioController`** (les anciens `/studio/api/auth/*` sont SUPPRIMÉS). Tout data plane admin
est derrière le firewall (anonyme → **401**).

- Toute API admin EXIGE un rôle (`ROLE_NODEFONY_ADMIN`) → **403** sinon. Le gating se fait via le **broker**
  (`IAdminApi` → `AdminBroker`, RBAC + audit gratuits) ou un `@IsGranted` ; ne jamais re-rouler une garde à la main.
- Rôles dérivés **côté serveur** depuis la session, jamais lus tels quels du token/payload client.
- Endpoints qui EXÉCUTENT (run tests, scaffold) → **DEV-ONLY** : 403 hors `development`.
- Secrets/credentials **redactés côté serveur** avant `renderJson` ; jamais en clair, jamais loggés.
- `bypassFirewall` est réservé aux endpoints **publics par conception** (liveness k8s, `/info` pré-login
  à surface minimale) — jamais sur une route qui lit une donnée sensible.

## 5. Realtime serveur (push WS)

Providers transport-agnostiques (`createXxx(publish)`), `dispose()`
garanti au `unsubscribe` ET `ctx.once("onFinish")`. ⚠️ Après le handshake `ctx.send()` **rejette**
(`requestEnded=true`) → pousser sur la **connexion brute** `ctx.connection.send(str, cb)` (garde
`readyState===1`). **SSE** : écouter `rawRes.once("close")` (RESPONSE), jamais `request.on("close")`
(fire trop tôt en HTTP/2).

## 6. Cycle de build (≠ front !)

- Modif **front** (`frontend/src/**`) → **HMR Vite, 0 restart**.
- Modif **back** Studio (`nodefony/**` : controller, providers, config) → `cd src/packages/@nodefony/studio
&& npm run build` (**rollup**, pas Vite) **puis** restart serveur (`start.sh`).
- Modif **core** ou **nouveau subpath `nodefony/*`** → build core (`cd src/nodefony && npm run build`)
  **puis** restart (Vite ré-optimise les deps au boot ; un subpath neuf n'est pas résolu à chaud).
- Vérif back sans navigateur : **curl le data plane** (`curl -sk https://127.0.0.1:5152/nodefony/<m>/api/...`)
  - curl le transform Vite (`https://127.0.0.1:5173/@fs/<abs>.tsx`) pour valider la résolution d'un subpath.

> 🚨 **PIÈGE #1 EN CLUSTER (`nodefony cluster -w N`) — 0 HMR + `build:front` ≠ `build`** : en cluster,
> le front est un **bundle prod figé** (Vite ne tourne pas). Deux conséquences mortelles :
>
> 1. **`npm run build:front` (= `nodefony frontend:build`, Vite) ne recompile QUE le frontend.** Il ne
>    touche PAS le **back Studio** (`nodefony/**` : controller, **realtime providers** comme
>    `clusterSupervision.ts`). Un fix back « invisible au runtime » alors qu'on a « rebuildé » 5× =
>    on a rebuildé le mauvais étage. **Back Studio → `cd src/packages/@nodefony/studio && npm run build`
>    (rollup)**, TOUJOURS. Vérifier : `grep <ta-chaîne> src/packages/@nodefony/studio/dist/nodefony/...`.
> 2. **Toute modif front** = `build:front` **+ kill/restart cluster** (`renderProdTags` cache le manifest
>    au boot → restart obligatoire, pas juste le build) **+ hard-reload navigateur avec DevTools
>    « Disable cache » ON** (sinon vieux `index.html` → chunk hashé supprimé → **404 import lazy = "la
>    page ne marche plus"**, ≠ bug code). Ne PAS saturer le cluster (ELU 100 %) en testant → la **socket
>    Studio meurt en premier** (famine event-loop) → charge **modérée**.
> 3. **Diag drill cluster** : un canal `dashboard:supervision@<pid>` muet se prouve côté serveur par un
>    mini-client `ws` (subscribe + compte frames) lancé **depuis `.claude/skills/nodefony-load-test/scripts/`**
>    (résout `ws`), PAS depuis `/tmp`. Vrai bug trouvé ainsi : `mapInstanceToSupervision` faisait
>    `r?.elu.active` → **TypeError dès que la sonde riche arrive** (`r.elu` undefined) → 0 frame →
>    `r?.elu?.active`. Garder l'optional chaining JUSQU'AU BOUT sur les sondes riches optionnelles.
