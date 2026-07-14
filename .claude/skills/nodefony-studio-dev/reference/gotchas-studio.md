# Gotchas Studio — règles durables (par thème)

> Leçons distillées de toutes les sessions Studio, **intemporelles** (pas de journal daté — l'historique
> vit dans `git log`). Lire avant de coder un écran. Le détail des **mécanismes généraux** (socket client,
> BFF, perf/a11y/temps-réel-calme) est dans `nodefony-frontend-dev` ; ici = le **spécifique Studio**.

## Sommaire

- [1. Build / typage / dist](#1-build--typage--dist)
- [2. Routing / nav / data plane](#2-routing--nav--data-plane)
- [3. Hydratation `<p>` imbriqué (LE piège récurrent)](#3-hydratation-p-imbriqué)
- [4. Sticky & layout (fix STRUCTUREL)](#4-sticky--layout)
- [5. DataGrid](#5-datagrid)
- [6. Temps réel / socket Studio](#6-temps-réel--socket-studio)
- [7. Rôles / autorisation front](#7-rôles--autorisation-front)
- [8. Patron sondes + hub (observabilité)](#8-patron-sondes--hub)
- [9. Perf — data plane, overlays, grands graphes](#9-perf)
- [10. Grosse page : extraction & module éclaté](#10-grosse-page--extraction)
- [11. Workspace (bureau composable)](#11-workspace)
- [12. ApiClient & pont socket](#12-apiclient--pont-socket)
- [13. Notifications](#13-notifications)
- [14. Écrans vitrine (Login)](#14-écrans-vitrine)
- [15. FlowGraph live / migration POC → vitrine](#15-flowgraph-live--migration-poc)

---

## 1. Build / typage / dist

- **`customConditions: ["browser"]`** dans le `tsconfig` front = LE réglage clé : résout `nodefony` vers le
  client isomorphe (comme Vite) ; sans lui `tsc` sort des dizaines d'erreurs cross-package (il tire les sources
  http/security) et ne voit pas `RealtimeClient`/`RealtimeState` en types.
- **`tsc` est le SEUL gate de types** : esbuild/Vite transpile **fichier par fichier** sans vérifier les symboles
  cross-fichier → un composant non importé (`TS2304`), un `Table` Mantine oublié passent le `curl` du transform
  Vite mais cassent au build. **Toujours `npm run typecheck`** avant de dire « fait » (cf `nodefony-frontend-verify`).
- `npx tsc` tourne dans un cwd parasite (sandbox) → utiliser `node_modules/.bin/tsc` ou `npm run typecheck`.
- `<Group component={RouterNavLink} to=…>` (polymorphe Mantine) ne type pas `to` → `<RouterNavLink><Group/></RouterNavLink>`.
- Commentaire `//xxx` DANS `compilerOptions` → TS5025 ; mettre les notes au niveau racine (clé `"//"`).
- **Deps mortes** : `recharts` (cassé React 19, courbes invisibles) + `@mantine/charts` → retirées ; courbes =
  `<MiniChart>` SVG. `mantine-react-table` cible Mantine v7 = risqué sur v9/React 19 (préférer `@tanstack/react-table`).
- **Collision de nom local** (un `StatCard` local vs kit, un id réutilisé entre `Logs.tsx` et `routes/logs/*`) →
  renommer le local ; le transform Vite ne le signale pas toujours, le bundle/typecheck final si.
- **Trappe DIST** : un endpoint/canal renommé qui **ne s'affiche pas au runtime** → suspecter le `dist/`, pas le
  code. `turbo run build` (et `clean && build`) **ne busте PAS le cache turbo** → il restaure un vieux `dist`.
  Causes vécues : module turbo-caché sans la nouvelle route, `dist` manquant (crash boot `ERR_MODULE_NOT_FOUND`),
  front HMR en avance sur le back (widgets fantômes). Fix : `npm run build -- --force` puis restart. **Back Studio /
  core modifié = rebuild + restart** (le `start.sh` ne rebuild QUE le module test). Vérifier : `grep <chaîne> dist/`.
- **🔑 `createContext` (StoreContext, ...) = ÉPINGLER sur `globalThis`, jamais une `const` de module nue.** En dev,
  Vite **réévalue** un module (HMR `?t=…`, ou duplication de graphe quand Studio est servi par le serveur Vite d'un
  AUTRE bundle React — Studio n'a pas toujours son propre serveur). Une `const Ctx = createContext()` recrée alors un
  **2e objet de contexte** : le `<Provider>` monté tôt (App.tsx) garde l'objet A ; une page **lazy** chargée APRÈS
  (TraceView) importe l'objet B → `useContext(B)` ne voit pas le Provider de A → **« useStore() outside provider »
  alors que l'arbre EST enveloppé**. Discriminant : erreur **PROPRE** (ctx null) = React unique + contexte dédoublé
  (≠ « invalid hook call » = double React). Fix racine = `g[KEY] ?? (g[KEY] = createContext(null))` sur `globalThis`
  → un seul objet de contexte réutilisé par toute réévaluation/duplication (cf `stores/index.ts`).

## 2. Routing / nav / data plane

- **SPA fallback = préfixe LITTÉRAL par deep-link**, jamais générique `/{section}/{page}` ni catch-all `*` (un
  générique masque les vraies routes des autres modules sous `/nodefony/<x>/<y>` → régression vécue, 21 échecs http).
  Route **mono-segment** (`/nodefony/dev`, `/nodefony/twin`) = déjà couverte (le framework réserve `/nodefony`) ;
  **≥2 segments** (`/orm/:pid`, `/modules/:name`) → ajouter le fallback littéral `@Get("/orm/{pid}")` au controller.
- **Nav data-driven** (`navConfig.ts` `NAV_GROUPS`) : restructurer/ajouter = éditer la donnée + route mono-segment
  dans `App.tsx`. Page non livrée = **`StubPage`** + flag `NavItem.wip` → badge « à venir » = la sidebar devient la
  **carte d'avancement**. Remplacer un stub = lazy dans `App.tsx` + retirer du bloc `stubs` + retirer `wip` du
  navConfig + supprimer l'export stub mort.
- **La roadmap RESTE dans le menu, mais RANGÉE** (elle sert la démo : montrer où va le produit). Deux temps de
  lecture, faits au RENDU (`AdminLayout`), pas dans `navConfig` (qui reste rangé par thème) : les items **livrés**
  d'abord à plein contraste, les `wip` **relégués en fin de groupe** sous un trait « À venir », atténués + badgés ;
  l'en-tête du groupe porte le **compteur** (« 5 à venir ») → l'ampleur reste lisible **groupe replié**. Sans ce
  tri, 16 entrées mortes sur 40 diluaient les pages qui marchent.
- **Défaut de pliage décidé par le CONTENU, pas figé** : `ui.isGroupCollapsed(id, fallback)` — un groupe 100 %
  « à venir » s'ouvre replié, les autres ouverts ; un choix explicite de l'utilisateur gagne toujours. (Un défaut
  « tout plié » ouvrait la console sur une colonne de titres muets.) Changer la sémantique du défaut ⇒ **bumper la
  clé localStorage** (`…groups.v2` → `v3`), sinon l'ancien état fige l'ancien défaut.
- **Axe ENVIRONNEMENT en plus du rôle** : `NavItem.devOnly` masque une page dont le **back n'existe qu'en dev**
  (ex. Playground : `@nodefony/framework` ne monte son data plane qu'en `development`/`-d` → en prod l'entrée mène
  à un écran mort). Source = l'env RÉEL du serveur (`/studio/api/info` → `AdminStore.env`) ; env inconnu → on
  MONTRE (mieux vaut une entrée de trop qu'une entrée disparue sur un aléa réseau). ⚠️ **C'est du confort
  d'affichage, JAMAIS une sécurité** — la garde reste le serveur (API absente / firewall).
- **🔑 404 ≠ 401 — discriminant à graver** : le **route-match est hissé AVANT le firewall**. Une route **absente**
  = **404** ; une route **présente derrière le firewall** = **401**. Lire un 404 comme « route absente » d'emblée
  (ne pas suspecter un dist périmé / un fantôme). Vécu : un `IAdminApi` (namespace `security`) monte sous
  `/nodefony/security/api/<path>` — **PAS** `/security/api/admin/<path>` : pas de sous-préfixe `admin` ; un `/admin/`
  écrit côté front = 404.

## 3. Hydratation `<p>` imbriqué

**LE piège récurrent** (vu sur `KeyValue`, `StatCard`, `KpiCard`, `PageHeader`). Ces composants rendent leur valeur
dans un `<Text>` = `<p>`. Y mettre une valeur **RICHE** (`<Badge>`, `<div>`, `<Group>`, liste de chips) déclenche
`<div>/<p> cannot appear as a descendant of <p>` (warning hydratation au boot).

- Valeur riche → **`Field` local** (`Group` label + `Box` valeur), pas `KeyValue` (réservé au texte/mono).
- `PageHeader` avec `subtitle` riche (Group) → `<Text component="div">` (sinon `<p>` dans `<p>`).
- Dette connue : `KpiCard` rend sa valeur dans un `<Text>` → un children riche casse pareil (fix = `component="div"`).

## 4. Sticky & layout

- **🚨 LE bug du sticky est STRUCTUREL, pas par page.** Mantine pose un `min-height` ≈ pleine hauteur sur
  `AppShell.Main` qui **écrase** le `height: calc(100dvh - header)` → Main grandit avec le contenu, ne scrolle
  JAMAIS (c'est le `body` qui scrolle) → tout `position: sticky` enfant est piégé dans un conteneur non scrollé.
  **Fix racine = `minHeight: 0` sur `AppShell.Main`** (`AdminLayout`) → `height` plafonne → **scroll interne à
  Main** → les sticky marchent sur **toutes** les pages d'un coup. Diagnostic : `getComputedStyle(main).overflowY ===
"auto"` MAIS `main.scrollHeight > main.clientHeight === false` → Main ne scrolle pas. Symptôme trompeur « certaines
  pages marchent » = en fait nulle part, seules les pages assez longues pour scroller le révélaient.
- **Layout commun = `PageLayout` + `StickyTabsList`** : `PageLayout` = `<Stack gap="md"><PageHeader sticky/>{children}</Stack>` ;
  `StickyTabsList` = `Tabs.List` figé **sous** le header (`top: var(--nf-pageheader-height)` publié par le PageHeader).
  Migrer une page = remplacer le `<Stack><PageHeader sticky/></Stack>` par `<PageLayout>` + `<Tabs.List>`→`<StickyTabsList>`.
- **`PageHeader` sans `mb`** : l'espacement vient du `gap` du Stack parent SEUL (un `mb` + le gap = double → trou
  entre header sticky et Tabs.List sticky).
- **Sticky hand-rollé à `top: var(--app-shell-header-height)` est cassé en main-scroll** : ce `56px` est compté
  DANS Main → l'élément se fige 56 px trop bas. Fix = `top: var(--nf-pageheader-height)` (sous le PageHeader) ou `top: 0`.
- **z-index des sticky (échelle figée)** : PageHeader **2** (`top:0`) > StickyTabsList **1** = pagination **1** >
  contenu. Le `stickyHeader` de table Mantine (z~3) passe DEVANT le PageHeader → le **désactiver en mode hauteur auto**
  (`stickyHeader={height !== "auto"}`), il ne reste sticky qu'en mode hauteur fixe (dans le ScrollArea interne).
- **0 magic number** : toute hauteur via les tokens de `layout.ts` (`PAGE_CONTENT_HEIGHT`, `…_WITH_BAND`,
  `TABS_PANEL_HEIGHT`, `MODAL_FULLSCREEN_*`) ; **0 `calc(100vh - Npx)`** résiduel. Nommer les CONTRIBUTEURS
  (HEADER, PAGE_HEADER, BAND, DEBUGBAR) et composer — la valeur exacte n'est pas le but.
- **Debug bar** : tout `calc(100vh - …)` doit **aussi** soustraire `- var(--nodefony-debugbar-height, 0px)` (le
  padding-bottom de l'hôte ne suffit pas pour un enfant à hauteur viewport fixe → il déborde sous la barre).
- **`ReactFlow` exige une hauteur CONCRÈTE**, jamais `height:100%` (string) → erreur #004 « parent needs width and
  height » (résolu à 0 au mount, surtout en onglet + StrictMode). Passer le token calc DIRECTEMENT à `FlowGraph`.
- **Largeur 100 % (piège flex)** : dans un wrapper flex ROW, le `flex` pilote la LARGEUR → garder `flex:1 + width:100%`
  sur le `ScrollArea` ; piloter la hauteur via le `flex` du div parent (axe column) + le `type` du ScrollArea.

## 5. DataGrid

> La règle de **hauteur** (`height="auto"` par défaut + 2 exceptions) est dans `ui-kit.md` §1. Ici = les autres leçons.

- **NE JAMAIS hand-roller** un tableau/filtre/tri/pagination : `@tanstack/react-table` est déjà en deps. MUI DataGrid
  Pro / mantine-react-table = juste des UI par-dessus. (Coût vécu : un popover de filtre maison = focus volé / input
  intypable + cycles perdus.)
- **Filtres = INLINE** (ligne sous l'en-tête), **PAS un Popover** : un Popover Mantine autour d'un input vole le focus.
- Un `Select`/combobox **inline dans une table** = **`comboboxProps={{withinPortal:true}}`** sinon son menu est clippé
  par l'overflow de la table.
- **Empty = une ligne de corps** : à 0 résultat, garder en-têtes + ligne de filtres visibles (sinon « tout disparaît »
  et on ne peut plus corriger le filtre). Filtre tolérant : valeur vide / nombre en cours de frappe → ne filtre pas.
- **Serveur** : `loader` en `useCallback` (sinon refetch en boucle) ; un compteur `refresh` dans ses deps = bouton
  Recharger. État persisté restauré en **initialiseur `useState` lazy SYNCHRONE** → prêt AVANT la 1ʳᵉ requête (pas de
  double-fetch). Endpoint back = renvoyer `{rows,total}`, lire `page/pageSize/sort/dir/q/filters(JSON)`.
- Persistance **indexée** : clé `nf.datagrid:<persist.key>` (unique par grille) ; « Effacer la sauvegarde » au menu Colonnes.

## 6. Temps réel / socket Studio

> Invariant socket partagée + log protocole + actions : `realtime-studio.md`. Mécanisme client : `nodefony-frontend-dev`.

- **Canal PARTAGÉ + ref-comptage** : un canal souscrit par 2 consommateurs (hook + store, ou Logs + Dashboard) → le
  ref-comptage doit être l'**autorité de `RealtimeClient.subscribe/unsubscribe`** (réseau émis aux seules transitions
  0↔1, re-subscribe au `onopen`) ; binding + store ne font qu'appeler. JAMAIS de raw `client.emit("subscribe")`.
- **Hub réconcilie depuis le client** : la table d'abonnements (`syncStats`) se reconstruit depuis
  `client.subscribedChannels` (+ `getChannelStats`), pas depuis un état parallèle qui se désynchronise quand une page
  migre aux hooks.
- **`useSyncExternalStore` + snapshot OBJET = boucle de render** (réf instable) → réserver `useSyncExternalStore`
  aux snapshots **primitifs** (ex. `client.state`) ; les stats via `state` + effet.
- **Nouveau subpath** (`nodefony/react`, …) pas résolu par Vite à chaud → **redémarrer** le serveur (`optimizeDeps`).
- **Canal à granularité** (`dashboard:supervision:<ms>`) est poussé sur le canal **EXACT** souscrit (suffixe inclus)
  → un listener de test/debug doit matcher `startsWith("dashboard:supervision")`, pas le nom nu.
- **🔥 Ne JAMAIS cycler la socket partagée au boot** : un `disconnect()`+`connect()` au montage (réaction d'identité
  `null→id`) coupe les requêtes data-plane **EN VOL** qui passent par le pont `api.request` → la page reste en spinner
  jusqu'au timeout du pont. Réserver `disconnect()` au **vrai changement de compte** (`prevId !== null && prevId !== id`).
- **Diag « boucle de requêtes »** : `me`/`info`/`health` qui se répètent = **REMONTAGE du shell** (`AuthGuard
key={user.id}`), PAS un retry (`useResource` ne retry pas). Lire « X / Y requests » du Network : Y = tous les assets
  (modules Vite en dev), X = filtré Fetch/XHR (le ×2 vient de StrictMode/reconnect, pas d'un emballement).
- **Cadence auto (AIMD) = réglage GLOBAL via store** (`UiStore.adaptiveCadence`) : un contrôle qui doit apparaître dans
  le popover du chip se met dans **`RealtimeHubContent`** (le composant partagé), PAS dans `RealtimeConsole` (qui ne le
  rend pas). Les pages d'état (ORM…) **lisent** `ui.adaptiveCadence`, pas de switch local par page.
- **Un job long (terminal live) = action pour LANCER + canal pour SUIVRE, et le canal porte l'ÉTAT, pas que les lignes.**
  Patron de la page « Créer » (`routes/create/`) : `conn.request("scaffold:run")` rend le `jobId` **tout de suite**, puis
  `useNodefonyChannel("scaffold:job@<id>")` streame. Deux pièges, tous deux vécus :
  1. **Course « je reçois l'id / je m'abonne »** — les premières lignes sont AUSSI les plus rapides (écriture des fichiers) :
     elles partent avant l'abonnement et un pub/sub nu les perdrait (terminal qui démarre au milieu, sans raison visible).
     → le serveur **garde son backlog et le REJOUE à l'abonnement** ; le front **dédoublonne par `seq`**. Un F5 en plein
     `npm install` reconstitue alors tout le terminal.
  2. **Si le canal ne porte que des lignes, le front ne sait jamais que c'est fini** → on retombe sur un **sondage HTTP**
     alors qu'une socket est ouverte (absurde). → le canal pousse une union `{kind:"line"|"state"}` ; l'état part à
     l'abonnement, dès les fichiers écrits, et à la fin. **Zéro polling.**
- **Une action Studio qui ÉCRIT dans les sources fait redémarrer le serveur** (le watcher dev regarde `nodefony/` et
  `index.ts` — là où le scaffold écrit) → le rechargement tombe au milieu du job et **tue le `npm install`** (process
  enfant du serveur). Le back doit encadrer son travail par `suspendSupervisor()`/`resumeSupervisor()` (cf
  `nodefony-framework-dev` § Pièges structurels). Symptôme sans ça : le terminal se coupe net et la socket meurt.
- **🚫 Un front ne DEVINE JAMAIS une capacité du serveur.** Vécu, coûteux : `FRONT_CAPABILITIES = { hasCheckout: false }`
  écrit en dur côté React → la question `link` du scaffold (conditionnée `askIf: "hasCheckout"`) n'était **jamais posée**,
  donc **supprimée en silence**. Or `link` est ce qui réécrit les deps `@nodefony/*` en `file:<checkout>` — sans elle,
  l'app générée tire des paquets **non encore publiés sur npm** et son `npm install` meurt en **404** (trouvé par le user
  en cliquant, pas par un test). Règle : une capacité qui dépend de l'ÉTAT DU DISQUE SERVEUR se **demande au serveur**
  (`caps` dans la réponse du data plane, cf `scaffoldCaps()`), et le défaut d'absence est le plus **restrictif**, jamais
  une invention. Corollaire d'ergonomie : quand une option est nécessaire pour que le résultat FONCTIONNE, l'interface la
  pré-coche **et dit pourquoi** — et si l'utilisateur la décoche, elle **avertit avant**, pas pendant.
- **Livrer un artefact généré sans écrire sur le serveur** (`create app` mode archive) : générer dans un temporaire
  jetable (`mkdtempSync`), archiver (`tar` — **aucune dépendance npm ajoutée**), servir par `renderFileDownload()`, purger
  le temporaire AVEC le job. Le client télécharge « l'archive du job `<id>` », **jamais un chemin** → il n'y a rien à
  traverser. Et on n'installe RIEN avant d'archiver : embarquer `node_modules` ferait des centaines de Mo pour un code
  qui sera de toute façon installé à l'arrivée.

## 7. Rôles / autorisation front

- Mécanisme rôles = subpath Core **isomorphe** `nodefony/roles` (`hasRole`/`hasAnyRole`/`hasAllRoles` purs, `RoleSet`,
  `RoleRegistry` bitmask). Les **noms** de rôles sont applicatifs (côté Studio `auth/`), jamais dans le core (mécanisme ≠ politique).
- **Le gating front = AFFICHAGE seulement, PAS de la sécu.** L'enforcement réel (403 serveur par rôle) est côté
  firewall/data plane. Ne jamais mettre de donnée sensible derrière un seul guard front.
- **« Admin voit tout » = 1 helper** `isVisibleForRoles(required, userRoles)` (court-circuit `ROLE_NODEFONY_ADMIN`
  → true) + bundles **`VIEW_ROLES`** = source unique partagée nav ⟷ routes ⟷ catalogue. Ne JAMAIS répéter
  `ROLE_NODEFONY_ADMIN` sur chaque item/route/bloc.
- **Couper un appel admin = NE PAS MONTER le composant** (pas gater chaque fetch). `RoleGuardOutlet` (variante
  layout-route de `RoleGuard`) garde des **groupes de routes** → une page admin **ne se monte pas** en deep-link →
  0 fetch, 0 403 console.
- **Page dual-audience = DEUX gardes** : menu (`navConfig.roles`) **ET** route (`RoleGuardOutlet` dans `App.tsx`). Un
  403 LIVE vient du garde de **ROUTE**, pas du menu → mettre la route dans le bloc « accessible à tous », gater le mode
  admin DANS le composant. Couper les appels admin = gater le **FETCH** (`isAdmin ? store.api.get : Promise.resolve(null)`).
- **Self-service ≠ uniforme selon le back** : un « mode mine » exige un **endpoint back dédié anti-IDOR**
  (`sessions/mine`, scopé identité serveur). Tant qu'il n'existe pas (l'endpoint n'a qu'un RBAC admin), le mode self
  tape l'admin = 403 → page admin-only. **Vérifier l'endpoint AVANT de présumer qu'un mode self est self-service.**
- ⚠️ Bitmask JS = **32 bits signés** → cap 31 rôles ; inadapté aux rôles DYNAMIQUES (DB, pas de bit fixe).

## 8. Patron sondes + hub

> Les 5 pièces du patron : `realtime-studio.md` §6. Ici = les règles d'UI d'observabilité distillées.

- **Briques partagées, pas par page** : `KpiCard` (carte KPI riche, clic→onglet, halo live), `FlashValue` +
  `ensureLiveStyles` (flash « ce qui bouge », re-clé sur la valeur), `buildHealth`/`utils/health.ts` (verdict). Corriger
  un défaut dans la brique partagée (PageHeader/FlashValue/KpiCard) profite à tous les dashboards.
- **Snapshot HTTP one-shot pour le mode OFF** : le patron expose AUSSI un endpoint pendant du canal → cartes peuplées
  de vraies valeurs SANS flux WS quand le temps réel est OFF (symétrie endpoint + ticker).
- **Temps réel OFF par défaut (perf)** : l'abonnement = enfant monté conditionnellement (`{live && <XxxLive/>}` qui
  appelle `useNodefonyChannel`, ref-compté → 0 ticker serveur quand OFF). Masquer les widgets live-only en OFF ; garder
  les widgets snapshot. `activeTab` retombe sur un onglet visible quand un onglet live-only disparaît.
- **Santé GLOBALE = 3 états** (OK / À surveiller / Dégradé), JAMAIS binaire : rouge réservé aux alertes CRITIQUES, un
  warning jaune = « À surveiller » (sinon faux « Dégradé » permanent dès 1 erreur/min). Chaque alerte porte un `DocHint`
  (sens + gravité + quoi regarder).
- **Indice composite** (`buildHealth`/`healthDesirability`) : moyenne géométrique pondérée des désirabilités
  (Derringer-Suich, NIST). 2 classes : **saturation** (`floor>0` → planchée « Dégradé » max) vs **panne**
  (`critical:true` → peut tirer à 0). Null exclu (poids recalculés). Sliders de pondération persistés.
- **Seuils env-aware** : en DEV l'event-loop partage le process avec Vite/HMR (15-25 ms normal) → seuils relâchés vs
  prod ; `info.environment` pilote.
- **Famine realtime SIGNALÉE, pas figée** : sous charge, le ticker `setInterval` serveur dérape → mesurer la cadence
  RÉELLE côté client (`observedGapMs` via un heartbeat 1/s live-only ; setState seulement si `gap > liveMs` → 0 render
  parasite) → badge « retard ~Xs » (= « à surveiller », jamais rouge). Le seuil est **relatif** à la cadence (tester en 1 s).
- **Latence applicative contextualisée** : une latence mesurée côté serveur en JS (ping ORM…) est **gonflée par
  l'attente event-loop** sous charge → quand la santé loop n'est pas verte, afficher un `DocHint` qui le DIT (sinon
  l'utilisateur croit que sa base déconne).
- **Ping connecteur** : « en attente… » (gris) tant que la santé live n'est pas reçue ; « échec » (rouge) UNIQUEMENT
  si `pingOk === false` (pas `undefined`) — évite le faux échec au 1ᵉʳ render.
- **Un compteur cumulatif n'a PAS de couleur d'alarme** (count ≠ rate) : réserver la couleur aux signaux rares
  (critiques `red`, connecteurs déconnectés `orange`). Chaque métrique = un `DocHint` qui explique son **cas 0/null**.
- **Sonde additive sur une page live = champs OPTIONNELS + rendu conditionnel** : types miroir locaux avec champs `?`
  optionnels (instance ET totaux), rendu `inst.x ? <section/> : null` → 0 régression si un worker ne remonte pas la
  sonde ; `normalize()` propage la sonde au cas per-instance (mono-process) → les KPI s'affichent aussi en dev.
- **Tester un round-trip WS sur serveur CALME** (un stress sature le handshake → faux négatif).
- **Cloud-native** : `instanceId` = pid stampé, **per-instance**, NE PAS agréger dans le process (vue multi-pod =
  Prometheus / fan-out Redis). CPU% = % d'UN cœur.

## 9. Perf

- **Mesurer un endpoint lent** : `curl -sk -o /dev/null -w "%{time_total}s %{size_download}o" <url>`. Payload minuscule
  - temps élevé ⇒ coût **fs/git**, pas le réseau. Vécu : un `git log` spawné PAR doc → relire seulement à l'ouverture,
    `readdir` seul pour les counts (~80×). **Loader = skeleton** qui épouse la page, pas un spinner centré.
- **Tout overlay/widget animé se met en PAUSE quand l'onglet est caché** (`document.hidden` via Page Visibility) — un
  `setInterval` + une animation qui tournent onglet caché font ramer la machine. **Jamais de `backdrop-filter: blur`
  plein écran animé** (paint GPU permanent, recomposé même caché). Respecter `useReducedMotion`, hisser les styles.
- **Grand graphe React Flow** (>~quelques dizaines de nœuds = illisible/laggy) : `Select searchable` → focus ;
  **sous-graphe `neighborhood(root, depth)`** (BFS 1-2 sauts) → ne layouter QUE le voisinage ; garde `LARGE_GRAPH`
  (>60 sans focus → invite à chercher + bouton « Afficher tout ») ; cadrage auto via `onInit`→`useRef(instance)` puis
  `requestAnimationFrame(() => rf.fitView(...))` dans un effet `[focus, nodes]` (laisser React Flow committer avant de cadrer).

## 10. Grosse page : extraction

- **Module de page ÉCLATÉ** (recette éprouvée ORM/audit/firewall/apikeys) : `routes/<feat>/<feat>Model.ts` (types
  miroir du contrat back + constantes + statut **dérivé** + `describe<Feat>Error` + format dates, **0 JSX**) ·
  `<feat>Format.tsx` (badges a11y icône+couleur+texte, **JSX → `.tsx`**) · `<Feat>Filters.tsx` · `<Feat>Detail.tsx`
  (**Modal centré, jamais drawer**) · `<Feat>Live.tsx` (abonnement live monté conditionnel) · orchestrateur `<Feat>.tsx`.
- **Extraire une route > ~2k lignes** (cache cher) vers 3 cibles : `types/<feat>.ts` (**0 JSX**), `utils/<feat>Format.ts`
  (helpers PURS — un helper qui rend une icône `<Icon/>` DOIT rester en `.tsx`, jamais `.ts` → sinon build cassé),
  `routes/<feat>/<Comp>.tsx` (composants + abonnements + hooks dérivés + contrôles partagés). Bénéfice : la page ET le
  drill importent le MÊME code (0 copie). ⚠️ prettier (lint-staged) reformate les nouveaux fichiers après le commit.
- **Front = types MIROIR locaux**, jamais d'import runtime d'un module serveur (`@nodefony/security`, …) dans
  `frontend/src` (cf §sécurité du SKILL : frontière isomorphe).
- **Consommer un data plane PAGINÉ PAR CURSEUR** (≠ offset) : `DataGrid mode="client"` sur la fenêtre chargée + bouton
  « charger plus anciens » (append `before=nextBefore`) + **jeton de course** (`reqId` ref) qui invalide les fetchs en
  vol au re-filtrage. KPIs dérivés de la fenêtre (`DocHint` honnête sur le périmètre).
- **`useResource` ne renvoie que `e.message`** → pour un message FR honnête (401/403/503/404), mapper l'erreur **DANS
  le fetcher** : `try { return await store.api.getAbsolute(...) } catch (e) { throw new Error(describeErr(e)) }`.
- **Drill par worker en cluster** : le diagnostic riche tombe sur 1 worker au hasard (round-robin reusePort) →
  **best-effort honnête** = alerte orange « fourni par pid Y » dès que ça diverge, jamais faire passer le rich d'un
  autre worker pour celui demandé. Quand un relais ciblé back existe, **canal combiné** `<x>:rich@<pid>` (1 enrich, pas
  de ref-count ; `richPending` = bandeau warming ≤ 1 cycle) → toujours exact en mono ET cluster.

## 11. Workspace

- **Modèle px/fraction, PAS de colonnes figées** : `{x,w = fraction 0..1 (responsive) ; y,h = px ; z = z-order}`.
- **Un singleton MobX SURVIT au HMR** → après refonte d'un modèle de store, l'ancienne instance persiste (tuiles à
  `(0,0)`, « tout figé ») → **hard-reload obligatoire** + **bumper la clé localStorage** (`…v2→v3`).
- **Drag/resize = `setPointerCapture`** sur la poignée (pas de listeners `window`) → suivi en `transform`/taille DOM
  directe (compositor, throttle rAF), **commit au `pointerup` seulement** (ne pas `setSize`→persist à chaque frame).
- **Placement LIBRE + « Ranger »** : chevauchement permis (z-order, clic = `bringToFront`) ; bouton « Ranger » =
  `autoTile` (= Clean Up des OS), pas d'anti-collision permanent. Gouttière = **inset** le wrapper (padding), pas le modèle.
- **`isolation: "isolate"`** sur le conteneur des fenêtres → confine leur z-index (sinon une fenêtre remonte au-dessus
  de la topbar). **`overflow-x: auto` force `overflow-y: auto`** (spec) → bordure (dans la box) pas `outline` (déborde).
- **Renommer via `Menu` Mantine** : à la fermeture le Menu rend le focus à son trigger → blur immédiat de l'input
  `autoFocus` → commit avant la frappe. Fix = **`returnFocus={false}`** + double-clic pour renommer.
- **Persistance autoritaire** : si l'utilisateur a des bureaux, ils font foi ; les presets ne sont que des **modèles**
  pour le « + », semés au 1ᵉʳ lancement seul. **Templates** : `WorkspacePreset.layout?` (positions exactes, bypass
  `autoTile`) vs `items` (graines pavées auto). Bureaux/blocs filtrés par rôle (`WorkspacePreset.roles` / `CATEGORY_ROLES`).
- **Nom du bureau actif réactif** (`observer`, lié au store) — un titre statique ne change pas.
- **Réordonner les BUREAUX (vignettes du bandeau)** : même patron pointeur que les fenêtres (poignée +
  `setPointerCapture` + `transform`, commit unique au relâché) — **pas de lib de DnD** : une seconde mécanique de
  drag dériverait de la première. **Seuil de ~4 px** avant qu'un appui devienne un drag, sinon le clic « bascule de
  bureau » part en déplacement au moindre tremblement. **Équivalent CLAVIER obligatoire** (menu ⋯ « Déplacer à
  gauche/droite ») : un réordonnancement souris-seul est inaccessible.
- **L'ordre des bureaux EST celui des clés de `layouts`** (ids non numériques → JS et JSON préservent l'ordre
  d'insertion) : pas de tableau `order` parallèle à tenir en cohérence avec créations/suppressions (une seule
  source de vérité). Déplacer = **relatif à un voisin** (`moveWorkspace(id, beforeId)`), **jamais par index** : la
  liste affichée est filtrée par rôle → l'index vu à l'écran n'est pas l'index réel.
- **Catalogue à facettes** : aperçu LIVE au survol = réutiliser **`useBlockSource` + `BlockBody`** (registre de blocs
  unifié, le MÊME bloc qu'au bureau) monté lazy dans le `HoverCard`. Recherche tolérante = `normalize("NFD").replace(/\p{Diacritic}/gu,"")`
  - multi-termes. **Tags** : 2 axes **saisis** (domaine hiérarchique + nature) + 1 axe **dérivé** (capacités, 0 dérive).
- **Registre de BLOCS UNIFIÉ `blocks/`** : 1 contenu écrit 1× (`IBlockDef`) monté page/widget/dialog via `BlockView` ;
  `useBlockSource` = le cœur (snapshot HTTP + live conditionnel) ; **1 SEULE Map** (pas de doublon).

## 12. ApiClient & pont socket

> Le contrat BFF (ApiClient/useResource, mutations HTTP vs socket, idempotence) est dans `nodefony-frontend-dev`
> (`reference/data-bff.md`). Ici = les pièges vécus en intégrant le pont dans Studio.

- **Point d'injection = `ApiClient.send()`, PAS `useResource` ni les pages** : toutes les pages passent par `store.api.*`
  → brancher le pont là couvre tout Studio avec **0 call-site modifié**. `ApiClientOptions.socket` = **type structurel**
  (`state` + `request(path)`), pas d'import runtime `nodefony` (0 couplage, mockable).
- **🚨 Le pont socket ne sert que les SUCCÈS** : TOUT échec → `learnFromSocketError` puis **fallback fetch** (réponse
  de référence, mêmes `ApiError`/`onError`/`onUnauthorized` → 0 divergence par construction). Ne JAMAIS propager
  `RpcError.data.status` en `ApiError` (une route GET-only → 405 du pont ≠ la réponse REST → Studio cassé à la
  connexion). Mémoriser pour ne pas gaspiller : `-32601` → pont désactivé session ; **405 → `httpOnlyRoutes`** (clé =
  path SANS query, scopé **par méthode**). Duck-typing `name === "RpcError"` (pas d'`instanceof` cross-bundle).
- **L'unwrap `{result}` doit être PARTAGÉ** entre les 2 transports (`unwrapResult` commun) → shape identique.
- **Tester `ApiClient` (service pur sans React)** : importer `frontend/src/services/ApiClient` direct, `fetch` mocké
  par `vi.stubGlobal`. ⚠️ une `Response` ne se lit qu'UNE fois → `mockImplementation(() => Promise.resolve(new Response(…)))`,
  jamais `mockResolvedValue(réponse-partagée)` (2ᵉ lecture = « Body is unusable »).
- ⚠️ **Vérif transform Vite en multi-bundle : identifier la BONNE instance** : le mono-supervisor lance N serveurs Vite
  (5173 React/studio, 5177 angular…). Un curl `@fs` d'un `.tsx` React sur l'instance **angular** → 500 « invalid JS
  syntax » alors que le code est sain. Discriminer : `.tsx` témoin non modifié, `[angular] [vite] Internal server error`
  dans le log, `lsof` les ports. Ne pas « corriger » un faux positif.

## 13. Notifications

- **`NotificationStore` (MobX) branché sur `realtime.onNotice`** au constructeur (comme `ConnectionStore`) →
  `notifications.show()` Mantine + ring `recent`. Source NORMALISÉE = `NodefonyNotice` (Core isomorphe). Studio ne
  consomme PAS les hooks notice (réservés aux apps React non-MobX).
- **`ApiClient` option `onError` → toast les MUTATIONS échouées** (POST/PUT/DELETE), **PAS les GET** (déjà rendus par
  `<DataState>`) ni les **401** (déjà = logout) → évite le double affichage. Erreurs `autoClose: false`.

## 14. Écrans vitrine

- **🚫 Layout shift d'erreur = anti-pattern ergo MAJEUR** (« c'est mon œil qui bouge ») : une erreur ne déplace JAMAIS
  les champs. Recette zéro-saut : (a) TOUTES les erreurs (auth ET validation) dans **UNE zone à hauteur RÉSERVÉE**
  (`<Box mih={N}>`) ; **JAMAIS** d'erreur inline Mantine (`error=` + `validate` du `useForm` **poussent** le form →
  retirer `validate`, valider à la main dans `onSubmit`, router le message vers la zone) ; (b) zone EN HAUT (près du
  regard) ; (c) le centrage vertical reste sans saut car la réserve garde la hauteur constante.
- **Erreurs CLASSÉES** : `classifyError(e, step)` → credentials (message générique = anti-énumération) / réseau / serveur
  / throttle 429 non réessayable (countdown + `Retry-After`). `role="alert"` (WCAG 3.3.1), s'efface à la frappe.
- **Identifier-first SÛR** : étape 1 = **0 appel serveur** (anti-énumération OWASP) ; « rebonjour » (mémorise le dernier
  user → démarre à l'étape mot de passe). Méthodes alternatives (SSO/Passkey) = bloc partagé rendu aux 2 étapes.
- **Écran VITRINE → mini-cahier des charges VISUEL validé AVANT** (structure + erreurs + responsive + ce qui doit/ne
  doit PAS bouger), pas improviser le rendu (sinon ~12 itérations UI).

## 15. FlowGraph live / migration POC

- **Pattern « 0 ticker quand OFF »** : séparer `<MonGraphe live={false}>` (statique, **PAS d'appel** au hook qui
  s'abonne) de `<LiveBranch>` (sous-composant qui appelle le hook). Switch OFF → la branche est **DÉMONTÉE** →
  unsubscribe ref-compté → ticker serveur arrêté. Un `live={false}` qui appellerait quand même le hook = fuite.
- `FlowGraph` accepte `liveNodeData?: Record<nodeId, LiveNodeData>` (`{metrics?, status?, pulse?}`) → bandeau métriques
  (tabular-nums, `contain: layout paint`) + dot d'état + pulse (`opacity` only, coupé par `prefers-reduced-motion`).
  Les `map<Schéma>Live(snap)` projettent vers `Record<nodeId, LiveNodeData>` (purs, testables ; `FlowGraph` reste générique).
- **Migration POC HMR → vitrine officielle** : la liste vit dans **UNE source** (registry isomorphe + helper de mapping
  qui accepte les 2 formes de slug, JAMAIS deux registries). Étapes : dissoudre la branche `if (isXxx)` dans le rendu
  générique (`MarkdownDoc` + briques) ; **purger les hardcodes du controller** (sinon doublon dans le menu) ; supprimer
  la route/page/nav du POC. Si la branche ne peut PAS être dissoute → la vitrine manque une brique générique (l'ajouter d'abord).

> **Briques de doc (MarkdownDoc, admonitions, anchors, DocPageHeader, code blocks)** → skill `nodefony-documentation`
> (concern transverse dédié). Règle gravée : override `<pre>` (pas `<code>`) pour un block enrichi (`<pre><Paper>` valide,
> pas `<code>` qui donnerait `<pre><Paper></pre>` invalide).

## Forage Twin — règle (rappel)

Un sous-schéma / une vue forée décrit une **architecture RÉELLE** → AVANT de poser briques/étapes/liens, **lire la
SOURCE DE VÉRITÉ du module** (code + `MEMORY.md`/`CLAUDE.md`), jamais deviner l'ordre ni les noms. Une brique inexacte
est un **BUG** (une donnée fausse trompe plus qu'elle n'informe). Détail : `twin.md`.
