---
name: nodefony-frontend-dev
metadata:
  version: 1.0.0
description: >
  Kit de dev FRONT de Nodefony — full-stack côté client : isomorphisme (`nodefony` partagé
  front/back), socket client (`RealtimeClient`, hooks React), builder Vite + HMR
  (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC
  isomorphe, ergonomie/a11y/perf (bundlés offline), et vérification d'une modif front — sans
  navigateur (transform Vite en `curl`, purge du prébundle) ou en OBSERVANT l'écran depuis un
  navigateur en CONTENEUR (console, a11y, requêtes réelles ; jamais de Chromium nu sur le poste).
  Studio → `nodefony-studio-dev` ; scaffold front → `nodefony-create-frontend-module` ;
  back → `nodefony-framework-dev`.
  Déclencheurs : "dev front nodefony", "isomorphisme", "socket client", "RealtimeClient",
  "useNodefony", "hooks realtime", "HMR", "Vite nodefony", "ApiClient",
  "useResource", "data plane front", "BFF", "RBAC front", "accessibilité front", "WCAG",
  "perf front", "vérifie le front", "ma modif front passe ?", "transform Vite",
  "prébundle Vite périmé".
---

# nodefony-frontend-dev — kit de dev FRONT (full-stack côté client)

> **Référence de développement du front Nodefony pour tout agent IA / LLM**, shippée avec le framework.
> Face FRONT du kit full-stack : `nodefony-framework-dev` (back) **produit** le contrat, ce skill le
> **consomme**. Couvre les **mécanismes du framework** (isomorphisme, socket, HMR, BFF) — pas une stack UI
> précise (le builder fait React/Vue/Angular). Tout est ici (corps) + `references/` (chargé à la demande)
>
> - `references/specs/` (best practices bundlées **offline**) → codable même sans le source du core.
>
> **MAINTENANCE (lire avant d'éditer)** : ce skill décrit la **vérité courante**, pas un journal. Mettre à
> jour = **éditer en place**. **Pas de changelog ni de retex daté** — l'historique vit dans `git log` ; une
> leçon durable se **fond en règle** dans `.claude/skills/nodefony-framework-dev/references/gotchas.md` ou la section concernée. Détail = `references/*.md`
> (progressive disclosure) → garder ce fichier **< 500 lignes**.

> **Périmètre / passer la main** : app admin **Studio** (UI kit, Mantine v9, MobX, pages, Twin, debugbar)
> → **`nodefony-studio-dev`** (DÉRIVE de ce skill + ajoute SA stack). Scaffolder un module front neuf →
> **`nodefony-create-frontend-module`**. Back (controllers, services, data plane, realtime serveur) →
> **`nodefony-framework-dev`** (qui porte aussi « Doc TypeScript / @types/node » pour un type tordu).
> Sécurité review → `nodefony-security-review`.

## 🔗 Paire POLYMORPHE front ⇄ back (co-évolution OBLIGATOIRE)

`nodefony-frontend-dev` (front) et `nodefony-framework-dev` (back) = **deux faces d'UN kit full-stack**
(isomorphisme : front/back partagent le paquet `nodefony`). Le back **PRODUIT le contrat** ; ce skill le
**CONSOMME**. Le SEAM partagé (source de vérité = les exports `nodefony` + types `I*Api`/`I*Controller`,
jamais une copie figée) :

- **Data-plane** `/nodefony/<mod>/api/*` : back l'expose via `IAdminApi` → front via `ApiClient`/`useResource`. → `references/data-bff.md`.
- **Realtime** : back = hub + `RealtimeController` (canaux) → front = `RealtimeClient` + hooks `nodefony/react`. → `references/realtime-client.md`.
- **RBAC** : rôles dérivés CÔTÉ SERVEUR, exposés dans le DTO ; le front les lit via `nodefony/roles` (cosmétique). → `references/isomorphic.md`.

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

| Besoin                                                                                    | Skill                             |
| ----------------------------------------------------------------------------------------- | --------------------------------- |
| App Studio : UI kit (PageHeader/DataGrid/StatCard…), Mantine, MobX, pages, Twin, debugbar | `nodefony-studio-dev`             |
| Scaffolder un module front (React/Vue/Angular)                                            | `nodefony-create-frontend-module` |
| Back : controller, service, data plane, realtime serveur, ORM                             | `nodefony-framework-dev`          |
| Typer un truc tordu (utility types, `@types/node`)                                        | `nodefony-framework-dev` §1       |
| Revue sécurité d'un diff front                                                            | `nodefony-security-review`        |

## 2. 🚨 RÈGLES ABSOLUES front (non négociables)

- **Frontière ISOMORPHE** : côté front, `nodefony` = lib **client** (`customConditions:["browser"]`) — **JAMAIS** importer un service serveur (kernel, ORM, http…). Types miroir locaux si besoin, pas d'import runtime serveur. (Détail → `references/isomorphic.md`.)
- **Rendu = TEXTE toujours** : `<Text>`/équivalent ou composant typé, **jamais** `dangerouslySetInnerHTML`/`innerHTML` sur des données non maîtrisées. **0 secret** loggé/embarqué (le bundle front est public).
- **RBAC front = cosmétique** : masquer/afficher selon les rôles du **DTO** (`hasRole` isomorphe) — l'autorité reste le SERVEUR (le front ne décode jamais un token, ne décide jamais l'accès).
- **Perf = compositor-only** : animer **uniquement** `transform`/`opacity` (jamais `width`/`top`/`left` → reflow). `will-change`/`contain`/`content-visibility` à bon escient. (→ `references/front-quality.md` + `references/specs/`.)
- **Temps réel CALME** (WCAG 2.2.2) : paliers ms↔s, `tabular-nums`, respecter `prefers-reduced-motion` (flashes → opacité douce). Test des 30 s : l'œil ne doit rien voir bouger sans raison.
- **Socket PARTAGÉE** : 1 `RealtimeClient` par URL (singleton) ; canaux **ref-comptés** (subscribe au montage, unsubscribe au démontage) ; reconnect → re-subscribe auto. Ne JAMAIS ouvrir une 2ᵉ socket.
- **a11y** : 1 seul `<h1>`, `aria-label` sur les icônes-boutons, `aria-expanded` sur les toggles, `aria-live` pour le live. (→ `references/specs/w3c-wcag22.md` + `w3c-aria-apg-patterns.md`.)
- **TS strict** : 0 `any`, 0 `@ts-ignore`. Gate `npm run typecheck` du module front AVANT de dire « fait ».

## 3. Référence — `references/` (chargé À LA DEMANDE)

> Trouve ta tâche → lis le fichier indiqué (lui seul). Chaque fichier = API + mécanismes + gotchas, vérité
> courante, ancrés au source. `references/specs/` = best practices **bundlées offline** (0 réseau requis).

| Ta tâche                                                                                       | Lis ce fichier                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Isomorphisme (`nodefony` front/back, `customConditions`, subpaths), `nodefony/roles` RBAC      | `references/isomorphic.md`                      |
| Socket client `RealtimeClient` + hooks `nodefony/react` (`useNodefony*`, canaux, identité)     | `references/realtime-client.md`                 |
| Builder Vite + HMR (`@nodefony/frontend`, `registerEntry`, multi-bundle, prod, CDN)            | `references/build-hmr.md`                       |
| Consommer le data-plane BFF (`ApiClient`, `useResource`, session, RBAC, mutations)             | `references/data-bff.md`                        |
| Patterns d'écran (data-driven, live ref-compté, détail/drill) — framework-agnostique           | `references/patterns.md`                        |
| Ergonomie / temps réel calme / perf CSS / a11y / sécu front                                    | `references/front-quality.md`                   |
| Prouver une modif front **sans navigateur** (transform Vite, purge du prébundle, rechargement) | `references/build-hmr.md` §8                    |
| **Voir et MESURER l'écran** — navigateur en conteneur (console, a11y, contrastes calculés)     | skill **`nodefony-browser`**                    |
| Gotchas front (HMR, prébundle `.vite`, isomorphisme, socket)                                   | section _Gotchas_ dans chaque fichier ci-dessus |
| **Best practices bundlées OFFLINE** (ergonomie, a11y, perf)                                    | `references/specs/` (voir liste ci-dessous)     |

**`references/specs/` (offline, ~870 Ko)** : `w3c-wcag22.md` (WCAG 2.2 complet) · `w3c-aria-apg-patterns.md`
(ARIA Authoring Practices) · `nng-10-heuristics.md` (Nielsen Norman — 10 heuristiques d'ergonomie) ·
`webdev-animations-perf.md` (web.dev — animations performantes) · MDN CSS perf : `mdn-css-will-change.md`,
`mdn-css-contain.md`, `mdn-css-content-visibility.md`, `mdn-prefers-reduced-motion.md`.

## 4. Gates qualité front (AVANT de dire « fait »)

1. **`npm run typecheck`** du module front (esbuild/Vite n'attrape QUE la syntaxe, PAS les types).
2. **Transform Vite 200** : `curl -sk "https://<viteHost>/@fs/<abs>/src/<fichier>.tsx"` → vérifie résolution + transpilation. Purger `node_modules/.vite` si un import/subpath a changé. **Protocole complet, symptômes et limites → `references/build-hmr.md` §8.**
3. **Voir l'écran** — deux voies, dans cet ordre :
   - **Navigateur en CONTENEUR** → skill **`nodefony-browser`** : il lit la console, l'arbre
     d'accessibilité, les requêtes réelles, et **MESURE** les contrastes et tailles calculés, sans
     rien installer sur le poste. Décor, pilotage et les trois contraintes structurelles y vivent —
     **non recopiés ici**, sinon la copie diverge et empêche d'atteindre le skill.
     🔴 Ne jamais demander au développeur de jouer la sonde.
   - **Hard-reload** dans le navigateur du développeur (cache React) → confirmation visuelle.
     Reste nécessaire pour juger le HMR, l'animation et le rendu fin.
4. Modif d'un **contrat partagé** (canal/endpoint/type) → MAJ `nodefony-framework-dev`.

## Réfs

- Code de référence (1ʳᵉ implémentation = l'app Studio) : `src/packages/@nodefony/studio/frontend/src/`.
- Builder : `src/packages/@nodefony/frontend/`. Cœur isomorphe : `src/nodefony/` (exports `nodefony/client|react|roles`).
- Détail bas niveau d'un module : son `MEMORY.md` (présent dans le repo framework ; **absent** en projet consumer → tout l'essentiel est ici).
