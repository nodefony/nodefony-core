---
name: nodefony-create-frontend-react
description: >
  Wrapper du skill `nodefony-create-module` spécialisé **frontend React 19 via @nodefony/frontend**.
  Délègue la création du squelette de module au skill existant (mkdir, package.json, tsconfig, rollup,
  index.ts, errors), puis enrichit avec les fichiers spécifiques React : controller backend qui rend
  l'HTML + override CSP, frontend/{index.html, src/main.tsx, src/App.tsx}, config module-frontend
  (https + apiProxyPaths), peerDeps react/react-dom. Met à jour @modules() racine en plaçant le
  module APRÈS @nodefony/frontend (ordre boot critique). Évite les pièges connus du POC
  poc/frontend-child : hook onServersReady, preamble React, CSP cross-origin, proxy backend.
  Déclencheurs : "crée un module frontend react", "scaffold module react", "nouveau front react nodefony",
  "génère un module avec frontend", "module react vite", "frontend react nodefony", "scaffold @nodefony/* react".
---

# nodefony-create-frontend-react

**Wrapper** du skill `nodefony-create-module` — ne dupliquera AUCUN template déjà géré par lui.
Ne fait que ce qui est spécifique au cas "module applicatif avec frontend React 19".

## Quand l'utiliser

L'user dit :
- "crée un module frontend react"
- "scaffold un module avec front react vite"
- "nouveau module nodefony avec frontend"

**Ne pas utiliser** si l'user veut un module SANS frontend → utiliser directement `nodefony-create-module`.
**Ne pas utiliser** pour ajouter un frontend à un module existant — éditer directement.

## Pré-requis

- `src/packages/@nodefony/frontend/` doit exister (vérifier avec `ls`)
- `vite` + `@vitejs/plugin-react` + `react` + `react-dom` installés à la racine (`ls node_modules/vite node_modules/react`). Si absent : `npm i -D vite @vitejs/plugin-react react react-dom`

## Phase 1 — Déléguer au skill `nodefony-create-module`

> **⚠️ Layout — toujours `src/modules/`** : un frontend React est TOUJOURS un **module applicatif** (`src/modules/{nom}/`), **JAMAIS** un package framework (`src/packages/@nodefony/{nom}/`).
>
> - `src/packages/@nodefony/*` est réservé aux composants génériques réutilisables qui font partie du framework lui-même (ex : `@nodefony/frontend`, `@nodefony/http`). Ces packages existent dans le **repo source `nodefony-core`** uniquement.
> - Dans **une app utilisateur** (la plupart des cas réels), le dossier `src/packages/@nodefony/` n'existe pas — les `@nodefony/*` sont consommés depuis `node_modules/`. Le scaffold se fait toujours dans `src/modules/{nom}/`.
> - Donc l'heuristique "tape `@nodefony/foo` → package" du skill parent ne s'applique PAS pour un frontend React. Forcer Q2 sur **applicatif**.

**Appeler le skill existant** avec ce preset fixé (passer ces choix dans son AskUserQuestion ou les fixer si l'user n'a pas répondu) :

