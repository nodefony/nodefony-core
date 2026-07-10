# CLAUDE.md — @nodefony/core workspace

> Workspace racine : `src/nodefony/` — exporte le module npm `nodefony` (NOT `@nodefony/core` — historique JS conservé).
> Pour audience IA en cours de session. Complète le [`MEMORY.md`](./MEMORY.md) (ultra-concis, internals) et le [`README.md`](./README.md) (humain).

## Rôle du workspace

`@nodefony/core` est le **socle** sur lequel reposent **tous les autres packages** : `@nodefony/http`, `@nodefony/framework`, `@nodefony/security`, `@nodefony/user`, ORM adapters, IA platform.

Il fournit :

| Brique                     | Fichier source                     | Rôle                                                                                                                 |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **`Service`**              | `src/Service.ts`                   | Classe de base de tout composant Nodefony (Kernel/Module/Controller/adapters ORM/etc.) — DI + EventEmitter + Logging |
| **`Container`**            | `src/Container.ts`                 | DI Container hiérarchique — services nommés, paramètres dot-notation, scopes par requête                             |
| **`Kernel`**               | `src/kernel/Kernel.ts`             | Orchestre boot, modules, lifecycle events                                                                            |
| **`Module`**               | `src/kernel/Module.ts`             | Classe de base d'un module Nodefony (suit le pattern `@Module` decorator)                                            |
| **`CliKernel`**            | `src/kernel/CliKernel.ts`          | Kernel spécialisé pour les commandes CLI (`nodefony development`, `nodefony build`, etc.)                            |
| **`Syslog` / `Pdu`**       | `src/syslog/`                      | Logger structuré RFC 5424 — ring buffer O(1), transports pluggables                                                  |
| **`Cli` / `Command`**      | `src/cli/` + `src/command/`        | Framework de commandes CLI (Commander wrapper + lifecycle hooks)                                                     |
| **`Nodefony`**             | `src/Nodefony.ts`                  | Façade statique (singleton) — `Nodefony.getKernel()`, `Nodefony.version`, `Nodefony.generateId()`                    |
| **`Event`**                | `src/Event.ts`                     | Étend `EventEmitter` Node.js — ajoute `fire()`, `fireAsync()`, `listen()`, `settingsToListen()`                      |
| **`FileClass` / `Finder`** | `src/finder/` + `src/FileClass.ts` | Wrapper fs + recherche de fichiers avec filtres                                                                      |
| **`Tools`**                | `src/Tools.ts`                     | Helpers utilitaires (`extend`, `typeOf`, `isArray`, `isPromise`, `isPlainObject`, `isFunction`, `isContainer`)       |
| **`nodefonyError`**        | `src/Error.ts`                     | Classe d'erreur étendue (anciennement `Error` — renommée pour éviter collision avec `globalThis.Error`)              |
| **`RequestContext`**       | `src/runtime/RequestContext.ts`    | Façade `AsyncLocalStorage` — propagation `requestId`/`user`/`traceparent` per-request (P1.4 ✅)                      |

## Décisions techniques figées

| Sujet              | Décision                                                     | Pourquoi                                                         |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Nom npm du package | **`nodefony`** (pas `@nodefony/core`)                        | Héritage JS — renommage cassant non envisagé                     |
| Module ESM         | **ESM only** — `import { X } from "nodefony"`                | Modern Node.js, tree-shaking                                     |
| Exports            | **Named only** — pas de `default` export                     | Compatibilité avec `preserveModules` + DX                        |
| Erreur             | **`nodefonyError`** (pas `Error`)                            | Collision avec `globalThis.Error` cassait les imports            |
| Singleton          | **`Nodefony.getKernel()`** (statique)                        | L'ancien export `kernel` direct cassait à l'init                 |
| Préfixe interfaces | **`I`** — `IService`, `IContainer`, `IKernel`, `IScope`      | Convention universelle pour ne pas confondre interface vs classe |
| Imports Node       | **Préfixe `node:`** obligatoire — `import fs from "node:fs"` | Standard ESM, dé-ambiguïse npm packages                          |
| TypeScript         | **Strict, zéro `any`, zéro `@ts-ignore`**                    | Sécurité du compilateur                                          |
| Tests              | **`vitest` 4 + `chai`** (migré 2026-06-05, ex-mocha)         | ESM-natif, esbuild, coverage v8 ; aligné sur tout le repo        |
| Bundler            | **`rolldown`** (`preserveModules: true`) + `.d.ts` par tsgo  | Per-module `.d.ts`, tree-shakeable                               |

