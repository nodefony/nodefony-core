# @nodefony/frontend

Builder frontend Nodefony — supervise [Vite](https://vite.dev/) dans un process séparé pour transpiler les frontends de tes modules (React 19, Vue 3, Angular, vanilla TS).

> Audience : développeur Nodefony qui ajoute son **premier frontend** à un module existant. Tu connais déjà `Module`, `Service`, `Controller`. Si non, lis d'abord le [CLAUDE.md racine](../../../../CLAUDE.md).

---

## Pourquoi un process séparé ?

Vite a besoin d'un event-loop et d'un tas V8 pour compiler/HMR. L'exécuter **in-proc** dans le serveur Nodefony bloque les requêtes pendant les rebuilds. Un process séparé (`child_process.spawn`) isole parfaitement Vite du backend :

- Crash Vite ≠ crash Nodefony
- Compilation Vite ≠ latence event-loop Nodefony
- HMR WebSocket de Vite reste autonome
- Auto-restart en cas de mort du child (résilience built-in)

---

## Quickstart — ajouter un frontend à ton module

### 1. Activer `@nodefony/frontend` dans l'app

Dans `index.ts` racine :

```ts
@modules([
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/frontend",       // ← avant ton module consumer
  "@nodefony/mon-module",
])
class App extends Module { ... }
```

> **Ordre important** : `@nodefony/frontend` doit être déclaré AVANT les modules qui appellent `registerEntry()` — sinon le service `frontend` n'existe pas dans le DI Container au moment du `onKernelBoot()` du consumer.

### 2. Installer les peer deps

```bash
npm i -D vite @vitejs/plugin-react   # react19 / react-dom
# ou
npm i -D vite @vitejs/plugin-vue     # vue3
```

### 3. Déclarer ton frontend dans le module consumer

```ts
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";
import config from "./nodefony/config/config";
import MyController from "./nodefony/controller/MyController";

@controllers([MyController])
class MyModule extends Module {
  constructor(kernel: Kernel) {
    super("my-module", kernel, import.meta.url, config);
  }

  override async onKernelBoot(): Promise<this> {
    const svc = this.kernel?.container?.get("frontend") as
      FrontendService | undefined;
    svc?.registerEntry(this, {
      type: "react19", // | "vanilla"
      entry: "./frontend/src/main.tsx", // relatif au module
      root: "./frontend", // contient index.html
      outDir: "./public/dist", // pour la prod build
      name: "my-module", // nom logique (entryName)
      // Quand le browser fait fetch("/my/api/x") depuis l'app Vite,
      // Vite proxifie vers Nodefony :
      apiProxyPaths: ["/my/api"],
    });
    return this;
  }
}
```

### 4. Créer le frontend Vite

```
src/modules/my-module/frontend/
├── index.html                    ← (peut être absent — Nodefony rend la page elle-même)
├── src/
│   ├── main.tsx                  ← entry point (React 19 ici)
│   └── App.tsx
```

`main.tsx` standard :

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

### 5. Rendre la page depuis un Controller

```ts
import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

@controller("/my-route")
class MyController extends Controller {
  constructor(context: Context) {
    super("MyController", context);
  }

  @route("my-react", { path: "/" })
  renderReact(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      FrontendService | undefined;

    // En développement, la CSP doit autoriser les origines Vite cross-origin :
    // le controller surcharge l'en-tête via les directives du service.
    if (svc) {
      this.context?.response?.setHeader(
        "Content-Security-Policy",
        svc.getCspDirectives(),
      );
    }

    const viteTags =
      svc?.renderTags("my-module") ?? "<!-- @nodefony/frontend not started -->";

    return this.render(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My App</title>
    ${viteTags}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`);
  }
}
```

### 6. Lancer le serveur dev

```bash
npx nodefony development
```

Le superviseur Vite démarre automatiquement sur l'event `onServersReady` du kernel (après que les 4 serveurs Nodefony écoutent). Tu verras dans le syslog :

```
INFO frontend : registered entry: my-module (react19) from "my-module"
INFO frontend : vite dev server ready on 127.0.0.1:5173
```

Va sur `http://127.0.0.1:5151/my-route/` — Nodefony rend l'HTML, le browser tape Vite (5173) pour les assets, HMR fonctionne en édition de `App.tsx`.

---

## Config complète

Dans le `config.ts` de **ton app** ou de **ton module** :

```ts
const config = {
  "module-frontend": {
    devHost: "127.0.0.1", // host d'écoute Vite
    devPort: 5173, // port Vite (incrémenté si occupé)
    autoStartInDevelopment: true, // démarre Vite en env=development
    pipeViteLogs: true, // logs Vite dans syslog Nodefony

    // HTTPS — partage les certs Nodefony (server-https 5152)
    https: true, // false par défaut

    // Proxy backend Vite → Nodefony
    backendHost: "127.0.0.1",
    backendPort: 5151,
    backendProtocol: "http", // http | https

    // Variables d'env passées à Vite (les VITE_* sont exposées au browser)
    viteEnv: {
      VITE_API_BASE: "/api/v1",
    },

    // Résilience supervisor
    resilience: {
      autoRestart: true, // restart sur crash
      maxRestarts: 5, // avant abandon
      restartBackoffBaseMs: 500, // backoff exponentiel
      restartBackoffMaxMs: 8_000,
      healthCheckIntervalMs: 30_000, // ping HTTP périodique (0 = off)
      healthCheckFailureThreshold: 3, // échecs avant restart
      portRetryAttempts: 3, // port+1, port+2 sur EADDRINUSE
    },
  },
};
```