| Question `nodefony-create-module` | Réponse à forcer ici |
| --- | --- |
| Q1 Nom du module | Demander à l'user (kebab-case, ex `shop-front`). **Sans préfixe `@nodefony/`** — c'est applicatif. |
| Q2 Catégorie | **Module applicatif** (`src/modules/{nom}/`) — TOUJOURS, peu importe ce que l'user tape (même `@nodefony/foo`). |
| Q3 Options à activer | **`Controllers HTTP` + `Frontend Vite`** uniquement (pas de Service, pas de CLI, pas d'Entities sauf si user le demande explicitement) |
| Q4 Ajouter au `@modules` racine | **Oui** (sinon la page React n'est pas servie) |

Cela génère :
- `src/modules/{nom}/package.json` (avec peer `@nodefony/frontend`, `@nodefony/framework`, `@nodefony/http`)
- `src/modules/{nom}/tsconfig.json` + `rollup.config.ts`
- `src/modules/{nom}/index.ts` (avec `@controllers([...])` + `onKernelBoot` qui appelle `svc.registerEntry`)
- `src/modules/{nom}/frontend/` (dossier créé vide ou avec stubs minimaux)
- `src/modules/{nom}/nodefony/controller/{NomPascal}Controller.ts` (stub)
- `src/modules/{nom}/nodefony/config/config.ts` (stub)
- Activation dans `index.ts` racine

## Phase 2 — Enrichissements spécifiques React (POST-`nodefony-create-module`)

Après que le skill délégué a terminé, **vérifier puis surcharger/compléter** les fichiers suivants. Si `nodefony-create-module` les a déjà générés correctement, skip — sinon Write/Edit.

### Variables à substituer dans les templates

Calculer une fois en début de Phase 2 :
- `MOD` = nom kebab-case fourni par l'user (ex `shop-front`)
- `MOD_PASCAL` = PascalCase (ex `ShopFront`) — utilisé pour la classe Module + className du controller
- `ROUTE` = route HTTP racine du module. Default `/${MOD}` (ex `/shop-front`). Demander à l'user s'il veut une route différente.
- `HTTPS_VITE` = booléen demandé à l'user : "Activer HTTPS Vite (partage certs Nodefony) ?" (recommandé `true` pour éviter mixed-content)

### Fichier 1 — peerDeps React/ReactDOM

Le skill `nodefony-create-module` ajoute déjà `@nodefony/frontend` + `vite` + `@vitejs/plugin-react` en peerDeps quand `Frontend Vite` est coché. Compléter avec :

```json
"peerDependencies": {
  "...": "...",
  "react": ">=19.0.0",
  "react-dom": ">=19.0.0"
}
```

Edit le `src/modules/{MOD}/package.json` pour ajouter `react` et `react-dom` aux `peerDependencies`.

### Fichier 2 — Config `module-frontend` (HTTPS)

`src/modules/{MOD}/nodefony/config/config.ts` :

```typescript
/**
 * Config du module {MOD}. Surcharge `module-frontend` (@nodefony/frontend).
 */
const config = {
  "module-frontend": {
    https: {HTTPS_VITE}, // true si user a dit oui à HTTPS, sinon false
  },
};

export default config;
```

### Fichier 3 — `onKernelBoot` + `apiProxyPaths`

Le skill délégué génère normalement le `registerEntry` dans `index.ts`. **Vérifier** que la déclaration contient :

```typescript
svc.registerEntry(this, {
  type: "react19",
  entry: "./frontend/src/main.tsx",
  root: "./frontend",
  outDir: "./public/dist",
  name: "{MOD}",
  apiProxyPaths: ["{ROUTE}/api"], // ← IMPORTANT — sans ça, fetch backend = HTML SPA-fallback
});
```

Si `apiProxyPaths` est absent → Edit pour l'ajouter. C'est LE piège n°1 sans lequel `fetch("/{MOD}/api/...")` retourne du HTML.

### Fichier 4 — Controller HTML + CSP

`src/modules/{MOD}/nodefony/controller/{MOD_PASCAL}Controller.ts` — surcharger pour qu'il contienne :

```typescript
import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

/**
 * Controller {MOD} :
 *  - GET {ROUTE}/        → page HTML rendue par Nodefony (charge React via Vite)
 *  - GET {ROUTE}/api/data → exemple d'endpoint backend (proxifié par Vite)
 */
@controller("{ROUTE}")
class {MOD_PASCAL}Controller extends Controller {
  constructor(context: Context) {
    super("{MOD_PASCAL}Controller", context);
  }

  @route("{MOD}-react", { path: "/" })
  renderReact(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      | FrontendService
      | undefined;

    // Helmet pose `script-src 'self'` par défaut → bloque les scripts Vite
    // cross-origin. Override avec la CSP du FrontendService.
    // TODO : migrer dans @nodefony/security (cf project-csp-vite-security-todo).
    if (svc) {
      this.context?.response?.setHeader(
        "Content-Security-Policy",
        svc.getCspDirectives(),
      );
    }

    const viteTags = svc?.renderTags("{MOD}")
      ?? "<!-- @nodefony/frontend not ready -->";

    return this.render(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{MOD_PASCAL}</title>
    ${viteTags}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`);
  }

  @route("{MOD}-api-data", { path: "/api/data" })
  apiData() {
    return this.renderJson({ ts: Date.now(), module: "{MOD}" });
  }
}

export default {MOD_PASCAL}Controller;
```

### Fichier 5 — Frontend React

**`src/modules/{MOD}/frontend/index.html`** (optionnel — utile si l'user veut tester Vite standalone) :

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{MOD_PASCAL} — Vite standalone</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`src/modules/{MOD}/frontend/src/main.tsx`** :

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**`src/modules/{MOD}/frontend/src/App.tsx`** :

```tsx
import { useEffect, useState } from "react";

