---
name: nodefony-framework-dev
version: 2.0.0
description: >
  Kit de dev du CŒUR backend de Nodefony — core (`nodefony`), `@nodefony/http` (pipeline/serveurs/WS/
  sessions/certificats), `@nodefony/framework` (Router/Controller/décorateurs). Couvre : créer un service
  injectable, un module, une commande CLI, une entité/repository/adapter ORM, un endpoint HTTP/WS ou un
  data plane admin, et le realtime (WS natif + RealtimeService/hub TCP/UDP/Redis). Donne les RÈGLES
  ABSOLUES (perf-mémoire, TS strict, ESM, lazy alloc, cleanup listener, ALS), des recettes copier-coller
  vérifiées sur le source (dans `reference/`), les gotchas, les gates qualité et les RFC bundlées offline.
  Orchestre nodefony-rfc, nodefony-ts-docs, nodefony-security-review. Déclencheurs : "dev core", "coder
  dans le kernel", "pipeline http", "créer un service", "service injectable", "module hooks", "commande
  CLI", "controller nodefony", "décorateur route", "créer une entité", "repository", "adapter ORM",
  "endpoint data plane", "certificats TLS", "Core isomorphe", "realtime", "RealtimeService", "WebSocket",
  "firewall", "@IsGranted", "@Idempotent", "idempotence".
---

# nodefony-framework-dev — kit de dev du cœur (backend)

