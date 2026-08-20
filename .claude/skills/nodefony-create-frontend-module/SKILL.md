---
name: nodefony-create-frontend-module
description: >
  Scaffold d'un module à frontend SPA (React 19, Vue 3, Angular 21, Svelte 5) servi par @nodefony/frontend via
  Vite, DANS LE REPO FRAMEWORK (src/modules/). Dans une APPLICATION, le scaffold est une commande —
  `nodefony create module <nom> --frontend <fw>` — et ce skill se contente d'y renvoyer : il ne
  réimplémente pas le CLI. Wrapper de nodefony-create-module : délègue le squelette puis enrichit le
  spécifique frontend (controller HTML+CSP, registerEntry, entry+App du framework, peerDeps).
  Déclencheurs : "crée un module frontend", "module react", "module vue", "module angular", "module svelte",
  "scaffold module avec front", "nouveau front nodefony", "module vite".
---

# nodefony-create-frontend-module

**Wrapper** de `nodefony-create-module` — ne duplique AUCUN template déjà géré par lui.
Crée un **module applicatif** (`src/modules/{nom}/`) embarquant un frontend **React 19 / Vue 3 / Angular 21**
servi par `@nodefony/frontend` (mono-supervisor Vite). Tout ce qui est commun aux 3 frameworks est ici ;
le spécifique par framework est dans **[`references/frameworks.md`](references/frameworks.md)**.

## 🚦 DEUX CAS — ne pas confondre (lire AVANT toute génération)

Dans une **APP**, le scaffold est une COMMANDE, pas un skill. Ce skill ne la réimplémente pas :
deux scaffolders qui divergent, c'est le bug que ce projet a déjà payé.

| Cible                                                                   | Qui scaffolde                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Module à front d'une **APP** (`modules/<nom>/` d'un projet utilisateur) | **le CLI** (ci-dessous). Ce skill n'intervient PAS.     |
| Module à front du **repo framework** (`src/modules/test-frontend-*`)    | **ce skill** (le CLI ne connaît pas le layout du repo). |

**Cas APP — une seule commande, tout est câblé (module + front + wiring) :**

```bash
nodefony create module shop --frontend react     # ou vue | angular | svelte
nodefony create front dashboard --module shop    # une page de plus, sur un module existant
```

`create module --frontend X` pose le workspace npm PUIS délègue au scaffold `front` : coquille HTML,
entry du framework, controller de page (nonce CSP), `registerEntry` dans `onKernelBoot`, deps npm du
framework. Templates réels : `src/nodefony/templates/front/` + `templates/shared/front-shell/`
(source UNIQUE, partagée avec `create app`). Le tableau de paramètres par framework ci-dessous vaut
comme RÉFÉRENCE de lecture — mais dans une app, ne rends rien à la main.

Ce que l'IA apporte en plus : le choix du framework, la vérification post-build (transform Vite,
hard-reload), et l'explication du POURQUOI. Jamais la mécanique.

## Quand l'utiliser

- "crée un module frontend {react|vue|angular}", "scaffold un module avec front vite" — **dans le repo framework**
- **Dans une app utilisateur** → `nodefony create module <nom> --frontend <fw>` (cf encadré ci-dessus).
- **Ne pas utiliser** pour un module SANS frontend → `nodefony-create-module` directement.
- **Ne pas utiliser** pour ajouter un frontend à un module existant → `nodefony create front <page> --module <nom>` (app), ou éditer à la main (repo).

## Phase 0 — Choisir le framework + variables

1. **Framework** = arg ou question : `react` (défaut) · `vue` · `angular` · `svelte`. Charge la colonne correspondante
   de la table ci-dessous + `references/frameworks.md`.
