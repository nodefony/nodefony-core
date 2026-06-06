---
name: nodefony-studio-dev
version: 1.21.0
description: >
  Aide au développement du frontend Studio (@nodefony/studio, React 19) : construire un écran —
  page, dashboard, panneau, onglet — vite et bien en réutilisant le UI kit (PageHeader, DataState,
  StatCard, KeyValue, JsonViewer, MiniChart), le hook useResource et les hooks temps réel
  nodefony/react (useNodefonyState/Channel/ChannelData/Syslog). Donne la recette (route + lazy +
  navConfig + fallback deep-link + data plane), des squelettes copier-coller (données / live /
  détail) et les règles qualité (a11y, sécu, gate tsc). Couvre AUSSI la debug bar Nodefony
  (nodefony/debugbar — vanilla TS + Shadow DOM, dev-only, ≠ React/Mantine).
  Déclencheurs : "dev studio", "page studio", "dashboard studio", "écran studio", "panneau studio",
  "composant studio", "page /nodefony", "comment coder dans studio", "debug bar", "debugbar",
  "barre de debug", "coder dans la debug bar", "WDT".
---

# nodefony-studio-dev — kit de dev Studio pour agent IA

Playbook **déterministe** : produis un écran Studio (page / dashboard / panneau / onglet)
**cohérent, accessible, perf** sans explorer le code. Toutes les signatures et tous les chemins
nécessaires sont ici. Studio = `src/packages/@nodefony/studio/frontend` (React 19 + Mantine **v9** +
MobX + React Router 7). Racine module : `src/packages/@nodefony/studio`.

> Page de RÉFÉRENCE (pattern complet) : `frontend/src/routes/RoutesView.tsx`.
> Page DÉTAIL (onglets) : `frontend/src/routes/ModuleDetail.tsx`. Live : `frontend/src/routes/Dashboard.tsx`.
> Ne PAS relire les sources du kit : tout est ci-dessous.

## 🔗 Paire POLYMORPHE front ⇄ back (co-évolution OBLIGATOIRE)

`nodefony-studio-dev` (front) et `nodefony-framework-dev` (back) sont les **deux faces d'UN kit full-stack**,
à l'image de l'isomorphisme Nodefony (back/front partagent `nodefony`). **Ce skill = CONSOMMER le contrat** ;
`nodefony-framework-dev` = le **produire**. Le SEAM partagé :

- **Data-plane** `/nodefony/<mod>/api/*` (front via `useResource`/`ApiClient` ← back via `IAdminApi`).
- **Realtime** : canaux + actions (front via hooks/`conn.request`/`conn.ping` ← back via `RealtimeController`). Hub = patron.
- **Types** : exports `nodefony` (isomorphes) + `I*Api`/`I*Controller` = **source de vérité unique** (jamais une copie figée).

**Quand passer la main** : dès que le besoin touche le CŒUR — service injectable, module, commande CLI, entité/
repository/adapter ORM, pipeline HTTP/WS, **nouveau canal/action/format realtime SERVEUR** (`RealtimeController`,
`JsonRpcPeer`, `IRealtimeHub`, transports TCP/UDP/Redis), **subpath Core isomorphe** (`nodefony/*`), ou QUOI
construire pour le non-fait (roadmap, P6) — **invoquer `nodefony-framework-dev`** (RÈGLES perf-mémoire, recettes
vérifiées source, gates Core).

**RÈGLE DE CO-ÉVOLUTION (les skills « dev ensemble »)** : une feature qui traverse front+back →
**mettre à jour LES DEUX skills dans la MÊME session**, retex cross-liés (même apprentissage, 2 angles).
Quand le front commence à consommer un **canal/action/endpoint/type** nouveau → vérifier qu'il est décrit côté
`nodefony-framework-dev` (et inversement). Ouvrir le skill jumeau dès qu'une feature touche son côté.

**VERSION COMMUNE (lockstep)** : les deux skills partagent **UNE même version SemVer** (frontmatter) =
snapshot cohérent du contrat full-stack. **Bumper LES DEUX au même numéro** à chaque co-évolution
(même si un seul fichier change beaucoup, l'autre suit au minimum d'un patch + ligne changelog). Actuel : **1.16.1**
(session BACKEND `nodefony-framework-dev` 1.16.1 : **durcissement framework F1+F4** — purge `any` de dette

- couverture unit Controller 22→80 % / Resolver + doc hook `initialize()`.
  **Aucun contrat front touché** → studio-dev suit en lockstep **back-only**, pas de changement de page/canal/type).

## API exacte — UI kit (`import { … } from "../components/ui"`)

```ts
useResource<T>(fetcher: () => Promise<T>): { data: T|null; loading: boolean; error: string|null; reload: () => void }
//   ↑ import depuis "../hooks". `fetcher` DOIT être useCallback(...). Annule la requête au démontage.

<PageHeader title subtitle? icon? actions? />            // title = <h1>. actions = boutons à droite.
<DataState loading error? empty? onRetry? emptyMessage? minHeight?>{children}</DataState>  // priorité error>loading>empty>children
<StatCard label icon? hint? span?>{valeur}</StatCard>    // REND sa propre <Grid.Col> → mettre DANS <Grid>. span défaut {base:12,sm:6,lg:3}
<InfoHint text />                                          // tooltip SIMPLE (micro-UI : filtre, toggle, colonne DataGrid)

// Bulles d'aide TYPÉES = fiches de doc (HoverCard : en-tête icône+titre+badge version, résumé,
// paragraphes structurés, liens externes sécurisés). Ouvre au survol ET focus clavier ; reste
// ouverte pour lire/sélectionner. Le `kind` choisit icône+accent+badge. Réf : routes/RealtimeConsole.tsx.
<DocHint   title version? summary? sections? links? />     // 📖 doc (défaut)  — concept, métrique
<GraphHint title version? summary? sections? />            // 📈 graphe        — comment lire une courbe
<LinkHint  title links={[{label,href}]} summary? />        // 🔗 lien externe  — RFC, doc tierce (rel=noreferrer)
<TipHint   title summary? sections? />                     // 💡 astuce        — conseil d'usage, raccourci
<WarnHint  title summary? sections? />                     // ⚠ attention     — limite, piège, prérequis
<Hint kind="doc|graph|link|tip|warning" title … />         // forme générique (les 5 ci-dessus en sont les presets)
//   sections = [{ label:"Technique"|"Si vide"|…, body }] ; KpiCard/StatCard/MiniStat/Panel acceptent
//   `info={<DocHint/>}` (rendu À LA PLACE du `hint` texte). DocHint = ex-InfoHint « riche ».
<KeyValue k v mono? />                                     // ligne label→valeur ; mono=monospace
<DefinitionList gap?>{…KeyValue}</DefinitionList>
<JsonViewer value maxHeight? />                            // dump JSON read-only + copier (texte sûr, 0 injection)
<MiniChart series={[{data:number[],color:string,label:string}]} height? max? threshold? format? />  // courbe SVG ; JAMAIS recharts
<ChartCard title caption badge?>{<MiniChart/>}</ChartCard>
<Legend color label />

// DataGrid<T> — grille RÉUTILISABLE (bâtie sur @tanstack/react-table, déjà en deps).
// NE PAS hand-roller un tableau/filtre/tri/pagination : utiliser ceci.
<DataGrid
  mode="client" data={rows[]}                       // CLIENT : tout en mémoire
  // OU mode="server" loader={(q)=>Promise<{rows,total}>}  // SERVEUR : q={page,pageSize,sort,search,columnFilters} ; loader DOIT être useCallback
  columns={DataGridColumn<T>[]}                      // {key,header,align?:"left"|"right",sortable?,filterable?,filterType?:"text"|"number"|"select",filterOptions?:string[],hint?,render?(row),value?(row)}
  getRowId={(r)=>string} onRowClick?={(r)=>void}
  initialSort?={{key,dir}} pageSize?={25} height?="100%"
  searchable?={true} searchPlaceholder?
  persist?={{ key:"studio.<vue>", storage:"session"|"local" }}  // sauve tri+filtres+colonnes+pagination (clé indexée nf.datagrid:<key>)
/>
// Inclus : recherche globale, filtres par colonne à OPÉRATEURS (inline, contains/=/≥/vide…),
// masquer des colonnes (menu Colonnes), tri, pagination client+serveur, persistance + clear.
// En mode serveur, l'état persisté est restauré AVANT la 1ʳᵉ requête (pas de double-fetch).
// Réf client : routes/Database.tsx (vue Liste). Réf serveur : routes/RoutesView.tsx + back FrameworkAdminApi `routes/page`.
```

## API exacte — hooks temps réel (`import { … } from "nodefony/react"`)

```ts
useNodefony(): RealtimeClient                              // client brut (RPC request/stream) — rare
useNodefonyState(): "connected"|"connecting"|"reconnecting"|"disconnected"|"error"
useNodefonyChannel(channel, (payload)=>void, deps?=[])    // sub/unsub auto + reconnect ; handler capturé (pas besoin de deps)
useNodefonyChannelData<T>(channel, initial?=null): T|null  // dernière valeur reçue
useNodefonyChannelStats(channel): { msgCount; lastMessage; rate; series } | null
useNodefonySyslog({ max?=500; severities?; channel?="syslog:stream" }): unknown[]   // ring buffer prêt
useNodefonyNotifications((notice: NodefonyNotice)=>void, deps?=[])   // chaque notice normalisée → handler (bridge snackbar). Monter 1× au shell.
useNodefonyNoticeLog({ max?=50; sources? }): NodefonyNotice[]        // ring buffer des notices (hub « incidents temps réel »)
```

`NodefonyNotice = { level:"success"|"info"|"warning"|"error"; title?; message; source:"realtime"|"api"|"server"; code?; ts }` (import depuis `nodefony`). Émise par `RealtimeClient` sur close anormal (RFC 6455 → `closeCodeToNotice`), erreur serveur poussée, reconnexion. **Studio ne consomme PAS ces hooks** : il branche `NotificationStore` (MobX) sur `realtime.onNotice` au constructeur (les hooks servent les apps React non-MobX).
`<NodefonyProvider>` est DÉJÀ monté dans `App.tsx` et la connexion ouverte par l'app
(`AdminLayout`). **NE JAMAIS** remonter le Provider ni appeler `client.connect()` dans une page.

## Accès données + stores

```ts
import {
  useStore,
  useAuth,
  useUi,
  useConnection,
  useAdmin,
  useProfiler,
  useNotifications,
} from "../stores";
// useNotifications() → NotificationStore : .notify(level,message,{title?,source?,code?}) pour pousser
// un toast (ex. depuis une action) ; .realtimeIncidents (notices realtime/server, hub) ; .recent.
const store = useStore();
store.api.getAbsolute<T>("/nodefony/<module>/api/..."); // data plane absolu (modules) — le cas courant
store.api.get<T>("/..."); // relatif à /nodefony/studio/api
// + postAbsolute / deleteAbsolute. Catalogue des producteurs : /nodefony/framework/api/admin
```

Data plane utile : `/nodefony/kernel/api/{info,modules,module/{name}}`, `/nodefony/framework/api/{info,routes,admin}`, `/nodefony/<module>/api/*`. JAMAIS d'URL en dur hors data plane.

## Recette — ajouter un écran (étapes déterministes)

1. **`frontend/src/routes/MaVue.tsx`** — `export const MaVue = observer(() => { … })` (observer si lit un store/realtime).
2. **`frontend/src/App.tsx`** :
   - ajouter `const MaVue = lazy(() => import("./routes/MaVue").then((m) => ({ default: m.MaVue })));` (bloc des lazy).
   - ajouter `{ path: "ma-vue", element: <MaVue /> },` dans les `children` de `<AdminLayout/>`.
3. **`frontend/src/layouts/navConfig.ts`** — dans le bon groupe de `NAV_GROUPS` :
   `{ to: "/nodefony/ma-vue", label: "Ma vue", icon: IconX }` (icône `@tabler/icons-react`).
4. **Deep-link ≥2 segments** (`/ma-vue/:id`) → ajouter le **fallback SPA littéral** dans
   `nodefony/controller/StudioController.ts` (route `@Get("/nodefony/ma-vue/:id")` → renderStudio).
   JAMAIS de catch-all générique (régression vécue → 21 échecs http). Mono-segment = déjà couvert.
5. **Build conditionnel** : modif frontend = HMR (0 restart). Modif backend (controller) = `stop.sh`+`start.sh`.

## Squelette — DONNÉES (liste / fetch)

```tsx
import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import { Stack, Button } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import { PageHeader, DataState } from "../components/ui";

export const Things = observer(() => {
  const store = useStore();
  const fetcher = useCallback(
    () => store.api.getAbsolute<Thing[]>("/nodefony/<mod>/api/things"),
    [store],
  );
  const { data, loading, error, reload } = useResource(fetcher);
  const rows = data ?? [];
  return (
    <Stack gap="md">
      <PageHeader
        title="Things"
        subtitle={`${rows.length} élément(s)`}
        actions={
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={loading}
            onClick={reload}
          >
            Recharger
          </Button>
        }
      />
      <DataState
        loading={loading && !rows.length}
        error={error}
        empty={!rows.length}
        onRetry={reload}
      >
        {/* table TanStack (copier RoutesView) OU grille de cartes */}
      </DataState>
    </Stack>
  );
});
```

## Squelette — LIVE / DASHBOARD (temps réel)

```tsx
import { Grid, Stack } from "@mantine/core";
import { PageHeader, StatCard, ChartCard, MiniChart } from "../components/ui";
import { useNodefonyState, useNodefonyChannelData } from "nodefony/react";

export function LiveBoard() {
  const state = useNodefonyState();
  const stats = useNodefonyChannelData<Stats>("<canal>:stats");
  return (
    <Stack gap="lg">
      <PageHeader title="Board" subtitle={`Realtime : ${state}`} />
      <Grid>
        <StatCard label="Débit" hint="msg/s">
          {stats?.rate ?? "—"}
        </StatCard>
      </Grid>
      <ChartCard title="…" caption="…">
        <MiniChart
          series={[
            { data: history, color: "var(--mantine-color-blue-6)", label: "x" },
          ]}
        />
      </ChartCard>
    </Stack>
  );
}
```

## Squelette — DÉTAIL (onglets)

`<PageHeader>` (ou en-tête custom) + `<Tabs>` Mantine (onglets masqués si vides) + `<KeyValue>`
pour les infos + `<JsonViewer>` pour config/dump. Copier `frontend/src/routes/ModuleDetail.tsx`.

## Debug bar (`nodefony/debugbar`) — VANILLA + Shadow DOM (≠ Studio React)

Contexte **DIFFÉRENT** de Studio. La debug bar (WDT à la Symfony, dev-only) est un subpath **Core**
isomorphe, **vanilla TS + Shadow DOM** — **AUCUN React/Mantine/JSX, AUCUN UI kit Studio ici**.

- **Où** : `src/nodefony/src/client/debugbar/*.ts` (workspace Core `src/nodefony`, PAS studio/frontend).
  `DebugBar.ts` (widget), `network.ts` (intercepteur fetch/XHR), `profile.ts`/`model.ts` (waterfall),
  `format.ts`, `hmr.ts`, `index.ts` (barrel).
- **Particularité vanilla** : DOM créé à la main, monté dans un **Shadow DOM**
  (`host.attachShadow({ mode:"open" })`) → styles 100 % isolés de la page hôte (0 fuite CSS, pas de
  Mantine). **JAMAIS** de splice `</body>` rendu serveur (≠ legacy « sale »). Realtime = `RealtimeClient`
  Core **direct** (PAS les hooks `nodefony/react`), `Pdu` Core pour les logs.
- **API** : `import { mountDebugBar } from "nodefony/debugbar"; mountDebugBar(opts)`. Handle global
  `window.__NODEFONY_DEBUGBAR__.setVisible(bool)/toggle()` ; localStorage **`nf.debugbar.visible`**
  (PARTAGÉ avec `UiStore.debugBar` de Studio). Exports : `DebugBar`, `mountDebugBar`, `computeWaterfall`,
  types `NetEntry`/`DebugBarModel`.
