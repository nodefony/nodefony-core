# @nodefony/frontend

Builder frontend Nodefony — supervise [Vite](https://vite.dev/) dans un process séparé pour transpiler les frontends de tes modules (React 19, Vue 3, Angular, vanilla TS).

> Audience : développeur Nodefony qui ajoute son **premier frontend** à un module existant. Tu connais déjà `Module`, `Service`, `Controller`. Si non, lis d'abord le [CLAUDE.md racine](https://github.com/nodefony/nodefony-core/blob/main/CLAUDE.md).

---

## Pourquoi un process séparé ?

Vite a besoin d'un event-loop et d'un tas V8 pour compiler/HMR. L'exécuter **in-proc** dans le serveur Nodefony bloque les requêtes pendant les rebuilds. Un process séparé (`child_process.spawn`) isole parfaitement Vite du backend :

- Crash Vite ≠ crash Nodefony
- Compilation Vite ≠ latence event-loop Nodefony
- HMR WebSocket de Vite relayé par Nodefony, sur l'origine de la page
- Auto-restart en cas de mort du child (résilience built-in)

---

## Quickstart — ajouter un frontend à ton module

### 1. Activer `@nodefony/frontend` dans l'app

Dans `nodefony.config.ts` :

```ts
export default defineConfig(() => ({
  modules: [
    "@nodefony/http",
    "@nodefony/framework",
    "@nodefony/frontend", // ← avant ton module consumer
    "@nodefony/mon-module",
  ],
}));
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

    // Rien à faire pour la CSP : en développement, le service déclare les
    // origines Vite au firewall (`@nodefony/security`), qui émet UN seul
    // en-tête. Un controller qui le réécrirait écraserait le nonce.

    // Deux données de la requête sont propagées au rendu :
    //  - le nonce CSP, sans lequel `script-src 'nonce-…'` bloque les balises ;
    //  - l'hôte, dont l'origine des assets Vite est dérivée en développement —
    //    la page annonce l'origine par laquelle le client est arrivé, si bien
    //    qu'un poste et un navigateur en conteneur sont servis en même temps,
    //    sans configuration. Scheme et port restent ceux de Vite.
    const viteTags =
      svc?.renderTags(
        "my-module",
        this.context?.cspNonce,
        this.context?.domain,
      ) ?? "<!-- @nodefony/frontend not started -->";

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
INFO frontend : vite [default] ready on 127.0.0.1:5173
```

Va sur `https://127.0.0.1:5152/my-route/` — Nodefony rend l'HTML, et relaie à Vite tout ce qui passe sous `/_vite/<famille>/` (modules, styles, socket du rechargement à chaud). Le navigateur ne voit qu'**une** origine : un seul certificat, pas de contenu mixte. HMR fonctionne en édition de `App.tsx`.

Pour ouvrir la page depuis un téléphone du réseau local : `NF_BIND_ALL=true` (application générée), puis `https://<IP-de-ta-machine>:5152/my-route/` — détail dans la [documentation du module](docs/index.md#-hors-de-la-boucle-locale--téléphone-conteneur-réseau).

---

## Config complète

Dans le `config.ts` de **ton app** ou de **ton module** :

```ts
const config = {
  "module-frontend": {
    devHost: "127.0.0.1", // écoute de Vite — boucle locale, Nodefony le relaie
    devPort: 5173, // port Vite interne (incrémenté si occupé)
    autoStartInDevelopment: true, // démarre Vite en env=development
    pipeViteLogs: true, // logs Vite dans syslog Nodefony

    // Proxy de Vite → Nodefony : ne sert que si une page est servie par Vite
    // lui-même (apiProxyPaths). Une page rendue par Nodefony n'en a pas besoin.
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
  listEntries(): ReadonlyArray<IResolvedFrontendEntry>;
  status(): IViteSupervisorStatus;
  statusAll(): ReadonlyArray<{ family: string; status: IViteSupervisorStatus }>;
  startDev(): Promise<void>; // appelé auto par onServersReady
  stopDev(): Promise<void>;
  // vite.build() par entrée ; bilan construits / ignorés / en échec
  build(opts?: { force?: boolean }): Promise<IFrontendBuildResult>;
  // `nonce` = `Context.cspNonce` ; `requestHost` = `Context.domain` (sans port),
  // dont l'origine des assets est dérivée en développement.
  renderTags(entryName, nonce?, requestHost?): string;
  renderDocument(entryName, nonce?, requestHost?): string;
  assetUrl(path): string;
}
```

`registerEntry(module, declaration)` est porté par la classe `FrontendService`, pas par l'interface.

---

## Troubleshooting

### Page blanche, scripts bloqués par CSP

En développement, le service déclare son fragment CSP au pare-feu (`@nodefony/security`) une fois
Vite prêt — sans aucune origine, tout passe par celle de la page — et ce dernier émet UN seul
en-tête CSP avec le nonce de la requête. Vérifie que tu passes
`this.context?.cspNonce` à `svc.renderTags(…)` / `renderDocument(…)`, et ne réécris jamais l'en-tête
dans le contrôleur : tu écraserais le nonce.

### `Unexpected token '<'` sur `fetch("/api/...")`

La page est ouverte sur le port de Vite, qui sert son SPA-fallback HTML pour les routes inconnues. Ouvre-la par Nodefony (le `fetch` part alors vers lui) ; sinon, déclare le préfixe dans `apiProxyPaths` :

```ts
svc.registerEntry(this, { ..., apiProxyPaths: ["/my/api"] });
```

### `@vitejs/plugin-react can't detect preamble`

Le `TemplateHelper` injecte automatiquement le preamble React Fast Refresh pour les entries `type: "react19"`. Si tu vois cette erreur, vérifie que tu utilises bien `svc.renderTags("entry-name")` au lieu d'injecter les `<script>` à la main.

### Vite démarre sur un autre port que `devPort`

Le port configuré est pris. Le supervisor retry automatiquement sur `port+1`, `port+2` (option `portRetryAttempts`). Vérifie le port résolu via `svc.status().port` — il vaut `null` tant qu'aucun port n'a été résolu, jamais le port demandé : un port qu'on espère n'est pas un port qui sert.

### Le navigateur alerte sur le certificat de développement

Accepte-le **une** fois sur la page : modules et socket passent par la même origine, donc par le même certificat. Ou installe la CA root Nodefony : `nodefony/config/certificates/ca/nodefony-root-ca.crt.pem` dans ton trousseau. L'option `https` du module est dépréciée et sans effet.

### Connexion refusée depuis un téléphone

En développement, l'application n'écoute que la boucle locale. `NF_BIND_ALL=true` l'ouvre au réseau local (application générée) — à réserver à un réseau de confiance.

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
   ├─ écrit vite.config.generated.mjs (base /_vite/<famille>/, env)
   ├─ monte /_vite/<famille>/ sur le proxy inverse de @nodefony/http
   ├─ spawn(node, [vite.js, "--config", ...])   (repli npx si le binaire n'est pas résolu)
   ├─ parse stdout "Local: https://host:port" → state = "ready"
   ├─ attach exit handler (auto-restart si crash inattendu)
   └─ start health check loop (ping HTTP périodique)

Browser GET /my-route/
   │
Nodefony rend HTML + svc.renderTags() injecte:
   <script type="module">  preamble React Fast Refresh
   <script src="/_vite/default/@vite/client">
   <script src="/_vite/default/@fs/…/src/main.tsx">

Browser → Nodefony (5152) /_vite/… → relais → Vite 127.0.0.1:5173 (assets + HMR WSS)
Browser → Nodefony (5152) /api/…  → ton contrôleur, sans proxy
```

Détails internes (dans le dépôt) : voir [`CLAUDE.md`](https://github.com/nodefony/nodefony-core/blob/main/src/packages/@nodefony/frontend/CLAUDE.md) et [`MEMORY.md`](https://github.com/nodefony/nodefony-core/blob/main/src/packages/@nodefony/frontend/MEMORY.md).
