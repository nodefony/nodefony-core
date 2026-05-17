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

- react19 → `@vitejs/plugin-react` lazy import, optimizeDeps: react/react-dom/react-dom/client. Extensions: tsx,jsx,ts,js.
- vanilla → no plugin, no optimizeDeps. Extensions: ts,js.
- TODO: vue3, svelte5, solid.

## Pipeline

1. consumer module → `frontendService.registerEntry(this, { type, entry })` dans initialize()
2. kernel.onReady + env=development + autoStart → service.startDev()
3. startDev → generator.toMjs → writeFileSync → supervisor.start (spawn vite)
4. browser → controller rend HTML → TemplateHelper.renderTags injecte `<script>`
5. browser ↔ Vite direct (cors=true) sur port 5173 (ou suivant)
6. kernel.onTerminate → supervisor.stop → SIGINT + SIGKILL 3s

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
}
```

## Behaviors

- `vite.config.generated.mjs` overwrite à chaque startDev — ne jamais éditer.
- Port réel ≠ devPort si occupé — Vite incrémente, supervisor lit dans stdout.
- `@vitejs/plugin-react` chargé via `await import()` dans le preset — pas d'erreur si pas installé.
- Mode prod: `service.build()` → `vite.build(cfg)` in-proc (one-shot, OK).
- Logs Vite: `child.stdout.pipe → syslog` (pipeViteLogs=true) — natif flux OS.
- Cleanup: SIGINT puis SIGKILL après 3s. Évite zombies bloquant 5173.

## Errors

- `FrontendError` — base, code+context.
- `FrontendPresetUnknownError` — preset type non enregistré.
- `FrontendSupervisorStartError` — spawn/timeout/exit-before-ready.
- `FrontendNoEntriesError` — startDev sans registerEntry préalable.

## Commands CLI

- `nodefony frontend:dev` — start manual (si autoStart=false)
- `nodefony frontend:build` — vite.build() prod
- `nodefony frontend:status [-j]` — état supervisor + entries (consommé par Vision)

## Gotchas

- TemplateHelper.stripRoot strip "./frontend/" du entryFile pour URL Vite (`src/main.tsx`).
- `module.path` (Module class) requis pour résoudre les chemins absolus du consumer.
- Si `state !== "ready"` quand renderTags est appelé → commentaire HTML `<!-- vite supervisor state=... -->`.
- Container.get("frontend") = name passé au constructor Service (pas le className).

## API Vision (route /nodefony/frontend/* — Phase 10)

- GET /nodefony/frontend/api/status → JSON status (idem `frontend:status -j`)
- GET /nodefony/frontend/api/entries → list entries résolues
- POST /nodefony/frontend/api/restart → stop + startDev
- (TODO Phase 14.2 quand Vision MVP ✅)
