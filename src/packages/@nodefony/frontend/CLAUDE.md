# CLAUDE.md — @nodefony/frontend

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (états supervisor, gotchas Vite, format config généré)
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet
- [`../http/CLAUDE.md`](../http/CLAUDE.md) — module HTTP (le controller backend rend l'index.html)
- [`../framework/CLAUDE.md`](../framework/CLAUDE.md) — Controller pour le rendu HTML

> **Branche POC `poc/frontend-child`** : le superviseur Vite est `ViteProcessSupervisor` (spawn child_process).
> **Branche POC `poc/frontend-single`** : le superviseur sera `ViteInProcSupervisor` (in-proc).
> SEUL `ViteProcessSupervisor.ts` diffère entre les deux branches.

## Rôle du module

Builder frontend de Nodefony — successeur du legacy `webpackService.js` (631 L).
Pilote Vite pour transpiler les frontends déclarés par chaque module :

```ts
{ frontend: { type: "react19", entry: "./frontend/src/main.tsx" } }
```

**Approche hybride découplée** (validée 2026-05-17 par audit perf) :

- Vite tourne en process séparé (child_process.spawn) → zéro impact event-loop backend
- Nodefony rend l'index.html lui-même via son moteur de templates
- Le HTML inclut `<script src="http://127.0.0.1:5173/...">` → navigateur ↔ Vite direct
- En prod : `nodefony frontend:build` → Vite compile → `manifest.json` lu par le template helper

## Structure des fichiers

```
src/packages/@nodefony/frontend/
├── index.ts                            ← class Frontend (Module) + exports publics
├── package.json                        ← peerDeps: vite, @vitejs/plugin-react
├── rollup.config.ts                    ← bundler — NE PAS MODIFIER
├── tsconfig.json                       ← NE PAS MODIFIER
└── nodefony/
    ├── config/config.ts                ← config default (devPort, host, autoStart)
    ├── command/
    │   ├── frontend-build.ts           ← `nodefony frontend:build`
    │   ├── frontend-dev.ts             ← `nodefony frontend:dev`
    │   └── frontend-status.ts          ← `nodefony frontend:status`
    ├── interfaces/                     ← IFrontPreset, IFrontBuilder, IViteSupervisor, IFrontendService
    ├── service/
    │   ├── FrontendService.ts          ← orchestrateur DI — @injectable
    │   ├── ViteProcessSupervisor.ts    ← spawn Vite (cette branche)
    │   └── ViteConfigGenerator.ts      ← écrit `vite.config.generated.mjs`
    └── src/
        ├── builders/ViteBuilder.ts     ← config Vite programmatique (mode build)
        ├── presets/
        │   ├── react19-vite.ts
        │   ├── vue3-vite.ts
        │   ├── angular-vite.ts
        │   └── vanilla-vite.ts
        ├── template/TemplateHelper.ts  ← inject `<script type="module">`
        └── errors/FrontendError.ts
```

## Pipeline complet

```
Module consumer (ex: @nodefony/test-frontend-react)
  └─ initialize() → frontendService.registerEntry(this, { type, entry, ... })
                       │
Kernel onReady (env=development + autoStart=true)
  └─ FrontendService.startDev()
        ├─ ViteConfigGenerator.toMjs(entries, "development") → string
        ├─ writeFileSync(`${moduleRoot}/vite.config.generated.mjs`, str)
        └─ ViteProcessSupervisor.start()
              ├─ spawn("npx", ["vite", "--config", "...", "--port", "5173"])
              ├─ pipe stdout/stderr → syslog Nodefony
              └─ parse "Local: http://..." → state = "ready"

Browser GET / (HTTP 5151)
  └─ Controller render index.html
        └─ inject frontendService.renderTags("test-frontend-react")
              → `<script src="http://127.0.0.1:5173/@vite/client">`
              → `<script src="http://127.0.0.1:5173/src/main.tsx">`

Browser parses HTML → fetch http://127.0.0.1:5173/src/main.tsx → Vite serves transpiled

Kernel onTerminate
  └─ FrontendService.stopDev()
        └─ child.kill("SIGINT") (puis SIGKILL si timeout)
```

## Décisions techniques figées

| Sujet                      | Décision                                                               |
| -------------------------- | ---------------------------------------------------------------------- |
| Builder                    | **Vite** — ESM natif, HMR rapide, cohérence Rollup backend             |
| Supervisor (cette branche) | `child_process.spawn("npx vite ...")` — process système isolé          |
| Config Vite                | Fichier `.mjs` GÉNÉRÉ au boot dans `${root}/vite.config.generated.mjs` |
| Plugins                    | Hardcodés dans le `.mjs` généré selon les preset types détectés        |
| Logs                       | `child.stdout.pipe → syslog Nodefony` (pas de sérialisation JSON)      |
| Cleanup                    | `SIGINT` puis `SIGKILL` timeout 3s — évite zombies bloquant 5173       |
| Multi-bundles              | **Une seule instance Vite multi-entry** (Rollup-style `input` map)     |
| Peer deps                  | `vite`, `@vitejs/plugin-react` (optional) — pas embarquées par défaut  |

## Mode prod (P14.5 ✅ 2026-05-24 — page blanche résolue)

- **Build** : `build()` appelle `vite.build()` **par entry** (chaque bundle = son `root`/`outDir`/`base`/`manifest` → multi-module + isolation Angular). In-proc, one-shot, pas de superviseur.
  - **Idempotent** : une entrée dont `outDir/.vite/manifest.json` est plus récent que ses sources est **ignorée** (`skipped`) → relance prod console rapide. `--force` rebuild tout.
  - **Erreurs collectées** : un bundle KO n'arrête pas les autres ; `failures[]` remonté → la commande met `process.exitCode = 1` (pipeline CI).
  - Scripts racine : `npm run build:front` (= `nodefony frontend:build`) · `npm run build:all` (backend turbo + front).
  - ⚠️ CLI `nodefony frontend:build` = bug pré-existant `unknown command` (cf mémoire `project_cli_commands_broken_claude_ts`) → en attendant, `build:all` ou fix CLI séparé.
- **Rendu** : `TemplateHelper.renderProdTags()` lit `outDir/.vite/manifest.json` (caché par outDir, 0 relecture disque/req) → `<link rel="stylesheet">` (CSS récursif) + `<link rel="modulepreload">` (imports) + `<script type="module" crossorigin>`, **préfixés par `publicPath`**. Manifest absent → commentaire HTML (pas de crash).
- **Service statique** : en prod (`env !== "development"`), `FrontendService.setupProd()` (hook `onServersReady`) monte chaque `outDir` sur son `publicPath` via `container.get("server-static").addMount(prefix, dir)` — **résolu par nom** (anti-cycle, pas d'import `@nodefony/http`). Cloud-native (nginx/haproxy/CDN frontal) = Phase 16, bascule via `publicPath` sans toucher `renderProdTags`.

### Coquille templatable (2026-05-24) — plus de shell hardcodé

- `renderDocument(entry)` : lit l'`index.html` **du module** (le dev y met meta/polices/externals) + injecte les tags (marqueur `<!--nodefony:frontend-->` ou avant `</head>`) + retire le `<script>` d'entrée source. `StudioController.renderStudio` = `this.render(svc.renderDocument("studio"))`.
- Helpers template (style Symfony `encore_entry_script_tags`), même source `renderTags`/`renderDocument` :
  - **Twig** `{{ frontend_tags('studio')|raw }}` / `{{ frontend_document('studio')|raw }}` (via `twig.extendFunction`, échappe → `|raw`).
  - **EJS** `<%- frontendTags('studio') %>` / `<%- frontendDocument('studio') %>` (injecté dans les locals par `Controller.withFrontendLocals`, `<%-` = brut).

### `publicPath` — concept pivot (aligne 3 pièces)

Défaut `/_assets/<entryName>/` (surchargeable via `frontend.publicPath`). Sert de : `base` Vite au build · mount prefix de `Statics` (guard `startsWith` O(1) + strip) · préfixe des URLs émises par `renderProdTags`. → les trois restent cohérents par construction.

## Gotchas

- **`vite.config.generated.mjs` overwrite** : régénéré à CHAQUE `startDev()`. Ne JAMAIS éditer manuellement.
- **Port Vite réel ≠ port configuré** : si 5173 occupé, Vite incrémente. Le superviseur parse `Local:` pour récupérer le port réel.
- **`@vitejs/plugin-react` paresseux** : chargé via `await import()` dans le preset → pas d'erreur si pas installé tant qu'aucun module ne déclare `type: "react19"`.
- **PathRoot vs entryFile** : `entryFile` est relatif au root du module (ex: `./frontend/src/main.tsx`), `root` est la racine front (ex: `./frontend`). Le TemplateHelper retire le root pour produire l'URL Vite (`/src/main.tsx`).
- **`emitDecoratorMetadata` requis** : Service injectable via `@injectable()` — sans `experimentalDecorators` + `emitDecoratorMetadata`, la DI ne résout pas.
- **Pas de `@nodefony/framework` en dep dure** : framework dépend de http qui peut dépendre de frontend → on garde frontend en bout de chaîne, sans import framework.

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` ou `tsconfig.json`
- Ajouter `vite` aux `dependencies` (doit rester `peerDependencies` — taille)
- Importer `@nodefony/framework` ou `@nodefony/http` (cycles potentiels via app config)
- Remplacer `child_process.spawn` par `worker_threads` (testé/rejeté — sérialisation logs explose)

## Roadmap

| Étape | Statut | Description                                                                      |
| ----- | ------ | -------------------------------------------------------------------------------- |
| MVP   | ⏳     | POC child_process vs single — mesure perf p99                                    |
| 14.2  | ✅     | TemplateHelper prod (manifest.json injection) — 2026-05-24, page blanche résolue |
| 14.3  | ⏳     | Multi-bundles validation (admin + shop + dashboard)                              |
| 14.4  | 🟡     | Presets Vue3 ✅ + Angular ✅ (2026-05-20) — Svelte5/Solid restants               |
| 14.5  | ⏳     | `nodefony frontend:create <module> <preset>` scaffold                            |
| 14.6  | ⏳     | HMR cross-module (lien avec `watcherService.register`)                           |