- **3 montages** : (1) auto en dev via plugin Vite (`@nodefony/frontend`) ; (2) toggle Studio
  (`AdminLayout` → handle global) ; (3) standalone `nodefony/debugbar.js`
  (`dist/client/debugbar.standalone.js`, mono-fichier, `<script type=module>` sur page EJS/Twig).
- **Symbiose Studio** : clic Network → `dispatchEvent(new CustomEvent("nodefony:debugbar:select",
{ detail:{ requestId } }))` → `AdminLayout` écoute → `navigate("/nodefony/profiling?req="+id)`.
  Profil serveur via data-plane `/nodefony/profiler/api/*`. SPA : on profile **les appels AJAX**
  (chacun son `X-Request-Id`), pas la page.
- ⚠️ **Build = Core** : `cd src/nodefony && npm run build` (PAS Vite HMR). La règle perf/mémoire Core
  s'applique (lazy, `removeListener`, pas d'alloc « au cas où »).
- ⚠️ **Gotcha import** : `@analogjs/vite-plugin-angular` trébuche sur `import … from "nodefony/debugbar"`
  dans un `.ts` (« Angular decorators ») → dans un **store `.ts`** Studio = **types miroir locaux** ;
  les `.tsx` (plugin React) peuvent importer le subpath.
- **Dev-only / opt-in strict** : jamais en prod (perf + fuite d'info). Réf : mémoire `project_studio_debugbar`.

## Back-end Studio (controller + data plane + auth/mock + realtime)

Studio a un **back-end Nodefony** (≠ front React). Fichiers : `nodefony/controller/StudioController.ts`
(pages UI + mock auth + data plane studio), `nodefony/controller/StudioRealtimeController.ts`
(WS JSON-RPC), `nodefony/realtime/providers.ts` (providers de canaux). Tout est du **TS serveur**
(`Controller` de `@nodefony/framework`, `Context` de `@nodefony/http`) — la frontière isomorphe
ne s'applique PAS ici (c'est le serveur), mais la **règle perf/mémoire Core** oui.

**Partition du namespace `/nodefony` (FIGÉE — cf studio/CLAUDE.md)** :

- UI SPA (humain) = **mono-segment** `/nodefony` + `/nodefony/{page}`, portée par Studio.
- Data plane (machine) = `/nodefony/<module>/api/*` (**≥3 segments**, marqueur `/api/`), porté par
  CHAQUE module (vit dans le module propriétaire : kernel/framework/http…, PAS dans Studio).
- Règle : un module n'expose JAMAIS une route admin mono-segment `/nodefony/<module>`. Toujours `/api/*`.

**Ajouter un endpoint data plane** (dans le module propriétaire, pas Studio si possible) :

```ts
// @controller("/nodefony") dans le module ; renvoyer du JSON
@Get("/<module>/api/things")
listThings(@Query("limit") limit?: string) {
  return this.renderJson({ things: [...] });   // jamais de couplage à la vue
}
```

Le front consomme via `store.api.getAbsolute<T>("/nodefony/<module>/api/things")`.

**Lire la requête — décorateurs, PAS `this.context.body`** :

- `@Body() body: T` (corps parsé), `@Param("x")`, `@Query("x")`, `@Header("x")`.
  ⚠️ **`this.context.body` est vide/non parsé** → un POST lu ainsi tombe sur le défaut silencieusement
  (bug vécu : mock login renvoyait toujours `admin`). Toujours `@Body()`.
- En-têtes bruts (ex. `Authorization`) : `this.context.request.headers.authorization` (clé **minuscule**,
  Node lowercase ; peut être `string | string[]`).
- Réponses : `this.renderJson(obj)` (API), `this.setContextHtml()` + `this.render(html)` (page).

**Sécurité back Studio (Zero Trust, priorité max)** :

