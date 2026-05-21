---
module: "@nodefony/frontend"
topic: frontend-react-guide
audience: [human]
tags: [frontend, react, vite, guide, tutorial, getting-started]
status: stable
last-updated: 2026-05-18
---

# Guide — Ajouter un frontend React 19 à un module Nodefony

> Tu as un module Nodefony existant et tu veux y ajouter une SPA React 19 servie par Vite, avec HMR en dev et build optimisé en prod. Ce guide te montre comment.

**Audience** : développeur Nodefony qui connaît déjà `Module`, `Service`, `Controller`. Si non, lis d'abord [`../architecture/container.md`](../architecture/container.md) puis reviens.

**Résultat final** : une page React montée à `https://localhost:5152/shop-front/` qui appelle ton API backend (`/shop-front/api/data`) via le proxy Vite, avec HMR fonctionnel.

## Approche express — via le skill

```
/nodefony-create-frontend-module react
```

Le skill `nodefony-create-frontend-module` (cf `.claude/skills/`) délègue au skill `nodefony-create-module` pour le squelette, puis enrichit avec les éléments du framework choisi — **React 19, Vue 3 ou Angular 21** (controller HTML+CSP, frontend/, peerDeps). Te fait gagner les ~6 étapes manuelles ci-dessous.

Le reste de ce guide explique la **version manuelle**, utile pour comprendre ce que le skill fait sous le capot.

---

## Pré-requis

- Repo Nodefony à jour avec `@nodefony/frontend` mergé dans `claude-ts` (commit `f013b19` ou ultérieur)
- Vite + plugins installés à la racine :
  ```bash
  npm i -D vite @vitejs/plugin-react react react-dom
  ```
- Connaissance basique React 19 + JSX

## Étape 1 — Activer `@nodefony/frontend` dans l'app

Dans le `index.ts` racine de ton app (ou du repo `nodefony-core` en dev) :

```typescript
@modules([
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/frontend",        // ← AVANT ton module consumer (ordre boot critique)
  "@nodefony/shop-front",       // ← ton module à venir
])
class App extends Module { ... }
```

> ⚠️ **Ordre important** : `@nodefony/frontend` doit être déclaré AVANT les modules qui appellent `registerEntry()`. Sinon le service `frontend` n'est pas dans le DI Container au `onKernelBoot` du consumer → `ERROR @nodefony/frontend service unavailable`.

## Étape 2 — Créer le module applicatif

```bash
mkdir -p src/modules/shop-front/nodefony/{config,controller}
mkdir -p src/modules/shop-front/frontend/src
```

**`src/modules/shop-front/package.json`** : copier depuis `src/modules/test-frontend-react/package.json`, remplacer `test-frontend-react` par `shop-front`.

**`src/modules/shop-front/tsconfig.json`** et **`rollup.config.ts`** : copier à l'identique depuis `test-frontend-react/`.

## Étape 3 — `index.ts` du module

```typescript
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import config from "./nodefony/config/config";
import ShopFrontController from "./nodefony/controller/ShopFrontController";

@controllers([ShopFrontController])
class ShopFront extends Module {
  constructor(kernel: Kernel) {
    super("shop-front", kernel, import.meta.url, config);
  }

  override async onKernelBoot(): Promise<this> {
    const svc = this.kernel?.container?.get("frontend") as
      | FrontendService
      | undefined;
    if (!svc) {
      this.log(
        "@nodefony/frontend service unavailable — wrong @modules order?",
        "ERROR",
      );
      return this;
    }
    svc.registerEntry(this, {
      type: "react19",
      entry: "./frontend/src/main.tsx",
      root: "./frontend",
      outDir: "./public/dist",
      name: "shop-front",
      // ⚠️ apiProxyPaths : sans ça, fetch backend = HTML SPA-fallback
      apiProxyPaths: ["/shop-front/api"],
    });
    return this;
  }
}

export default ShopFront;
```

## Étape 4 — Config du module

**`src/modules/shop-front/nodefony/config/config.ts`** :

```typescript
const config = {
  "module-frontend": {
    // HTTPS = recommandé. Partage les certs Nodefony pour éviter mixed-content
    // si tu sers la page sur https://localhost:5152/.
    https: true,
  },
};

export default config;
```

## Étape 5 — Controller backend

**`src/modules/shop-front/nodefony/controller/ShopFrontController.ts`** :

```typescript
import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

@controller("/shop-front")
class ShopFrontController extends Controller {
  constructor(context: Context) {
    super("ShopFrontController", context);
  }

  @route("shop-react", { path: "/" })
  renderReact(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      | FrontendService
      | undefined;

    // ⚠️ CSP — helmet bloque les scripts Vite cross-origin par défaut.
    // Override avec la CSP du FrontendService (TODO : migrer dans security).
    if (svc) {
      this.context?.response?.setHeader(
        "Content-Security-Policy",
        svc.getCspDirectives(),
      );
    }

    const viteTags = svc?.renderTags("shop-front")
      ?? "<!-- @nodefony/frontend not ready -->";

    return this.render(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Shop Front</title>
    ${viteTags}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`);
  }

  @route("shop-api-data", { path: "/api/data" })
  apiData() {
    return this.renderJson({ ts: Date.now(), module: "shop-front" });
  }
}