## Ce qui est INTERDIT sans accord explicite (CLAUDE.md racine)

- ❌ Modifier `rolldown.config.ts`, `tsconfig.json`, `tsconfigClient.json`, `tsconfig.declarations.json`
- ❌ Modifier `package.json` (workspaces, scripts, deps)
- ❌ Supprimer des fichiers
- ❌ Changer la structure des dossiers
- ❌ Toucher à `bin/` (publication CLI)

## Règle perf+mémoire (CLAUDE.md racine — ABSOLUE)

Avant **TOUTE** modification dans `Service.ts`, `Container.ts`, `Kernel.ts`, `Syslog.ts`, `Event.ts` :

- Penser au coût par requête (allocations, appels système, listeners attachés)
- Pas d'allocation "au cas où" — préférer `null` + lazy init au premier usage
- Pas de listener sans `removeListener` correspondant
- Pas de Promise/async pour rien (microtasks coûtent)
- Pas de `JSON.stringify`/string concat dans le hot path sans nécessité

Après modification :

```bash
cd src/packages/@nodefony/http && TS_NODE_PROJECT=tsconfig.tests.json \
  npx mocha --config .mocharc.load.json --grep "Memory"
```

Si un seuil saute (35 MB / 1000 req HTTP, 30 MB / 100 WS) → c'est un **blocker**. NE PAS commit. Investiguer + lazy + cleanup avant de continuer.

## Structure du workspace

```
src/nodefony/
├── package.json              ← name: "nodefony" (pas @nodefony/core)
├── rolldown.config.ts          ← preserveModules + .d.ts per module
├── tsconfig.json             ← config build
├── tsconfig.declarations.json← config types
├── tsconfigClient.json       ← config browser-compat (P14.11 isomorphe — futur)
├── typedoc.json              ← config TypeDoc
├── CLAUDE.md                 ← ce fichier
├── MEMORY.md                 ← internals IA
├── README.md                 ← API publique humain
├── INJECTION_PLAN.md         ← plan migration injection (P4.5, Phase B/C/D/E)
├── bin/
│   └── nodefony              ← exécutable CLI (link vers dist/bin/nodefony.js)
├── dist/                     ← sortie rolldown (gitignored)
└── src/
    ├── index.ts              ← barrel ESM — re-exports publics
    ├── Service.ts            ← classe de base
    ├── Container.ts          ← DI container
    ├── Event.ts              ← EventEmitter étendu
    ├── Error.ts              ← nodefonyError
    ├── FileClass.ts          ← wrapper fs
    ├── Nodefony.ts           ← façade statique
    ├── Tools.ts              ← helpers
    ├── Cli.ts                ← façade CLI
    ├── bundler/              ← socle rolldown partagé — subpath publié `nodefony/bundler` (toutes les configs du repo + apps ; le core seul importe la source en relatif)
    ├── cli/                  ← Cli class + helpers (MEMORY.md, README.md)
    ├── command/              ← Command class + lifecycle
    ├── config/               ← config par défaut framework
    ├── finder/               ← FileClass + Finder (MEMORY.md, README.md)
    ├── kernel/               ← Kernel + Module + CliKernel (MEMORY.md, README.md)
    │   └── injector/         ← @injectable @inject décorateurs (MEMORY.md, README.md)
    ├── runtime/              ← RequestContext (ALS façade)
    ├── service/              ← services internes
    ├── client/               ← browser-compat stubs (P14.11 futur)
    ├── syslog/               ← Syslog + Pdu (MEMORY.md, README.md)
    │   └── transports/       ← console, file, JSON, etc.
    ├── tests/                ← tests vitest (+ vitest.setup.ts, vitest-mocha-shim.mjs)
    └── types/                ← interfaces (IKernel, IService, IContainer, ...)
```