- Toute API admin EXIGE un rôle (`ROLE_NODEFONY_ADMIN`) → **403** sinon (P6 ; aujourd'hui mock).
- Rôles dérivés **côté serveur**, jamais lus tels quels du token client (même en mock).
- Endpoints qui EXÉCUTENT (run tests, scaffold) → **DEV-ONLY** : 403 hors `development`.
- Secrets/credentials **redactés côté serveur** avant `renderJson` ; jamais en clair, jamais loggés.
- Mock auth (`/auth/login|me|logout`) = POC ; ne rien bâtir de sûr dessus (→ firewall P6).

**Realtime serveur (push WS)** : providers transport-agnostiques (`createXxx(publish)`), `dispose()`
garanti au `unsubscribe` ET `ctx.once("onFinish")`. ⚠️ Après le handshake `ctx.send()` **rejette**
(`requestEnded=true`) → pousser sur la **connexion brute** `ctx.connection.send(str, cb)` (garde
`readyState===1`). **SSE** : écouter `rawRes.once("close")` (RESPONSE), jamais `request.on("close")`
(fire trop tôt en HTTP/2).

**Cycle de build (≠ front !)** :

- Modif **front** (`frontend/src/**`) → **HMR Vite, 0 restart**.
- Modif **back** Studio (`nodefony/**` : controller, providers, config) → `cd src/packages/@nodefony/studio
&& npm run build` (**rollup**, pas Vite) **puis** restart serveur (`start.sh`).
- Modif **core** ou **nouveau subpath `nodefony/*`** → build core (`cd src/nodefony && npm run build`)
  **puis** restart (Vite ré-optimise les deps au boot ; un subpath neuf n'est pas résolu à chaud).
- Vérif back sans navigateur : **curl le data plane** (`curl -sk https://127.0.0.1:5152/nodefony/<m>/api/...`)
  - curl le transform Vite (`https://127.0.0.1:5173/@fs/<abs>.tsx`) pour valider la résolution d'un subpath.

> 🚨 **PIÈGE #1 EN CLUSTER (`nodefony cluster -w N`) — 0 HMR + `build:front` ≠ `build` (vécu 2026-05-25,
> a coûté des heures)** : en cluster, le front est un **bundle prod figé** (Vite ne tourne pas). Deux
> conséquences mortelles :
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
>    Studio meurt en premier** (famine event-loop) → charge **modérée**. Cf [[feedback_live_cluster_debug_workflow]].
> 3. **Diag drill cluster** : un canal `dashboard:supervision@<pid>` muet se prouve côté serveur par un
>    mini-client `ws` (subscribe + compte frames) lancé **depuis `.claude/skills/nodefony-load-test/scripts/`**
>    (résout `ws`), PAS depuis `/tmp`. Vrai bug trouvé ainsi : `mapInstanceToSupervision` faisait
>    `r?.elu.active` → **TypeError dès que la sonde riche arrive** (`r.elu` undefined) → 0 frame →
>    `r?.elu?.active`. Garder l'optional chaining JUSQU'AU BOUT sur les sondes riches optionnelles.

## Realtime Studio — canaux, socket PARTAGÉE, hub, log protocole

Le temps réel est **le différenciateur** (« le patron »). Architecture : WS JSON-RPC 2.0
`WS /nodefony/studio/api/realtime` (`StudioRealtimeController`) ⇄ `RealtimeClient` (Core, `nodefony`).
Pub/sub PAR CANAL on-demand ; providers serveur **transport-agnostiques** (`nodefony/realtime/providers.ts`).

**Ajouter un canal realtime** :

1. Serveur : un provider qui `publish(channel, payload)` (cf `createSyslogBridge`/`createStatsTicker`) ;
   le `StudioRealtimeController` le démarre au `subscribe`, `dispose()` au `unsubscribe` + `onFinish`.
2. Client : **s'abonner = ref-compté** via `useNodefonyChannel("<canal>", handler)` (page) ou
   `useNodefonyChannelData/Stats` ; le client ré-abonne seul au reconnect.

**Canaux SANTÉ génériques (broker ticker)** : `orm:health`/`orm:flow`/**`realtime:health`** sont poussés par
`createBrokerTicker(() => fetchAdminEndpoint(broker, ns, path), …)` → Studio reste générique (0 dép au module
producteur). Le **canal `realtime:health`** (2026-05-24) = sonde de **la Socket Nodefony** (`RealtimeHub.probe`,
backend livré côté `nodefony-framework-dev`) : `{channels[{channel,subscribers,messages}], publish/fanoutTotal,
connectionCount, bytes/messagesSentTotal, backpressure{max/totalBufferedAmount, slowConsumers}}`. Endpoint 1ᵉʳ
paint = `GET /nodefony/realtime/api/health`. **À CODER (panneau Studio « Hub »)** : KpiCard canaux/abonnés/fan-out

- MiniChart débit + **jauge backpressure** (bufferedAmount max/total + slow-consumers). ⚠️ le **débit/s se DÉRIVE**
  des snapshots (delta `total`/`ts`) dans un **store sampler** (comme les stats realtime), PAS en interval React.
  [[project_realtime_socket_probe]] · nommage « **la Socket Nodefony** » (majuscule=concept).

**Actions (requête→réponse, ≠ pub/sub) — direction CONTRÔLE (2026-05-23)** :

- Une frame **avec `id`** attend une réponse `result`/`error` (boutons « reconnecter / vacuum / purger / Force GC »).
  Front : `const r = await conn.request<T>("kernel:ping", params)` (Promise id-matchée, timeout 30 s) ; helper
  réutilisable `conn.ping()` (RTT). Le `realtime:welcome` annonce `params.methods` → **actions découvrables**.
- Côté serveur : le controller étend **`RealtimeController`** (framework) et déclare `realtimeActions()`
  (`kernel:ping`/`kernel:gc` aujourd'hui). Inconnu → `-32601` ; throw → `-32603` générique. **Pour ajouter une
  action serveur → skill `nodefony-framework-dev`.** Le générique (protocole, RTT) vit dans la lib/le framework,
  PAS dupliqué dans le front.

**Architecture « la socket Nodefony »** (north-star, mémoire `project_realtime_nodefony_socket_vision`) : le hub
(`IRealtimeHub`) = lien fusionnel isomorphe ; sous lui Endpoint(`IRealtimePeer`) > Peer(`JsonRpcPeer`) >
Transport(`IRealtimeTransport`, seul seam). `RealtimeClient` et `StudioRealtimeController` composent le MÊME peer.
Front = consommateur du hub → utilise les hooks/stores, ne touche jamais le protocole.

**🚨 Invariant SOCKET PARTAGÉE (le piège #1 du soir)** :

- 1 SEULE socket par origine : `RealtimeClient.shared({url})` (singleton par URL sur `globalThis`,
  scheme normalisé ws/wss). Studio (`RootStore`) ET la debug bar l'utilisent → pas 2 connexions.
- **TOUS les consommateurs DOIVENT ref-compter** : `client.subscribe(channel)` /
  `useNodefonyChannel` / `conn.subscribe`. **JAMAIS** de raw `client.emit("subscribe")` : sur le
  client partagé, un `unsubscribe` ref-compté (ref→0) coupe le canal pour TOUS (bug vécu : la barre
  perdait ses canaux quand une page se démontait).
- Un consommateur MobX (store) **doit initialiser son état depuis `client.state`** au montage : la
  socket peut être DÉJÀ ouverte (barre montée avant) → sinon on rate l'event « connected » passé.

**Log protocole (inspecteur de frames)** :

- `RealtimeClient` garde un **ring always-on bon marché** : `recordFrame` ne pousse qu'une réf brute
  `{ts,dir,msg}` ; la construction + **redaction des secrets** sont DIFFÉRÉES à la lecture
  (`get frameLog`) ou au live (`__frame__`, émis seulement si un listener écoute). → la console
  « retrace l'instant » dès l'ouverture (seed depuis `frameLog`), sans surcoût hors console.
- Côté UI : payload stringifié **uniquement à l'ouverture** d'une ligne (pas 300 `Collapse`/stringify),
  **cap ~150 lignes rendues** (ring = 300), uptime isolé (`<SessionUptime>`) pour ne pas re-render la
  liste chaque seconde. Payload affiché en TEXTE (jamais d'HTML).

**Hub (UI)** — source unique `components/RealtimeHubContent.tsx` (carte connexion + stats + VU-mètres
par canal + couper), réutilisée dans :

- **HoverCard du chip topbar** = aperçu live des abonnements de la PAGE COURANTE (la vraie vision par
  page, sans la quitter) ; le chip **navigue** (clic) → **plus de drawer**.
- **Console `/nodefony/hub`** (« Realtime Hub ») = plein écran : KPIs + abonnements (Protocole/Transport/
  peer, forward-compat SIP/UDP/TCP) + log protocole. La console **s'auto-abonne** aux canaux standard
  → toujours vivante. Box stable = `tabular-nums` + `nowrap` (sinon saute à chaque message).

## 🎯 PATRON Studio = Sondes back + Abonnement hub (VISION — observabilité/contrôle TOTAL temps réel)

> Validé par le user (2026-05-23, dashboard ORM). **C'est le modèle de TOUT panneau Studio
> d'observabilité désormais.** Studio = console de **contrôle temps réel** de chaque sous-système
> (ORM, http, sécurité, agents IA…), PAS un dashboard statique. Réf mémoire `project_studio_probes_hub_vision`.

**Les 5 pièces (à répliquer par module) :**

1. **Sondes riches côté back** — interface `I<X>Probe` + méthode **optionnelle** `probe(): Promise<I<X>Probe>`
   sur le service/adapter → métriques profondes module-spécifiques. Best-effort (jamais throw, **jamais de
   credential**). Ex ORM : latence (fenêtre glissante min/moy/max), cycle de vie (connexions/reconnexions/
   erreurs/uptime), stockage (SQLite PRAGMA size/journal/freelist), pool (Mongo).
2. **Moniteur générique lazy** process-wide (ex `ConnectionMonitor`) branché sur les **template methods**
   du cycle de vie (`Orm.connect`) → capture latence/erreurs/reconnexions. Alloc **lazy** (`null` par défaut,
   ring borné), **per-instance** (cloud-native).
3. **Fonction `build<X>Health()` réutilisable** dans le module → exposée par un **endpoint data plane**
   `/nodefony/<module>/api/<x>/health` ET poussée par un **provider ticker** realtime (transport-agnostique,
   `publish`, `dispose()` au unsubscribe + `onFinish`, `setInterval` unref).
4. **Studio reste GÉNÉRIQUE** : le provider realtime invoque l'endpoint admin **via le broker**
   (`this.get<IAdminBroker>("adminBroker")` → `broker.list()`→producer `adminNamespace`→
   `endpoint.handler({params:{},query:{},roles:[]})`), **PAS de dép directe au module** (philosophie IAdminApi).
5. **Front** : abonnement **conditionnel** (switch « Temps réel ») via **montage/démontage** d'un petit
   composant qui appelle `useNodefonyChannel("<module>:health", onData)` (ref-compté → unsubscribe auto au
   démontage) ; fallback `useResource` HTTP pour le 1ᵉʳ paint + bouton « Tester » (one-shot).

**Subtilité CSS = voir CE QUI BOUGE dans les cartes** (pas juste un point on/off) : **flash léger** sur les
valeurs qui changent (re-clé sur la valeur → l'animation CSS rejoue : `key={String(v)}` + classe `nf-flash`
`@keyframes` background bref). + point pulsant on/off près du switch. Style injecté **une fois**
(`document.createElement("style")` gardé par flag), hover/anim en CSS pur (0 re-render).

**Cloud-native** : `instanceId`=pid stampé ; per-instance, vue multi-pod = Prometheus / fan-out Redis (P13).
NE PAS agréger dans le process.

**« Contrôle total »** : à terme pas que de la lecture → aussi des **actions** (boutons : reconnecter, vacuum,
purger…) sur le même canal/data-plane (DEV-ONLY + RBAC P6).

## 🪞 Jumeau Vivant (Twin) — carte d'architecture runtime data-driven + forage

> **`/nodefony/twin`** = explorateur de l'**architecture qui TOURNE**, multi-niveaux, vivant et cliquable.
> PAS une topologie de modules npm (rejeté par le user : « les modules n'ont aucun intérêt »). **2 gestes
> par brique** : **clic = creuser** (entre dans le sous-niveau, fil d'Ariane pour remonter) ; **ⓘ =
> expliquer** (dialog Modal liens+docs). Fichiers : `realtime/twin/*`, `routes/Twin.tsx`, `blocks/*`.

**Les 3 couches (séparation stricte présentation ⇄ données ⇄ nav)** :

1. **LE MODÈLE — `realtime/twin/twinSchemas.tsx`** (data-driven). Un **`TwinSchema { id, title, bricks[],
links[], boundaries[] }`** = des briques positionnées en **% fixe** (carte MAÎTRISÉE, pas dagre
   « brouillon ») + des liens + des frontières de process (pointillés). `SchemaBrick { id, title, color,
icon, pos{x,y}, emphasis?, external?, enter?, info? }` — **`enter`** = id du sous-schéma ouvert au clic
   (forage) ; **`info`** = la brique a une fiche ⓘ ; **`external`** = nœud hors frontière (client/infra,
   décoratif). **`buildSchema(schemaId, ctx) → { schema, live }`** = LE registre : un `if (schemaId === …)`
   par schéma, retourne le `TwinSchema` + sa couche `live: Record<brickId, LiveNodeData>`. **`schemaTitle(id)`**
   = libellé du fil d'Ariane. Schémas livrés : `root` (archi runtime + connecteurs réels), `kernel-detail`,
   `bp-realtime-detail`, `bp-logs-detail` (drivers surlignés par config).
2. **LE RENDU — `realtime/twin/TwinMap.tsx`** (PUR). `TwinMap` rend N'IMPORTE QUEL `TwinSchema` (SVG liens
   en `viewBox 0..100`, briques HTML absolues en %, drag local, dot d'état + pulse, liens animés `live`-gated).
   **`TwinMapView`** aiguille **statique/live** (`live ? <TwinMapLive/> : …`) — `TwinMapLive` s'abonne
   (`useTwinLive` ← `realtime:health` + `useRecentLogActivity` ← `syslog:stream`) et appelle `buildSchema` ;
   **« 0 ticker quand OFF »** = le sous-arbre live est DÉMONTÉ quand `live=false` (jamais `live={false}` qui
   s'abonnerait quand même).
3. **LA NAV — `routes/Twin.tsx`**. `stack: string[]` (`["root"]`) = pile de schemaId ; `current = stack.at(-1)` ;
   `onEnter(id) → push` ; breadcrumb = `stack.map(schemaTitle)` ; `onInfo(brickId) → <TwinNodePanel>` (dialog ⓘ).
   Switch « Temps réel » global (défaut ON) propagé en `live`.

**Recette — AJOUTER UN FORAGE en sous-schéma `TwinSchema`** (cas homogène : kernel-detail, bp-\*) :

1. sur la brique parente → `enter: "<x>-detail"` ;
2. une fonction `<x>Schema(): TwinSchema` (hub central + briques satellites, cf `driverDetailSchema`/`kernelSchema`) ;
3. un `if (schemaId === "<x>-detail")` dans **`buildSchema`** qui retourne `{ schema, live }` (couche live = surligne l'actif depuis `ctx.normalized`/`ctx.info`) ;
4. un cas dans **`schemaTitle`**.

**Recette — FORAGE vers une VUE SPÉCIALE non-`TwinSchema`** (ex. brancher des **graphes React Flow** comme
les 6 vues `realtime/socket/`) : un `LiveGraph` n'est PAS un `TwinSchema` → **brancher dans `Twin.tsx`** :
`enter: "<x>-view"` sur la brique → dans le rendu, une **map `specialViews: Record<string, ReactNode>`**
consultée AVANT la carte (`specialViews[current] ?? <TwinMapView/>`, 1 entrée par forage → extensible ; le
breadcrumb + `schemaTitle("<x>-view")` marchent pareil). **Réutiliser une page route existante** (ex.
`OrmOverview`) = lui ajouter une prop **`embedded`** qui skip son `PageHeader` **sticky** (sinon 2 en-têtes
sticky se chevauchent) et ne rend que sa barre d'actions. Réutiliser le
**registry isomorphe** existant (ex. `socketPages.filter(p => p.LiveGraph)` — MÊME source que le portail doc,
JAMAIS un 2ᵉ registre), graphes en **`<Tabs>` 1er niveau** (facettes sœurs d'un même sujet = divulgation
progressive). Propager le `live` global du Twin aux graphes (`<LiveGraph live={live} height=…/>`) — PAS de
switch par graphe ici (le Twin en a déjà un ; `LiveGraphSection` avec son switch local est réservé aux pages de doc).

**Registre de BLOCS UNIFIÉ — `blocks/`** (un contenu écrit 1×, monté partout) : `IBlockDef = IWidgetDef`
(le `render` est un composant pur). **`useBlockSource(source, live)`** = le CŒUR (snapshot HTTP + live
conditionnel, patron sonde+hub, extrait de `WidgetHost`) ; **`BlockBody`** = live feed + `DataState` + render ;
**`BlockView`** monte un bloc dans n'importe quel contenant (le point d'unification) ; **`BlockHost`** =
`BlockDialog` (Modal) + `BlockPanel` (page Paper) ; **`registry.ts`** ré-exporte le registre widget
(`registerBlock`/`getBlock`/`listBlocks`) — **1 SEULE Map**, pas de doublon. Le `WidgetHost` du bureau entoure
désormais `BlockBody` (même cœur). **Preuve** : `TwinNodePanel` (dialog ⓘ de la brique Realtime) monte
`getBlock("realtime.hub")` via `BlockView` = **le même bloc « Socket Nodefony » que le widget de bureau**.
`import "../../workspace/widgets"` (side-effect) peuple le registre.

**Conventions / gotchas Twin** : positions **%** (responsive, 0 magic px) · **charte CALME** obligatoire
(liens animés `live`-gated, dot d'état à couleur STABLE, pulse = `opacity` only, `prefers-reduced-motion`,
`contain: content`) · **jamais de drawer** (dialogs = **Modal centrés**, préférence user FERME) · route
**mono-segment** `/nodefony/twin` → déjà couverte par le fallback SPA (0 ajout backend) · sources data toutes
DÉJÀ servies (`realtime:health`, `kernel/api/info`+`/modules`, `orm/api/connection/health`, `syslog:stream`)
→ **0 seam back** = pas de bump lockstep pour une évolution Twin front-only. Kit chantier : mémoire
`project_studio_twin_kit` (LIRE EN PREMIER).

## Décision rapide (quel outil)

| Besoin               | Outil                         | NE PAS                                  |
| -------------------- | ----------------------------- | --------------------------------------- |
| fetch + états        | `useResource` + `<DataState>` | re-rouler `loading? … : error? …`       |
| dernière mesure live | `useNodefonyChannelData`      | `conn.subscribe`+useEffect manuel       |
| réagir à un flux     | `useNodefonyChannel`          | idem                                    |
| logs                 | `useNodefonySyslog`           | buffer maison                           |
| courbe               | `<MiniChart>`                 | recharts / @mantine/charts (cassés R19) |
| dump JSON            | `<JsonViewer>`                | `dangerouslySetInnerHTML`               |
| KPI                  | `<StatCard>` dans `<Grid>`    | Card ad-hoc                             |

> **Doc / portail / markdown / sommaire / layout docs-site** (DocLayout, DocToc, MarkdownDoc,
> FlowGraph, module `@nodefony/documentation`) → skill **`nodefony-documentation`** (concern transverse
> dédié, hors de ce skill). Les règles de mise en page docs-site y vivent désormais.

## Règles non négociables (qualité IA)

- **🔎 VÉRIFIER L'EXISTANT AVANT DE CODER (directive user 2026-05-23, PRIORITÉ #1)** : avant de
  hand-roller un composant/une primitive UI (tableau, filtre, tri, pagination, autocomplete,
  date-picker, popover complexe…), **CHERCHER s'il existe déjà**, dans cet ordre :
  1. **UI kit Studio** (`components/ui/` : `DataGrid`, `DataState`, `StatCard`, `JsonViewer`, `MiniChart`, `KeyValue`, `ConfigView`, `InfoHint`…).
  2. **`@mantine/core`** (le composant Mantine natif).
  3. **deps DÉJÀ installées** (`package.json`) — ex. **`@tanstack/react-table`** (déjà là !) = tableau headless standard : filtres à opérateurs (`filterFn`), faceting (valeurs distinctes), tri, pagination **client + serveur** (`manualPagination`/`manualFiltering`). MUI DataGrid Pro & mantine-react-table ne sont QUE des UI par-dessus ça.
  4. Sinon, peser une dep éprouvée (⚠ compat : Mantine **v9** + React **19** — `mantine-react-table` est conçu pour v7 = risqué).
     Ne hand-roll **qu'en dernier recours**, en réutilisant les primitives Mantine. **Coût vécu** :
     un popover de filtre maison = bug de focus (input intypable) + plusieurs cycles perdus, **alors que
     TanStack Table était déjà installé**. Réutiliser > réinventer. **Toujours `grep` le `package.json` +
     `components/ui/` avant de créer un composant.**
- **a11y** : 1 `<h1>`/page (PageHeader le fait) ; `aria-label` sur tout `ActionIcon` icône-seule ;
  `aria-expanded` sur un toggle ; états async → `aria-live` (DataState le fait). Norme = section
  « Normes & accessibilité W3C » ci-dessous (vérifier le pattern ARIA exact).
- **Sécu** : 0 secret loggé/affiché brut ; rendu de données non maîtrisées via `<JsonViewer>`/`<Text>`
  (texte), jamais HTML. JWT client = transitoire POC (→ cookie HttpOnly P6) — ne pas étendre.
- **Perf** : pas d'alloc inutile dans le hot render ; `MiniChart` (SVG) pas recharts ; hooks realtime
  ref-comptés (cohabitent — ne pas dédupliquer à la main). **CSS = aussi un sujet perf** → section
  « ⚡ CSS & perf de rendu » ci-dessous (directive user 2026-05-23).
- **TS strict** : 0 `any`, 0 `@ts-ignore` ; ESM `import` ; `import type` pour les types.
- **Style** : commentaires FR ; coller au pattern de `RoutesView.tsx`.
- **🟢 Aide contextuelle ⓘ DYNAMIQUE (directive user 2026-05-23, PRIORITAIRE)** : tout contrôle non
  trivial (filtre, recherche, toggle, tri, segment, métrique) DOIT porter une bulle d'aide qui
  explique en clair ce qu'il fait, **dynamique** — interpolée depuis les **données live**
  (`${entities.length}`, counts, noms…), **JAMAIS de valeur codée en dur** (« 410 tables ») qui se
  périme et ment. But : écran **auto-explicatif** sans alourdir les labels (pain point #1 du user :
  « des fois on comprend rien »). Vérifier que la valeur reflète l'état réel. À faire **à chaque écran**.
  - **Quel composant** (directive user 2026-05-24) : une **bulle TYPÉE = fiche de doc** (`DocHint`/
    `GraphHint`/`LinkHint`/`TipHint`/`WarnHint`, cf API UI kit) — en-tête icône+titre+badge version,
    **résumé + paragraphes** (`sections=[{label:"Technique"|"Si vide"|…, body}]`), **+ cas null/0
    expliqués** (pourquoi c'est vide, pas un « — » nu). `InfoHint` (texte brut) **réservé aux
    micro-tooltips d'UI** (option de filtre, en-tête de colonne DataGrid). Sur une carte
    (`KpiCard`/`StatCard`/`MiniStat`/`Panel`), passer `info={<DocHint …/>}` (rendu à la place de
    `hint`) ; mieux : router le `hint` du composant local à travers `DocHint` (titre = le label de la
    carte) → toutes ses ⓘ deviennent des fiches sans toucher les call-sites (pattern OrmOverview).
  - **Versionner** la doc par surface : un const `XXX_DOC = "v1.0"` passé en `version=` (ORM, Hub…).

## ⚡ CSS & perf de rendu (directive user 2026-05-23 — appliquer EN CONSTRUISANT)

Le CSS est **un sujet de perf à part entière**, surtout sur les écrans **live** (supervision,
dashboards re-rendus à chaque tick). Ne pas « écrire du CSS qui marche » → écrire le CSS le **moins
coûteux** pour le pipeline de rendu. **Chercher la meilleure façon** (sources ci-dessous), ne pas
deviner. Règles (issues web.dev/MDN, vérifiées) :

- **Animer UNIQUEMENT `transform` + `opacity`** (compositor-only, GPU, ni layout ni paint). **JAMAIS**
  animer `width`/`height`/`top`/`left`/`margin` (→ **layout/reflow**) ni `box-shadow`/`filter`/`blur`
  (→ **paint** coûteux). Un flash de couleur (`background`) = paint : OK s'il est **bref + sur une
  petite surface** (ex. `nf-flash`), sinon préférer `opacity` sur un calque.
- **`will-change` parcimonieux** : seulement sur un élément qui anime **souvent**, retirer après.
  Forcer un calque = `will-change: transform` / `transform: translateZ(0)` — pas en masse (coût mémoire).
- **`contain: content` (ou `layout paint`)** sur tout **widget live indépendant** (carte qui flashe/se
  met à jour) → isole le reflow/repaint à la carte au lieu de toute la page. Le réflexe pour un
  dashboard qui tique.
- **`content-visibility: auto`** (+ `contain-intrinsic-size`) sur les **longues listes hors écran**
  (logs, grosses tables) → le navigateur saute le rendu du hors-champ.
- **`tabular-nums`** (`font-variant-numeric`) sur tout nombre qui change → évite le **jitter de
  largeur** (donc des reflows) à chaque mise à jour. (Déjà appliqué aux KPI/latences.)
- **Pas d'objet `style={{…}}` recréé à chaque render** dans un composant live (nouvelle réf → React
  ré-applique) : **hisser** les styles statiques en `const` au niveau module, ou les passer en
  **classe CSS** ; ne garder en inline que la **valeur réellement dynamique** (largeur d'une barre…).
- **Pas de layout thrashing** : ne pas lire une métrique de layout (`offsetWidth`, `getBoundingClientRect`)
  puis écrire un style dans la même frame en boucle. Mesurer une fois, écrire ensuite.
- Style injecté **une seule fois** (pattern `ensureLiveStyles` : `document.createElement("style")` gardé
  par flag), animations/hover en **CSS pur** (0 re-render React).

**Où chercher (autorité, via proxy — règle universelle : jamais la page HTML lourde directe)** :

- `https://r.jina.ai/https://web.dev/articles/animations-guide` (compositor-only, will-change)
- `https://r.jina.ai/https://web.dev/articles/content-visibility` · `.../articles/dom-size-and-interactivity`
- `https://r.jina.ai/https://developer.mozilla.org/en-US/docs/Web/Performance/CSS_JavaScript_animation_performance`
- `https://r.jina.ai/https://developer.mozilla.org/en-US/docs/Web/CSS/contain`

Réflexe : avant d'animer/styler un élément qui bouge en live, se demander « layout, paint ou
compositor ? » et choisir le moins cher ; au moindre doute → consulter la source ci-dessus.

## 🧘 Temps réel CALME — neutre pour l'œil (ergonomie, directive user 2026-05-24)

**Principe (validé user).** Dans une UI **pro**, le temps réel doit être **neutre pour l'œil** : il
informe **sans solliciter**. Un flux qui clignote/saute = amateur ; un flux **calme** = maîtrise.
C'est de la **psychologie** : la vision périphérique détecte le mouvement de façon **involontaire**
(NN/g) → le moindre scintillement vole l'attention hors du focus et fatigue. **Règle d'or : le
statique domine, le mouvement est RARE et porteur de sens.** À appliquer sur TOUT widget live.

1. **Texte qui se met à jour = format STABLE.** Pas de bascule d'unité (ms↔s), pas de décimale qui
   churn. Utiliser des **paliers** (« à l'instant » sous ~1,5 s, puis secondes/min/h ENTIÈRES).
   `tabular-nums` + `nowrap` → 0 jitter de largeur. _Vécu : `fmtAge` affichait `200ms→800ms→1.2s` →
   clignotait ; remplacé par `sinceLabel` (paliers) → calme._
2. **Aucune animation qui REJOUE à chaque tick.** Un `box-shadow`/glow qui s'allume-s'éteint = paint
   répété **= le clignotement**. Indicateur d'état = couleur/opacité **stable** (transition douce),
   pas un battement. Réserver le flash (`nf-flash`, re-key sur la valeur) aux **changements
   signifiants**, **bref**, sur **petite surface** — jamais en régime permanent.
3. **Pas de bascule de style binaire sur donnée bruitée** : badge `filled↔light`, couleur teal↔gray
   quand un débit oscille 0/1 → garder un **variant stable** (la donnée change, pas le style).
4. **Isoler le re-render.** `contain: content` par carte live ; idéalement isoler la valeur qui tique
   dans un **petit composant auto-tickant** (le reste de la carte ne re-render pas). Un `setInterval`
   parent qui re-render toute la liste 1×/s = source de churn.
5. **Mouvement = compositor only** (`opacity`/`transform`), jamais layout/paint dans le hot path
   (cf section « ⚡ CSS & perf de rendu »).
6. **Respecter `prefers-reduced-motion`.** Sous `@media (prefers-reduced-motion: reduce)` : couper/
   atténuer flashes et animations (alternative en opacité douce, ou rien). Obligation a11y (troubles
   vestibulaires).
7. **Contrôle utilisateur OBLIGATOIRE — WCAG 2.2 SC 2.2.2 (Pause, Stop, Hide).** Tout contenu
   **auto-mis-à-jour** doit offrir **pause/stop/hide OU un contrôle de fréquence** (au-delà de 5 s
   d'auto-update). Nodefony coche déjà le trio : switch **« Temps réel »** (stop), **granularité**
   (`:ms`), **cadence auto AIMD**. Le garder sur tout dashboard live.
8. **Exception change-blindness (NN/g).** Pour un changement **rare ET important** qui pourrait être
   manqué, un flash **subtil** le révèle mieux qu'une alerte statique criarde — mais c'est l'exception,
   pas le régime permanent.

> **Test mental avant de livrer un widget live** : « si je fixe l'écran 30 s sans rien faire, est-ce
> que quelque chose attire l'œil sans raison ? » Si oui → neutraliser (palier, variant stable,
> `contain`, isoler le tick). Le temps réel parfait est **invisible** tant qu'il ne se passe rien.

**Comment TESTER / faire une passe ergonomie (live calm audit) :**

1. **Test des 30 s** (le plus important, 0 outil) : ouvrir l'écran live, **ne rien faire**, fixer
   30 s. Tout ce qui **bouge/clignote/saute sans cause** = défaut → lister puis neutraliser.
2. **DevTools → Rendering** : activer **« Paint flashing »** (zones repeintes en vert) et **« Layout
   Shift Regions »**. Un widget calme ne doit repeindre **que** la valeur qui change, pas toute la
   carte/liste à chaque tick. Vert qui clignote partout = `contain` manquant / glow animé / re-render
   trop large. **« Frame Rendering Stats »** (FPS meter) : un dashboard idle doit rester ~0 % GPU.
3. **Simuler la charge** pour voir l'AIMD/anti-jitter : pousser une cadence rapide (`:250` / `:500`)
   via la granularité, ou le skill **`nodefony-load-test`** (stress event-loop) → vérifier que les
   textes restent en paliers (pas de churn ms↔s) et que la cadence **recule** sans saccade visible.
4. **`prefers-reduced-motion`** : DevTools → Cmd Palette → « Emulate CSS prefers-reduced-motion:
   reduce » → flashes/animations doivent disparaître ou s'atténuer.
5. **A11y/perf gate** : Lighthouse (onglet a11y + perf) sur la page ; viser 0 régression CLS
   (Cumulative Layout Shift) — le jitter de largeur fait monter le CLS.
6. **Checklist par widget** : (a) format texte = paliers ? (b) `tabular-nums` ? (c) variant/couleur
   stables ? (d) `contain: content` ? (e) re-render isolé au tick ? (f) contrôle pause/fréquence
   (WCAG 2.2.2) ? (g) `prefers-reduced-motion` géré ?

> ⚠️ Vérif navigateur = **curl + confirmation visuelle user** (pas de headless — règle projet) ; le
> « test des 30 s » est fait par le user, l'agent prépare le diff + la checklist.

**Sources (proxy `r.jina.ai` — jamais la page HTML lourde directe) :**

- WCAG 2.2 SC 2.2.2 Pause, Stop, Hide : `https://r.jina.ai/https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html`
- NN/g — Animation & motion (vision périphérique, restraint) : `https://r.jina.ai/https://www.nngroup.com/articles/animation-purpose-ux/`
- MDN — `prefers-reduced-motion` : `https://r.jina.ai/https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion`

## 🧭 Ergonomie — divulgation progressive (directive user 2026-06-01 — appliquer EN CONSTRUISANT)

**Studio est une console PRO, JAMAIS un « clickodrome ».** Sur **tout** écran : **ne jamais tout
montrer d'un coup** — afficher d'abord le **formel/établi et l'important**, le reste se **révèle à la
demande**. Une vision dense se **découpe en sous-rubriques**. La directive « CALME » ci-dessus régit
le **mouvement** ; celle-ci régit la **densité** (complémentaires — cf [[feedback_studio_realtime_calm]]).

**Why** : un écran qui empile tout = bruit ; l'utilisateur ne comprend pas au 1ᵉʳ regard. Le
différenciateur Studio est la **lisibilité pro**, pas la densité.

**Boîte à outils de divulgation (du + visible au + caché)** :

| Besoin                                        | Brique                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Facettes d'UN sujet (1 seul détail à la fois) | **Tuiles d'axe** master cliquable, défaut = la + importante (ex. `BackplanePanel` Lecture/Écriture/Temps réel) |
| Sections sœurs de même niveau                 | **Onglets PREMIER niveau** (`<Tabs>`) — **JAMAIS 2 niveaux imbriqués**                                         |
| Détail secondaire                             | **`Collapse` replié** (prop Mantine v9 = **`expanded`**, pas `in`)                                             |
| Aperçu → détail au survol                     | **Pophover** `JsonPeek` / `DocHint` (lazy au survol)                                                           |
| Beaucoup de lignes                            | **`DataGrid` paginé** (tri/recherche/filtre)                                                                   |
| Explication / métaphore                       | **PAS sur l'écran factuel** → onglet/rubrique **Doc** + fiches `DocHint`                                       |

**Anti-clickodrome (checklist)** :

- **Factuel d'abord, pédagogie ailleurs** : l'écran porte l'état établi ; les explications vont en
  onglet/rubrique **Doc** + `DocHint`.
- **Préserver l'état au retour** : onglet actif + filtres persistés en `sessionStorage` (piège vécu :
  un effet qui réécrit l'URL clobbe le `requestId` deep-link → garder le param existant).
- **Défaut sur l'important** ; **contrôle PRÈS de ce qu'il pilote** (le select « Changer la source »
  vit dans la tuile ET la card qu'il modifie, pas dans une barre lointaine).
- **Terme explicite FR + tech en second** (« Source consultée · relecture », pas « relu » seul) ;
  **chips** pour « où / combien » (destinations actives surlignées). Cf [[feedback_terminology_forage]].
- **Test du 1ᵉʳ regard** : « je vois SEULEMENT l'essentiel ET je comprends sans pavé ? » sinon découpe.

**Vécu (refonte console Logs, commit `a19a471`)** : Profiling → `DataGrid` paginé ; onglets 1er niveau
Santé/Doc ; Vue d'ensemble « fond de panier » = 3 tuiles d'axe (un seul détail ouvert). Détails :
[[feedback_studio_ergonomie_progressive]].

## 🔒 Sécurité — PRIORITÉ MAX (directive permanente)

Conformité = directive prioritaire (mémoire `feedback_security_rfc_rigor`). Nodefony doit être une
**référence** sécurité. Avant tout commit Studio → passer le diff au skill **`nodefony-security-review`**.
Front specifics, NON négociables :

- 🚨 **Frontière isomorphe — NE JAMAIS embarquer de code/données SERVEUR dans le bundle client.**
  L'import `nodefony` côté front résout vers le build **client isomorphe** (condition `browser`,
  `customConditions:["browser"]`) — JAMAIS le serveur. N'importe **AUCUN** module serveur dans
  `frontend/src` : `@nodefony/http`, `@nodefony/security`, `@nodefony/framework` (runtime), kernel,
  services, config, ORM, secrets/`.env`. Les embarquer mettrait de la logique/des secrets serveur
  dans le navigateur → **compromission du serveur Nodefony**. Besoin d'un type serveur (ProfilePhase,
  ProfileEntry…) → **type miroir local** (pas d'import runtime). Le SEUL pont front↔serveur = le
  **data plane** `/nodefony/<module>/api/*` (JSON, secrets redactés CÔTÉ serveur). Vérifier le bundle :
  un import qui tire `node:*`/un service serveur = STOP.
- **Rendu de données non maîtrisées → TEXTE** : `<Text>` / `<Code>` / `<JsonViewer>`. JAMAIS
  `dangerouslySetInnerHTML`. Seul sink HTML toléré = Mermaid (`securityLevel:"strict"`, markdown du repo).
- **Markdown** : `react-markdown` SANS `rehype-raw` (pas de HTML brut injecté).
- **JWT / token** : ne PAS étendre le `localStorage` (exfiltrable XSS). Cible = cookie **HttpOnly
  Secure SameSite=Strict** + CSRF double-submit (P6). Le `Authorization: Bearer` lu du localStorage
  est un transitoire POC — ne rien construire dessus.
- **Réponses serveur** : ne pas faire confiance aveugle (`ApiClient` fait `as T`) → valider la forme
  (Zod, différé). Narrower au boundary dès que dispo.
- **Secrets/credentials** : jamais affichés ni loggés en clair (redaction) ; **0 `console.*` committé**.
- **Zero Trust** : toute API admin exige un rôle (`ROLE_NODEFONY_ADMIN`) → 403 sinon. L'auth Studio
  est **mock** aujourd'hui (≠ sécurité réelle, P6) — ne jamais présumer l'utilisateur fiable.
- **Endpoints qui EXÉCUTENT** (run tests, etc.) → gardés **DEV-ONLY** (403 hors `development`).
- **CSP** : l'override `renderStudio` est un hack POC (cross-origin Vite) → migrer `@nodefony/security`
  (P14.14) ; ne pas relâcher la politique. **Liens externes** → `rel="noreferrer noopener"`, `target="_blank"`.

## ♿ Normes & accessibilité W3C — TOUJOURS vérifier

Pour TOUT composant/interaction Studio, vérifier la norme **W3C AVANT** de livrer :

- **WCAG 2.2** (niveau AA) : contraste, focus visible, cible tactile, alternatives texte, pas
  d'info portée par la couleur seule.
- **WAI-ARIA 1.2** + **ARIA Authoring Practices (APG)** : le pattern ARIA EXACT d'un widget
  (dialog, tabs, menu, combobox, disclosure, alert…) — rôles, états (`aria-expanded`/`-selected`/
  `-controls`/`-busy`), navigation clavier attendue.
- Protocole (HTTP/WS/CORS/cookies) → skill **`nodefony-rfc`** (IETF + W3C bruts).

⚠️ Règle universelle (CLAUDE.md racine) : NE JAMAIS charger les pages HTML lourdes (`w3.org`).
Toujours via le proxy **`https://r.jina.ai/`** ou raw GitHub `w3c/*`. Sources canoniques :

- `https://r.jina.ai/https://www.w3.org/TR/WCAG22/`
- `https://r.jina.ai/https://www.w3.org/WAI/ARIA/apg/patterns/`

Mantine couvre beaucoup nativement (focus trap, rôles de base) — mais **valider les ajouts custom** :
graphes SVG → `role="img"`+`aria-label` ; toggles → `aria-expanded` ; zones live → `aria-live` ;
icône-seule → `aria-label`.

## Vérification AVANT commit (obligatoire)

```bash
cd src/packages/@nodefony/studio && npm run typecheck     # gate frontend = exit 0 (0 erreur)
```

1. **Sécurité** : passer le diff au skill `nodefony-security-review` (PRIORITÉ MAX).
2. **A11y** : vérifier WCAG 2.2 AA + pattern ARIA (APG) des composants ajoutés (section ci-dessus).
3. **Type-check** : `npm run typecheck` = 0 erreur.
4. **Hard-reload** `https://127.0.0.1:5152/nodefony` (cache React) pour vérifier le rendu.

Serveur dev : `bash .claude/skills/nodefony-start-server/start.sh`. Modif backend → `stop.sh` puis `start.sh`.

## Retex Studio — problèmes rencontrés & solutions (kit VIVANT, à enrichir)

> Photo à jour des pièges Studio. Format : **symptôme → cause → fix**. Lire avant de coder ;
> compléter à chaque session (cf « Fin de session » plus bas).

**Build / typage**

- Frontend non type-checké (Vite/esbuild transpile sans tsc) → gate `frontend/tsconfig.json` +
  `npm run typecheck`.
- 🔑 `tsc` sortait 33 erreurs cross-package (source http/security tirée) + `nodefony` n'exposait pas
  `RealtimeClient`/`RealtimeState` en types → **`customConditions:["browser"]`** dans le tsconfig
  (résout `nodefony` vers le client isomorphe, comme Vite). LE réglage clé de tout tsconfig front.
- `npx tsc` tourne dans un cwd parasite (sandbox) → `node_modules/.bin/tsc` en direct, ou `npm run typecheck`.
- `<Group component={RouterNavLink} to=…>` (polymorphe Mantine) ne type pas `to` →
  `<RouterNavLink><Group/></RouterNavLink>`.
- Commentaire `//xxx` DANS `compilerOptions` → TS5025 ; mettre les notes au niveau racine (`"//"`).

**Perf / deps**

- `recharts` (cassé React 19, courbes invisibles) + `@mantine/charts` = deps MORTES → retirées ;
  courbes = `<MiniChart>` SVG maison. Vérifier `vite-env.d.ts` (déclaration CSS) en cas de retrait.
- Stubs morts dans `routes/stubs.tsx` (non importés par App) → supprimer.

**Temps réel**

- Canal PARTAGÉ (`syslog:stream` Logs+Dashboard) : hook ET store émettaient subscribe/unsubscribe →
  un démontage coupait l'autre. Fix : **autorité ref-comptée dans `RealtimeClient.subscribe/unsubscribe`**
  (réseau émis aux seules transitions 0↔1, re-subscribe au `onopen`) ; binding + store ne font qu'appeler.
- Hub cassé (sparklines disparues) après migration d'une page aux hooks : ses canaux n'étaient plus dans
  `ConnectionStore.activeSubscriptions` (lu par le Drawer). Fix : `syncStats()` **réconcilie** depuis
  `client.subscribedChannels` (+ `getChannelStats`) ; entrées SSE préservées ; garde anti-double-subscribe
  sur `clientHandlers` (pas `activeSubscriptions`).
- `useSyncExternalStore` + snapshot OBJET = boucle de render (réf instable) → stats via `state`+effet ;
  réserver `useSyncExternalStore` aux snapshots PRIMITIFS (ex `client.state`).
- Nouveau subpath (`nodefony/react`) pas résolu par Vite → **redémarrer** le serveur (optimizeDeps).
- **Actions WS + extraction isomorphe (2026-05-23)** : le front peut APPELER le serveur — `await conn.request("kernel:ping")`
  / `conn.ping()` (RTT) ; `realtime:welcome.methods` = actions découvrables. Côté serveur, le protocole est sorti
  dans **`JsonRpcPeer`** (core, isomorphe) + **`RealtimeController`** (framework, le controller n'a plus de
  `dispatchRequest` hand-rollé) ; transport derrière **`IRealtimeTransport`** (`BrowserWsTransport`/`WsConnectionTransport`).
  Le front reste un **consommateur du hub** (hooks/stores) — ne touche jamais le protocole. **Ajouter une action serveur
  → skill `nodefony-framework-dev`.** Vision « la socket Nodefony » : mémoire `project_realtime_nodefony_socket_vision`.
- ⚠️ Piège instrumentation : un canal à granularité `dashboard:supervision:<ms>` est poussé sur le canal **EXACT
  souscrit** (suffixe inclus) → un listener de test/debug doit matcher `startsWith("dashboard:supervision")`, pas le nom nu.

**Archi / collisions**

- Collision de nom (`StatCard` local d'une page vs kit) → renommer le local (ex `OverviewStat`).
- SPA fallback générique masque les routes d'autres modules → fallback **littéral** par deep-link.
- Routes dashboards = **mono-segment** (`/nodefony/dev`, `/nodefony/supervision`) → couvertes par le
  fallback SPA existant, **0 ajout backend**. (≥2 segments = fallback littéral à ajouter au controller.)
- **Nav = `navConfig.ts` data-driven** (2026-05-24) : restructurer/ajouter une page = éditer `NAV_GROUPS`
  - route mono-segment dans `App.tsx`. Page non livrée = **`StubPage`** + flag **`NavItem.wip`** → badge
    « à venir » (rightSection plein, masqué en rail) = la sidebar devient la **carte d'avancement** du produit.
    « Tout plié au boot » = **inverser** la sémantique `UiStore.isGroupCollapsed` (`!== false` = plié sauf
    déplié explicite) + `toggleGroup` (`!isGroupCollapsed(id)`) + **bumper la clé localStorage**
    (`…groups.v2`) pour ne pas hériter d'un ancien état. Tout additif (aucune route retirée) = « sans rien casser ».

**Back-end (controller / data plane)** — section dédiée ci-dessus

- 🔑 **`this.context.body` est VIDE** : un POST lu ainsi tombe sur le défaut en silence (mock login
  renvoyait toujours `admin`, jamais le username envoyé). → décorateur **`@Body()`** (+ `@Param/@Query/@Header`).
- En-tête `Authorization` côté controller : `this.context.request.headers.authorization` (clé minuscule).
- Rôles dérivés **côté serveur** depuis le username du token (le client ne dicte pas ses rôles, même en mock).
- Modif controller Studio → `npm run build` (rollup) **+ restart** ; n'est PAS du HMR.

**Rôles / autorisation (nouveau — `nodefony/roles`)**

- Mécanisme rôles = subpath Core **isomorphe** `nodefony/roles` (front Studio + serveur P6) : `hasRole`,
  `hasAnyRole`, `hasAllRoles` (purs, 0 alloc), `RoleSet` (O(1) répété), `RoleRegistry` (bitmask, set fixe).
  Les NOMS de rôles (`ROLE_DEV`…) sont **applicatifs** → définis côté Studio (`frontend/src/auth/dashboards.ts`
  - mirroir mock backend), JAMAIS dans le core (mécanisme ≠ politique).
- Gating front (nav filtrée par `roles`, `RoleGuard` → 403) = **affichage seulement**, PAS de la sécu :
  l'enforcement réel (403 serveur par rôle) = P6. Ne jamais mettre de donnée sensible derrière un guard front.
- Dashboard par rôle : registre `DASHBOARDS` (role→path/label/icon) pilote nav + `RoleGuard` + `homePath`
  (redirection d'accueil = 1er dashboard autorisé). Multi-rôles ⇒ plusieurs entrées de nav.
- ⚠️ Bitmask JS = **32 bits signés** → cap 31 rôles (`ROLE_MASK_CAPACITY`) ; au-delà → strings/BigInt.
  Inadapté aux rôles DYNAMIQUES (DB) : pas de bit fixe.

**Sécu (dette notée)**

- JWT en `localStorage` (XSS) → migrer cookie HttpOnly Secure SameSite=Strict (P6) ; `ApiClient`
  cast `as T` sans validation runtime → Zod (différé).
- Mock auth multi-rôles (`mockRolesFor`) = POC ; rôles applicatifs dupliqués front/back (commentaire
  d'alignement) → P6 fera la source de vérité serveur unique.

**Realtime = LE PATRON (console `/nodefony/realtime`, pas un drawer)**

- Le temps réel est le différenciateur Nodefony → console de **premier plan** (entrée nav en tête,
  le chip topbar y NAVIGUE). Un drawer pour ça = « pièce rapportée », à proscrire.
- **1 seule socket** Studio + debug bar : `RealtimeClient.shared({url})` = singleton **par URL**
  sur `globalThis`. ⚠️ Normaliser `http(s)→ws(s)` (clé ET WebSocket) : une URL relative hérite du
  scheme `https` → clé `https://…` ≠ `wss://…` = 2 instances/2 sockets, et `new WebSocket("https://…")`
  **throw**. La barre = `shared(...)`, `connect()` sans arg, jamais « possédée » (ne déconnecte pas).
- ⚠️ **Consommateur d'un client partagé = init depuis `client.state`** : la socket peut être DÉJÀ
  ouverte (barre montée avant le store) → sinon on rate l'event « connected » passé → hub « disconnected »
  à tort. (`ConnectionStore` initialise state+stats au montage.)
- **Log protocole** = `RealtimeClient` frame-ring **LAZY** : enregistré/émis (`__frame__`) seulement
  si un listener existe (console ouverte) → 0 surcoût sinon. Secrets **redactés** (`redactFrame`).
  La page tape `client.on("__frame__")` (active la capture) ; afficher payload en **texte** (pas d'HTML).
- Hub **protocol-aware** : la table d'abonnements montre `protocol`/`transport`/`peer`
  (forward-compat SIP/UDP/TCP — `SubscriptionMeta`).
- **Cadence auto (AIMD) = réglage GLOBAL via store (2026-05-24)** : `UiStore.adaptiveCadence`
  (persisté `nf.realtime.adaptive`). Switch rendu **2×** sur la même valeur — console `/nodefony/hub`
  (`RealtimeConsole` PageHeader) **et** popover du chip topbar (`RealtimeHubContent`, le composant
  partagé). ⚠️ **`RealtimeConsole` ne rend PAS `RealtimeHubContent`** (contenu dupliqué) → pour qu'un
  contrôle apparaisse dans le **popover du chip**, l'ajouter à **`RealtimeHubContent`** (pas à la
  console). Les pages d'état (ORM…) **lisent** `ui.adaptiveCadence` et passent `enabled` au hook —
  pas de switch local par page (le mettre au Hub, pas sur ORM). Cadence réelle/canal = badge `~Xs`
  dérivé du suffixe `:ms` du nom de canal (`channelCadenceMs`).
- ⚠️ **Anti-clignotement « temps réel calme » (2026-05-24, cf section « 🧘 Temps réel CALME »)** : le
  popover du chip clignotait. 3 causes cumulées, toutes corrigées dans `RealtimeHubContent` :
  (1) `fmtAge` affichait `200ms→1.2s` (bascule unité ms↔s + décimale à chaque tick) → **`sinceLabel`**
  à paliers (« à l'instant » <1,5 s, puis s/min/h entières) ; (2) `ActivityDot` allumait un
  **`box-shadow` glow** chaque tick (paint) → anime juste l'`opacity`, styles stables par état ;
  (3) badge débit `variant filled↔light` qui flippait → **variant stable** ; + `contain: content`
  par carte canal. Régime cible = **statique tant que rien ne change**.
- ⚠️ **Passe ergonomie Supervision (2026-05-24) — corrigée dans les BRIQUES PARTAGÉES** (donc gain
  sur ORM/Supervision/futurs dashboards) : (a) `PageHeader` mettait un `subtitle` riche (Group) dans
  un `<Text>` (=`<p>`) → **`<p> dans <p>`** (warning hydratation au boot) → `<Text component="div">`.
  (b) `ensureLiveStyles` (`FlashValue.tsx`) : `.nf-live-card` était un **halo `box-shadow` qui bat en
  boucle** (le pire anti-calme : mouvement périphérique constant + paint) → **anneau statique** ;
  `.nf-live-dot` pulsait via `box-shadow` → **respiration d'`opacity`** (compositor) ; **ajout
  `@media (prefers-reduced-motion: reduce)`** (coupe les animations). (c) `KpiCard` : grande valeur
  sans `tabular-nums` → jitter de largeur au tick → ajouté. (d) badge « retard ~Xs » décimale → entier.
  Régle retenue : **corriger dans la brique partagée** (PageHeader/FlashValue/KpiCard), pas par page.

**Dashboards par rôle**

- Registre `frontend/src/auth/dashboards.ts` (`DASHBOARDS` role→path/label/icon) pilote nav + `RoleGuard`
  (→ 403) + `AuthStore.homePath` (accueil = 1ᵉʳ dashboard autorisé). Multi-rôles ⇒ N entrées de nav.
- **DEV = config/introspection STATIQUE** (env, git, ORM+vendor, modules) ; **SUPERVISION = runtime/santé
  LIVE** (KPIs seuillés + alertes + graphes). Ne pas mélanger (le runtime ne va PAS dans DEV).
- « Tablette » demandée = **grille de cartes + onglets Mantine** (`<Tabs>`), PAS un window manager.
- Gating front = **affichage seulement** (≠ sécu ; enforcement 403 serveur = P6).

**Perf data plane (quand une page rame)**

- **Mesurer** : `curl -sk -o /dev/null -w "%{time_total}s %{size_download}o" <url>` par endpoint.
  Payload minuscule + temps élevé ⇒ coût **fs/git**, pas le réseau.
- Vécu : `kernel/api/module/{name}` 3.6s / `.../docs` 4s = **`git log` spawné PAR doc** dans
  `listModuleDocs`, appelé 2× → `countModuleDocs` (readdir seul) pour les counts + git **à l'ouverture**
  seulement. → 45ms / 14ms (~80×).
- **Loader = skeleton** qui épouse la page (en-tête + KPIs + cartes), pas un spinner centré.

**Composants/conventions nés cette session**

- **`PageHeader sticky`** (prop) : en-tête collé sous la barre AppShell au scroll
  (`top: var(--app-shell-header-height)`, fond opaque, marges négatives = largeur pleine). À activer
  sur les pages longues (dashboards, hub) → le titre reste visible.
- **`DbLogo` + `assets/db-logos/`** : logos officiels bases/ORM (devicon colorés ; simple-icons recoloré
  pour drizzle) rendus en **`<img>`** (pas d'exécution SVG, ≠ inline). `hasDbLogo(name)` + mapping
  driver/vendor → svg. Réutilisable pour tout panneau ORM/data.
- **Dashboard ORM** = page **séparée** `/nodefony/orm` (PAS d'onglets dans l'ERD `/nodefony/databases` =
  React Flow pleine hauteur, ne pas le refactorer pour si peu). Carte connecteur : logo base + logo ORM
  - versions (`describeConnection` data plane) + badge `:memory:` ou chemin. ⚠️ **Cible = chemin RELATIF**
    (jamais d'absolu = info-leak FS → règle skill `nodefony-security-review` §B).
- **Centre de notifications (snackbar)** : `NotificationStore` (MobX) branché sur `realtime.onNotice`
  au constructeur (comme `ConnectionStore`) → `notifications.show()` Mantine (déjà monté `<Notifications/>`
  dans `App.tsx`) + ring `recent`. Source NORMALISÉE = `NodefonyNotice` (Core isomorphe). `ApiClient`
  option `onError` → toast les **mutations** échouées (POST/PUT/DELETE) ; **PAS les GET** (déjà rendus
  par `<DataState>`) ni **401** (déjà = logout) → évite le double affichage. Erreurs auto-close `false`
  (une criticité ne disparaît pas seule). Hub : bloc « incidents temps réel » = `realtimeIncidents`
  (historique borné, distinct de `conn.lastError`). La logique pure testée côté Core
  (`closeCodeToNotice`, 11 tests) ; le `NotificationStore` (frontend MobX) **non testé** = dette
  (harness React Studio toujours non scaffoldé).
- `ConfigView` (UI kit) : config en **options lisibles** (clé→valeur + type, booléens en badge), PAS
  un dump JSON. Texte only.
- `GitService` (core, `nodefony`) : lecture `.git` (branche+commit) **sans spawn ni dépendance**,
  exposé via `kernel/api/info.git`. Vendor ORM dérivé du nom de classe (dette : `IOrm.vendor` P7.1).
- Debug bar : publie `--nodefony-debugbar-height` (ResizeObserver) → l'hôte réserve le `padding-bottom`
  (`var(--nodefony-debugbar-height, 0px)`) ; sûr même barre absente. ⚠️ **Le padding-bottom de l'hôte
  ne suffit PAS pour un enfant à hauteur viewport fixe** (`height: calc(100vh - Xpx)`, ex. DataGrid
  pleine page) : il déborde sous la barre (sa pagination disparaît). → tout `calc(100vh - …)` doit
  **aussi** soustraire `- var(--nodefony-debugbar-height, 0px)` (vécu 2026-05-23 sur Routes/Database).
- **ERD grosse base (`Database.tsx`) — recherche + focus N-hop** : un ERD React Flow devient illisible/laggy
  au-delà de ~quelques dizaines de tables (vécu : Dolibarr 410 tables / 793 relations). Pattern ajouté :
  (1) **`Select searchable`** des noms d'entités → `focus` ; (2) **sous-graphe `neighborhood(entities, root, depth)`**
  (BFS bidirectionnel sur `relations`, 1 ou 2 sauts via `SegmentedControl`) → on ne layoute QUE le voisinage ;
  (3) **garde `LARGE_GRAPH`** (>60 tables sans focus → on ne rend pas tout : invite à chercher + bouton « Afficher
  les N tables » `showAll`) ; (4) **cadrage auto** = capturer l'instance via `onInit={(inst)=>rfRef.current=inst}`
  (`ReactFlowInstance<Node,Edge>` en `useRef` — `useReactFlow()` indisponible hors `<ReactFlow>`/Provider) puis
  `requestAnimationFrame(()=>rf.fitView({padding,duration,maxZoom}))` dans un effet `[focus, nodes]` (laisser
  React Flow committer les nœuds avant de cadrer) ; (5) **racine surlignée** + arêtes incidentes accentuées via
  un param `rootName` de `layoutGraph` (node.style outline + edge stroke `primary-color-filled`). Focus prime
  sur le filtre module (désactivé en focus). Réutilisable pour tout grand graphe.
- **`DataGrid<T>` (UI kit) — grille réutilisable sur TanStack Table (2026-05-23)** : tri, filtres
  par colonne à opérateurs, masquage de colonnes, recherche globale, pagination **client+serveur**,
  persistance storage. **Toujours réutiliser au lieu de hand-roller un tableau.** Leçons (chèrement
  payées) :
  1. **NE PAS hand-roller** un tableau/filtre/tri/pagination → `@tanstack/react-table` est déjà en
     deps (cf règle #1 « vérifier l'existant »). MUI DataGrid Pro / mantine-react-table = juste des UI
     dessus, et MRT cible Mantine v7 (risqué sur notre v9/React19).
  2. **Filtres = INLINE (ligne sous l'en-tête), PAS un Popover** : un Popover Mantine autour d'un input
     vole le focus → input intypable (3 cycles perdus). Inline = typable.
  3. Un `Select`/combobox **inline dans une table** doit être **`comboboxProps={{withinPortal:true}}`**
     sinon son menu est **clippé** par l'overflow de la table (≠ dans un Popover où c'est l'inverse).
  4. **Ne jamais remplacer toute la table par l'état vide** : à 0 résultat, garder en-têtes + ligne de
     filtres visibles (sinon « tout disparaît » et on ne peut plus corriger le filtre). Empty = une
     ligne de corps.
  5. Filtre tolérant : valeur vide / nombre en cours de frappe → **ne filtre pas** (sinon vide tout).
  6. **Serveur** : `loader` en `useCallback` (sinon refetch en boucle) ; un compteur `refresh` dans ses
     deps = bouton Recharger. État persisté restauré en **initialiseur `useState` lazy** (SYNCHRONE) →
     prêt AVANT la 1ʳᵉ requête (pas de double-fetch « vide puis restauré »). Endpoint back = renvoyer
     `{rows,total}` et lire `page/pageSize/sort/dir/q/filters(JSON)` (cf `FrameworkAdminApi` `routes/page`).
  7. Persistance **indexée** : clé `nf.datagrid:<persist.key>` (unique par grille → pas de mélange) ;
     « Effacer la sauvegarde » dans le menu Colonnes.

**Patron sondes+hub appliqué à la SUPERVISION + briques partagées (2026-05-23 soir)**

- **`KpiCard` (UI kit)** : carte KPI RICHE (≠ `StatCard` simple) — icône ThemeIcon accent, grande
  valeur, **footer sous-métriques**, **clic→onglet** (bordure accent `active`), **halo pulse** live,
  ⓘ. Réutiliser pour tout dashboard d'observabilité (extrait du dashboard ORM).
- **`FlashValue` + `ensureLiveStyles` (UI kit)** : flash « ce qui bouge » PARTAGÉ (re-clé sur valeur
  - `.nf-flash` ; `ensureLiveStyles()` injecte aussi `.nf-live-dot`/`.nf-live-card`). Appeler
    `useEffect(ensureLiveStyles, [])`.
- **Snapshot HTTP one-shot pour le mode OFF** : le PATRON expose AUSSI un endpoint pendant du canal
  (`GET /studio/api/stats` = `readStatsSnapshot`, échantillon CPU/event-loop ~150ms) → cartes peuplées
  de vraies valeurs SANS flux WS quand le temps réel est OFF. Symétrie endpoint+ticker (comme ORM).
- **Temps réel OFF par défaut (perf)** : abonnement = enfant monté conditionnellement
  (`{live && <XxxLive .../>}` qui appelle `useNodefonyChannel`, ref-compté → 0 ticker serveur quand OFF).
  Switch + HoverCard granularité (canal `:<ms>`). **Masquer les widgets live-only en OFF** (courbes,
  GC) ; garder les widgets snapshot (KPIs, breakdown, système). Onglets live-only retirés en OFF +
  `activeTab` retombe sur un onglet visible ; clic KPI live-only → active le temps réel.
- **Santé GLOBALE = 3 états** (OK/À surveiller/Dégradé) JAMAIS binaire : rouge réservé aux alertes
  CRITIQUES, un warning jaune = « À surveiller » (sinon faux « Dégradé » permanent dès 1 erreur/min).
- **Alertes EXPLIQUÉES** : chaque alerte du bandeau porte un `<InfoHint>` (sens + gravité + quoi
  regarder) + légende couleur. Directive ⓘ dynamique étendue aux alertes.
- **Seuils env-aware** : en DEV, l'event-loop partage le process avec Vite/HMR (15-25ms normal) →
  seuils relâchés (élevé ≥50ms/critique ≥120ms) vs prod (≥20/≥50ms). `info.environment` pilote.
- **Ping connecteur** : « en attente… » (gris) tant que la santé live n'est pas reçue, « échec »
  (rouge) UNIQUEMENT si `pingOk===false` (pas `undefined`) — évite le faux échec au 1ᵉʳ render.
- **Famine realtime SIGNALÉE, pas figée (fix B, 2026-05-23)** : sous forte charge, l'event-loop
  serveur sature → le ticker `setInterval` dérape → le dashboard se rafraîchit « par paliers » et a
  l'air planté. Fix = **mesurer la cadence RÉELLE côté client** (`observedGapMs` = max(écart entre 2
  frames, retard courant) vs `liveMs`) via un **heartbeat 1/s live-only** (détecte le retard même quand
  AUCUNE frame n'arrive ; setState seulement si `gap>liveMs` → 0 render parasite). `realtimeStale =
observedGap > liveMs*3` → badge orange « retard ~Xs » (KPI État) + alerte (= « à surveiller », jamais
  rouge). ⚠️ Le seuil étant **relatif** à la cadence, à 10 s de granularité il faut 30 s de retard pour
  déclencher (tester en 1 s). **Réutilisable** = jauge de santé du flux pour tout dashboard live. C'est
  la « jauge » dont l'évolution future est le **gouverneur** = cadence adaptative AIMD (mémoire IA
  `project_realtime_granularity_clientlib`).
- **Latence dérivée contextualisée** : une latence mesurée côté serveur en JS (ex. **ping ORM** =
  `await inst.ping()`) est **gonflée par l'attente event-loop** sous charge (8 s observés = ordonnancement,
  pas la base — SQLite local ≈ µs). Quand `loopH.color !== "teal"`, afficher un `<InfoHint>` qui le DIT,
  sinon l'utilisateur croit que sa base déconne. Règle : toute latence applicative affichée se lit à
  l'aune de l'event-loop lag.

**Debug bar (`nodefony/debugbar`, Core vanilla) — 2026-05-23 soir**

- **Canal DÉDIÉ `debugbar:stats`** (≠ `dashboard:supervision`, réservé à la page Supervision) : la
  barre est présente en permanence en dev → un canal partagé la ferait maintenir le ticker supervision
  actif. Dispatcher serveur route `debugbar:stats[:ms]` ET `dashboard:supervision[:ms]` vers le même
  `createStatsTicker` (base détectée), canaux distincts.
- **Bouton ○/● live** (temps réel opt-in, OFF défaut, `nf.debugbar.live`) : `startLive/stopLive`
  (subscribe/unsubscribe ref-compté). Listeners `.on` TOUJOURS branchés (gratuit) ; seul l'ABONNEMENT
  est gaté.
- ⚠️ **Graphe « frames/s » figé en OFF** : il s'alimente de `__stats__` = compteur GLOBAL du client
  PARTAGÉ (frames des autres consommateurs) → gater `sampleThroughput` sur `live` + recaler
  `prevFrames` au ré-ON (sinon pic). Le graphe stats (`debugbar:stats`) se gèle seul (canal désabonné).

**⚠️ Trappe dist (a coûté ~8 restarts + 1 rebuild --force cette session)**

- Endpoint/canal renommé qui **ne s'affiche pas au runtime** → suspecter le **DIST**, pas le code :
  `grep` dans `dist/` + comparer mtime. Causes vécues : orm-core **turbo-caché** sans `connection/health`
  (→ `orm:health` muet → faux « ping échec ») ; `framework`/`http` dist **manquants** (→ crash boot
  `ERR_MODULE_NOT_FOUND`) ; **front HMR en avance sur le back** (→ widgets fantômes). Fix robuste =
  `npm run build -- --force` (bypass cache) puis restart. Back Studio/core modifié = rebuild + restart
  (le `start.sh` ne rebuild QUE le module test).

**Briques réutilisables nées en supervision (2026-05-23, observabilité)**

- **Indice de santé composite** (`buildHealth`/`healthDesirability` dans `DashboardSupervision.tsx`) :
  agrège N sondes hétérogènes en 1 score 0-100 par **Derringer-Suich** (moyenne géométrique pondérée
  des désirabilités, NIST). 2 classes : **saturation** (`floor>0` → planchée, « Dégradé » max, jamais
  Critique seule) vs **panne** (`critical:true` → peut tirer l'indice à 0). Null exclu (poids recalculés).
  Échelle Excellent→Critique + facteur limitant + **sliders de pondération** réglables/persistés
  (localStorage) + bouton « Par défaut » + cas tout-à-zéro géré. Patron pour tout « état général ».
- **Icônes de PROVENANCE** sur les cartes (réfs stables module-scope) : `<IconBrandNodejs>` (runtime Node),
  `<NodefonyLogo>` (framework), `dbIcon(vendor)`→`<DbLogo>` (élément ORM). Doubler l'icône topique est OK.
- **`ChartCard` prop `fullscreen`** : bouton ⤢ → Modal plein écran ; passer `children` en **render-prop**
  `({fullscreen}) => …` pour agrandir le graphe (`MiniChart height` adapté) + police (légendes/table) ;
  `Legend` a un prop `size`. Provenance/poids transparents = ⓘ + texte in-card, pas seulement tooltip.
- **Tester un round-trip WS** (bidirectionnel) : sur serveur **CALME** (un stress sature le handshake →
  faux négatif). Le transport est prouvé (welcome + réponse RPC id-matchée + push) ; manque une méthode
  RPC qui renvoie un `result` (direction « actions / contrôle total »).
- **Surfacer une sonde additive sur une page live = champs OPTIONNELS + rendu conditionnel (2026-05-25, P16.H.7,
  `Cluster.tsx`)** : le back a ajouté `IRealtimeHealth.orm`/`.errors` (additif). Côté front : (1) **types miroir
  locaux** (`OrmLeanHealth`/`InstanceErrorHealth`, jamais d'import runtime serveur) avec `orm?`/`errors?` **optionnels**
  sur l'instance ET les totaux ; (2) **rendu conditionnel** (`inst.orm ? <section/> : null`) → 0 régression si un worker
  ne remonte pas la sonde (vieux pod, sonde coupée) ; (3) **`normalize()` propage** `orm`/`errors` dans les totaux du
  cas **per-instance** (mono-process) → les KPI pod s'affichent aussi en dev, pas seulement en cluster ; (4) chaque
  métrique porte un `DocHint` **dont le cas 0/null** (« Si 0 → flux ORM OFF en prod, NODEFONY_ORM_FLOW=1 ») — un compteur
  cumulatif n'a PAS de couleur d'alarme (count ≠ rate), réserver la couleur aux signaux rares (critiques `red`,
  connecteurs déconnectés `orange`). **Démo** : dev (HMR, 1 worker, instantané, fiable) montre toute l'UI ; la **grille
  N workers + agrégation pod** = cluster (`build:front` + restart + hard-reload — friction PIÈGE #1). Vu live OK
  (ORM 4304 req/EWMA 0.05ms/3-3 ; erreurs 7). Lockstep back = framework-dev 1.12.0. [[project_cluster_drilldown_kit]].
- **Extraire une route géante + page DRILL par worker (2026-05-25, `0533180`, OrmOverview 2592→~1200 l)** : quand une
  page route dépasse ~2k lignes (cache cher au cache-read), **extraire vers 3 cibles** : `types/<feat>.ts` (interfaces
  - constantes, **0 JSX**), `utils/<feat>Format.ts` (helpers PURS — fmt\*, agrégateurs, **0 JSX** : un helper qui rend
    une icône `<Icon/>` DOIT rester dans un `.tsx`, jamais un `.ts` → sinon erreur de build), `routes/<feat>/<Comp>.tsx`
    (composants + abonnements live + **hooks dérivés** `useXxxRates`/`useXxxFlow` + contrôles partagés type `OrmRealtimeControls`).
    Bénéfice double : la page consommatrice ET le drill importent le MÊME code (0 copie), et le diff/cache de la grosse
    page fond. ⚠️ après le commit, **prettier (lint-staged) reformate** les nouveaux fichiers → ne pas s'étonner du diff.
- **Page DRILL « front-only honnête » (pattern réutilisable, `OrmWorker.tsx`)** : pour drill un worker `:pid` sans relais
  backend ciblé — (1) **exact** = ce qui vient de la **sonde lean pod agrégée par le master** (`realtime:health.instances`
  filtré `find(i=>i.instanceId===pid)`) → verdict/métriques de CE pid sont justes ; (2) **best-effort honnête** = le
  diagnostic RICHE (`connection/health`/`orm:flow`) tombe sur 1 worker au hasard (round-robin reusePort) → comparer
  `healthList[0].instanceId` au `:pid` et afficher une **Alert orange « fourni par pid Y »** dès que ça diverge (mono =
  toujours exact). Ne JAMAIS faire passer le rich d'un autre worker pour celui demandé. Route = **chemin** `/…/:pid`
  (pas query) + **fallback SPA littéral** au controller (`@Get("/orm/{pid}")`, jamais catch-all). Lockstep back =
  framework-dev 1.14.0. [[project_orm_dashboard_cluster_kit]] · [[project_cluster_drilldown_kit]].
- **Drill @pid EXACT via canal COMBINÉ (2026-05-25, relais backend livré → l'alerte « autre worker » DISPARAÎT)** : quand
  le relais ciblé backend existe (cf framework-dev `orm:rich@<pid>`), le front passe du « front-only honnête » à l'exact.
  (1) **Un seul composant live `OrmRichLive`** (dans `ConnectorCard.tsx`) abonné au **canal combiné** `orm:rich@${pid}`
  (`useNodefonyAdaptiveChannel`) qui livre `{ health, flow, richPending }` → split `onHealth`/`onFlow` ; **remplace**
  `OrmHealthLive`+`OrmFlowLive` sur la page drill (ces 2 canaux nus tombent sur un worker round-robin en cluster). Un seul
  canal = un seul enrich (le hub dédoublonne par nom) → pas de ref-count. (2) **`richPending`** (≤ 1 cycle le temps que
  l'enrich se propage cross-process) → bandeau bleu « Préparation du diagnostic » (état warming, pas écran vide). (3) **Le
  canal `orm:rich@<pid>` marche en mono** (pid===process.pid → ticker broker local exact) ET en cluster (relais master→
  worker) → **toujours `live` → exact**, plus besoin de comparer `respondingPid`. L'**alerte orange** ne reste que pour le
  fallback HTTP **hors temps réel** (round-robin) → reformulée « active le temps réel pour l'exact ». Lockstep back =
  framework-dev 1.15.0. [[project_cluster_drilldown_kit]].

**FlowGraph mode LIVE — `liveNodeData` (2026-05-28, session 2 doc Socket, front-only)**

- **Extension de `FlowGraph`** : prop optionnelle `liveNodeData?: Record<nodeId, LiveNodeData>`
  avec `LiveNodeData = { metrics?: {label,value}[]; status?: "ok"|"warn"|"down"|"idle"; pulse? }`.
  Quand fournie, chaque nœud rend un **bandeau métriques** (tabular-nums, isolé via
  `contain: layout paint`) + un **dot d'état** (ok/warn/down/idle) + un éventuel
  **pulse** (animation `opacity` seule, compositor, coupée par `prefers-reduced-motion`).
  La hauteur de nœud passe de 86px à 132px **automatiquement** quand au moins un
  `liveNodeData[id].metrics` est non-vide → dagre re-layout avec `ranksep` ajusté.
- **Pattern « 0 ticker quand OFF »** sur les composants graphe live : séparer
  `<MonGraphe live={false}>` (statique, **PAS d'appel** au hook qui s'abonne) de
  `<LiveBranch>` (sous-composant qui appelle `useSocketLiveData()`). Quand le
  switch passe à OFF, la `LiveBranch` est **démontée** → unsubscribe ref-compté →
  ticker côté serveur arrêté. Le `live={false}` qui appellerait quand même le hook
  garde l'abonnement actif → fuite. Vu et corrigé sur `ArchitectureLiveGraph`.
- **Brique `<LiveGraphSection>`** (UI realtime/socket) : wrapper Paper + switch +
  graphe. Réutilisable sur toutes les pages de doc qui ont un graphe live associé
  via le registry (`LIVE_GRAPHS[slug]` du `pages.ts`). Hint personnalisable. État
  `liveOn` local au composant → indépendant par page.
- **Hook `useSocketLiveData()`** (`frontend/src/realtime/socket/`) : combine
  `useNodefonyChannelData<RealtimeHealth>("realtime:health")` + `useNodefonyState()`.
  Renvoie un `SocketLiveSnapshot`. Les `map<Schéma>Live(snap)` projettent vers
  `Record<nodeId, LiveNodeData>` exploitable par `FlowGraph` (purs, testables,
  PAS de connaissance métier dans `FlowGraph`).

**Template doc impeccable + 0 magic number (2026-05-28, session 1, front-only — pas de bump lockstep)**

- **`layout.ts` étendu = 4 nouveaux tokens** (`PAGE_CONTENT_HEIGHT`, `PAGE_CONTENT_HEIGHT_WITH_BAND`,
  `TABS_PANEL_HEIGHT`, `MODAL_FULLSCREEN_BODY`, `MODAL_FULLSCREEN_CONTENT`) avec 2 constantes internes
  `BAND="48px"` (toolbar/filtres ou Tabs.List sticky) et `MODAL_HEADER="60px"` (topbar Modal Mantine
  fullScreen). **0 `calc(100vh - Npx)` résiduel hors `layout.ts`** (vérifié par grep). Réponse à
  [[feedback_studio_layout_rigor]] §1.
- **8 magic numbers migrés** : `RoutesView.tsx` (DataGrid 200→`WITH_BAND`), `ModuleDetail.tsx` (Card mih
  170→`PAGE_CONTENT_HEIGHT` + `READER_HEIGHT` 250→`TABS_PANEL_HEIGHT`), `Database.tsx` (ERD 210→`WITH_BAND`),
  `Chat.tsx` (96→`PAGE_CONTENT_HEIGHT` **+ bug debugbar corrigé** en passant à `<PageHeader>` au passage —
  cohérence kit), `DocLayout.tsx` (Modal body 60→`FULLSCREEN_BODY` + grid 90→`FULLSCREEN_CONTENT`),
  `FlowGraph.tsx` (Modal 90→`FULLSCREEN_CONTENT`). RÈGLE confirmée : la valeur de hauteur exacte n'est
  PAS le but — nommer les **contributeurs** (HEADER, PAGE_HEADER, BAND, DEBUGBAR, GAP) et composer.
- **`<DocPageHeader>` (UI kit, NOUVELLE BRIQUE)** : en-tête riche d'une page de doc — breadcrumb
  (Section › Page) + titre h2 + badges (`version`, `status`, `wip`) + meta line (« Mis à jour le … » +
  « Modifier sur GitHub »). Tout sauf le titre est optionnel → dégradation gracieuse. Status reconnus :
  `stable`/`draft`/`temporary`/`experimental`/`deprecated` (couleurs auto). Usage = passer `<DocPageHeader/>`
  au `title=` du `DocLayout`. Front prêt à recevoir `updated`/`sourceUrl` du backend sans changer
  les call-sites — le backend documentation pourra remonter ces champs (frontmatter `updated`+`source`
  → URL GitHub assemblée serveur) plus tard sans casser le rendu actuel.
- **Admonitions GitHub-flavor dans `MarkdownDoc`** : `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` détecté
  par parser direct dans `parseAdmonition` (recursion sur les children React du blockquote, retire le
  préfixe `[!TYPE]` du 1ᵉʳ text node) → rendu `<Alert>` Mantine (icône + couleur + titre traduit FR :
  Note / Astuce / Important / Avertissement / Attention). **0 nouvelle dep** — `remark-gfm` ne parse
  pas les admonitions, on consomme le texte brut. Permet d'écrire des callouts en `.md` (avant : il
  fallait être en React, cf le bloc `if (isSocket)` de `Documentation.tsx`).
- **Heading anchors cliquables au hover** dans `MarkdownDoc` : sur h2/h3/h4, icône `#` à droite qui
  passe `opacity 0→0.7` au `:hover`, `opacity 1` au `:focus`/anchor `:hover`. Clic = copie URL profonde
  (`origin + path + #slug`) dans le presse-papier + `scrollIntoView` (smooth ou auto selon
  `prefers-reduced-motion`). Styles injectés une seule fois (pattern `ensureDocStyles` — pareil que
  `ensureLiveStyles`, 0 re-render React). `:hover`/`:focus-within` impossibles en inline style → la
  classe CSS + injection unique restent la solution la plus simple.
- **Code blocks enrichis** dans `MarkdownDoc` : override de `pre` qui détecte un enfant
  `<code className="language-X">` → wrapper `Paper` avec topbar (`<chip langue>` + `ActionIcon` Copier
  avec feedback `IconCopy → IconCheck` 1.2s). Inline `<code>` inchangé (pas de className `language-`).
  **Pas** de syntax highlighting (lourd, différé). ⚠️ Piège HTML évité : si on override `<code>` qui
  rend un `<Paper>`, on a `<pre><Paper>...</Paper></pre>` = invalide → c'est `<pre>` qu'on doit override
  pour rendre le block enrichi, pas `<code>`.
- **`prefers-reduced-motion` gate** ajoutée à `DocToc.go()` ET à l'anchor copy : `behavior` = `"auto"`
  si reduce, `"smooth"` sinon. WCAG 2.3.3 Animation from Interactions.
- **Sécurité** vérifiée : `navigator.clipboard.writeText` est OK en HTTPS (Studio sur 5152). Pas de
  `dangerouslySetInnerHTML` ajouté. `Anchor` externe garde `rel="noreferrer noopener"`. Mermaid reste
  en `securityLevel:"strict"`.
- **Gates verts** : `npm run typecheck` (frontend Studio) = 0 erreur ; curl du transform Vite (`@fs`)
  sur 11 fichiers touchés = 200 partout (esbuild OK). HMR Vite suffit, 0 restart serveur.
- **PAS de bump lockstep** : front-only (briques UI kit + 1 page + cleanup layout) → la version commune
  reste 1.15.0. Bumper si une future passe touche le contrat front+back (canal, action, type isomorphe).

**Migration POC → vitrine officielle (2026-05-28, session 2, front-only — pas de bump lockstep)**

> Pattern à appliquer chaque fois qu'un POC HMR (route dédiée, page React qui rend en dur) est mûr et
> doit fusionner dans la vitrine officielle (ici : portail doc backend `/nodefony/documentation` scanné
> sur FS). Vécu sur `/socket-poc` → `Documentation.tsx` : 842L → 352L (-58 %), -132L de page POC supprimée,
> 0 doublon dans le menu.

- **Registry isomorphe + helper de mapping** : la liste des graphes live vit dans **UNE seule source**
  (ici `frontend/src/realtime/socket/pages.ts → LIVE_GRAPHS`, clé courte = `vue-ensemble`, `fan-out`…)
  consommée par 2 mondes : (a) le POC HMR (slugs courts) et (b) le portail backend (slugs longs
  hiérarchiques `root~realtime~socket~04-fan-out`). On expose un **helper** `findSocketLiveGraph(slug)`
  qui accepte les 2 formes, **JAMAIS deux registries**. Le 1ᵉʳ truc qui diverge si on duplique.
- **Extraction « feuille » d'un slug long** = regex `(?:^|~)(?:\d+[-_])?([a-z][\w-]*)$` (tolère le préfixe
  numérique `04-`). À l'inverse, **préfixe « dossier »** d'un slug long = `slug.replace(/[^~]+$/, "")` →
  utile pour le **rewrite des liens internes** `./xx.md` → slug portail correspondant.
- **`MarkdownDoc.onInternalLink` au niveau page consommatrice**, pas dans `MarkdownDoc` : la logique de
  routing connaît la page qui consomme (préfixe dossier ici, structure flat ailleurs) → `MarkdownDoc`
  reste générique. Idiome : la callback reçoit le href brut (`./04-fan-out.md`), renvoie le slug portail.
- **Supprimer le POC** quand la vitrine couvre 100 % des cas : route (`App.tsx`), page (`SocketPocPage.tsx`),
  entrée nav (`navConfig.ts`) — pas de « je garde l'outil HMR rédacteur au cas où ». Si la HMR Vite
  n'apporte rien de plus que la lecture via le portail backend (le `.md` est rechargé par scan FS), 132L
  à maintenir = déchet. **Si** la HMR apporte un vrai gain rédacteur (preview live d'un graphe en cours
  d'édition non versionné), garder en `frontend-only` derrière une option claire.
- **Purger les hardcodes du controller** une fois le scan FS opérationnel : `DocumentationController.ts`
  portait `slug:"socket"` + une **section hardcodée `realtime`** + une constante `SOCKET_MD` 50L → tout
  ça duplique ce que le scan FS fait déjà → **doublon dans le menu** (« 2× Realtime »). Quand on migre
  POC → vitrine, l'étape **2** est obligatoirement « virer les anciens fallbacks hardcodés ». Le scan FS
  est la source unique, le controller ne fait que le servir.
- **Suppression de la branche `if (isSocket)` géante** = la marque d'un POC bien fait : tout le rendu
  spécifique au POC vivait dans une branche JSX (Alert + SectionTitle + FlowGraph statiques +
  SocketLiveBlock + FeasibilityTable, ~200L). La migrer = la **dissoudre dans le rendu générique** (ici
  via les briques génériques `MarkdownDoc` + `LiveGraphSection` + `findSocketLiveGraph(slug)`). Si la
  branche `if (isXxx)` ne peut PAS être dissoute, c'est que la vitrine officielle manque une brique
  → ajouter la brique générique avant de supprimer le POC.
- **PAS de bump lockstep** (commit `ce38d53`, suite de la session 1) : refactor front-only + suppression
  d'une route Studio + nettoyage controller back (qui ne sert qu'au frontend Studio = pas un contrat
  externe). Lockstep reste 1.15.0. La leçon va dans ce retex, pas dans le changelog.

**Console du Log Backplane — page Logs full-stack (2026-05-31, full-stack — bump lockstep 1.17.0)**

> Refonte complète de `routes/Logs.tsx` (478→~105L, le reste éclaté en sous-composants `routes/logs/*`)
> en console du Log Backplane : onglets Live / Explorer / Fichiers / Backplane. Lockstep back =
> `nodefony-framework-dev` 1.17.0 (trace full-stack + `ILogDriver`/`filterPdus`).

- **Une page « auto-explicative » se paie en itérations de COMPRÉHENSION, pas de code** : la valeur n'est
  pas le rendu mais le fait que l'utilisateur COMPRENNE le flux (live vs explorer vs backplane). Budgéter du
  temps de vulgarisation (libellés, bandeau `BackplaneBanner` qui explique les 3 axes write/query/bus AVANT
  les données) — pas juste « afficher la donnée ».
- **Drawer de détail à 2 sources via `localRecords`** : `PduDetailDrawer` doit afficher un Pdu venant SOIT du
  live SOIT d'un fichier rejoué — garder une copie locale (`localRecords`) pour que le rejeu (`FileReplay`) ne
  dépende pas du flux live courant. Ne pas coupler le drawer à une source unique.
- **« Magnétoscope » de rejeu = deltas RÉELS bornés** (`FileReplay`) : rejouer un fichier à la cadence
  d'origine = `Δt` entre uid/timestamps consécutifs, **borné** (clamp max) pour ne pas figer l'UI sur un trou
  de 10 min. Le delta vient de la donnée, pas d'un `setInterval` fixe.
- **Collision de nom local** : un identifiant réutilisé entre `Logs.tsx` et un sous-composant `routes/logs/*`
  → renommer ; le transform Vite ne le signale pas toujours, le bundle final si.
- **`Table` (Mantine) à importer = `TS2304` attrapé par `npm run typecheck`, PAS par le transform Vite** :
  esbuild compile fichier par fichier et ignore les symboles manquants cross-fichier → un composant non importé
  passe le `curl` Vite mais casse au typecheck. **Gate = `tsc`, toujours** (cf `nodefony-frontend-verify`).

## Fin de session Studio (OBLIGATOIRE)

À toute fin de session touchant Studio : **ajouter ICI** (section Retex) les problèmes rencontrés +
leur fix, et toute nouvelle brique/convention (composant, hook, règle). Ce skill est le kit **VIVANT**
— il doit rester la photo à jour du « comment développer Studio parfaitement ». Répartition :
les **stats** de session → `docs/session-retros/` ; les **leçons Studio** → ICI ; un **fait isolé** →
mémoire IA dédiée + lien.

## Réfs (mémoires IA — détails)

`project_studio_frontend_conventions` (kit, a11y, sécu, gate `customConditions:["browser"]`) ·
`project_realtime_framework_bindings` (hooks `nodefony/react`, autorité ref-comptée) ·
`feedback_spa_fallback_literal` (deep-link) · `project_studio_page_playbook` (pointeur) ·
module `CLAUDE.md`/`MEMORY.md`.

## Changelog (SemVer — version COMMUNE avec `nodefony-framework-dev`, lockstep)

> Les deux skills de dev partagent un même numéro (cf « Paire POLYMORPHE » en tête). Bumper ENSEMBLE.

- **1.21.0** (2026-06-06) — **Forage ORM du Jumeau + `OrmOverview` mode `embedded` + map de vues spéciales**
  (front-only). Brique `orm` → `enter:"orm-view"` + `schemaTitle` ; `Twin.tsx` passe à une **map
  `specialViews[current] ?? <TwinMapView/>`** (`realtime-view`→`SocketExplorer`, `orm-view`→`<OrmOverview embedded/>`)
  = recette « vue spéciale » généralisée à N forages (1 entrée/brique forée). **`OrmOverview` réutilisé tel quel**
  via une prop **`embedded`** : skip son `PageHeader` sticky (le Jumeau a déjà le sien → sinon 2 en-têtes sticky se
  chevauchent) et ne rend que sa **barre d'actions** (toggle live ORM + ERD + Export). 0 logique ORM dupliquée.
  **Front-only** → `nodefony-framework-dev` reste **1.19.0**. [[project_studio_twin_kit]].
- **1.20.0** (2026-06-06) — **Jumeau Vivant (Twin) + registre de blocs unifié + forage Realtime** (front-only ;
  commits `57aa3ca` + ce commit). Nouvelle section **« 🪞 Jumeau Vivant (Twin) »** : modèle data-driven
  (`twinSchemas` `TwinSchema{bricks,links,boundaries}` + `buildSchema`/`schemaTitle`), rendu pur (`TwinMap`/
  `TwinMapView` aiguille statique/live, 0 ticker OFF), nav (`Twin.tsx` pile `stack` + breadcrumb + `enter`/ⓘ),
  **2 recettes de forage** (sous-schéma `TwinSchema` homogène **vs** VUE SPÉCIALE non-schéma branchée dans
  `Twin.tsx`), et le **registre de blocs unifié `blocks/`** (1 contenu = `IBlockDef` monté page/widget/dialog,
  `useBlockSource` cœur, `BlockView`/`BlockHost`, 1 seule Map). **Exemple LIVE** = forage de la brique **Realtime
  Hub** (`enter:"realtime-view"`) → `SocketExplorer` monte les **6 vues live de la Socket** (`realtime/socket/`)
  en `<Tabs>`, **piloté par le registre `socketPages`** (MÊME source que le portail doc, dédoublonné par graphe),
  `live` global propagé, 0 ticker hors onglet actif. **Front-only** (`realtime:health`/`kernel/api`/`syslog:stream`
  déjà servis → 0 seam back) → **pas de bump back** (`nodefony-framework-dev` reste **1.19.0**). [[project_studio_twin_kit]].
- **1.19.0** (2026-06-01) — **Messages WS dans le Suivi de requête + famille vue JSON + UX console Logs**.
  Full-stack (back = framework-dev 1.19.0 ; commits `e44cbd5`, `a19a471`). **Contrat front+back touché** (le seam
  http `wsLogContent` émet un nouveau `msgid` `ws-message` corrélé requestId) → bump MINOR partagé.
  - **Famille vue JSON** `components/ui/json` : **`JsonView`** (arbre repliable + brut + copier), **`JsonCard`**
    (carte autonome), **`JsonPeek`** (pophover aperçu→carte au survol, lazy) ; `JsonViewer` = wrapper. `TraceView`
    onglet **WebSocket** (handshake→messages→close, **messages repliés par défaut**).
  - **UX console Logs** (commit `a19a471`) : Profiling → **`DataGrid` paginé** ; **persistance** onglet + filtres
    Explorer (`sessionStorage`, fix clobber `requestId`) ; onglets **1er niveau** Santé/Doc ; Vue d'ensemble
    **« fond de panier »** = 3 **tuiles d'axe** (Lecture défaut/Écriture/Temps réel, un seul détail ouvert).
  - **RETEX** : (a) **ergonomie « pas de clickodrome »** gravée → nouvelle section « 🧭 Ergonomie — divulgation
    progressive » (cf [[feedback_studio_ergonomie_progressive]]). (b) **Mantine = v9** (le skill disait v8 = FAUX) :
    `Collapse` prop **`expanded`** (pas `in`) ; `DataGridColumn.align ∈ {left,right}`, `filterOptions: string[]`.
    (c) **binaire WS** : `Buffer.isBuffer` seul insuffisant (ws.send accepte ArrayBuffer/TypedArray/Blob/Buffer[])
    → `binaryByteLength` couvre tout → `[binary N B]`, jamais sérialisé. +27 tests verts (737/0, memory WS 6/6).
    Lockstep back = **framework-dev 1.19.0**. [[project_request_tracking_page_vision]].
- **1.18.0** (2026-06-01) — **LB.4 — destinations prod Loki/OpenSearch (front : ping + clarté lecture/écriture)**.
  Full-stack (back = framework-dev 1.18.0 ; commit `6d8e17f`). Page Logs/panneau Backplane : bouton **« Tester la
  destination »** (`DestinationPing` dans `BackplaneBanner`, ping/latence/infos via `GET /nodefony/syslog/api/backplane/ping`,
  auto-sondé au changement de driver) ; loki/opensearch **sélectionnables** (`UPCOMING_DRIVERS`→`PLACEHOLDER_DRIVERS`,
  `driverMeta.upcoming` retiré de loki/opensearch) ; badge **« temps réel » clarifié** (`labelOff` « Pas de tap natif »
  - `helpOff` : l'onglet **Live reste TOUJOURS dispo** via le bus `syslog:stream`, **indépendant** du driver de relecture).
    **RETEX** : (a) **select Studio = LECTURE** (un seul « fond de panier ») ≠ **écriture = fan-out** (1 log →
    console+fichier+Loki+OpenSearch) → **l'UI doit séparer les 2 axes** : TODO **cases à cocher écriture + select lecture**
    (le user a buté dessus). (b) page Dashboards (iframe Grafana/OpenSearch) = design figé à faire (mixed-content 127.0.0.1
    OK + fallback deep-link + `GF_SECURITY_ALLOW_EMBEDDING` + CSP `frame-src`). Lockstep back = **framework-dev 1.18.0**. [[project_log_backplane_vision]].
- **1.17.0** (2026-05-31) — **Console du Log Backplane — refonte page Logs** (commit `3d6158e` front +
  `c48858b` back). **Contrat front+back touché** → bump MINOR partagé (≠ lockstep back-only). Page `/nodefony/logs`
  refondue en console du Log Backplane : `Logs.tsx` éclaté en sous-composants `routes/logs/*` — onglets **Live**
  (`LiveLogs`) / **Explorer** (`LogExplorer`, query unifiée + search paginé sur `filterPdus`) / **Fichiers**
  (`FilesTab` + `FileReplay` magnétoscope) / **Backplane** (`BackplanePanel` + `BackplaneBanner` 3 axes
  write/query/bus). `PduDetailDrawer` à 2 sources via `localRecords` (live + rejeu). Gate : tsc 0. RETEX
  (page auto-explicative = itérations de compréhension ; drawer 2 sources ; magnétoscope = deltas bornés ;
  TS2304 attrapé par typecheck pas par le transform Vite). Lockstep back = framework-dev 1.17.0.
- **1.16.3** (2026-05-30) — **Lockstep back-only** (session BACKEND `nodefony-framework-dev` 1.16.3 :
  durcissement framework F7 — config Zod validée au boot dans `@nodefony/framework`, `frameworkConfigJsonSchema()`
  exposé pour un futur formulaire d'édition Studio). **Aucun contrat front touché** — pas de changement de
  page/canal/type (le JSON Schema sera consommé plus tard côté Studio).
- **1.16.2** (2026-05-30) — **Lockstep back-only** (session BACKEND `nodefony-framework-dev` 1.16.2 :
  durcissement framework F5 — gotchas décorateurs ; `Response.redirect()` corrigé = whitelist RFC 9110 §15.4
  `{301,302,303,307,308}` + défaut 302 au lieu de 301). **Aucun contrat front touché** — `redirect()` est une
  API serveur (le front ne la consomme pas), pas de changement de page/canal/type.
- **1.16.1** (2026-05-30) — **Lockstep back-only** (session BACKEND `nodefony-framework-dev` 1.16.1 :
  durcissement framework F1 purge `any` + F4 couverture unit Controller 22→80 % / Resolver + doc hook
  `initialize()`). **Aucun contrat front touché** — pas de changement de page/canal/type.
- **1.16.0** (2026-05-29) — **Lockstep back-only** (session BACKEND `nodefony-framework-dev` 1.16.0 :
  résilience de boot Ph.3 — `Event.emitAsyncGuarded`/`Kernel.fireLifecycle`, `Module.critical`, `withTimeout` ;
  gain perf `emitAsync` +14→30 % ; dette config ordering RÉSOLUE). **Aucun contrat front touché** (page/canal/
  endpoint/type isomorphe inchangés) → bump de cohérence uniquement, rien à coder côté Studio.
- **1.15.0** (2026-05-25) — **Drill ORM riche @pid EXACT en cluster** (full-stack ; relais backend = framework-dev 1.15.0).
  Front : `OrmWorker.tsx` consomme le **canal combiné `orm:rich@<pid>`** via un nouveau composant **`OrmRichLive`**
  (`ConnectorCard.tsx`, `useNodefonyAdaptiveChannel`) → `{health, flow, richPending}` splitté vers `setLiveHealth`/`onFlow` ;
  **remplace `OrmHealthLive`+`OrmFlowLive`** sur le drill (ces canaux nus = round-robin en cluster). En **live**, le
  diagnostic riche est celui du **pid EXACT** (relais master→worker) → `respondingPid===pid` → **l'alerte « fourni par un
  autre worker » disparaît** (reformulée : reste seulement hors temps réel = fallback HTTP round-robin → « active le temps
  réel »). Bandeau bleu **« Préparation du diagnostic »** sur `richPending` (enrich en cours de propagation, ≤ 1 cycle).
  Marche en mono (ticker broker local) ET cluster (relais). RETEX (canal combiné = 1 enrich pas de ref-count ; warming
  richPending). Lockstep back = **framework-dev 1.15.0** (facette enrich `"orm"`, seam `setOrmRichProvider`, `createClusterOrmTicker`).
  [[project_cluster_drilldown_kit]].
- **1.14.0** (2026-05-25) — **Page DRILL ORM par worker `/nodefony/orm/:pid` + extraction DRY** (front-only,
  commit `0533180`). (a) Nouvelle page **`OrmWorker.tsx`** : **santé lean EXACTE du pid** (verdict 3 états +
  6 MiniStat + courbe req/s, extraite de `realtime:health.instances` par pid → exacte car agrégée master) +
  **diagnostic riche par connecteur** (`ConnectorCard`). En **cluster**, le rich (`connection/health` + `orm:flow`)
  tombe sur 1 worker au hasard (round-robin reusePort) → **alerte honnête** « fourni par pid Y » dès que
  `respondingPid !== pid` (`healthList[0].instanceId`) ; en mono = exact. Relais ciblé @pid = backend futur. (b)
  **`OrmOverview` allégé** : onglet Connecteurs = **`ClusterOrmGrid` dans LES DEUX modes** (en-tête pod ssi
  `rows.length>1`), carte worker **cliquable → `navigate('/nodefony/orm/'+pid)`** ; **cartes connecteur inline
  retirées** + fetch `connection/health`/flow supprimés de l'overview (la grille lit la sonde lean) ; ajout d'une
  **bande d'identité des connecteurs** (schéma invariant) ; KPI verdict footer = label+worst+connected (incidents
  connHealth retirés) ; `RealtimeHealthLive` gagne `onRate` (badge cadence). (c) **Extraction DRY** (OrmOverview
  2592 → ~1200 l, cache moins cher) : **`types/orm.ts`** (types+constantes), **`utils/ormFormat.ts`** (fmt*/
  analyzeModel/ormHealthInputs/ensureLivePulseStyle/ls*, ORM_DOC→v1.2, **purs sans JSX**), **`routes/orm/ConnectorCard.tsx`**
  (ConnectorCard + MiniStat + storageOf + OrmHealthLive/OrmFlowLive/RealtimeHealthLive + hooks **`useOrmRates`/`useOrmFlow`**
  - **`OrmRealtimeControls`** partagé overview↔drill). (d) Back : `App.tsx` route lazy `orm/:pid` ; `StudioController`
    **fallback SPA littéral `@Get("/orm/{pid}")`** (deep-link/F5, même règle que `modules`/`cluster/:x`). Prouvé live
    cluster -w3 (deep-link 200 HTML+bundle, `realtime:health` cluster:true 3 workers, `connection/health` round-robin =
    cas alerte). RETEX (extraction grosse page sous prettier ; helper JSX→`.tsx` pas `.ts` ; zsh `$F` non word-split ;
    `index.lock` orphelin husky). Lockstep back = **framework-dev 1.14.0**. [[project_orm_dashboard_cluster_kit]].