interface ApiData { ts: number; module: string; }

export function App() {
  const [data, setData] = useState<ApiData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("{ROUTE}/api/data")
      .then((r) => r.json())
      .then((json) => setData((json.result ?? json) as ApiData))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>{MOD_PASCAL}</h1>
      <p>Module Nodefony avec frontend React 19 via @nodefony/frontend.</p>
      <h2>Backend ping</h2>
      {error ? <pre style={{ color: "crimson" }}>{error}</pre>
        : data ? <pre>{JSON.stringify(data, null, 2)}</pre>
        : <p>loading…</p>}
    </div>
  );
}
```

### Phase 3 — Build + validation

```bash
cd /Users/cci/repository/nodefony-core/src/modules/{MOD} && npm run build
cd /Users/cci/repository/nodefony-core && npx tsc --noEmit | head -20
```

Lancer le serveur (skill `nodefony-start-server`) puis naviguer :
- `http://127.0.0.1:5151{ROUTE}/` (HTTP)
- `https://127.0.0.1:5152{ROUTE}/` (HTTPS — recommandé si `HTTPS_VITE=true`)

## Vérification finale — checklist

À la fin du scaffold, contrôler que :

- [ ] `src/modules/{MOD}/index.ts` contient `apiProxyPaths` dans le `registerEntry`
- [ ] Le controller fait `setHeader("Content-Security-Policy", svc.getCspDirectives())` AVANT le `render`
- [ ] La config `module-frontend.https` correspond au choix utilisateur
- [ ] `@modules` racine : `@nodefony/frontend` est AVANT `@nodefony/{MOD}` (ordre boot critique)
- [ ] `package.json` du module contient `react` et `react-dom` en peerDependencies
- [ ] `npx tsc --noEmit` passe (0 erreur)
- [ ] `npm run build` du module passe

## Pièges à éviter (spécifiques au cas React)

### 1. Ordre dans `@modules` racine
`@nodefony/frontend` AVANT `@nodefony/{MOD}`. Sinon : `ERROR @nodefony/frontend service unavailable` au boot du module consumer.

### 2. `apiProxyPaths` non déclaré
Symptôme : `Unexpected token '<'` dans la console browser sur `fetch("{ROUTE}/api/...")`.
Cause : Vite sert son SPA-fallback HTML quand le path n'est pas proxifié.
Fix : ajouter `apiProxyPaths: ["{ROUTE}/api"]` au `registerEntry`.

### 3. CSP bloque les scripts Vite
Symptôme : page blanche + console `Refused to load script ... blocked:csp`.
Fix : controller doit appeler `setHeader("Content-Security-Policy", svc.getCspDirectives())`.

### 4. Preamble React absent
Symptôme : `Uncaught Error: @vitejs/plugin-react can't detect preamble`.
Fix : ne JAMAIS injecter les `<script>` à la main — toujours via `svc.renderTags(name)` (qui inline le preamble pour les entries `type: "react19"`).

### 5. Cache navigateur HMR
Après CSP changes : **Cmd+Shift+R** (hard reload). Le cache standard garde l'ancien manifest Vite.

### 6. Cert HTTPS Vite (si `HTTPS_VITE=true`)
Première visite : accepter le cert sur `https://127.0.0.1:5173` ET sur `https://127.0.0.1:5152` (origines distinctes). Alternative : installer `nodefony/config/certificates/ca/nodefony-root-ca.crt.pem` dans le trousseau.

### 7. Placeholder non substitués
Le skill utilise `{MOD}`, `{MOD_PASCAL}`, `{ROUTE}`, `{HTTPS_VITE}` littéralement. **Remplacer AVANT le Write** sinon TS plante.

## Pattern de référence

`src/modules/test-frontend-react/` est la **référence canonique** — toujours la consulter avant de générer pour valider le résultat attendu. Le module a été produit manuellement durant le POC `poc/frontend-child` (commit `66967b2`).

## Skills liés

- `nodefony-create-module` — délégué de la phase 1 (squelette de module)
- `nodefony-start-server` — pour lancer le serveur après scaffold
- `src/packages/@nodefony/frontend/README.md` — doc complète @nodefony/frontend
- `src/modules/test-frontend-react/` — référence canonique
