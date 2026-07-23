# Référence — Jumeau Vivant (Twin)

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
les vues à graphe live de la socket Nodefony) : un `LiveGraph` n'est PAS un `TwinSchema` → **brancher dans `Twin.tsx`** :
`enter: "<x>-view"` sur la brique → dans le rendu, une **map `specialViews: Record<string, ReactNode>`**
consultée AVANT la carte (`specialViews[current] ?? <TwinMapView/>`, 1 entrée par forage → extensible ; le
breadcrumb + `schemaTitle("<x>-view")` marchent pareil). **Réutiliser une page route existante** (ex.
`OrmOverview`) = lui ajouter une prop **`embedded`** qui skip son `PageHeader` **sticky** (sinon 2 en-têtes
sticky se chevauchent) et ne rend que sa barre d'actions. Réutiliser le
**registry isomorphe** existant (ex. `socketPages.filter(p => p.LiveGraph)` — MÊME source que le portail doc,
JAMAIS un 2ᵉ registre), graphes en **`<Tabs>` 1er niveau** (facettes sœurs d'un même sujet = divulgation
progressive). Propager le `live` global du Twin aux graphes (`<LiveGraph live={live} height=…/>`) — PAS de
switch par graphe ici (le Twin en a déjà un ; `LiveGraphSection` avec son switch local est réservé aux pages de doc).

**🚫 RÈGLE — un forage est EXACT, jamais improvisé** (vécu HTTP, a coûté 1 commit faux) : un
sous-schéma / une vue forée décrit une **architecture RÉELLE** → AVANT de poser les briques, les
étapes ou les liens, **lire la SOURCE DE VÉRITÉ du module** (code + `MEMORY.md`/`CLAUDE.md`), ne
JAMAIS deviner l'ordre ni les noms. Le Jumeau se veut « vivant/honnête » → une brique inexacte est un
**BUG**, pas un détail (une donnée fausse trompe plus qu'elle n'informe). Méthode : (1) ouvrir le
`MEMORY.md` du module ciblé ; (2) y lire l'enchaînement réel (ex. `http/MEMORY.md` → `HttpKernel.handleHttp`)

- (3) ne mettre dans le schéma QUE ce qui existe. **Contre-exemple corrigé (pipeline HTTP)** : improvisé =
  « Firewall avant Router, sans Parse ni Static » (FAUX) ; réel = **Serveurs → Contexte (requestId/ALS) →
  Route match (hissé) → Parse (sauté si `@Body stream`) → Firewall (`handleSecurity`) → Controller →
  Réponse**, **+ Static en FALLBACK** après une route ratée (≠ static-first). Idem realtime (lire
  `@nodefony/realtime/MEMORY.md` + ses `docs/`) et ORM (réutiliser `OrmOverview`, pas réécrire).

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
`contain: content`) · **jamais de drawer** (dialogs = **Modal centrés**, règle ferme) · route
**mono-segment** `/nodefony/twin` → déjà couverte par le fallback SPA (0 ajout backend) · sources data toutes
DÉJÀ servies (`realtime:health`, `kernel/api/info`+`/modules`, `orm/api/connection/health`, `syslog:stream`)
→ **0 seam back** (évolution Twin = front-only).