> **Référence de développement du back Nodefony pour tout agent IA / LLM.** Playbook **déterministe** :
> produis du code **perf, sûr, typé** sans ré-explorer les ~15 `CLAUDE.md`/`MEMORY.md` — signatures,
> chemins et recettes sont ici (corps) + dans `reference/` (chargé à la demande).
>
> **MAINTENANCE (lire avant d'éditer ce skill)** : ce skill décrit la **vérité courante**, pas un journal.
> Mettre à jour = **éditer la section concernée en place**. **Pas de changelog ni de retex daté** ici —
> l'historique vit dans `git log`. Une leçon durable se **fond en règle** dans `reference/gotchas.md`.
> Le **détail** (recettes longues, API, RFC) vit dans `reference/*.md` (progressive disclosure) — garder
> ce fichier **< 500 lignes**. Avancement/phases/roadmap = `MIGRATION_STATUS.md` **uniquement**, jamais ici.

> **Périmètre** : front (full-stack côté client) → **`nodefony-frontend-dev`** (skill JUMEAU) ; app admin Studio spécifique (UI kit/Mantine) → `nodefony-studio-dev` (dérive de frontend-dev). Scaffolder un module
> neuf → **`nodefony-create-module`** (ici = comment CODER dedans). RFC/normes → `reference/rfc/` (bundlé
> offline) + skill `nodefony-rfc` (full-text rare). Types TS → `nodefony-ts-docs`. Sécurité review/attaque
> → `nodefony-security-review`.

## 🔗 Paire POLYMORPHE back ⇄ front (co-évolution OBLIGATOIRE)

`nodefony-framework-dev` (back) et `nodefony-frontend-dev` (front) sont les **deux faces d'UN kit full-stack**
(isomorphisme Nodefony : back/front partagent `nodefony`). **Ce skill PRODUIT le CONTRAT** ; le jumeau le
**CONSOMME** (l'app Studio dérive de frontend-dev). Le SEAM partagé :

- **Data-plane** `/nodefony/<mod>/api/*` (back l'expose via `IAdminApi` → front via `useResource`/`ApiClient`). Recette → `reference/framework.md`.
- **Realtime** : la **socket** (`IRealtimeSocket`) = la prise métier (multiplexe des canaux) ; le **hub** (`RealtimeHub`) = broker serveur (canaux partagés + fan-out). Recette → `reference/realtime.md`.
- **Types** : exports `nodefony` (isomorphes) + `I*Controller`/`I*Api` = **source de vérité unique** du contrat (jamais une copie figée dans un skill → sinon dérive).

**RÈGLE** : une feature qui traverse back+front → mettre à jour **LES DEUX skills dans la MÊME session**.
Quand tu changes ici un **canal / action / endpoint / type** consommé par le front → vérifier/MAJ la
section correspondante de `nodefony-frontend-dev` (et inversement).

## 1. Quand l'utiliser / quand passer la main

**Utiliser** quand on touche :

- **core** (`src/nodefony`) : `Service`, `Container`, `Kernel`, `Module`, `CliKernel`, `Cli`/`Command`,
  `Injector`/DI, `Syslog`/`Pdu`, `RequestContext` (ALS), `Nodefony` façade, **lib client isomorphe**
  (`RealtimeClient`, subpaths `nodefony/client|react|roles|debugbar`).
- **pipeline http** (`@nodefony/http`) : `HttpKernel`, `Context`/`HttpContext`/`WebsocketContext`,
  `Request`/`Response`, serveurs, **certificats TLS** (`Certificate`/mkcert), `SessionsService`,
  `Profiler`, loggers/error-renderer, realtime WS JSON-RPC.
- **framework** (`@nodefony/framework`) : `Router`, `Resolver`, `Route`, `Controller`, décorateurs
  `@route`/`@controller`/`@Get`/`@Body`…, `AdminBroker`/data plane, vues Eta.
- créer un **service** (`@injectable`), une **commande CLI**, un **endpoint** HTTP/WS ou admin,
  une **entité** (`@entity`), un **repository**, un **service CRUD** (`AbstractCrudService`), un **adapter ORM**.

**Passer la main** :

| Besoin                                                             | Skill                             |
| ------------------------------------------------------------------ | --------------------------------- |
| Scaffolder un module vide (package.json/rollup/tsconfig/structure) | `nodefony-create-module`          |
| Module applicatif avec front Vite (React/Vue/Angular)              | `nodefony-create-frontend-module` |
| Frontend Studio (page/dashboard/composant React)                   | `nodefony-studio-dev`             |
| Lancer la suite mémoire (avant commit pipeline)                    | `nodefony-check-memory-health`    |
| Démarrer/redémarrer le serveur dev                                 | `nodefony-start-server`           |
| Conformité RFC HTTP/WS/CORS/cookies                                | `nodefony-rfc`                    |
| Revue sécurité du diff avant commit                                | `nodefony-security-review`        |
| Typer un truc tordu (utility types, @types/node)                   | `nodefony-ts-docs`                |
| Charge / stress HTTP+WS                                            | `nodefony-load-test`              |

**Déclencher EN PLUS pendant le dev (orchestration — ne pas coder « de mémoire » sur ces sujets)** :

| Dès que tu touches…                                                                | Déclenche AVANT/PENDANT                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| HTTP/HTTP2/WS, headers, status, CORS, cookies, framing                             | **`nodefony-rfc`** (vérifier la RFC EXACTE — IETF/W3C bruts) |
| un type tordu, une API Node (`node:*`, `NodeJS.Timeout`, streams), un utility type | **`nodefony-ts-docs`**                                       |
| auth, crypto, secrets, validation d'entrée, surface d'attaque, header de sécurité  | **`nodefony-security-review`** + sources OWASP/ANSSI (§10)   |
| Kernel / Container / pipeline request / mémoire                                    | **`nodefony-check-memory-health`** (avant commit)            |
| inspiration architecture (DI, guards, modules)                                     | **`nodefony-nestjs`** (mot-clé « NestJS » uniquement)        |

> Règle : sur RFC, types Node/TS, ou sécurité/vulns, **TOUJOURS** consulter la source/skill — ne jamais
> trancher de mémoire. Ces skills sont gratuits en tokens tant qu'ils ne se déclenchent pas.

## 2. 🚨 RÈGLES ABSOLUES (non négociables — priorité MAX)

### Perf & mémoire (LE blocker — toute alloc/listener/syscall compte)

- **Lazy alloc** : `null` par défaut + init au premier usage (`if (this._x === null) this._x = []`).
  JAMAIS `[]`/`new Map()` « au cas où » dans un constructeur de `Context` / hot path.
- **Hooks utilisateurs** : `null` par défaut, alloc array au 1ᵉʳ `register`, `null` à nouveau après fire.
- **Petite map < 16 entrées, accès ponctuel** : `Object.create(null)` plutôt que `Map`.
- **Listener = cleanup explicite** : tout `request.on`/`response.on`/`ws.on` attaché → prévoir le
  `removeListener` (ou `once` + cleanup manuel quand l'event jumeau finish/close est attendu).
- **Pas d'`async`/`await` pour du code synchrone** (microtasks coûtent). Pas de `JSON.stringify`/concat
  dans le hot path — différer au `send()`.
- **`performance.now()`** OK (~50 ns) mais 1 mesure début/fin, pas N dans une boucle.
- **APRÈS toute modif de `@nodefony/http`/`@nodefony/framework`/core pipeline → suite mémoire OBLIGATOIRE**
  AVANT commit (cf §8). Seuils blockers : **35 MB / 1000 req HTTP**, **10 MB / 100 crashes**,
  **30 MB / 100 WS**. Si ça saute → NE PAS commit, lazy + cleanup d'abord.
- Quantifier dans le commit si écart > 5 % : « 1000 req : Xms avant / Yms après, heap delta Z MB ».

### Doctrine Node « ne pas bloquer l'event-loop » (compléments officiels)

> Source canonique (proxy obligatoire, JAMAIS nodejs.org HTML direct) :
> `https://r.jina.ai/https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop`.
> 1 seul Event Loop + petit Worker Pool → **un callback lourd bloque TOUS les clients = DoS**.

- **Chaque callback borné O(1)/O(n)** (jamais O(n²) sur input user). CPU **< 1 ms** → sur l'event loop ;
  **lourd** → **partitionner** (`setImmediate` entre tranches) ou **offload Worker Pool** (`node:worker_threads`).
- **Pas d'API `*Sync`** sur l'event loop (`crypto.*Sync`/`pbkdf2Sync`, `zlib.*Sync`, fs sync, `child_process.*Sync`)
  → variantes async / streams. (Cf « Zéro I/O synchrone » ci-dessus.)
- **ReDoS = faille SÉCURITÉ** : pas de quantificateurs imbriqués `(a+)*`, pas d'alternance qui se chevauche
  `(a|a)*`, **jamais de backreference** `\1`. `indexOf` pour le simple ; `safe-regex` / RE2 (`node-re2`) pour
  tout **input non fiable**. (Aligne avec `nodefony-security-review`.)
- **JSON borné** : valider la **taille** avant `JSON.parse`/`stringify` (gros > ~10 MB → streaming). Borner
  les paramètres user (taille fichier, longueur, sortie crypto).
- **Worker Pool = variance minimale** : pas de tâche géante qui affame les autres ; **streams**
  (`fs.read`/`ReadStream`) au lieu de `readFile` pour les gros fichiers ; tranches de coût comparable.
- **Mesure = event-loop latency + p99 sous charge** (supervision `eventLoopMs` + skill `nodefony-load-test`),
  **PAS** un microbench à seuil dans la suite.

### Tests de PERF = isolés + opt-in (`RUN_PERF=1`)

- Un **microbench à seuil temporel** (`expect(elapsed).lessThan(Nms)`) ne mesure RIEN de fiable **dans la
  suite** : CPU non déterministe + event-loop chargé par les ~1300 tests précédents (machine chaude + GC)
  → faux échec (vécu : `extend 50k deep 536 ms` > 500 ms en suite, **162 ms isolé**).
- Le perf-skip (porté dans `vitest.setup.ts`, mocha SUPPRIMÉ) skippe les perfs **par défaut** (titres
  `… < Nms` ou describe `performance`) ; elles sont **OPT-IN** : `RUN_PERF=1 npm test` (+ toujours
  skippées en CI). → `npm test` est **déterministe** (0 faux failing). **Mesurer une perf = la lancer
  ISOLÉE** (`RUN_PERF=1 npx vitest run src/tests/Tools.test.ts`), jamais sur la suite chaude. **Ne PAS
  desserrer un seuil** pour masquer la contamination — corriger l'environnement de mesure, pas le seuil.

### TypeScript / ESM

- **0 `any`, 0 `@ts-ignore`** → `unknown` + narrowing. **ESM only** : `import`, jamais `require()`.
- **Préfixe `node:`** obligatoire : `import fs from "node:fs"`.
- **Named exports only** — pas de `default` (sauf legacy `export default Framework` déjà en place).
- **Interfaces préfixées `I`** : `IKernel`, `IService`, `IContext`.
- **TSDoc** sur chaque classe/interface/méthode publique non triviale (1ʳᵉ phrase auto-suffisante →
  extraite dans `.ai/symbols.json`).

### Pièges structurels du core

- **JAMAIS dérefencer le kernel au top-level** d'un fichier chargé à l'import (config.ts surtout) :
  `Nodefony.getKernel()` est `null` au moment de l'`import` → crash non-importable/non-testable.
  → **getter lazy** (`get filename() { return path.resolve((Nodefony.getKernel() as Kernel).path, …) }`)
  ou **guard** `Nodefony.getKernel()?.tmpDir?.path ?? "/tmp"`.
- **ALS + listeners différés** : tout listener attaché DANS la bulle `RequestContext.run()` mais qui
  fire plus tard (`message`/`close`/`finish`, timer, hook post-réponse) et qui lit l'ALS →
  **`AsyncResource.bind(fn)` au bind** (sinon `RequestContext.get()` = `undefined`). Le teardown HTTP
  est **hors** bulle ALS → y lire la réf sur le `context`, pas via `RequestContext.get()`.
- **Module hooks = méthodes prototype**, jamais arrow ni property initializer (`super()` tourne avant
  les initializers → un hook en property n'est pas encore défini quand `setEvents()` le wire).
- **`@nodefony/http` ne peut PAS importer `@nodefony/framework`** (cycle) → resolver via `(context as any)?.resolver`.
- **Zéro I/O synchrone dans le pipeline/boot** : `fs.lstatSync`/`readFileSync`/`existsSync` bloquent l'event-loop.
  `FileClass` a une voie **async** : `await FileClass.from(path)` (au lieu de `new FileClass` = `lstatSync`),
  `moveAsync`/`unlinkAsync` ; `Finder` stat en parallèle (`Promise.all`) + `checkPathAsync`. `Controller.getFile()`
  est `@deprecated` → `getFileAsync()`. Les `render*`/`stream*` sont async. Exception tolérée : un `mkdirSync`
  **idempotent au boot** hors hot path (ex. `tmp/` — cf BUG-CI-001, dossier gitignored absent en CI/pod frais).
- **`turbo run build` (et `clean && build`) NE busте PAS le cache turbo** : il restaure un `dist/` caché avec un
  mtime neuf → tu testes l'ANCIEN code (route qui hang, header périmé, export manquant). Avant tout test runtime
  d'un diff non commité : **`npx turbo run build --force --filter=@nodefony/http --filter=@nodefony/test`**.

### Sécurité (directive permanente — Nodefony = référence)

- Requêtes ORM **bindées** (jamais de concat SQL). **Secrets/credentials jamais loggés ni renvoyés en
  clair** (redaction côté serveur). **Zero Trust** : API admin exige un rôle → 403 sinon. JWT stateless
  cookie HttpOnly. Avant tout commit sensible → diff au skill **`nodefony-security-review`**.

## 3. Cartographie — qui vit où

```
nodefony (core, src/nodefony)        Service · Container(scopes) · Kernel · Module · CliKernel · Cli/Command
   │                                 Injector(DI) · Syslog/Pdu · Event · Nodefony · RequestContext(ALS)
   │                                 FileClass/Finder · nodefonyError · client isomorphe (nodefony/{client,react,debugbar,roles})
   ↓
@nodefony/http                       HttpKernel · Context/HttpContext/WebsocketContext · Request/Response
   │                                 serveurs(5151/5152) · SessionsService · Profiler · loggers
   ↓
@nodefony/framework                  Router · Resolver · Route · Controller · décorateurs · AdminBroker · vues Eta
   ↓
src/modules/test                     controllers d'intégration HTTP+WS

@nodefony/orm-core (LIB PURE)        IOrm/IEntity/IRepository/ITransaction · ormRegistry/entityRegistry
   ↑                                 @entity/@repository · AbstractCrudService · Criteria/FieldOperators
   └─ drivers (Modules) : @nodefony/drizzle (défaut SQL) · mongoose (NoSQL)  → auto-register au boot
      @nodefony/user (IUser/BaseUser/UserService) · session storage  consomment orm-core
```

**Règle dure** : `http` n'importe jamais `framework` (cycle). Le contrat admin est splitté exprès :
`IAdminApi`/`IAdminRegistry` dans le **core**, `IAdminBroker`/transport dans **framework**.

**Lookup zéro-token** (`.ai/symbols.json`, régénéré par hook pre-commit) AVANT de grep :

```bash
jq '.symbols.Container' .ai/symbols.json                       # définition
jq '.relations.extendedBy.Service' .ai/symbols.json            # qui étend Service
jq '.relations.implementedBy.IContainer' .ai/symbols.json      # qui implémente
jq '.relations.usedBy.Container' .ai/symbols.json              # qui importe
jq '.symbols | to_entries | map(select(.value.module=="@nodefony/http")) | from_entries' .ai/symbols.json
```

## 4. Recettes & référence — `reference/` (chargé À LA DEMANDE)

> **Comment l'utiliser** : trouve la ligne qui matche ta tâche → lis le fichier `reference/…` indiqué
> (lui seul → 0 token gaspillé). **1 fichier = 1 module** : Partie A recettes copier-coller (usage) +
> Partie B API publique + internals + gotchas du module (vérifiés sur le source). Mettre à jour = éditer
> en place (pas de journal). Autosuffisant : tout est ici, même sans le source du core (cas projet consumer).

| Ta tâche                                                                                                                                                                                            | Lis ce fichier                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Service injectable (DI `@inject`), Module+hooks, CLI, lazy/cleanup, ALS, config (`defineConfig`/`env`), interfaces, erreurs ; + API core (Kernel/Container/Event/Syslog/Finder)                     | `reference/core.md`                                |
| Endpoint HTTP/WS (Controller + `@Get`/`@Post`/`@route`), contrat RFC du cycle, certificats TLS, tests d'intégration ; + API/internals pipeline http (Context/Request/Response/sessions/trust-proxy) | `reference/http.md`                                |
| Router/Resolver/Route, décorateurs (`@IsGranted`/`@RequireScope`/`@Idempotent`/`@Csp`/`@CsrfProtect`…), **admin data plane** (`IAdminApi`/broker) + lien full-stack, vues (Eta)                     | `reference/framework.md`                           |
| Entité `@entity`, Repository (contrat CRUD complet : `upsert`/`createMany`/`exists`/`increment`/`deleteOne`/`findOneAndDelete`…), Service CRUD, tx, data plane ORM, multi-dialecte                  | `reference/orm.md`                                 |
| Realtime : socket isomorphe, WS, hub, `RealtimeService`, Redis backplane, pont TCP/UDP/SIP                                                                                                          | `reference/realtime.md`                            |
| Coder AVEC la sécurité (sources normatives, `npm audit`)                                                                                                                                            | `reference/security.md`                            |
| **Normes/RFC exactes** (HTTP/WS/cookies/CORS/auth/crypto) — bundle offline                                                                                                                          | `reference/rfc/` (index `reference/rfc/README.md`) |
| **Gotchas TRANSVERSES & diagnostic** (perf, ALS, boot, build ; reproduire un bug)                                                                                                                   | `reference/gotchas.md`                             |

> Review/attaque sécurité d'un diff (red/blue-team, conformité) → skill **`nodefony-security-review`**.
> RFC full-text rare (hors `reference/rfc/`) → skill **`nodefony-rfc`** (raw GitHub + proxy r.jina.ai).

## 5. Gates qualité (AVANT commit — l'ordre compte)

```bash
# 1. BUILD (rollup, par module modifié ; clean+build si pull/merge/refactor croisé)
cd src/packages/@nodefony/<mod> && npm run build          # ou : npm run build (turbo, racine)

# 2. TYPECHECK — gate DISTINCT du build (tsc rejette ce que rollup ne fait qu'AVERTIR : ex TS18036)
npm run typecheck                                          # racine (turbo) — core a `tsc --noEmit`
npx tsc --noEmit                                           # ou direct dans le module ciblé

# 3. TESTS unitaires
#    core   : cd src/nodefony && npm run test                  (vitest)  | coverage = npm run coverage (vitest v8) — migré 2026-06-05
#    http/fw: cd src/packages/@nodefony/<mod> && npm run test   (vitest)  | coverage = npm run coverage (vitest)

# 4. INTÉGRATION (serveur requis 5151/5152 — cf nodefony-start-server)
cd src/packages/@nodefony/<mod> && npm run test:integration

# 5. 🚨 SUITE LOURDE — si modif Kernel / pipeline request / cycle de vie / mémoire (OBLIGATOIRE)
cd src/packages/@nodefony/http && npm run test:memory   # vitest (mocha SUPPRIMÉ) — ou skill nodefony-check-memory-health

# 6. Symboles (régénérés par le hook pre-commit, mais utile manuellement)
npm run generate-symbols
```

- **Pourquoi typecheck séparé** : rollup tolère/avertit là où `tsc --noEmit` rejette (TS18036
  `static #x` + décorateur de classe a cassé toute la CI le 2026-05-22). Toujours typecheck avant push.
- **Filet local = hooks git** (posés 2026-05-22) : **pre-push** `tsc --noEmit`, **commit-msg** commitlint,
  **pre-commit** lint-staged (prettier-only) + pré-filtre symbols. eslint racine = `warn` (jamais
  bloquant au commit). Tout bypassable `--no-verify`.
- **Tests perf à seuil temporel** : ne gatent PAS la CI (runners non déterministes) → opt-in
  `RUN_PERF=1` (perf-skip porté dans `vitest.setup.ts`, mocha SUPPRIMÉ). Ne pas les « réparer », c'est voulu.
- `npm run build` (sans clean) ne recompile que les workspaces modifiés (cache turbo) → après
  pull/merge/changement d'`index.ts` public → `npm run clean && npm run build`.
- Vérif dist à jour : `grep -E "^export\s*\{" src/packages/@nodefony/<mod>/dist/index.js | head -1`.

## Réfs (CLAUDE.md/MEMORY.md — détails)

Core : `src/nodefony/{CLAUDE,MEMORY}.md` + sous-modules `src/{kernel,kernel/injector,cli,syslog,finder}/MEMORY.md` ·
http : `src/packages/@nodefony/http/{CLAUDE,MEMORY}.md` · framework : `…/framework/{CLAUDE,MEMORY}.md` ·
test : `src/modules/test/{CLAUDE,MEMORY}.md`.
Mémoires IA : `feedback_perf_memory_rule`, `feedback_security_rfc_rigor`, `project_als_ws_bug`,
`project_command_architecture`, `project_injection_plan`, `project_clikernel_lifecycle`,
`feedback_watch_rollup_pitfall`, `project_studio_page_playbook` (gabarit frontend).