- **1.13.0** (2026-05-25) — **Dashboard ORM cluster-aware + verdict « Santé ORM » 3 états** (suite P16.H.7,
  front-only). `OrmOverview.tsx` consomme désormais la sonde lean pod `realtime:health` (`.totals.orm` +
  `.instances[].orm`, agrégée par le master → cohérente, ≠ `/orm/api/*` round-robin) : (a) **KPI « Santé ORM »**
  (remplace « Santé connexions ») = verdict 3 états via `utils/health.ts` `buildHealth` (MÊME brique que la santé
  framework), calculé **par worker, pod = pire worker (rollup)** ; erreurs/reconnexions en **TAUX (delta/min)** pas
  cumul ; connecteurs+erreurs = PANNE (→ 0), latence/lentes/reconnex = SATURATION (planché « Dégradé »). (b) Cluster :
  badges **« schéma identique · N workers »** (couche schéma invariante inchangée), **`ClusterOrmGrid`** = vue ORM
  **orientée graphs calquée sur l'accueil Supervision (`ProcessGraphGrid`)** : carte **« Santé ORM » pod** (anneau du
  verdict + rollup pire worker + agrégats pod) puis **une card par worker** (santé + requêtes/connecteurs en grand +
  **courbe débit req/s** dérivée des deltas `queryTotal` par pid). **Alert** « diagnostic détaillé = 1 worker » (le rich
  `connection/health`/`orm:flow` reste, labellisé honnêtement par pid). (c) **DRY** : types miroir `realtime:health`
  - `normalize`/`isCluster` extraits dans **`utils/realtimeHealth.ts`** (source unique) → `Cluster.tsx` refactorisé
    pour l'importer. ORM_DOC → v1.1. RETEX (verdict ORM = `buildHealth` réutilisé ; rates par pid via ref+state ;
    source lean pod ≠ /orm/api round-robin). ⚠️ **Dette** : `RealtimeConsole.tsx`/`ProcessGraphGrid.tsx` portent encore
    leurs propres mirrors divergents (noms différents) → à migrer vers `utils/realtimeHealth` une autre passe.
    Lockstep back = **framework-dev 1.13.0** (contrat inchangé — sonde lean P16.H.7 déjà livrée ; bump de cohérence).
    [[project_orm_dashboard_cluster_kit]] · [[project_cluster_drilldown_kit]].
