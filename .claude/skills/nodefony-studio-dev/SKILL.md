---
name: nodefony-studio-dev
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
nécessaires sont ici. Studio = `src/packages/@nodefony/studio/frontend` (React 19 + Mantine v8 +
MobX + React Router 7). Racine module : `src/packages/@nodefony/studio`.

> Page de RÉFÉRENCE (pattern complet) : `frontend/src/routes/RoutesView.tsx`.
> Page DÉTAIL (onglets) : `frontend/src/routes/ModuleDetail.tsx`. Live : `frontend/src/routes/Dashboard.tsx`.
> Ne PAS relire les sources du kit : tout est ci-dessous.

## API exacte — UI kit (`import { … } from "../components/ui"`)

```ts
useResource<T>(fetcher: () => Promise<T>): { data: T|null; loading: boolean; error: string|null; reload: () => void }
//   ↑ import depuis "../hooks". `fetcher` DOIT être useCallback(...). Annule la requête au démontage.

<PageHeader title subtitle? icon? actions? />            // title = <h1>. actions = boutons à droite.
<DataState loading error? empty? onRetry? emptyMessage? minHeight?>{children}</DataState>  // priorité error>loading>empty>children
<StatCard label icon? hint? span?>{valeur}</StatCard>    // REND sa propre <Grid.Col> → mettre DANS <Grid>. span défaut {base:12,sm:6,lg:3}
<InfoHint text />                                          // bulle ⓘ accessible
<KeyValue k v mono? />                                     // ligne label→valeur ; mono=monospace
<DefinitionList gap?>{…KeyValue}</DefinitionList>
<JsonViewer value maxHeight? />                            // dump JSON read-only + copier (texte sûr, 0 injection)
<MiniChart series={[{data:number[],color:string,label:string}]} height? max? threshold? format? />  // courbe SVG ; JAMAIS recharts
<ChartCard title caption badge?>{<MiniChart/>}</ChartCard>
<Legend color label />
```

## API exacte — hooks temps réel (`import { … } from "nodefony/react"`)

```ts
useNodefony(): RealtimeClient                              // client brut (RPC request/stream) — rare
useNodefonyState(): "connected"|"connecting"|"reconnecting"|"disconnected"|"error"
useNodefonyChannel(channel, (payload)=>void, deps?=[])    // sub/unsub auto + reconnect ; handler capturé (pas besoin de deps)
useNodefonyChannelData<T>(channel, initial?=null): T|null  // dernière valeur reçue
useNodefonyChannelStats(channel): { msgCount; lastMessage; rate; series } | null
useNodefonySyslog({ max?=500; severities?; channel?="syslog:stream" }): unknown[]   // ring buffer prêt
```
`<NodefonyProvider>` est DÉJÀ monté dans `App.tsx` et la connexion ouverte par l'app
(`AdminLayout`). **NE JAMAIS** remonter le Provider ni appeler `client.connect()` dans une page.

## Accès données + stores

```ts
import { useStore, useAuth, useUi, useConnection, useAdmin, useProfiler } from "../stores";
const store = useStore();
store.api.getAbsolute<T>("/nodefony/<module>/api/...")    // data plane absolu (modules) — le cas courant
store.api.get<T>("/...")                                   // relatif à /nodefony/studio/api
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
    () => store.api.getAbsolute<Thing[]>("/nodefony/<mod>/api/things"), [store]);
  const { data, loading, error, reload } = useResource(fetcher);
  const rows = data ?? [];
  return (
    <Stack gap="md">
      <PageHeader title="Things" subtitle={`${rows.length} élément(s)`}
        actions={<Button variant="light" leftSection={<IconRefresh size={16}/>}
          loading={loading} onClick={reload}>Recharger</Button>} />
      <DataState loading={loading && !rows.length} error={error} empty={!rows.length} onRetry={reload}>
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
      <Grid><StatCard label="Débit" hint="msg/s">{stats?.rate ?? "—"}</StatCard></Grid>
      <ChartCard title="…" caption="…">
        <MiniChart series={[{ data: history, color: "var(--mantine-color-blue-6)", label: "x" }]} />
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
  + curl le transform Vite (`https://127.0.0.1:5173/@fs/<abs>.tsx`) pour valider la résolution d'un subpath.

