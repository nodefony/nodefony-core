# Référence — UI kit Studio & construction d'écran

> Tout pour produire un écran Studio (page / dashboard / panneau / onglet) **cohérent, accessible,
> perf** sans explorer le code. Stack : **React 19 + Mantine v9 + MobX 6 + React Router 7 + TanStack
> Table 8**. UI kit = `import { … } from "../components/ui"`. Pages de référence : `routes/RoutesView.tsx`
> (liste/DataGrid), `routes/ModuleDetail.tsx` (détail/onglets), `routes/Dashboard.tsx` (live).

## Sommaire

- 1. API exacte — UI kit (composants + DataGrid + règle hauteur)
- 2. API exacte — hooks temps réel (`nodefony/react`)
- 3. Accès données + stores (MobX Studio)
- 4. Décision rapide (quel outil)
- 5. Recette — ajouter un écran (étapes déterministes)
- 6. Squelettes copier-coller (DONNÉES / LIVE / DÉTAIL)
- 7. Ergonomie — divulgation progressive

## 1. API exacte — UI kit

```ts
useResource<T>(fetcher: () => Promise<T>): { data: T|null; loading: boolean; error: string|null; reload: () => void }
//   ↑ import depuis "../hooks". `fetcher` DOIT être useCallback(...). Annule la requête au démontage.

<PageHeader title subtitle? icon? actions? sticky? />    // title = <h1>. actions = boutons à droite. sticky = collé sous la topbar au scroll.
<PageLayout title subtitle? icon? actions? gap?>{children}</PageLayout>  // = <Stack><PageHeader sticky/>{children}</Stack> ; LE layout commun d'une page
<StickyTabsList>{…Tabs.Tab}</StickyTabsList>             // Tabs.List figé SOUS le header (top: var(--nf-pageheader-height)). Cf gotchas-studio.md §4 (sticky structurel)
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
  initialSort?={{key,dir}} pageSize?={25} height?="auto"   // ⚠️ DÉFAUT "auto" — cf règle 🚨 ci-dessous
  searchable?={true} searchPlaceholder?
  persist?={{ key:"studio.<vue>", storage:"session"|"local" }}  // sauve tri+filtres+colonnes+pagination (clé indexée nf.datagrid:<key>)
/>
// Inclus : recherche globale, filtres par colonne à OPÉRATEURS (inline, contains/=/≥/vide…),
// masquer des colonnes (menu Colonnes), tri, pagination client+serveur, persistance + clear.
// En mode serveur, l'état persisté est restauré AVANT la 1ʳᵉ requête (pas de double-fetch).
// Réf client : routes/Database.tsx (vue Liste). Réf serveur : routes/RoutesView.tsx + back FrameworkAdminApi `routes/page`.
```