- **1.12.0** (2026-05-25) — **Page Cluster : ORM + erreurs par worker + KPI pod** (P16.H.7 front, commit `7ab9219`).
  `Cluster.tsx` consomme `IRealtimeHealth.orm`/`.errors` (+ `totals.*`) : WorkerCard gagne 2 sections conditionnelles
  (« ORM » requêtes/lentes/EWMA/connecteurs/erreurs ORM/reconnexions ; « Erreurs (logs) » erreurs/critiques) + 2 KPI pod
  (Requêtes ORM, Erreurs logs). Types miroir locaux optionnels, `normalize()` propage au cas per-instance, `DocHint`
  avec cas 0/null. RETEX (sonde additive = champs optionnels + rendu conditionnel ; count ≠ rate côté couleur ; démo
  dev-HMR vs grille cluster). Lockstep back = **framework-dev 1.12.0** (contrat `IOrmLeanHealth`/`IInstanceErrorHealth`,
  seam core `setOrmHealthProvider`). [[project_cluster_drilldown_kit]].
- **1.11.0** (2026-05-25) — **Supervision MULTI-PROCESS instance-aware + drill worker réparé**. Front :
  accueil `/nodefony/supervision` en cluster = **grille graph-oriented** (`ProcessGraphGrid` : par worker
  % CPU+mémoire en grand + courbes CPU/Heap live + ELU/loop/uptime + badge santé ; en tête **Santé du
  framework pod** = rollup pire worker **pondéré** + agrégats CPU moyen/loop max/heap pod) ; **détail
  worker** = page Supervision complète sur `?pid=` (canal `dashboard:supervision@<pid>`) + Select + bouton
  « Vue d'ensemble » + anti-fantôme (pid mort → grille). **Santé composite masquée par-worker** (`!isCluster`),
  remontée à l'accueil. **Util partagé `utils/health.ts`** (`buildHealth` Derringer-Suich + poids persistés
  `loadHealthWeights`) → la **pondération** (sliders) s'applique aussi au pod ; **sliders Pondération sur
  l'accueil cluster**. Toggle **« Temps réel » → store persisté** `UiStore.realtimeLive` (`nf.realtime.live`),
  partagé Cluster/Supervision/ORM. Back : **fix drill** `clusterSupervision` `r?.elu?.active`. **Leçon clé**
  ajoutée (build:front ≠ build, cluster 0-HMR, diag drill `ws`). [[feedback_live_cluster_debug_workflow]].
  `nodefony-framework-dev` suit en patch (back inchangé hormis le fix studio).