export default ShopFrontController;
```

> **Pourquoi `setHeader` avant `render` ?** Le pipeline Nodefony écrit les headers `helmet` quand la response est envoyée. Le `setHeader` du controller, exécuté plus tôt, n'est pas écrasé.

## Étape 6 — Frontend React

**`src/modules/shop-front/frontend/index.html`** (optionnel mais recommandé pour test Vite standalone) :

```html
<!doctype html>
<html lang="en">
  <head><title>Shop Front — Vite standalone</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`src/modules/shop-front/frontend/src/main.tsx`** :

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

**`src/modules/shop-front/frontend/src/App.tsx`** :

```tsx
import { useEffect, useState } from "react";

interface ApiData { ts: number; module: string; }

export function App() {
  const [data, setData] = useState<ApiData | null>(null);

  useEffect(() => {
    // fetch relatif → Vite proxifie vers Nodefony grâce à apiProxyPaths.
    fetch("/shop-front/api/data")
      .then((r) => r.json())
      .then((json) => setData((json.result ?? json) as ApiData));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Shop Front</h1>
      {data ? <pre>{JSON.stringify(data, null, 2)}</pre> : <p>loading…</p>}
    </div>
  );
}
```

## Étape 7 — Build + test

```bash
cd src/modules/shop-front && npm run build
cd ../../.. && npx tsc --noEmit
```

Puis lancer le serveur dev :

```bash
# Via le skill (recommandé) :
/start-nodefony-server

# Ou manuellement :
npx nodefony development
```

Logs attendus :

```
INFO frontend : registered entry: shop-front (react19) from "shop-front"
INFO frontend : [vite] VITE v8.x ready in XXX ms
INFO frontend : [vite] ➜  Local:   https://127.0.0.1:5173/
INFO frontend : vite dev server ready on 127.0.0.1:5173
```

Naviguer sur `https://127.0.0.1:5152/shop-front/`. La page React s'affiche, le `Backend ping` doit retourner du JSON.

> Première visite HTTPS : le browser demande d'accepter le cert self-signed sur `127.0.0.1:5152` ET sur `127.0.0.1:5173` (origines distinctes). Tu peux installer la CA root Nodefony (`nodefony/config/certificates/ca/nodefony-root-ca.crt.pem`) dans ton trousseau pour ne plus avoir le prompt.

## Étape 8 — Tester le HMR

Édite `frontend/src/App.tsx`, change un texte, sauvegarde. Sans rafraîchir la page :

- Le texte change dans le browser
- Si tu avais un state local (`useState`), il est **préservé** (c'est la signature du HMR React Fast Refresh)
- Le log Nodefony affiche : `[vite] (client) hmr update /src/App.tsx`

Si la page reload entièrement (state perdu) → c'est un full reload, pas du HMR. Causes possibles :

- Le preamble React n'est pas injecté (vérifie que tu utilises `svc.renderTags()`, pas des `<script>` à la main)
- Le canal WSS HMR ne s'est pas établi (cert HTTPS refusé sur 5173 ?)
- L'app crash silencieusement → reload comme fallback (regarde la console DevTools)

## Étape 9 — Build production

```bash
npx nodefony frontend:build
```

Génère `src/modules/shop-front/public/dist/manifest.json` + assets fingerprintés. En mode prod, le `TemplateHelper.renderProdTags()` lit le manifest pour injecter les bons chemins (⚠️ pas encore implémenté à date du 2026-05-18 — tracking issue à venir).

## Pièges récurrents (à connaître)

| Symptôme                                                   | Cause                                              | Fix                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| `ERROR @nodefony/frontend service unavailable`             | Ordre `@modules` racine                            | Déclarer `@nodefony/frontend` AVANT le module consumer               |
| Page blanche, `Refused to load script ... blocked:csp`     | Helmet bloque scripts Vite                         | `setHeader("Content-Security-Policy", svc.getCspDirectives())`       |
| `Unexpected token '<'` sur `fetch("/api/...")`             | Vite sert SPA-fallback HTML                        | Déclarer `apiProxyPaths` dans `registerEntry`                        |
| `@vitejs/plugin-react can't detect preamble`               | Preamble manquant                                  | Toujours utiliser `svc.renderTags(name)`                             |
| Cache navigateur après modif CSP                           | Browser cache                                      | **Cmd+Shift+R** (hard reload)                                        |
| Modules React introuvables                                 | Cert HTTPS Vite refusé sur 5173                    | Visiter `https://127.0.0.1:5173/` une fois et accepter le cert       |

## Aller plus loin

- API publique complète : [`@nodefony/frontend/docs/index.md`](../../src/packages/@nodefony/frontend/docs/index.md) (relocalisé, ADR-0001)
- Résilience supervisor (auto-restart, port retry, health check) : [`@nodefony/frontend/docs/index.md#résilience-supervisor`](../../src/packages/@nodefony/frontend/docs/index.md#résilience-supervisor)
- Audit perf child_process vs in-proc : [`../audits/poc-frontend-comparison.md`](../audits/poc-frontend-comparison.md)
- Pattern de référence : `src/modules/test-frontend-react/` (créé durant le POC, doc fidèle)
- Module Vision (Phase 10) consommera `@nodefony/frontend` pour son UI admin
