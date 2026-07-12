---
name: nodefony-create-frontend-module
description: >
  Scaffold d'un module applicatif Nodefony (src/modules/) avec frontend SPA servi par
  @nodefony/frontend via Vite — framework au choix : React 19, Vue 3 ou Angular 21. Wrapper de
  nodefony-create-module : délègue le squelette puis enrichit le spécifique frontend (controller
  HTML+CSP, registerEntry, entry+App du framework, peerDeps).
  Déclencheurs : "crée un module frontend", "module react", "module vue", "module angular",
  "scaffold module avec front", "nouveau front nodefony", "module vite".
---

# nodefony-create-frontend-module

**Wrapper** de `nodefony-create-module` — ne duplique AUCUN template déjà géré par lui.
Crée un **module applicatif** (`src/modules/{nom}/`) embarquant un frontend **React 19 / Vue 3 / Angular 21**
servi par `@nodefony/frontend` (mono-supervisor Vite). Tout ce qui est commun aux 3 frameworks est ici ;
le spécifique par framework est dans **[`reference/frameworks.md`](reference/frameworks.md)**.

## Quand l'utiliser

- "crée un module frontend {react|vue|angular}", "scaffold un module avec front vite"
- **Ne pas utiliser** pour un module SANS frontend → `nodefony-create-module` directement.
- **Ne pas utiliser** pour ajouter un frontend à un module existant → éditer à la main.

## Phase 0 — Choisir le framework + variables

1. **Framework** = arg ou question : `react` (défaut) · `vue` · `angular`. Charge la colonne correspondante
   de la table ci-dessous + `reference/frameworks.md`.
2. Variables (calculées une fois) :
   - `MOD` = nom kebab-case (ex `shop-front`)
   - `MOD_PASCAL` = PascalCase (ex `ShopFront`) — classe Module + className controller
   - `ROUTE` = route HTTP racine, défaut `/${MOD}` (demander si l'user veut autre chose)
   - `HTTPS_VITE` = bool (recommandé `true` — évite mixed-content ; partage les certs Nodefony)

## Table de paramètres par framework (LE cœur)

| Aspect                 | `react`                           | `vue`                           | `angular`                                                |
| ---------------------- | --------------------------------- | ------------------------------- | -------------------------------------------------------- |
| `type` registerEntry   | `react19`                         | `vue3`                          | `angular`                                                |
| `entry`                | `./frontend/src/main.tsx`         | `./frontend/src/main.ts`        | `./frontend/src/main.ts`                                 |
| Nœud de montage (HTML) | `<div id="root"></div>`           | `<div id="app"></div>`          | `<app-root></app-root>`                                  |
| Plugin Vite            | `@vitejs/plugin-react`            | `@vitejs/plugin-vue`            | `@analogjs/vite-plugin-angular`                          |
| peerDeps à ajouter     | `react`, `react-dom`              | `vue`, `@vitejs/plugin-vue`     | _(voir reference — devDeps)_                             |
| Fichiers frontend      | `main.tsx` + `App.tsx`            | `main.ts` + `App.vue`           | `main.ts` + `app/app.component.ts` + `tsconfig.app.json` |
| Preamble HMR injecté   | **oui** (auto via `renderTags`)   | non                             | non (HMR = reload)                                       |
| Module de référence    | `src/modules/test-frontend-react` | `src/modules/test-frontend-vue` | `src/modules/test-frontend-angular`                      |

> Détails (templates entry/App, tsconfig Angular, gotchas Angular) → **[`reference/frameworks.md`](reference/frameworks.md)**.
> Les 3 modules de référence sont **canoniques** : toujours s'en inspirer pour le résultat attendu.

## Pré-requis

- `src/packages/@nodefony/frontend/` existe (`ls`). Dans une app utilisateur il est dans `node_modules/`.
- `vite` + le plugin du framework installés à la racine. Sinon :
  - react : `npm i -D vite @vitejs/plugin-react react react-dom`
  - vue : `npm i -D vite @vitejs/plugin-vue vue`
  - angular : `npm i -D vite @analogjs/vite-plugin-angular @angular/build @angular/compiler-cli @angular/core @angular/common @angular/platform-browser --legacy-peer-deps`

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
    // Helmet pose `script-src 'self'` → bloque les scripts Vite cross-origin.
    // TODO migrer dans @nodefony/security (cf project-csp-vite-security-todo).
    if (svc) {
      this.context?.response?.setHeader("Content-Security-Policy", svc.getCspDirectives());
    }
    const viteTags = svc?.renderTags("{MOD}") ?? "<!-- @nodefony/frontend not ready -->";
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

Templates par framework dans **[`reference/frameworks.md`](reference/frameworks.md)**.
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
- [ ] Controller : `setHeader("Content-Security-Policy", svc.getCspDirectives())` AVANT `render`
- [ ] Nœud de montage HTML = celui du framework (table)
- [ ] `module-frontend.https` = choix user
- [ ] manifeste `modules` (nodefony.config.ts) : `@nodefony/frontend` AVANT `@nodefony/{MOD}` (ordre boot critique)
- [ ] peerDeps du framework présents (react+react-dom / vue / @angular\*)
- [ ] `npx tsc --noEmit` 0 erreur + `npm run build` du module OK
- [ ] `npm install` lancé (symlink workspace) + `ls dist/index.js` vérifié + `rolldown -c` racine (dist racine à jour)

## Pièges communs (les 3 frameworks)

1. **Ordre du manifeste `modules`** : frontend AVANT le module → sinon `@nodefony/frontend service unavailable` au boot.
2. **`apiProxyPaths` manquant** : `Unexpected token '<'` sur `fetch("{ROUTE}/api/...")` (Vite renvoie le SPA-fallback HTML).
3. **CSP** : page blanche + `blocked:csp` → controller doit poser `svc.getCspDirectives()`.
4. **Cache navigateur HMR** : après changement CSP/manifest → **Cmd+Shift+R**.
5. **Cert HTTPS Vite** (si HTTPS) : accepter le cert sur `:5173` ET `:5152` (origines distinctes), ou installer la CA Nodefony.
6. **Placeholders** : remplacer `{MOD}`, `{MOD_PASCAL}`, `{ROUTE}`, `{TYPE}`, `{ENTRY}`, `{MOUNT_NODE}`, `{HTTPS_VITE}` AVANT le Write.

> Pièges **spécifiques React** (preamble) et **Angular** (`--legacy-peer-deps`, external rolldown, tsconfig.app,
> `useDefineForClassFields:false`, HMR=reload) → **[`reference/frameworks.md`](reference/frameworks.md)**.

## Skills & références liés

- `nodefony-create-module` — délégué Phase 1 (squelette)
- `nodefony-start-server` — lancer après scaffold
- `src/packages/@nodefony/frontend/README.md` — doc complète
- Modules canoniques : `src/modules/test-frontend-{react,vue,angular}/`
