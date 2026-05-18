---
title: Audit isomorphisme Core Nodefony — P14.11
date: 2026-05-18
phase: P14.11 (ex-P13.3) — Core isomorphic export
status: 🔶 foundation déjà en place, build client cassé
---

# Audit isomorphisme `@nodefony/core` — état 2026-05-18

> Phase P14.11 — décision 2026-05-16 ([[project_decisions_realtime_isomorphic]]) : `@nodefony/client` n'est **pas** un module séparé. Le Core lui-même s'exporte côté browser via `exports.browser` du `package.json`.

## TL;DR

- ✅ Foundation déjà en place — entry point `src/nodefony/src/client/index.ts`, `package.json.exports.browser`, target Rollup `createClientConfig`.
- ❌ `dist/client/` non généré au dernier `npm run build` → bundle browser inutilisable en l'état.
- ⚠️ `cli-color` marqué external côté client → manquera dans le navigateur (à shimmer).
- ⚠️ Surface exportée minimale (Container, Service, Syslog, Pdu, Tools, Websocket, Storage). Pas encore d'API realtime ni de transport syslog `%c` browser.

## État du build

| Élément | État | Localisation |
|---|---|---|
| Entry point client | ✅ | `src/nodefony/src/client/index.ts` (re-export 7 symboles + uuid) |
| Subpath dossier client | ✅ | `src/nodefony/src/client/{api/Storage.ts, transport/websocket.ts, medias/audioApi.ts}` |
| `package.json.exports.browser` | ✅ | → `./dist/client/index.js` |
| `package.json.exports["./client"]` | ✅ | Subpath dédié |
| Rollup target client | ✅ | `createClientConfig` ligne 144 — `nodePolyfills()` + `nodeResolve({browser:true})` |
| `tsconfigClient.json` | ✅ | Config TS dédiée pour le bundle browser |
| `dist/client/index.js` généré | ❌ | **Manquant après dernier build** — à investiguer |
| Tests browser | ❌ | Aucun |

## Audit symboles — classification

> Méthode : `grep "from \"node:"` + scan transitif `process.|__dirname|Buffer.|require(|.cwd()` + chaîne d'imports.

### ✅ Pur isomorphe (zéro dépendance node:)

| Fichier | Notes |
|---|---|
| `syslog/Pdu.ts` | Aucun import — structure de log pure |
| `finder/Result.ts` | Importe `Pdu.Severity` (type) — OK |
| `types/*.d.ts` | Type-only — pas de runtime |

### ⚠️ Needs-adapter (importé par `client/index.ts` mais a chaîne node:)

| Fichier | Polyfill nécessaire |
|---|---|
| `Container.ts` | Cascade Syslog → polyfilled via `nodePolyfills()` |
| `Service.ts` | Cascade Event + Syslog |
| `Tools.ts` | Cascade Container |
| `Event.ts` | `node:events` → polyfilled automatiquement par `rollup-plugin-polyfill-node` |
| `Error.ts` | `node:assert`, `node:http` (STATUS_CODES), `node:util.inspect`, `cli-color` — polyfills auto sauf `cli-color` (external) |
| `syslog/Syslog.ts` | Cascade transports — variant browser ne doit inclure que ConsoleTransport |
| `syslog/transports/ConsoleTransport.ts` | **À adapter** : strip ANSI côté browser, transport `console.log("%c", ...)` CSS |
| `syslog/transports/index.ts` | Re-export — browser variant ne doit pas tirer File/Http/Syslog transports |

### ❌ Server-only (à exclure côté browser)

- `Cli.ts`, `bin/nodefony.ts` — CLI / binary
- `command/Builder.ts`, `command/Command.ts` — runner CLI
- `kernel/*` (Kernel, CliKernel, Module, decorators, injector, orm, commands/*) — boot Node
- `finder/File.ts`, `finder/Finder.ts`, `FileClass.ts` — node:fs
- `runtime/RequestContext.ts` — AsyncLocalStorage
- `service/babel/*`, `service/pm2Service.ts`, `service/rollup/rollupService.ts`, `service/watcherService.ts`, `service/fetchService.ts` (node-fetch)
- `syslog/transports/{FileTransport, HttpTransport, SyslogTransport}.ts`

### ✅ Browser-only déjà séparé

- `client/api/Storage.ts` — wrapper localStorage
- `client/transport/websocket.ts` — WS browser natif
- `client/medias/audioApi.ts` — WebAudio API

## Bloqueurs identifiés pour C (build browser)

1. **`dist/client/` non généré** — à diagnostiquer (peut-être `tsconfigClient.json` manquant ou cassé).
2. **`cli-color` externe non shimmé** — le browser ne sait pas résoudre `cli-color`. Choix : alias Rollup → stub vide, OU strip via plugin.
3. **`ConsoleTransport` actuel** — utilise probablement `cli-color` ANSI. Variant browser → CSS `%c` styling.
4. **Pas de test browser** — pas de validation que le bundle est utilisable dans Vite.

## Plan séquentiel pour les prochaines sessions

### C — Réparer build client (1-2h)
- Vérifier `tsconfigClient.json` (path, references)
- `rm -rf src/nodefony/dist && cd src/nodefony && npm run build`
- Si fail : analyser erreurs, ajuster external + polyfills
- Test : `ls src/nodefony/dist/client/index.js`
- Mesurer bundle size (cible < 50 KB gzip)

### D — Syslog browser-ready (1-2h)
- Stub `cli-color` côté browser (Rollup alias `cli-color` → `src/client/shim/cli-color.ts`)
- Adapter `ConsoleTransport` : path conditionnel ANSI/`%c` selon environnement (`typeof window !== "undefined"`)
- OU créer `BrowserConsoleTransport.ts` exporté uniquement via `client/index.ts`

### E — Validation dans Studio (30min)
- Studio importe `import { Syslog } from "@nodefony/core"` (auto-résolu vers browser variant via Vite)
- Test : logs Studio frontend → console formaté

### Plus tard
- `RealtimeClient` (actuellement dans Studio) → `src/nodefony/src/client/realtime/` (P14.11 suite)
- `ConnectionStepper` réel + chip topbar hub sub/unsub
- Page logs streaming (hack temp service syslog studio)

## Décisions figées (rappel)

- **PAS** de package séparé `@nodefony/client` — le Core lui-même est isomorphe.
- Bundle client target **< 50 KB minified gzippé**.
- API publique browser identique à back là où sémantiquement possible (Container, Service, Syslog, Pdu).
- Syslog ANSI = server-only → CSS `%c` côté browser.
- `node-fetch` interdit côté client (browser a `fetch` natif).

## Liens

- [[project_decisions_realtime_isomorphic]] — revirement 2026-05-16
- [[project_realtime_vision_studio_beta]] — Studio = beta testeur
- [[project_phase14_frontend_builder]] — P14 Vite + isomorphe
- `src/nodefony/src/client/index.ts` — entry point browser actuel
- `src/nodefony/rollup.config.ts:144` — `createClientConfig`