- **1.10.0** (2026-05-24) — **Bulles d'aide TYPÉES (fiches de doc) — front-only**. Famille `Hint` (UI kit
  `components/ui/DocHint.tsx`) : presets `DocHint` (📖 défaut), `GraphHint` (📈), `LinkHint` (🔗 externe
  sécurisé), `TipHint` (💡), `WarnHint` (⚠). HoverCard = en-tête icône+titre+badge version, résumé,
  `sections=[{label,body}]`, `links`. `KpiCard`/`StatCard`/`MiniStat`/`Panel` acceptent `info={<DocHint/>}`
  (rendu à la place du `hint` texte). `InfoHint` = réservé micro-tooltip UI. Migrés : panneau Hub +
  pages ORM (OrmOverview/OrmEntity/Database) — `hint` des composants locaux routé via `DocHint` (titre =
  label). Versionner par surface (`HUB_DOC`/`ORM_DOC`/`DB_DOC = "v1.0"`). `nodefony-framework-dev` inchangé (1.9.0).
- **1.9.0** (2026-05-24) — **Lockstep : sonde de la Socket Nodefony** (backend livré côté `nodefony-framework-dev`).
  Côté Studio : canal **`realtime:health`** documenté (broker ticker `fetchAdminEndpoint(broker,"realtime","health")`,
  endpoint `GET /nodefony/realtime/api/health`) avec sa forme (`channels[]`, fan-out, `backpressure{bufferedAmount,
slowConsumers}`). **À CODER** : panneau Studio « Hub » (KpiCard canaux/abonnés/fan-out + MiniChart débit + jauge
  backpressure) — débit/s **dérivé** des snapshots dans un store sampler (PAS interval React). Nommage « la Socket
  Nodefony » (majuscule=concept, minuscule=couche). [[project_realtime_socket_probe]].