Tout est optionnel — les defaults fonctionnent out-of-the-box.

---

## Events du supervisor

`FrontendService` est un `Service` Nodefony (donc un `EventEmitter`). Tu peux écouter :

| Event               | Payload                      | Quand                                   |
| ------------------- | ---------------------------- | --------------------------------------- |
| `frontend:starting` | `{ backendOrigin, entries }` | Juste avant le spawn Vite               |
| `frontend:ready`    | `IViteSupervisorStatus`      | Vite a annoncé `Local:` dans son stdout |
| `frontend:error`    | `Error`                      | Spawn ou ready timeout échoué           |
| `frontend:stopped`  | (rien)                       | Après `stop()` propre (SIGINT envoyé)   |

Exemple :

```ts
const svc = kernel.container.get("frontend") as FrontendService;
svc.on("frontend:ready", (status) => {
  console.log(`Vite up on ${status.host}:${status.port}`);
});
```

---

## API publique du service

```ts
interface IFrontendService {
  registerEntry(module, declaration): IResolvedFrontendEntry;
  listEntries(): ReadonlyArray<IResolvedFrontendEntry>;
  status(): IViteSupervisorStatus;
  startDev(): Promise<void>; // appelé auto par onServersReady
  stopDev(): Promise<void>;
  build(): Promise<void>; // vite.build() in-proc
  renderTags(entryName): string;
  getCspDirectives(): string; // CSP custom pour helmet override
}
```

---

## Troubleshooting

### Page blanche, scripts bloqués par CSP

Le helmet de `@nodefony/security` pose `script-src 'self'` par défaut. Override dans le controller :

```ts
this.context.response.setHeader(
  "Content-Security-Policy",
  svc.getCspDirectives(),
);
```

### `Unexpected token '<'` sur `fetch("/api/...")`

Vite sert son SPA-fallback HTML pour les routes inconnues. Déclare le préfixe dans `apiProxyPaths` :

```ts
svc.registerEntry(this, { ..., apiProxyPaths: ["/my/api"] });
```

### `@vitejs/plugin-react can't detect preamble`

Le `TemplateHelper` injecte automatiquement le preamble React Fast Refresh pour les entries `type: "react19"`. Si tu vois cette erreur, vérifie que tu utilises bien `svc.renderTags("entry-name")` au lieu d'injecter les `<script>` à la main.

### Vite démarre sur un autre port que `devPort`

Le port configuré est pris. Le supervisor retry automatiquement sur `port+1`, `port+2` (option `portRetryAttempts`). Vérifie le port résolu via `svc.status().port`.

### Le browser refuse le cert HTTPS de Vite (`https: true`)

Va sur `https://127.0.0.1:5173/` une fois et accepte le certificat. Ou installe la CA root Nodefony : `nodefony/config/certificates/ca/nodefony-root-ca.crt.pem` dans ton trousseau.

### Vite crash en boucle (`max restarts reached`)

Le superviseur abandonne après `maxRestarts` (default 5). Regarde les logs Vite dans le syslog (`[vite!] ...`) pour la cause. Augmente `maxRestarts` ou fix le source du crash.

---

## Tests

```bash
npm test                     # unit — ViteConfigGenerator
npm run test:integration     # intégration — supervisor, spawn réel
```

Les tests d'intégration nécessitent `vite` installé (déjà en devDependencies du repo).

---

## Architecture (résumé)

```
Module consumer
   │ onKernelBoot()
   ↓
FrontendService.registerEntry()       ← collecte les frontends à transpiler
   │
Kernel "onServersReady"               ← 4 servers Nodefony écoutent
   ↓
FrontendService.startDev()
   ↓
ViteProcessSupervisor.start()
   ├─ écrit vite.config.generated.mjs (proxy, https, base, env)
   ├─ spawn("npx", ["vite", "--config", ...])
   ├─ parse stdout "Local: https://host:port" → state = "ready"
   ├─ attach exit handler (auto-restart si crash inattendu)
   └─ start health check loop (ping HTTP périodique)

Browser GET /my-route/
   │
Nodefony rend HTML + svc.renderTags() injecte:
   <script type="module">  preamble React Fast Refresh
   <script src="https://host:5173/@vite/client">
   <script src="https://host:5173/src/main.tsx">

Browser → 5173 (Vite) pour les assets + HMR WSS
Browser → 5173 pour /api/... → Vite proxifie vers Nodefony (5151/5152)
```

Détails internes : voir [`CLAUDE.md`](./CLAUDE.md) et [`MEMORY.md`](./MEMORY.md).
