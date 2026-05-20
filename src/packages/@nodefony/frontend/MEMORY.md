# MEMORY.md — @nodefony/frontend

Purpose: builder Vite multi-framework. Successeur webpackService legacy.

## Core Components

- `Frontend` (Module class) — declared services: [FrontendService]. Commands: frontend:{build,dev,status}.
- `FrontendService` — @injectable, name="frontend". Container.get("frontend").
- `ViteProcessSupervisor` (cette branche POC) — spawn `npx vite --config <generated.mjs>`. Parse stdout "Local:" → state=ready.
- `ViteConfigGenerator` — produit `${moduleRoot}/vite.config.generated.mjs`. Hardcode imports plugins selon preset types.
- `ViteBuilder` — config Vite in-proc pour mode build (vite.build() programmatique).
- `TemplateHelper` — `renderTags(entryName)` → `<script type="module" src="http://host:port/...">`.

## Presets

- react19 → `@vitejs/plugin-react` lazy import, optimizeDeps: react/react-dom/react-dom/client. Extensions: tsx,jsx,ts,js. TemplateHelper inline preamble Fast Refresh.
- vue3 → `@vitejs/plugin-vue` lazy import, optimizeDeps: vue. Extensions: vue,ts,js. PAS de preamble (Vue se monte via `createApp(App).mount()` dans l'entry) → TemplateHelper chemin générique. Consommateur réf: `src/modules/test-frontend-vue`.
- angular → `@analogjs/vite-plugin-angular` lazy import, optimizeDeps: @angular/core+common+platform-browser. Extensions: ts,html. Angular 21 standalone+zoneless (`bootstrapApplication`+`provideZonelessChangeDetection`, pas zone.js). Generator émet `angular({ tsconfig: <ABSOLU> })` résolu depuis `angularEntry.root` (cwd Vite = entries[0].root ≠ root angular). PAS de preamble. Consommateur réf: `src/modules/test-frontend-angular` (/angular/app). **Gotchas** : install `--legacy-peer-deps` (TS6 vs @angular/build peer <6.0, mais compiler-cli accepte <6.1) ; `@analogjs/*`+`@angular` DOIVENT être dans `external` du rollup.config frontend (compiler-cli interop CJS typescript non-bundlable) ; le plugin transforme TOUS les .ts → scoping par tsconfig.app.json (include = frontend angular only) sinon casse le main.ts de Vue ; HMR = page reload (pas hot-swap).
- vanilla → no plugin, no optimizeDeps. Extensions: ts,js.
- TODO: svelte5, solid.

## Pipeline

1. consumer module → `frontendService.registerEntry(this, { type, entry, apiProxyPaths })` dans onKernelBoot()
2. kernel.**onServersReady** + env=development + autoStart → service.startDev() (PAS onReady — Vite après que les servers Nodefony écoutent)
3. startDev → generator.toMjs (base, https, proxy, viteOrigin) → writeFileSync → supervisor.start (spawn vite)
4. browser → controller rend HTML → TemplateHelper.renderTags injecte `<script>` (+ React preamble pour react19)
5. browser ↔ Vite direct (cors=true) sur port 5173. fetch("/api/...") → Vite proxifie vers Nodefony.
6. kernel.onTerminate → supervisor.stop (idempotent) → SIGINT + SIGKILL 3s

## Config DEFAULTS

```ts
{
  devHost: "127.0.0.1",
  devPort: 5173,
  autoStartInDevelopment: true,
  enabledPresets: ["react19", "vanilla"],
  defaultOutDir: "./public/dist",
  defaultRoot: "./frontend",
  startupTimeoutMs: 30_000,
  pipeViteLogs: true,
  backendHost: "127.0.0.1",
  backendPort: 5151,
  backendProtocol: "http",  // http | https
  https: false,             // partage certs Nodefony (server-https 5152)
  viteEnv: {},              // VITE_* exposé browser via import.meta.env
  resilience: {             // toutes optionnelles, defaults supervisor
    autoRestart: true,
    maxRestarts: 5,
    restartBackoffBaseMs: 500,
    restartBackoffMaxMs: 8_000,
    healthCheckIntervalMs: 30_000,
    healthCheckFailureThreshold: 3,
    portRetryAttempts: 3,
  },
}
```

## Behaviors

- `vite.config.generated.mjs` overwrite à chaque startDev — ne jamais éditer.
- Port retry : EADDRINUSE → devPort+1, devPort+2 (max portRetryAttempts). Stocké dans `status.port`.
- Auto-restart : child.exit avec state=ready (= crash inattendu) → scheduleRestart() avec backoff exponentiel. `willingShutdown` flag distingue shutdown volontaire.
- Health check : setInterval (default 30s) GET `viteOrigin/`. 3 échecs consécutifs → kill child → trigger restart.
- Idempotence : 2e `start()` retourne `startPromise` en cours. `stop()` mémorise `stopPromise`.
- Listener tracking : `trackListener(target, event, fn)` + `cleanupChildListeners()` au exit. Évite MaxListenersExceededWarning entre restarts.
- HTTPS Vite : si `cfg.https=true`, supervisor récupère `certificates.privateKeyPath` + `certificates.certPath` via DI et les passe au generator (server.https inject fs.readFileSync).
- React preamble : TemplateHelper inline `<script type="module">` avec `RefreshRuntime.injectIntoGlobalHook` pour entries `type: "react19"`. Sans ça : `@vitejs/plugin-react can't detect preamble`.
- Logs pipeline : split lignes + strip ANSI (`\x1b\[…m`) + dédup préfixe `[vite]` (Vite préfixe parfois lui-même).
- Mode prod: `service.build()` → `vite.build(cfg)` in-proc (one-shot, OK).
- Cleanup stop: SIGINT puis SIGKILL après 3s. Évite zombies bloquant 5173.

## Errors

- `FrontendError` — base, code+context.
- `FrontendPresetUnknownError` — preset type non enregistré.
- `FrontendSupervisorStartError` — spawn/timeout/exit-before-ready.
- `FrontendNoEntriesError` — startDev sans registerEntry préalable.

## Commands CLI

- `nodefony frontend:dev` — start manual (si autoStart=false)
- `nodefony frontend:build` — vite.build() prod
- `nodefony frontend:status [-j]` — état supervisor + entries (consommé par Studio)

## Gotchas

- TemplateHelper.stripRoot strip "./frontend/" du entryFile pour URL Vite (`src/main.tsx`).
- `module.path` (Module class) requis pour résoudre les chemins absolus du consumer.
- Si `state !== "ready"` quand renderTags est appelé → commentaire HTML `<!-- vite supervisor state=... -->`.
- Container.get("frontend") = name passé au constructor Service (pas le className).
- CSP : `script-src 'self'` par défaut bloque les scripts Vite cross-origin. Hack POC : `controller.context.response.setHeader("Content-Security-Policy", svc.getCspDirectives())`. TODO → migrer dans @nodefony/security.
- `process.kill(child.pid)` tue `npx` (parent), pas Vite. Pour tuer Vite réel dans tests : `lsof -ti:port -sTCP:LISTEN`.
- Test crash auto-restart : `pidListeningOn(port)` puis SIGKILL ; attendre `state==="ready"` + `pid !== nodefonyPidBefore` + `restartCount === 1`.

## Events (Service EventEmitter)

- `frontend:starting` (payload `{ backendOrigin, entries }`) — avant spawn
- `frontend:ready` (payload `IViteSupervisorStatus`) — Vite ready
- `frontend:error` (payload `Error`) — spawn/timeout fail
- `frontend:stopped` (no payload) — après stop() propre

## Tests

- Unit : `nodefony/tests/unit/ViteConfigGenerator.test.ts` — 14 cases. Pure function, ts-node, ~10ms.
- Intégration : `nodefony/tests/integration/ViteProcessSupervisor.test.ts` — 3 cases (start+stop, idempotence, crash auto-restart). Real spawn ~6s.
- Fixture : `nodefony/tests/fixtures/minimal-frontend/` (index.html + src/main.ts vanilla).
- Lancer : `npm test` (unit) + `npm run test:integration`.

## API Studio (route /nodefony/frontend/* — Phase 10)

- GET /nodefony/frontend/api/status → JSON status (idem `frontend:status -j`)
- GET /nodefony/frontend/api/entries → list entries résolues
- POST /nodefony/frontend/api/restart → stop + startDev
- (TODO Phase 14.2 quand Studio MVP ✅)