2. Variables (calculées une fois) :
   - `MOD` = nom kebab-case (ex `shop-front`)
   - `MOD_PASCAL` = PascalCase (ex `ShopFront`) — classe Module + className controller
   - `ROUTE` = route HTTP racine, défaut `/${MOD}` (demander si l'user veut autre chose)
   - `HTTPS_VITE` = bool (recommandé `true` — évite mixed-content ; partage les certs Nodefony)

## Table de paramètres par framework (LE cœur)

<!-- prettier-ignore -->
| Aspect | `react` | `vue` | `angular` | `svelte` |
| --- | --- | --- | --- | --- |
| `type` registerEntry | `react19` | `vue3` | `angular` | `svelte5` |
| `entry` | `./frontend/src/main.tsx` | `./frontend/src/main.ts` | `./frontend/src/main.ts` | `./frontend/src/main.ts` |
| Nœud de montage (HTML) | `<div id="root"></div>` | `<div id="app"></div>` | `<app-root></app-root>` | `<div id="app"></div>` |
| Plugin Vite | `@vitejs/plugin-react` | `@vitejs/plugin-vue` | `@analogjs/vite-plugin-angular` | `@sveltejs/vite-plugin-svelte` (export NOMMÉ `{ svelte }`) |
| peerDeps à ajouter | `react`, `react-dom` | `vue`, `@vitejs/plugin-vue` | _(voir reference — devDeps)_ | `svelte`, `@sveltejs/vite-plugin-svelte` |
| Fichiers frontend | `main.tsx` + `App.tsx` | `main.ts` + `App.vue` | `main.ts` + `app/app.component.ts` + `tsconfig.app.json` | `main.ts` (`mount(App, { target })`) + `App.svelte` + `env.d.ts` (shim `*.svelte`) |
| Preamble HMR injecté | **oui** (auto via `renderTags`) | non | non (HMR = reload) | non |
| Module de référence | `src/modules/test-frontend-react` | `src/modules/test-frontend-vue` | `src/modules/test-frontend-angular` | `src/modules/test-frontend-svelte` |

> Détails (templates entry/App, tsconfig Angular, gotchas Angular) → **[`references/frameworks.md`](references/frameworks.md)**.
> Les 3 modules de référence sont **canoniques** : toujours s'en inspirer pour le résultat attendu.

## Pré-requis

- `src/packages/@nodefony/frontend/` existe (`ls`). Dans une app utilisateur il est dans `node_modules/`.
- `vite` + le plugin du framework installés à la racine. Sinon :
  - react : `npm i -D vite @vitejs/plugin-react react react-dom`
  - vue : `npm i -D vite @vitejs/plugin-vue vue`
  - angular : `npm i -D vite @analogjs/vite-plugin-angular @angular/build @angular/compiler-cli @angular/core @angular/common @angular/platform-browser --legacy-peer-deps`
  - svelte : `npm i -D vite @sveltejs/vite-plugin-svelte svelte`

## Phase 1 — Déléguer à `nodefony-create-module`

> **⚠️ Layout — TOUJOURS `src/modules/`** : un module frontend est **applicatif**, JAMAIS un package
> `@nodefony/*`. Forcer Q2 sur applicatif même si l'user tape `@nodefony/foo` (l'heuristique du skill
> parent ne s'applique pas ici). `src/packages/@nodefony/*` = composants génériques du framework.

Appeler le skill avec ce preset (fixer ces réponses) :

| Question `nodefony-create-module`           | Réponse forcée                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Q1 Nom                                      | demander (kebab-case, **sans** préfixe `@nodefony/`)                                          |
| Q2 Catégorie                                | **Module applicatif** (`src/modules/{nom}/`) — toujours                                       |
| Q3 Options                                  | **`Controllers HTTP` + `Frontend Vite`** (pas de Service/CLI/Entities sauf demande explicite) |
| Q4 manifeste `modules` (nodefony.config.ts) | **Oui** (sinon la page n'est pas servie)                                                      |

Génère : `package.json` (peers `@nodefony/frontend|framework|http`), `tsconfig.json`, `rolldown.config.ts`,
`index.ts` (avec `@controllers` + `onKernelBoot` → `registerEntry`), `frontend/`, controller stub, config stub,
activation dans le manifeste `modules` de `nodefony.config.ts`.

## Phase 2 — Enrichissements (POST-`nodefony-create-module`)

Vérifier puis surcharger/compléter (skip si déjà correct).

### 2.1 peerDeps du framework

Edit `src/modules/{MOD}/package.json` → ajouter les peerDeps de la colonne framework (table). Angular : cf reference.

### 2.2 Config HTTPS — `nodefony/config/config.ts`

```typescript
/** Config du module {MOD}. Surcharge `module-frontend` (@nodefony/frontend). */
const config = {
  "module-frontend": { https: { HTTPS_VITE } }, // true si HTTPS Vite
};
export default config;
```

### 2.3 `registerEntry` + `apiProxyPaths` (dans `index.ts`, `onKernelBoot`)

```typescript
svc.registerEntry(this, {
  type: "{TYPE}", // react19 | vue3 | angular  (table)
  entry: "{ENTRY}", // main.tsx | main.ts        (table)
  root: "./frontend",
  outDir: "./public/dist",
  name: "{MOD}",
  apiProxyPaths: ["{ROUTE}/api"], // ← SANS ça, fetch backend = HTML SPA-fallback (piège n°1)
});
```

### 2.4 Controller HTML + CSP — `nodefony/controller/{MOD_PASCAL}Controller.ts`

Commun aux 3 frameworks ; seul **le nœud de montage** change (table).

```typescript
import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

@controller("{ROUTE}")
class {MOD_PASCAL}Controller extends Controller {
  constructor(context: Context) {
    super("{MOD_PASCAL}Controller", context);
  }

  @route("{MOD}-index", { path: "/" })
  renderApp(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as FrontendService | undefined;
    // CSP : émise par le FIREWALL (@nodefony/security) — le service frontend
    // déclare ses origines Vite via `registerCspOrigins` au démarrage. Le
    // controller ne pose AUCUN header : il propage le NONCE de la requête aux
    // <script> injectés. (`getCspDirectives()` n'existe plus — supprimé.)
    const viteTags =
      svc?.renderTags("{MOD}", this.context?.cspNonce) ??
      "<!-- @nodefony/frontend not ready -->";
    return this.render(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{MOD_PASCAL}</title>
    ${viteTags}
  </head>
  <body>
    {MOUNT_NODE}
  </body>
</html>`);
  }

  @route("{MOD}-api-data", { path: "/api/data" })
  apiData() {
    return this.renderJson({ ts: Date.now(), pid: process.pid, env: this.kernel?.environment, module: "{MOD}" });
  }
}
export default {MOD_PASCAL}Controller;
```

### 2.5 Fichiers frontend (entry + App)

Templates par framework dans **[`references/frameworks.md`](references/frameworks.md)**.
Pour un résultat riche, copier/adapter depuis le module de référence (`src/modules/test-frontend-{fw}/frontend/`).

## Phase 3 — Build + validation

```bash
# (a) Nouveau workspace → symlink (SINON boot crash "Cannot find package .../dist/index.js")
cd /Users/cci/repository/nodefony-core && npm install
# (b) Build module EN DIRECT + VÉRIFIER l'émission (ne pas se fier au message "created dist")
cd /Users/cci/repository/nodefony-core/src/modules/{MOD} && npm run build && ls dist/index.js
# (c) Dist RACINE rebuild après ajout au manifeste `modules` de nodefony.config.ts (start.sh ne build QUE le module test)
cd /Users/cci/repository/nodefony-core && npx rolldown -c rolldown.config.ts
cd /Users/cci/repository/nodefony-core && npx tsc --noEmit | head -20
```

> ⚠️ Si le module **consomme une lib partagée modifiée** (champ ajouté à `@nodefony/orm-core`…),
> builder cette dép **EN DIRECT** (`cd <dep> && npm run build`) avant le module — turbo sert des
> **types périmés** (`TS2353 '<champ>' n'existe pas`). Tableau complet : skill `nodefony-create-module` (Pièges).
> Lancer le serveur (skill `nodefony-start-server`) puis naviguer :
> `http://127.0.0.1:5151{ROUTE}/` · `https://127.0.0.1:5152{ROUTE}/` (si HTTPS).
> **Pas de Chrome headless** (bloque la machine) → vérif `curl -sk` transform Vite + hard-reload user.