> 🚨 **MANDATORY — hauteur des grilles.** Le défaut `height="auto"`
> EST le bon comportement pour **toute grille pleine page** : la **PAGE** scrolle (un SEUL scroll, jamais
> de « scroll trap » de tableau imbriqué — anti-pattern UX confirmé NN/g + le « il faut sortir la souris
> de la grille » vécu), la **barre de pagination reste collée en bas** (`position: sticky; bottom`,
> tirée de `-spacing-md` pour manger le `paddingBottom` de `AppShell.Main` et coller au bord sans masquer
> la debug bar), et l'**en-tête de colonnes** est figé. **→ NE PAS passer de `height` sur une grille
> principale** : laisser le défaut. **Seules exceptions** (passer un `height` fixe = `PAGE_CONTENT_HEIGHT*`
> token ou px) : (1) **grille SECONDAIRE** dans un panneau/onglet, peu de lignes (ex. `FirewallAuthStats`,
> 10 lignes) — sinon sa pagination sticky-bottom flotterait loin en bas du viewport ; (2) **conteneur à
> hauteur fixe partagé** (ex. `Database` : le DataGrid de la vue Liste vit dans le même `<Paper>` borné que
> l'ERD React Flow). En mode `height` fixe, le header + la pagination restent dans le **ScrollArea interne**
> (scroll interne assumé), pas en sticky page. Échelle z des sticky : PageHeader 2 > StickyTabsList 1 =
> pagination 1 > contenu ; le `stickyHeader` de table est **désactivé en mode auto** (sinon il colle au même
> `top:0` que le PageHeader avec un z Mantine plus haut → passe devant le titre).

## 2. API exacte — hooks temps réel

> Mécanisme **général** (couche client, ref-comptage, reconnexion) → `nodefony-frontend-dev`
> (`reference/realtime-client.md`). Ici = la **liste exacte** des hooks utilisés par Studio.

```ts
useNodefony(): RealtimeClient                              // client brut (RPC request/stream) — rare
useNodefonyState(): "connected"|"connecting"|"reconnecting"|"disconnected"|"error"
useNodefonyIdentity(): RealtimeIdentity | null            // identité résolue au handshake (realtime:welcome) ; null si anonyme
useNodefonyChannel(channel, (payload)=>void, deps?=[])    // sub/unsub auto + reconnect ; handler capturé (pas besoin de deps)
useNodefonyChannelData<T>(channel, initial?=null): T|null  // dernière valeur reçue
useNodefonyAdaptiveChannel(channel, (payload)=>void, opts?)        // canal à cadence ADAPTATIVE (AIMD) — suffixe :ms piloté côté serveur
useNodefonyAdaptiveChannelData<T>(channel, initial?, opts?): T|null // idem, dernière valeur (cadence pilotée par UiStore.adaptiveCadence)
useNodefonyChannelStats(channel): { msgCount; lastMessage; rate; series } | null
useNodefonySyslog({ max?=500; severities?; channel?="syslog:stream" }): unknown[]   // ring buffer prêt
useNodefonyNotifications((notice: NodefonyNotice)=>void, deps?=[])   // chaque notice normalisée → handler (bridge snackbar). Monter 1× au shell.
useNodefonyNoticeLog({ max?=50; sources? }): NodefonyNotice[]        // ring buffer des notices (hub « incidents temps réel »)
```

`NodefonyNotice = { level:"success"|"info"|"warning"|"error"; title?; message; source:"realtime"|"api"|"server"; code?; ts }` (import depuis `nodefony`). Émise par `RealtimeClient` sur close anormal (RFC 6455 → `closeCodeToNotice`), erreur serveur poussée, reconnexion. **Studio ne consomme PAS ces hooks** : il branche `NotificationStore` (MobX) sur `realtime.onNotice` au constructeur (les hooks servent les apps React non-MobX).
`<NodefonyProvider>` est DÉJÀ monté dans `App.tsx` et la connexion ouverte par l'app
(`AdminLayout`). **NE JAMAIS** remonter le Provider ni appeler `client.connect()` dans une page.

## 3. Accès données + stores

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

## 4. Décision rapide

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

## 5. Recette — ajouter un écran

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

## 6. Squelettes copier-coller

### Squelette — DONNÉES (liste / fetch)

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

### Squelette — LIVE / DASHBOARD (temps réel)

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

### Squelette — DÉTAIL (onglets)

`<PageHeader>` (ou en-tête custom) + `<Tabs>` Mantine (onglets masqués si vides) + `<KeyValue>`
pour les infos + `<JsonViewer>` pour config/dump. Copier `frontend/src/routes/ModuleDetail.tsx`.

## 7. 🧭 Ergonomie — divulgation progressive

**Studio est une console PRO, JAMAIS un « clickodrome ».** Sur **tout** écran : **ne jamais tout
montrer d'un coup** — afficher d'abord le **formel/établi et l'important**, le reste se **révèle à la
demande**. Une vision dense se **découpe en sous-rubriques**. Complémentaire de la règle **temps réel
CALME** (qui régit le **mouvement** — voir `nodefony-frontend-dev` `reference/front-quality.md`) :
celle-ci régit la **densité**.

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
  **chips** pour « où / combien » (destinations actives surlignées).
- **Test du 1ᵉʳ regard** : « je vois SEULEMENT l'essentiel ET je comprends sans pavé ? » sinon découpe.
