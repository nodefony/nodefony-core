---
name: nodefony-studio-dev
metadata:
  version: 2.0.0
description: >
  Kit de dev du frontend Studio de Nodefony (@nodefony/studio, React 19) — l'app admin interne du
  framework. Construire un écran (page / dashboard / panneau / onglet) vite et bien en réutilisant le
  UI kit (PageHeader, PageLayout, DataGrid, DataState, StatCard, KpiCard, JsonViewer, MiniChart,
  DocHint), le hook useResource, les stores MobX et les hooks temps réel nodefony/react. Donne la
  recette (route + lazy + navConfig + fallback deep-link + data plane), des squelettes copier-coller,
  le Jumeau Vivant (Twin), la debug bar, le back-end Studio (controller + data plane + realtime), et
  les règles qualité (a11y, sécu, perf, gate tsc). DÉRIVE de nodefony-frontend-dev (mécanismes front
  généraux). Déclencheurs : "dev studio", "page studio", "dashboard studio", "écran studio", "panneau
  studio", "composant studio", "page /nodefony", "comment coder dans studio", "Twin", "jumeau vivant",
  "debug bar", "debugbar", "barre de debug", "WDT".
---

# nodefony-studio-dev — kit de dev Studio (frontend admin)

> Playbook **déterministe** : produis un écran Studio (page / dashboard / panneau / onglet) **cohérent,
> accessible, perf** sans ré-explorer le code. Signatures, chemins et recettes sont ici (corps) + dans
> `references/` (chargé à la demande). Studio = `src/packages/@nodefony/studio/frontend` (React 19 +
> Mantine **v9** + MobX 6 + React Router 7 + TanStack Table 8). Racine module : `src/packages/@nodefony/studio`.
>
> **MAINTENANCE (lire avant d'éditer ce skill)** : ce skill décrit la **vérité courante**, pas un journal.
> Mettre à jour = **éditer la section concernée en place**. **Pas de changelog ni de retex daté** ici —
> l'historique vit dans `git log`. Une leçon durable se **fond en règle** dans `references/gotchas-studio.md`.
> Le **détail** (UI kit, recettes, Twin, realtime, back) vit dans `references/*.md` (progressive disclosure)
> — garder ce fichier **< 350 lignes**. Avancement/phases/roadmap = `MIGRATION_STATUS.md` **uniquement**.

> **Périmètre** : mécanismes front **généraux** (isomorphisme, socket `RealtimeClient` + hooks `nodefony/react`,
> HMR/Vite, data-plane BFF `ApiClient`/`useResource`, RBAC isomorphe, temps-réel-calme/perf/a11y) → **`nodefony-frontend-dev`**
> (skill PARENT dont CE skill dérive — l'y consulter, ne pas redocumenter). Scaffolder un module avec front
> → **`nodefony-create-frontend-module`**. Le CŒUR back (service, module, endpoint, canal/action serveur,
> entité ORM) → **`nodefony-framework-dev`**. Briques de doc/portail (MarkdownDoc, DocLayout, FlowGraph,
> `@nodefony/documentation`) → **`nodefony-documentation`**. Sécurité review/attaque → `nodefony-security-review`.

## 🔗 Paire POLYMORPHE front ⇄ back (co-évolution OBLIGATOIRE)

`nodefony-studio-dev` (front) **CONSOMME** le contrat que `nodefony-framework-dev` (back) **PRODUIT** — deux
faces d'UN kit full-stack (isomorphisme : back/front partagent `nodefony`). Le SEAM partagé :

- **Data-plane** `/nodefony/<mod>/api/*` (front via `useResource`/`ApiClient` ← back via `IAdminApi`).
- **Realtime** : canaux + actions (front via hooks/`conn.request` ← back via `RealtimeController` ; hub = broker).
- **Types** : exports `nodefony` (isomorphes) + `I*Api`/`I*Controller` = **source de vérité unique** (jamais une copie figée).

**RÈGLE** : une feature qui traverse front+back → mettre à jour **LES DEUX skills dans la MÊME session**.
Quand le front commence à consommer un **canal / action / endpoint / type** nouveau → vérifier qu'il est décrit
côté `nodefony-framework-dev` (et inversement). **Passer la main au back** dès que le besoin touche le CŒUR :
service injectable, module, commande CLI, entité/repository/adapter ORM, pipeline HTTP/WS, **nouveau canal/action
serveur**, **subpath Core isomorphe** (`nodefony/*`).

## 1. Quand l'utiliser / quand passer la main

**Utiliser** quand on construit, dans `src/packages/@nodefony/studio/frontend/src` :

- une **page / dashboard / panneau / onglet** (route + lazy + navConfig + fallback deep-link) ;
- un composant réutilisant le **UI kit** (`components/ui/`), les **stores** MobX, les **hooks** `nodefony/react` ;
- le **Jumeau Vivant** (`/nodefony/twin`), un **widget de bureau** (Workspace), la **debug bar** (`nodefony/debugbar`) ;
- le **back-end Studio** (`nodefony/controller/*`, `nodefony/realtime/providers.ts`) — controller, data plane utilitaire, providers de canaux.

**Passer la main** :

| Besoin                                                                                                 | Skill                                        |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Mécanisme front général (isomorphisme, socket client, HMR, BFF, RBAC isomorphe, a11y/perf/calme)       | `nodefony-frontend-dev`                      |
| Scaffolder un module applicatif avec front Vite (React/Vue/Angular)                                    | `nodefony-create-frontend-module`            |
| Cœur back : service, module, CLI, endpoint, **canal/action serveur**, entité ORM, subpath `nodefony/*` | `nodefony-framework-dev`                     |
| Portail doc / markdown / FlowGraph / `@nodefony/documentation`                                         | `nodefony-documentation`                     |
| Revue / attaque sécurité du diff avant commit                                                          | `nodefony-security-review`                   |
| Conformité RFC HTTP/WS/CORS/cookies · normes WCAG/ARIA                                                 | `nodefony-rfc` · (specs dans `frontend-dev`) |
| Démarrer/redémarrer le serveur dev                                                                     | `nodefony-start-server`                      |
| Vérifier une modif front sans navigateur (curl transform Vite, purge prébundle)                        | `nodefony-frontend-dev` §4                   |

## 2. 🚨 RÈGLES ABSOLUES Studio (non négociables — priorité MAX)

- **🔎 VÉRIFIER L'EXISTANT AVANT DE CODER** (priorité #1) : avant de hand-roller un composant/une primitive UI
  (tableau, filtre, tri, pagination, autocomplete, popover…), CHERCHER s'il existe déjà, dans cet ordre : (1)
  **UI kit Studio** (`components/ui/` → `references/ui-kit.md`) ; (2) **`@mantine/core`** ; (3) **deps déjà
  installées** (`@tanstack/react-table` = tableau headless standard, déjà là) ; (4) en dernier recours une dep
  éprouvée (⚠ compat Mantine **v9** + React **19**). `grep` le `package.json` + `components/ui/` avant de créer.
- **🚨 Frontière isomorphe — JAMAIS de code/données SERVEUR dans le bundle client** : `frontend/src` n'importe AUCUN
  module serveur (`@nodefony/http|security|framework` runtime, kernel, services, config, ORM, secrets). Besoin d'un
  type serveur → **type miroir local** (pas d'import runtime). Le SEUL pont front↔serveur = le **data plane**
  `/nodefony/<module>/api/*` (JSON, secrets redactés CÔTÉ serveur). Détail → `nodefony-frontend-dev` (`isomorphic.md`).
- **🔒 Sécurité (Zero Trust, priorité permanente)** : toute API admin exige `ROLE_NODEFONY_ADMIN` → 403 sinon
  (firewall RÉEL, session BFF — pas un guard front, cf `references/backend-studio.md`). Rendu de données non maîtrisées
  → **TEXTE** (`<Text>`/`<Code>`/`<JsonViewer>`), JAMAIS `dangerouslySetInnerHTML` ni `rehype-raw`. 0 secret affiché/
  loggé. Liens externes → `rel="noreferrer noopener"`. Avant tout commit → diff au skill **`nodefony-security-review`**.
- **🟢 Aide contextuelle ⓘ DYNAMIQUE** : tout contrôle non trivial (filtre, toggle, tri, métrique) porte une bulle
  d'aide **typée** (`DocHint`/`GraphHint`/`TipHint`/`WarnHint`), **interpolée depuis les données live** (`${entities.length}`…),
  **JAMAIS de valeur codée en dur** (qui se périme et ment) + le cas **null/0 expliqué**. But : écran auto-explicatif.
- **♿ a11y** : 1 `<h1>`/page (PageHeader le fait) ; `aria-label` sur tout `ActionIcon` icône-seule ; `aria-expanded`
  sur un toggle ; zones async → `aria-live` (DataState le fait) ; graphe SVG → `role="img"`+`aria-label`. Pattern ARIA
  EXACT (dialog/tabs/menu/combobox/disclosure) + WCAG 2.2 AA → specs bundlées dans `nodefony-frontend-dev`.
- **⚡ Perf & temps réel CALME** : `MiniChart` (SVG) jamais recharts ; hooks realtime ref-comptés ; animer SEULEMENT
  `transform`/`opacity` ; `contain: content` par widget live ; `tabular-nums` ; styles statiques hissés. Le détail
  (compositor, `prefers-reduced-motion`, WCAG 2.2.2 Pause/Stop/Hide, test des 30 s) → `nodefony-frontend-dev` (`front-quality.md`).
- **TS strict / style** : 0 `any`, 0 `@ts-ignore` ; `import type` pour les types ; commentaires **FR** ; coller au
  pattern de `routes/RoutesView.tsx`.

## 3. Cartographie — Studio (qui vit où)

```
src/packages/@nodefony/studio/
├── nodefony/controller/StudioController.ts        pages UI SPA + data plane utilitaire (auth = firewall réel, PAS ici)
├── nodefony/controller/StudioRealtimeController.ts WS JSON-RPC 2.0 (pub/sub + actions)
├── nodefony/realtime/providers.ts                  providers de canaux (transport-agnostiques)
└── frontend/src/
    ├── App.tsx (routes lazy) · layouts/navConfig.ts (nav data-driven) · theme.ts (palette brand)
    ├── components/ui/   UI kit : PageHeader, PageLayout/StickyTabsList, DataGrid, DataState, StatCard,
    │                    KpiCard, DocHint(+presets), JsonViewer/Json*, MiniChart, FlowGraph, ConfigLayout…
    ├── stores/          MobX : Root, Auth, Connection, Ui, Admin, Notification, Profiler
    ├── services/        ApiClient (BFF + pont socket), AuthService, RealtimeClient (← Core nodefony)
    ├── routes/<feat>/   pages éclatées : <feat>Model.ts (types miroir, 0 JSX) · <feat>Format.tsx · <Comp>.tsx
    ├── realtime/twin/   Jumeau Vivant (twinSchemas, TwinMap, Twin.tsx) · workspace/ (bureau composable + blocks/)
    └── auth/            roles.ts (isomorphe nodefony/roles), VIEW_ROLES, RoleGuard/RoleGuardOutlet
```

**Partition du namespace `/nodefony` (FIGÉE)** : UI SPA (humain) = **mono-segment** `/nodefony` + `/nodefony/{page}`
porté par Studio ; data plane (machine) = `/nodefony/<module>/api/*` (**≥3 segments**, marqueur `/api/`) porté par
CHAQUE module propriétaire. Un module n'expose JAMAIS une route admin mono-segment. Détail → `references/backend-studio.md`.

## 4. Référence — `references/` (chargé À LA DEMANDE)

> Trouve la ligne qui matche ta tâche → lis le fichier `references/…` indiqué (lui seul). Mettre à jour = éditer en place.

| Ta tâche                                                                                                                                                                                                           | Lis ce fichier                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| **Construire un écran** : API exacte du UI kit + DataGrid (+ règle hauteur), stores MobX, hooks `nodefony/react`, recette route/lazy/navConfig/fallback, squelettes (données/live/détail), divulgation progressive | `references/ui-kit.md`          |
| **Realtime Studio** : ajouter un canal, hub UI, log protocole, **PATRON sondes back + abonnement hub** (observabilité)                                                                                             | `references/realtime-studio.md` |
| **Back-end Studio** : controller, data plane, **auth firewall réel**, realtime serveur (push WS), partition namespace, cycle de build, piège cluster                                                               | `references/backend-studio.md`  |
| **Jumeau Vivant (Twin)** : carte d'archi runtime data-driven, modèle/rendu/nav, recettes de forage                                                                                                                 | `references/twin.md`            |
| **Debug bar** (`nodefony/debugbar`, vanilla TS + Shadow DOM, ≠ React)                                                                                                                                              | `references/debugbar.md`        |
| **Gotchas Studio** (sticky structurel, hydratation `<p>`, DataGrid, rôles, workspace, pont socket, extraction grosse page…)                                                                                        | `references/gotchas-studio.md`  |

## 5. Gates qualité (AVANT commit — l'ordre compte)

```bash
cd src/packages/@nodefony/studio && npm run typecheck     # gate front = exit 0 (esbuild/Vite NE type PAS)
```

1. **Sécurité** : passer le diff au skill `nodefony-security-review` (PRIORITÉ MAX) — frontière isomorphe, redaction, RBAC.
2. **A11y** : WCAG 2.2 AA + pattern ARIA (APG) des composants ajoutés (specs → `nodefony-frontend-dev`).
3. **Type-check** : `npm run typecheck` = 0 erreur (le SEUL gate de types — esbuild ne voit que la syntaxe).
4. **Vérif sans navigateur** : curl le data plane (`curl -sk https://127.0.0.1:5152/nodefony/<m>/api/...`) + le transform
   Vite (`https://127.0.0.1:5173/@fs/<abs>.tsx` → 200). Modif **front** = HMR (0 restart) ; modif **back** Studio =
   `npm run build` (rolldown) + restart.
5. **Voir et MESURER l'écran** : skill **`nodefony-browser`** — navigateur en conteneur, console, arbre d'accessibilité, requêtes réelles, et contrastes/tailles CALCULÉS (de quoi valider une correction de palette sans attendre un audit). 🔴 Ne jamais faire jouer la sonde au user. Pour le HMR et le rendu fin, qui ne se jugent pas en conteneur : **hard-reload** `https://127.0.0.1:5152/nodefony` (cache React) + confirmation visuelle user.

> Serveur dev : `bash .claude/skills/nodefony-start-server/start.sh`. **Fin de session Studio** : fondre les nouvelles
> leçons en règles dans `references/gotchas-studio.md` (jamais un journal daté) ; un fait isolé → mémoire IA dédiée.

## Réfs (CLAUDE.md/MEMORY.md — détails)

Module : `src/packages/@nodefony/studio/{CLAUDE,MEMORY}.md` · front builder : `src/packages/@nodefony/frontend/{CLAUDE,MEMORY}.md` ·
http (Context/SSE) : `src/packages/@nodefony/http/{CLAUDE,MEMORY}.md` · framework (`@controller`/`@route`) : `…/framework/{CLAUDE,MEMORY}.md`.
Skill JUMEAU (mécanismes front) : `nodefony-frontend-dev`. Skill BACK : `nodefony-framework-dev`.
