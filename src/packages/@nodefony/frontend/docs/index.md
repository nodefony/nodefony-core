---
module: "@nodefony/frontend"
topic: frontend
audience: [human, ai]
tags: [frontend, vite, react, vue, svelte, hmr, supervisor]
status: stable
last-updated: 2026-05-18
---

# @nodefony/frontend

> Builder frontend Nodefony — supervise [Vite](https://vite.dev/) dans un process séparé (`child_process.spawn`) pour transpiler les frontends déclarés par chaque module (React 19, Vue 3, Svelte 5, vanilla TS), avec HMR cross-origin et résilience runtime (auto-restart, port retry, health check).

## Vue d'ensemble

Le module pilote Vite **out-of-process** : la compilation et le HMR ne bloquent jamais l'event-loop Nodefony, et un crash Vite ne tue pas le serveur backend. Cette décision a été validée par audit perf au cours du POC `poc/frontend-child` (cf. [`../audits/poc-frontend-comparison.md`](../audits/poc-frontend-comparison.md)).

**Cas d'usage** :

- Module applicatif qui sert une SPA (React/Vue/Svelte) + une API backend
- Page d'admin Nodefony (`/nodefony/<module>/`) avec frontend interactif
- Future Vision UI (Phase 10) — frontend admin embarqué

**Hors scope** :

- Server-Side Rendering — Vite gère son propre rendering, Nodefony rend juste l'HTML d'entrée
- Frontends sans build (vanilla JS sans transpilation) — `@nodefony/http` `server-static` suffit

## Architecture

```
Module consumer (ex: src/modules/shop-front)
   │ onKernelBoot()
   ↓
FrontendService.registerEntry(this, { type: "react19", entry, apiProxyPaths, ... })
   │ … (collecte des entries depuis les modules)
   ↓
Kernel "onServersReady"  (les 4 serveurs Nodefony écoutent)
   ↓
FrontendService.startDev()
   ↓
ViteProcessSupervisor.start()
   ├─ écrit vite.config.generated.mjs (proxy, https, base, viteOrigin)
   ├─ spawn("npx", ["vite", "--config", ..., "--mode", kernel.env])
   ├─ parse stdout "Local: https://host:port" → state = "ready"
   ├─ attache exit handler (auto-restart si crash inattendu)
   └─ démarre health check loop (ping HTTP périodique)

Browser GET /shop-front/
   │
Controller rend HTML + svc.renderTags("shop-front") injecte:
   <script type="module"> preamble React Fast Refresh
   <script src="https://host:5173/@vite/client">
   <script src="https://host:5173/src/main.tsx">

Browser → Vite (5173) pour assets + HMR WSS
Browser → Vite (5173) pour /shop-front/api/… → Vite proxifie vers Nodefony (5151/5152)
```

Détails internes par sous-système :

- **`FrontendService`** ([Service injectable](../architecture/container.md)) — agrège les entries déclarées par les modules, démarre le supervisor au `onServersReady`, expose les events lifecycle (`frontend:starting/ready/error/stopped`) et la CSP custom (`getCspDirectives()`).
- **`ViteProcessSupervisor`** — boîte noire `child_process.spawn`. État machine étendu (`idle/starting/ready/restarting/crashed/stopping/stopped/errored`). Auto-restart sur crash avec backoff exponentiel (500ms→8s, max 5 tentatives). Port retry sur EADDRINUSE. Health check HTTP périodique.
- **`ViteConfigGenerator`** — fonction pure qui produit le `vite.config.generated.mjs` selon les entries (presets, proxy, base URL absolue, certs HTTPS, etc.).
- **`TemplateHelper`** — produit les balises `<script>` à injecter dans l'HTML rendu côté Nodefony. Inline le préambule React Fast Refresh pour les entries `type: "react19"` (sans : `@vitejs/plugin-react can't detect preamble`).

## API publique

### `FrontendService`

Service injectable, exposé via `kernel.container.get("frontend")`.

```typescript
interface IFrontendService {
  /** Enregistre la déclaration frontend d'un module consumer. À appeler dans onKernelBoot. */
  registerEntry(module: Module, decl: IFrontendModuleDeclaration): IResolvedFrontendEntry;

  /** Snapshot lisible — utilisé par TemplateHelper et Vision. */
  status(): IViteSupervisorStatus;

  /** Démarrer le dev server (idempotent). Appelé auto par onServersReady. */
  startDev(): Promise<void>;

  /** Stop propre du supervisor (SIGINT puis SIGKILL après 3s). Idempotent. */
  stopDev(): Promise<void>;

  /** Build production — vite.build() in-proc, écrit manifest.json. */
  build(): Promise<void>;

  /** Tags `<script>` à injecter dans l'HTML rendu par le controller. */
  renderTags(entryName: string): string;

  /** CSP à appliquer dans le response du controller (override helmet par défaut). */
  getCspDirectives(): string;
}
```

### `IFrontendModuleDeclaration`

```typescript
interface IFrontendModuleDeclaration {
  /** Preset : "react19" | "vanilla" (vue3, svelte5, solid à venir). */
  readonly type: IFrontPreset["type"];

  /** Entry source relatif au module (ex: "./frontend/src/main.tsx"). */
  readonly entry: string;

  /** Racine Vite (contient index.html). Default "./frontend". */
  readonly root?: string;

  /** Output build prod (relatif au module). Default "./public/dist". */
  readonly outDir?: string;

  /** Nom logique de l'entrée multi-bundle (default = nom du module). */
  readonly name?: string;

  /**
   * Préfixes de paths backend à proxifier depuis Vite vers Nodefony en dev.
   * Sans ça, fetch("/shop/api/x") depuis l'app servie par Vite reçoit du
   * HTML SPA-fallback → `Unexpected token '<'`.
   */
  readonly apiProxyPaths?: ReadonlyArray<string>;
}
```

### Events

`FrontendService` hérite de `Service` (donc EventEmitter Nodefony). Les events émis :

| Event                | Payload                            | Quand                                        |
| -------------------- | ---------------------------------- | -------------------------------------------- |
| `frontend:starting`  | `{ backendOrigin, entries }`       | Juste avant le spawn Vite                    |
| `frontend:ready`     | `IViteSupervisorStatus`            | Vite a annoncé `Local:` dans son stdout      |
| `frontend:error`     | `Error`                            | Spawn ou ready timeout échoué                |
| `frontend:stopped`   | (rien)                             | Après `stop()` propre                        |

Exemple :

```typescript
const svc = kernel.container.get("frontend") as FrontendService;
svc.on("frontend:ready", (status) => {
  console.log(`Vite up on ${status.host}:${status.port}`);
});
```

### Statut runtime

```typescript
interface IViteSupervisorStatus {
  readonly state: ViteSupervisorState; // idle | starting | ready | restarting | crashed | stopping | stopped | errored
  readonly host: string;
  readonly port: number | null;
  readonly pid: number | null;
  readonly lastError: string | null;
  readonly entries: ReadonlyArray<IResolvedFrontendEntry>;
  readonly https: boolean;
  readonly restartCount: number;     // depuis le premier start
  readonly healthFailures: number;   // failures consécutifs en cours
}
```

## Concepts clés

### Pourquoi `onServersReady` plutôt que `onReady`

Vite démarre **après** que les 4 serveurs Nodefony (HTTP/HTTPS/WS/WSS) sont en écoute. Sans ça :

- Le proxy Vite (`/api/...` → Nodefony) tape un backend pas encore prêt — premières requêtes 502
- Les health checks démarreraient avant que la cible soit servable

Le hook canonique est `kernel.once("onServersReady", ...)` dans `FrontendService.initialize()`.

### Pourquoi `base` URL absolue

En dev, Vite transforme `import { App } from "./App"` en `import { App } from "/src/App.tsx"` (chemin absolu root-relative). Quand l'HTML est servi par **Nodefony** (origin 5151), le browser résout `/src/App.tsx` contre 5151 → 404.

Solution : `base: "https://127.0.0.1:5173/"` dans la config Vite générée. Tous les imports deviennent **absolus complets**, le browser tape directement Vite (5173). `strictPort: true` est implicitement requis (si Vite saute de port, `base` mentirait silencieusement).

### Pourquoi le preamble React inline

`@vitejs/plugin-react` exige qu'un script inline soit présent dans le `<head>` AVANT le chargement des modules React. Ce script définit `window.__vite_plugin_react_preamble_installed__ = true` + injecte `@react-refresh`.

Quand c'est Vite qui sert l'HTML, il l'injecte automatiquement via `transformIndexHtml`. Quand c'est Nodefony qui rend l'HTML, on rate l'injection → `Uncaught Error: @vitejs/plugin-react can't detect preamble`. `TemplateHelper` injecte le preamble lui-même pour les entries `type: "react19"`.

### CSP cross-origin

Helmet (via `@nodefony/security`) pose `script-src 'self'` par défaut. Les scripts Vite cross-origin (5173) sont **bloqués**.

**Hack POC actuel** : le controller appelle `setHeader("Content-Security-Policy", svc.getCspDirectives())` avant `render()`. C'est explicitement temporaire.

**TODO** : exposer une API dans `@nodefony/security` pour qu'un module enregistre ses origines à inclure dans helmet — `FrontendService.startDev()` appellerait cette API au démarrage. Voir mémoire IA `project_csp_vite_security_todo`.

### Résilience supervisor

`ViteProcessSupervisor` est conçu pour **survivre aux crashes** :

- **Idempotence** : appels concurrents à `start()` partagent la même promesse. `stop()` aussi.
- **Auto-restart** : si le child meurt avec `state === "ready"` (= crash inattendu, pas un shutdown volontaire), `scheduleRestart()` planifie une relance avec backoff exponentiel (500ms → 8s, max 5 tentatives).
- **Port retry** : `EADDRINUSE` au spawn déclenche un retry sur `port+1`, `port+2` (max `portRetryAttempts`).
- **Health check** : `setInterval` (default 30s) qui `GET /` sur Vite. Après `healthCheckFailureThreshold` (default 3) échecs consécutifs, `killChild()` → trigger restart.
- **Cleanup listeners** : `trackListener()` + `cleanupChildListeners()` au exit. Évite `MaxListenersExceededWarning` entre restarts.
- **Distinction crash vs shutdown** : flag `willingShutdown` mis par `stop()` — l'exit handler skip l'auto-restart si shutdown volontaire.

Toutes ces options sont configurables via `module-frontend.resilience.*`. Désactiver l'auto-restart en CI (`autoRestart: false`) pour faire échouer le pipeline sur un crash au lieu de le masquer.

## Configuration

Voir le `config.ts` du module pour la liste exhaustive avec descriptions. Surcharge type :

```typescript
// app/nodefony/config/config.ts
const config = {
  "module-frontend": {
    devPort: 5173,
    https: true,                       // partage certs Nodefony (5152)
    backendProtocol: "http",           // proxy Vite → 127.0.0.1:5151 par défaut
    viteEnv: { VITE_API_BASE: "/v1" }, // exposé browser via import.meta.env
    resilience: { maxRestarts: 5 },    // toutes opts optionnelles
  },
};
```

## Quickstart

Voir le guide complet [`../guides/frontend-react.md`](../guides/frontend-react.md) pour scaffold un module avec frontend React 19 en 6 étapes, ou utiliser le skill `nodefony-create-frontend-module` (React 19 / Vue 3 / Angular 21).

## Gotchas

| Symptôme                                                   | Cause                                              | Fix                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| Page blanche, `Refused to load script ... blocked:csp`     | Helmet bloque scripts Vite cross-origin            | Controller : `setHeader("Content-Security-Policy", svc.getCspDirectives())` |
| `Unexpected token '<'` sur `fetch("/api/...")`             | Vite sert son SPA-fallback HTML, pas Nodefony      | Déclarer `apiProxyPaths: ["/api"]` dans `registerEntry`              |
| `@vitejs/plugin-react can't detect preamble`               | Preamble non injecté dans `<head>`                 | Utiliser `svc.renderTags("name")` (qui injecte automatiquement)      |
| `ERROR @nodefony/frontend service unavailable`             | Ordre `@modules` racine                            | Déclarer `@nodefony/frontend` AVANT le module consumer               |
| Vite démarre sur un autre port que `devPort`               | Port pris                                          | Supervisor retry sur `port+1`, `port+2`. Vrai port dans `status.port` |
| Browser refuse le cert HTTPS Vite                          | Cert self-signed, origine 5173 distincte de 5152   | Accepter le cert sur `https://127.0.0.1:5173` ou installer la CA root |
| `max restarts reached`                                     | Vite crash en boucle                               | Voir logs `[vite]` dans syslog, fix le source du crash               |

## Limites actuelles

- **Mode build production** : `service.build()` lance `vite.build()` in-proc. Le `TemplateHelper.renderProdTags()` n'est pas encore implémenté — actuellement renvoie un commentaire HTML. À faire : lire `manifest.json` du build pour injecter les assets fingerprintés.
- **Multi-bundles** : une seule instance Vite gère plusieurs entries (`input` map Rollup-style). Pas encore testé en intensif (3+ modules consumers).
- **Presets** : `react19` + `vanilla` implémentés. `vue3`, `svelte5`, `solid` à venir.
- **CSP** : override par controller — à migrer dans `@nodefony/security`.

## Tests

```bash
cd src/packages/@nodefony/frontend
npm test                    # 14 unit tests ViteConfigGenerator (~11ms)
npm run test:integration    # 3 integration tests real spawn (~6s)
```

## Liens

- Code source : `src/packages/@nodefony/frontend/`
- README utilisateur (quickstart concis) : `src/packages/@nodefony/frontend/README.md`
- MEMORY (notes internes IA) : `src/packages/@nodefony/frontend/MEMORY.md`
- Guide step-by-step : [`../guides/frontend-react.md`](../guides/frontend-react.md)
- Audit perf POC : [`../audits/poc-frontend-comparison.md`](../audits/poc-frontend-comparison.md)
- Skill scaffold : `.claude/skills/nodefony-create-frontend-module/SKILL.md` (React 19 / Vue 3 / Angular 21)
- Modules exemple : `src/modules/test-frontend-{react,vue,angular}/` (références canoniques)