## Realtime Studio — canaux, socket PARTAGÉE, hub, log protocole

Le temps réel est **le différenciateur** (« le patron »). Architecture : WS JSON-RPC 2.0
`WS /nodefony/studio/api/realtime` (`StudioRealtimeController`) ⇄ `RealtimeClient` (Core, `nodefony`).
Pub/sub PAR CANAL on-demand ; providers serveur **transport-agnostiques** (`nodefony/realtime/providers.ts`).

**Ajouter un canal realtime** :
1. Serveur : un provider qui `publish(channel, payload)` (cf `createSyslogBridge`/`createStatsTicker`) ;
   le `StudioRealtimeController` le démarre au `subscribe`, `dispose()` au `unsubscribe` + `onFinish`.
2. Client : **s'abonner = ref-compté** via `useNodefonyChannel("<canal>", handler)` (page) ou
   `useNodefonyChannelData/Stats` ; le client ré-abonne seul au reconnect.

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

## Décision rapide (quel outil)

| Besoin | Outil | NE PAS |
| ------ | ----- | ------ |
| fetch + états | `useResource` + `<DataState>` | re-rouler `loading? … : error? …` |
| dernière mesure live | `useNodefonyChannelData` | `conn.subscribe`+useEffect manuel |
| réagir à un flux | `useNodefonyChannel` | idem |
| logs | `useNodefonySyslog` | buffer maison |
| courbe | `<MiniChart>` | recharts / @mantine/charts (cassés R19) |
| dump JSON | `<JsonViewer>` | `dangerouslySetInnerHTML` |
| KPI | `<StatCard>` dans `<Grid>` | Card ad-hoc |

## Règles non négociables (qualité IA)

- **a11y** : 1 `<h1>`/page (PageHeader le fait) ; `aria-label` sur tout `ActionIcon` icône-seule ;
  `aria-expanded` sur un toggle ; états async → `aria-live` (DataState le fait). Norme = section
  « Normes & accessibilité W3C » ci-dessous (vérifier le pattern ARIA exact).
- **Sécu** : 0 secret loggé/affiché brut ; rendu de données non maîtrisées via `<JsonViewer>`/`<Text>`
  (texte), jamais HTML. JWT client = transitoire POC (→ cookie HttpOnly P6) — ne pas étendre.
- **Perf** : pas d'alloc inutile dans le hot render ; `MiniChart` (SVG) pas recharts ; hooks realtime
  ref-comptés (cohabitent — ne pas dédupliquer à la main).
- **TS strict** : 0 `any`, 0 `@ts-ignore` ; ESM `import` ; `import type` pour les types.
- **Style** : commentaires FR ; coller au pattern de `RoutesView.tsx`.

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

**Archi / collisions**
- Collision de nom (`StatCard` local d'une page vs kit) → renommer le local (ex `OverviewStat`).
- SPA fallback générique masque les routes d'autres modules → fallback **littéral** par deep-link.
- Routes dashboards = **mono-segment** (`/nodefony/dev`, `/nodefony/supervision`) → couvertes par le
  fallback SPA existant, **0 ajout backend**. (≥2 segments = fallback littéral à ajouter au controller.)

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
  + mirroir mock backend), JAMAIS dans le core (mécanisme ≠ politique).
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
- `ConfigView` (UI kit) : config en **options lisibles** (clé→valeur + type, booléens en badge), PAS
  un dump JSON. Texte only.
- `GitService` (core, `nodefony`) : lecture `.git` (branche+commit) **sans spawn ni dépendance**,
  exposé via `kernel/api/info.git`. Vendor ORM dérivé du nom de classe (dette : `IOrm.vendor` P7.1).
- Debug bar : publie `--nodefony-debugbar-height` (ResizeObserver) → l'hôte réserve le `padding-bottom`
  (`var(--nodefony-debugbar-height, 0px)`) ; sûr même barre absente.

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
