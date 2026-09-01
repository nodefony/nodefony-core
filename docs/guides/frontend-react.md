---
title: "Ajouter un frontend React 19 à un module Nodefony"
navTitle: Frontend React
lang: fr
module: "@nodefony/frontend"
topic: frontend-react-guide
audience: [human]
tags: [frontend, react, vite, guide, tutorial, getting-started]
version: "doc"
status: stable
updated: 2026-09-01
source: "docs/guides/frontend-react.md"
---

# Guide — Ajouter un frontend React 19 à un module Nodefony

> Tu as un module Nodefony existant et tu veux y ajouter une SPA React 19 servie par Vite, avec HMR en dev et build optimisé en prod. Ce guide te montre comment.

**Audience** : développeur Nodefony qui connaît déjà `Module`, `Service`, `Controller`. Si non, lis d'abord [`../architecture/injection-portees.md`](../architecture/injection-portees.md) puis reviens.

**Résultat final** : une page React montée à `https://localhost:5152/shop-front/` qui appelle ton API backend (`/shop-front/api/data`) via le proxy Vite, avec HMR fonctionnel.

📍 [Documentation](../index.md) › [Guides](README.md) › **Frontend React**

## Le modèle — deux serveurs, un seul site

Pendant le développement, **deux** serveurs tournent : Nodefony sert votre application, Vite sert
les modules du frontend et pousse le rechargement à chaud. Le visiteur, lui, n'en voit qu'un seul :
Nodefony rend la page, y insère les balises qui pointent vers Vite (`FrontendService.renderTags()`,
`FrontendService.ts:896`), et laisse Vite mandater vers l'API les chemins que le module a déclarés
(`apiProxyPaths`, `IFrontBuilder.ts:34`). En production il n'y a plus qu'un serveur : les fichiers
sont bâtis, et les mêmes balises pointent vers eux.

Un module déclare son frontend une seule fois, par `FrontendService.registerEntry()`
(`FrontendService.ts:231`) — c'est ce point d'entrée qui fait exister le tout.

## Approche express — la commande le fait

```bash
nodefony create module shop --frontend react   # ou : vue | angular | svelte
```

La commande produit le squelette du module **et** son frontend : controller HTML avec sa politique
de sécurité, dossier `frontend/`, dépendances déclarées, point d'entrée enregistré. Les quatre
choix sont **React 19, Vue 3, Angular 21 et Svelte 5** (`spec.ts:114`) — elle vous fait gagner les
neuf étapes manuelles ci-dessous.

Le reste de ce guide explique la **version manuelle**, utile pour comprendre ce que la commande
fait, et indispensable pour greffer un frontend sur un module qui existe déjà.

---

## Pré-requis

- `@nodefony/frontend` installé et déclaré dans l'application (étape 1 ci-dessous)
- Vite et ses plugins installés à la racine :
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
      FrontendService | undefined;
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
      FrontendService | undefined;

    // Rien à faire pour la CSP : le service déclare les origines Vite au
    // firewall (`@nodefony/security`), qui émet UN seul en-tête. Réécrire
    // l'en-tête ici écraserait le nonce de la requête.

    // On propage deux données de la requête : le nonce CSP (sans lui, les
    // balises émises sont bloquées) et l'hôte — en développement, l'origine
    // des assets Vite est dérivée de ce nom, si bien que votre poste et un
    // navigateur en conteneur (ou une machine distante) chargent la même page
    // en même temps, sans rien à configurer.
    const viteTags =
      svc?.renderTags(
        "shop-front",
        this.context?.cspNonce,
        this.context?.domain,
      ) ?? "<!-- @nodefony/frontend not ready -->";

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
  <head>
    <title>Shop Front — Vite standalone</title>
  </head>
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

interface ApiData {
  ts: number;
  module: string;
}

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

