---
name: nodefony-frontend-dev
version: 1.0.0
description: >
  Kit de dev FRONT de Nodefony (shippé avec le framework) — développer le full-stack côté client :
  isomorphisme (`nodefony` partagé front/back), la **socket Nodefony** client (`RealtimeClient` + hooks
  `nodefony/react`), le builder **Vite + HMR** (`@nodefony/frontend`, multi-framework React/Vue/Angular),
  la consommation du **data-plane BFF** (`ApiClient`/`useResource`), le RBAC isomorphe, et les règles
  d'**ergonomie / temps réel « calme » / a11y / perf** (best practices bundlées offline). Pour l'app admin
  Studio spécifique (UI kit Mantine + MobX + pages) → `nodefony-studio-dev` (qui DÉRIVE de ce skill).
  Scaffolder un module front → `nodefony-create-frontend-module`. Le back → `nodefony-framework-dev`.
  Déclencheurs : "dev front nodefony", "frontend nodefony", "isomorphisme", "socket client",
  "RealtimeClient", "useNodefony", "hooks realtime", "HMR", "Vite nodefony", "@nodefony/frontend",
  "ApiClient", "useResource", "data plane front", "BFF", "RBAC front", "temps réel ergonomique",
  "accessibilité front", "WCAG", "perf front", "front full-stack".
---

# nodefony-frontend-dev — kit de dev FRONT (full-stack côté client)

> **Référence de développement du front Nodefony pour tout agent IA / LLM**, shippée avec le framework.
> Face FRONT du kit full-stack : `nodefony-framework-dev` (back) **produit** le contrat, ce skill le
> **consomme**. Couvre les **mécanismes du framework** (isomorphisme, socket, HMR, BFF) — pas une stack UI
> précise (le builder fait React/Vue/Angular). Tout est ici (corps) + `reference/` (chargé à la demande)
>
> - `reference/specs/` (best practices bundlées **offline**) → codable même sans le source du core.
>
> **MAINTENANCE (lire avant d'éditer)** : ce skill décrit la **vérité courante**, pas un journal. Mettre à
> jour = **éditer en place**. **Pas de changelog ni de retex daté** — l'historique vit dans `git log` ; une
> leçon durable se **fond en règle** dans `reference/gotchas.md` ou la section concernée. Détail = `reference/*.md`
> (progressive disclosure) → garder ce fichier **< 500 lignes**.

> **Périmètre / passer la main** : app admin **Studio** (UI kit, Mantine v9, MobX, pages, Twin, debugbar)
> → **`nodefony-studio-dev`** (DÉRIVE de ce skill + ajoute SA stack). Scaffolder un module front neuf →
> **`nodefony-create-frontend-module`**. Back (controllers, services, data plane, realtime serveur) →
> **`nodefony-framework-dev`**. Types TS tordus → `nodefony-ts-docs`. Sécurité review → `nodefony-security-review`.

## 🔗 Paire POLYMORPHE front ⇄ back (co-évolution OBLIGATOIRE)

`nodefony-frontend-dev` (front) et `nodefony-framework-dev` (back) = **deux faces d'UN kit full-stack**
(isomorphisme : front/back partagent le paquet `nodefony`). Le back **PRODUIT le contrat** ; ce skill le
**CONSOMME**. Le SEAM partagé (source de vérité = les exports `nodefony` + types `I*Api`/`I*Controller`,
jamais une copie figée) :

- **Data-plane** `/nodefony/<mod>/api/*` : back l'expose via `IAdminApi` → front via `ApiClient`/`useResource`. → `reference/data-bff.md`.
- **Realtime** : back = hub + `RealtimeController` (canaux) → front = `RealtimeClient` + hooks `nodefony/react`. → `reference/realtime-client.md`.
- **RBAC** : rôles dérivés CÔTÉ SERVEUR, exposés dans le DTO ; le front les lit via `nodefony/roles` (cosmétique). → `reference/isomorphic.md`.

**RÈGLE** : une feature qui traverse back+front → MAJ **les deux skills dans la MÊME session**. Tu changes
ici un appel `ApiClient`/un hook/un canal consommé → vérifier/MAJ la section jumelle de `nodefony-framework-dev`.

## 1. Quand l'utiliser / quand passer la main

**Utiliser** quand tu codes côté CLIENT avec Nodefony :

- **isomorphisme** : partager du code `nodefony` front/back, `customConditions:["browser"]`, subpaths `nodefony/client|react|roles`.
- **socket Nodefony** : `RealtimeClient` (subscribe/request/mutate/ping), hooks `useNodefony*`, canaux temps réel.
- **builder/HMR** : `@nodefony/frontend` (`registerEntry`, Vite dev HMR, build prod, multi-bundle, `apiProxyPaths`).
- **data-plane BFF** : `ApiClient` (`getAbsolute`/`postAbsolute`/…), `useResource`, session BFF cookie opaque, RBAC front.
- **qualité front** : ergonomie, temps réel « calme », a11y (WCAG/ARIA), perf CSS compositor-only.

**Passer la main** :
| Besoin | Skill |
| --- | --- |
| App Studio : UI kit (PageHeader/DataGrid/StatCard…), Mantine, MobX, pages, Twin, debugbar | `nodefony-studio-dev` |
| Scaffolder un module front (React/Vue/Angular) | `nodefony-create-frontend-module` |
| Back : controller, service, data plane, realtime serveur, ORM | `nodefony-framework-dev` |
| Typer un truc tordu (utility types, génériques) | `nodefony-ts-docs` |
| Revue sécurité d'un diff front | `nodefony-security-review` |

## 2. 🚨 RÈGLES ABSOLUES front (non négociables)

- **Frontière ISOMORPHE** : côté front, `nodefony` = lib **client** (`customConditions:["browser"]`) — **JAMAIS** importer un service serveur (kernel, ORM, http…). Types miroir locaux si besoin, pas d'import runtime serveur. (Détail → `reference/isomorphic.md`.)
- **Rendu = TEXTE toujours** : `<Text>`/équivalent ou composant typé, **jamais** `dangerouslySetInnerHTML`/`innerHTML` sur des données non maîtrisées. **0 secret** loggé/embarqué (le bundle front est public).
- **RBAC front = cosmétique** : masquer/afficher selon les rôles du **DTO** (`hasRole` isomorphe) — l'autorité reste le SERVEUR (le front ne décode jamais un token, ne décide jamais l'accès).
- **Perf = compositor-only** : animer **uniquement** `transform`/`opacity` (jamais `width`/`top`/`left` → reflow). `will-change`/`contain`/`content-visibility` à bon escient. (→ `reference/front-quality.md` + `reference/specs/`.)
- **Temps réel CALME** (WCAG 2.2.2) : paliers ms↔s, `tabular-nums`, respecter `prefers-reduced-motion` (flashes → opacité douce). Test des 30 s : l'œil ne doit rien voir bouger sans raison.
- **Socket PARTAGÉE** : 1 `RealtimeClient` par URL (singleton) ; canaux **ref-comptés** (subscribe au montage, unsubscribe au démontage) ; reconnect → re-subscribe auto. Ne JAMAIS ouvrir une 2ᵉ socket.
- **a11y** : 1 seul `<h1>`, `aria-label` sur les icônes-boutons, `aria-expanded` sur les toggles, `aria-live` pour le live. (→ `reference/specs/w3c-wcag22.md` + `w3c-aria-apg-patterns.md`.)
- **TS strict** : 0 `any`, 0 `@ts-ignore`. Gate `npm run typecheck` du module front AVANT de dire « fait ».