## Cycle de boot type

```
1. CLI invocation : `npx nodefony development`
2. bin/nodefony.js → import { Nodefony, CliKernel } from "nodefony"
3. new CliKernel() — instance Kernel CLI
4. CliKernel.parseCommand(argv) — Commander parse
5. Command.onKernelStart() — hook pré-boot
6. Kernel.boot()
   ├── Charge config (config/dev|prod|test/*.ts)
   ├── Module discovery (manifeste config.modules, orchestré par le Kernel)
   ├── Service discovery (@injectable, @Service)
   ├── fire("onPreBoot") | fire("onBoot") | fire("onReady")
   └── Activate modules
7. Module instances créées via Container DI
8. Si Command est "server" → http-kernel démarre les serveurs
9. fire("onPostReady") — boot complet
```

## Sous-modules — index docs IA

| Sous-module            | CLAUDE.md | MEMORY.md | README.md | Focus                                                |
| ---------------------- | --------- | --------- | --------- | ---------------------------------------------------- |
| `src/syslog/`          | ⬜        | ✅        | ✅        | Syslog/Pdu, ring buffer, transports                  |
| `src/kernel/`          | ⬜        | ✅        | ✅        | Kernel lifecycle, Module hooks, CliKernel            |
| `src/kernel/injector/` | ⬜        | ✅        | ✅        | `@injectable`, `@inject`, scopes, circular detection |
| `src/cli/`             | ⬜        | ✅        | ✅        | Cli, Command, Commander, niceBytes, timers           |
| `src/finder/`          | ⬜        | ✅        | ✅        | FileClass, File, FileResult, Result, Finder          |

> Les CLAUDE.md de sous-modules pourront être créés au besoin. Pour l'instant, les `MEMORY.md` couvrent l'essentiel pour l'IA.

## Sujets transverses (cross-module)

### `RequestContext` (P1.4 ✅, AsyncLocalStorage)

Vit dans `src/runtime/RequestContext.ts`. Façade statique au-dessus de `AsyncLocalStorage` Node.js. Utilisé par `@nodefony/http` (`HttpKernel.handleHttp` + `handleWebsocket`) pour propager `requestId`/`user`/`scheme`/`traceparent` à travers tout le pipeline async sans threader manuellement.

**API** :

```typescript
RequestContext.run({ requestId, user, scheme }, async () => { /* code */ });
RequestContext.get();              // payload entier ou undefined
RequestContext.getRequestId();     // string | undefined
RequestContext.getUser();          // unknown | undefined
RequestContext.set("user", user);  // mute le store actuel
RequestContext.isProfiling();      // bool — buffer queries actif (dev profiler)
RequestContext.pushQuery({ sql, durationMs, rows?, connector? }); // no-op si !isProfiling
```

**Seam profiler ORM (`queries`)** : `HttpKernel.handleHttp` alloue `payload.queries: IProfilerQuery[]` **uniquement en dev** (profiler actif) ; les adapters ORM y poussent via `pushQuery()` (gratuit en prod = buffer absent). ⚠️ Ne PAS lire l'ALS depuis un callback détaché (pool ORM, listener) → `isProfiling()` y est faux ; capturer la réf du buffer dans le contexte valide (cf adapter Drizzle `#prof`).

**✅ BUGS résolus** (2026-05-20, cf [`../../BUG_REPORT.md`](../../BUG_REPORT.md)) :

- **BUG-001** : ALS WS messages — `AsyncResource.bind` sur `close`/`message` dans `WebsocketContext.connect()`
- **BUG-002** : ALS dans `onAfterResponse` HTTP+WS — `AsyncResource.bind(fn)` au register dans `Context.onAfterResponse`

**Règle dérivée** : tout listener EventEmitter attaché dans la bulle ALS mais qui fire plus tard
(message/close/finish, timers, hooks post-réponse) et qui doit lire l'ALS → `AsyncResource.bind()`
au moment du bind. P6 (security décorateurs isomorphes) débloqué.