- **1.8.0** (2026-05-24) — **Cadence adaptative (AIMD) front + ergonomie « temps réel calme »**.
  (a) Nouvelle section **« 🧘 Temps réel CALME »** (neutre pour l'œil = psychologie/maîtrise) +
  recette de **passe ergonomie/test** (test des 30 s, DevTools Paint flashing, `prefers-reduced-motion`,
  WCAG 2.2.2). (b) Hub : switch global **« Cadence auto (AIMD) »** lié à `UiStore.adaptiveCadence`
  (console `/nodefony/hub` **et** popover du chip topbar `RealtimeHubContent`) ; badge **`~Xs`** de
  cadence réelle par canal. Les pages d'état (ORM…) **suivent** ce réglage global. (c) **Retex
  anti-clignotement** (cf section Retex). Côté lib = framework-dev 1.8.0 (`channelRate`/`AdaptiveRate`/
  `useNodefonyAdaptiveChannelData`).
- **1.7.0** (2026-05-24) — Lockstep (session BACKEND realtime — front Studio inchangé). Côté back que le front
  consomme : la **socket** s'appelle `IRealtimeSocket` (renommé ex-`IRealtimeHub` ; « hub » = broker serveur
  `RealtimeHub`) ; canaux serveur désormais **PARTAGÉS** (1 provider/canal/pod) + **full-duplex entrant gated**
  (`realtimeInbound()`, seam SIP/bridge). **DX front identique** : `useNodefonyChannel`/`ConnectionStore`
  inchangés (le hub fan-out est transparent). Cf `nodefony-framework-dev` 1.7.0 + `docs/architecture/realtime-socket-nodefony.md`.
- **1.6.0** (2026-05-23) — Realtime **actions côté front** : `conn.request("kernel:ping")` / `conn.ping()` (RTT),
  actions découvrables via `realtime:welcome.methods`. Le protocole serveur est sorti dans `JsonRpcPeer` (core) +
  `RealtimeController` (framework) — le front reste **consommateur du hub** (hooks/stores), ne touche pas le
  protocole. Ajout du bloc **« Paire POLYMORPHE front ⇄ back »** + règle de co-évolution + **version lockstep**.
  Retex : piège canal à granularité poussé sur le nom EXACT suffixé. (Côté back = framework-dev 1.6.0.)
- **< 1.6.0** — historique non versionné SemVer ; voir la section **Retex** (journal symptôme→cause→fix) +
  l'history git du fichier.