## 3. Référence — `reference/` (chargé À LA DEMANDE)

> Trouve ta tâche → lis le fichier indiqué (lui seul). Chaque fichier = API + mécanismes + gotchas, vérité
> courante, ancrés au source. `reference/specs/` = best practices **bundlées offline** (0 réseau requis).

| Ta tâche                                                                                   | Lis ce fichier                                  |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Isomorphisme (`nodefony` front/back, `customConditions`, subpaths), `nodefony/roles` RBAC  | `reference/isomorphic.md`                       |
| Socket client `RealtimeClient` + hooks `nodefony/react` (`useNodefony*`, canaux, identité) | `reference/realtime-client.md`                  |
| Builder Vite + HMR (`@nodefony/frontend`, `registerEntry`, multi-bundle, prod, CDN)        | `reference/build-hmr.md`                        |
| Consommer le data-plane BFF (`ApiClient`, `useResource`, session, RBAC, mutations)         | `reference/data-bff.md`                         |
| Patterns d'écran (data-driven, live ref-compté, détail/drill) — framework-agnostique       | `reference/patterns.md`                         |
| Ergonomie / temps réel calme / perf CSS / a11y / sécu front                                | `reference/front-quality.md`                    |
| Gotchas front (HMR, prébundle `.vite`, isomorphisme, socket)                               | section _Gotchas_ dans chaque fichier ci-dessus |
| **Best practices bundlées OFFLINE** (ergonomie, a11y, perf)                                | `reference/specs/` (voir liste ci-dessous)      |

**`reference/specs/` (offline, ~870 Ko)** : `w3c-wcag22.md` (WCAG 2.2 complet) · `w3c-aria-apg-patterns.md`
(ARIA Authoring Practices) · `nng-10-heuristics.md` (Nielsen Norman — 10 heuristiques d'ergonomie) ·
`webdev-animations-perf.md` (web.dev — animations performantes) · MDN CSS perf : `mdn-css-will-change.md`,
`mdn-css-contain.md`, `mdn-css-content-visibility.md`, `mdn-prefers-reduced-motion.md`.

## 4. Gates qualité front (AVANT de dire « fait »)

1. **`npm run typecheck`** du module front (esbuild/Vite n'attrape QUE la syntaxe, PAS les types).
2. **Transform Vite 200** : `curl -sk "https://<viteHost>/@fs/<abs>/src/<fichier>.tsx"` → vérifie résolution + transpilation. Purger `node_modules/.vite` si un import/subpath a changé.
3. **Hard-reload** navigateur (cache React) après modif → demander la confirmation visuelle au user.
4. Modif d'un **contrat partagé** (canal/endpoint/type) → MAJ `nodefony-framework-dev`.

## Réfs

- Code de référence (1ʳᵉ implémentation = l'app Studio) : `src/packages/@nodefony/studio/frontend/src/`.
- Builder : `src/packages/@nodefony/frontend/`. Cœur isomorphe : `src/nodefony/` (exports `nodefony/client|react|roles`).
- Détail bas niveau d'un module : son `MEMORY.md` (présent dans le repo framework ; **absent** en projet consumer → tout l'essentiel est ici).