## Phase 4 (OPT-IN) — Module DISTRIBUÉ npm : UI pré-buildée (molette `ui`)

> Uniquement si le module sera **publié npm** et consommé par des apps tierces (pattern
> « admin-UI embarquée » : bull-board/GraphiQL). Le consommateur ne compile JAMAIS l'UI —
> les assets sont pré-buildés au publish et servis statiques SANS Vite ni @nodefony/frontend.
> **Référence vivante = `@nodefony/studio`** (1er consommateur, à copier) :
> `index.ts` (onKernelBoot), `frontend/vite.config.publish.mts`, `package.json` (scripts).

1. **Config module** : `ui: "auto" as "auto" | "static" | "vite"` + `publicMount: false`.
2. **`onKernelBoot`** : `resolveUiDelivery` (@nodefony/http) → `vite` = `registerEntry`
   (§2.3 inchangé) · `static` = `new PrebuiltUi({ publicPath: "/_assets/{MOD}/", distDir:
path.join(this.path, "dist", "frontend") }).mount(container, kernel)` + exposer
   l'instance en propriété publique `ui` · `none` = log ERROR (raison actionnable).
3. **Controller** : si `kernel.getModule("{MOD}")?.ui` → `render(ui.renderIndex(cspNonce))`,
   sinon flux `frontendService.renderDocument` (§2.4).