| Symptôme                                               | Cause                           | Fix                                                            |
| ------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------- |
| `ERROR @nodefony/frontend service unavailable`         | Ordre `@modules` racine         | Déclarer `@nodefony/frontend` AVANT le module consumer         |
| Page blanche, `Refused to load script ... blocked:csp` | Un controller réécrit le CSP    | Le laisser au firewall : il déclare déjà les origines Vite     |
| Assets sur `127.0.0.1` depuis une AUTRE machine        | Hôte hors `trustedHosts`        | L'y ajouter en dev : la même liste ouvre 421, Vite, CSP, rendu |
| `Unexpected token '<'` sur `fetch("/api/...")`         | Vite sert SPA-fallback HTML     | Déclarer `apiProxyPaths` dans `registerEntry`                  |
| `@vitejs/plugin-react can't detect preamble`           | Preamble manquant               | Toujours utiliser `svc.renderTags(name)`                       |
| Cache navigateur après modif CSP                       | Browser cache                   | **Cmd+Shift+R** (hard reload)                                  |
| Modules React introuvables                             | Cert HTTPS Vite refusé sur 5173 | Visiter `https://127.0.0.1:5173/` une fois et accepter le cert |

## 📖 Lexique

| Terme                        | Ce que c'est                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Point d'entrée** (_entry_) | Ce qu'un module déclare à `@nodefony/frontend` : un nom, un fichier source, les chemins d'API à mandater. Tout part de là.                                  |
| **HMR**                      | _Hot Module Replacement_ — Vite remplace à chaud le module modifié dans la page ouverte, sans rechargement ni perte d'état.                                 |
| **Superviseur Vite**         | Le processus qui lance Vite, le surveille et le relance s'il tombe. Il vit dans l'application, pas dans votre terminal.                                     |
| **CSP**                      | _Content Security Policy_ — l'en-tête qui dit au navigateur quelles origines ont le droit de fournir des scripts. En développement, elle doit inclure Vite. |
| **`renderTags`**             | Le rendu des balises `<script>`/`<link>` de votre point d'entrée : elles pointent vers Vite en développement, vers les fichiers bâtis en production.        |

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée depuis vitest — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires | `@nodefony/frontend` `unit/ViteConfigGenerator.test.ts`, `unit/ViteBuilder.test.ts`, `unit/templateHelperOrigin.test.ts` | la configuration Vite engendrée, le build, l'origine des balises rendues |
| Unitaires (sécurité) | `unit/cspBeforeVite.test.ts`, `unit/originDerivationPolicy.test.ts` | la politique de sécurité inclut Vite, et l'origine se dérive de l'hôte demandé |
| Unitaires (résilience) | `unit/viteSupervisorStop.test.ts`, `unit/pidFromNetstat.test.ts`, `unit/remoteDev.test.ts` | l'arrêt de l'arbre de processus, la reprise d'un port occupé, le développement à distance |
| Intégration | `integration/ViteProcessSupervisor.test.ts`, `integration/frontend-build.test.ts` | le superviseur avec un vrai Vite, et un build complet |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 📚 **L'interface publique complète** :
  [`@nodefony/frontend`](../../src/packages/@nodefony/frontend/docs/index.md)
- 🛟 **Ce qui se passe quand Vite tombe** (relance, port occupé, sonde de vie) :
  [résilience du superviseur](../../src/packages/@nodefony/frontend/docs/index.md#résilience--ce-qui-se-passe-quand-vite-tombe)
- 🧩 **Exemples vivants dans le dépôt** : `src/modules/test-frontend-react/` — et ses trois frères
  `test-frontend-vue/`, `test-frontend-angular/`, `test-frontend-svelte/`, qui montrent le même
  montage avec chacun des quatre choix.
- 🛠️ **La console d'administration** consomme elle-même `@nodefony/frontend` :
  [`@nodefony/studio`](../../src/packages/@nodefony/studio/docs/index.md)
- 📖 [Lexique général](../lexique.md) du framework.