### Pattern `@injectable` + `@inject` (DI)

Décorateurs dans `src/kernel/injector/`. Cf [`src/kernel/injector/MEMORY.md`](src/kernel/injector/MEMORY.md) pour internals (algorithme topologique, détection de cycles, scopes).

Phases d'évolution prévues (cf [INJECTION_PLAN.md](./INJECTION_PLAN.md) workspace racine) :

- Phase A : `@Inject` propriété ✅ partial
- Phase B : scoped/`AsyncLocalStorage` officiel ⬜
- Phase C : circular detection ⬜
- Phase D : registry module ⬜
- Phase E : lazy ⬜

### Logging structuré — Pdu

`Pdu` = unité de log (Process Data Unit, RFC 5424). Stocké dans `Syslog.buffer` (CircularBuffer O(1)). Severités :

| #   | Nom                       | Usage                    |
| --- | ------------------------- | ------------------------ |
| 0   | EMERGENCY                 | Système inutilisable     |
| 1   | ALERT                     | Action immédiate requise |
| 2   | **CRITIC** (pas CRITICAL) | Conditions critiques     |
| 3   | ERROR                     | Erreurs                  |
| 4   | WARNING                   | Conditions d'alerte      |
| 5   | NOTICE                    | Normal mais important    |
| 6   | INFO                      | Informationnel           |
| 7   | DEBUG                     | Debug                    |
| -1  | SPINNER                   | Animation CLI (non RFC)  |

⚠️ **"CRITIC" pas "CRITICAL"** — c'est le nom dans `SysLogSeverity`.

## Erreurs critiques à reconnaître

| Erreur                                        | Cause                              | Fix                                        |
| --------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `does not provide an export named 'default'`  | `import nodefony from "nodefony"`  | `import { Nodefony } from "nodefony"`      |
| `does not provide an export named 'Error'`    | `import { Error } from "nodefony"` | `import { nodefonyError } from "nodefony"` |
| `does not provide an export named 'kernel'`   | Ancien singleton supprimé          | `Nodefony.getKernel()`                     |
| `Container bad argument name` après `clean()` | `set()` appelé après clean         | Vérifier l'ordre lifecycle                 |
| `notificationsCenter not initialized`         | `nc=false` ou après `clean()`      | Ne pas appeler events après clean          |

## Lancer les tests du core

```bash
cd src/nodefony
npm run test           # vitest run — 1558 tests (perf opt-in skippés), 2026-06-05
npm run test:perf      # RUN_PERF=1 vitest run — inclut les microbenchs à seuil (non-déterministes)
npm run test:boot      # RUN_CLI_BOOT=1 vitest run — intégration CLI serveur réelle
npm run coverage       # vitest run --coverage (provider v8) → .coverage/
npm run build          # rolldown build + .d.ts tsgo
npm run clean          # supprime dist/
```

> Test runtime intégration : se lance depuis la racine du repo via `npx nodefony development` (cf skill `start-nodefony-server`).

> **Couverture** : `@vitest/coverage-v8` (provider v8 natif, config dans `vitest.config.ts`). ⚠️ **`c8` ne marche PAS** ici (full-ESM + Node 26 → `yargs` casse) ; **monocart retiré** le 2026-06-05 (migration vitest). Les tests `performance` sont skippés par défaut (port du root hook mocha dans `vitest.setup.ts`, OPT-IN `RUN_PERF=1`). Rapports : `.coverage/coverage-summary.json` + `lcov.info` (gitignored).

## Workflow de session typique sur le core

1. Lire [`CLAUDE.md`](../../CLAUDE.md) racine pour règles globales
2. Lire ce fichier (CLAUDE.md workspace)
3. Lire le `MEMORY.md` du sous-module ciblé
4. Modifier le code (TSDoc obligatoire sur classes/méthodes publiques nouvelles)
5. `npm run build` + `npm run test` (workspace)
6. Si modif `@nodefony/http`/`@nodefony/framework` pipeline → `memory.test.ts` obligatoire
7. Mettre à jour `MEMORY.md` + `README.md` du sous-module si API change
8. Commit local