4. **Build publish** : `frontend/vite.config.publish.mts` (app-mode, `base` = publicPath,
   `outDir: ../dist/frontend`) ; script `build:ui` ENCHAÎNÉ dans `build` (l'UI vit dans
   `dist/` → le `rimraf dist` du build backend l'emporte sinon) + `prepack` en filet.
5. **Preuve** : app générée `--link` en `production` sans @nodefony/frontend → route UI 200,
   asset hashé 200, CSP sans origine Vite (vécu : rebuild backend seul → `none` fail-loud).

## Checklist finale

- [ ] `index.ts` : `apiProxyPaths` présent dans `registerEntry`
- [ ] Controller : nonce propagé — `renderTags("{MOD}", this.context?.cspNonce)` (JAMAIS de header CSP posé à la main)
- [ ] Nœud de montage HTML = celui du framework (table)
- [ ] `module-frontend.https` = choix user
- [ ] manifeste `modules` (nodefony.config.ts) : `@nodefony/frontend` AVANT `@nodefony/{MOD}` (ordre boot critique)
- [ ] peerDeps du framework présents (react+react-dom / vue / @angular\*)
- [ ] `npx tsc --noEmit` 0 erreur + `npm run build` du module OK
- [ ] `npm install` lancé (symlink workspace) + `ls dist/index.js` vérifié + `rolldown -c` racine (dist racine à jour)

## Pièges communs (les 3 frameworks)

1. **Ordre du manifeste `modules`** : frontend AVANT le module → sinon `@nodefony/frontend service unavailable` au boot.
2. **`apiProxyPaths` manquant** : `Unexpected token '<'` sur `fetch("{ROUTE}/api/...")` (Vite renvoie le SPA-fallback HTML).
3. **CSP** : page blanche + `blocked:csp` → nonce non propagé (`renderTags` sans `cspNonce`), ou origine Vite absente du CSP (firewall pas encore `ready` → recharger après le boot complet).
4. **Cache navigateur HMR** : après changement CSP/manifest → **Cmd+Shift+R**.
5. **Cert HTTPS Vite** (si HTTPS) : accepter le cert sur `:5173` ET `:5152` (origines distinctes), ou installer la CA Nodefony.
6. **Placeholders** : remplacer `{MOD}`, `{MOD_PASCAL}`, `{ROUTE}`, `{TYPE}`, `{ENTRY}`, `{MOUNT_NODE}`, `{HTTPS_VITE}` AVANT le Write.

> Pièges **spécifiques React** (preamble) et **Angular** (`--legacy-peer-deps`, external rolldown, tsconfig.app,
> `useDefineForClassFields:false`, HMR=reload) → **[`references/frameworks.md`](references/frameworks.md)**.

## Skills & références liés

- `nodefony-create-module` — délégué Phase 1 (squelette)
- `nodefony-start-server` — lancer après scaffold
- `src/packages/@nodefony/frontend/README.md` — doc complète
- Modules canoniques : `src/modules/test-frontend-{react,vue,angular,svelte}/`
