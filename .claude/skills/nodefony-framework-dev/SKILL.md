---
name: nodefony-framework-dev
metadata:
  version: 2.0.0
description: >
  Kit de dev du CŒUR backend de Nodefony : core (`nodefony`), `@nodefony/http` (pipeline, serveurs,
  WS, sessions), `@nodefony/framework` (Router, Controller, décorateurs) et les modules (services,
  stores, ORM). À charger DÈS qu'une tâche va ÉDITER du code backend, avant la première
  modification : porte les règles absolues (perf-mémoire, TS strict, lazy alloc, cleanup listeners,
  ALS), les conventions de structure/config, les recettes vérifiées au source, les gotchas et les
  RFC hors ligne. Déclencheurs : toute édition de code back — "modifier du code backend", "coder
  dans le kernel", "toucher au cœur ou au pipeline", "créer un service injectable/module/controller", "commande CLI",
  "entité/repository/adapter ORM", "store et pagination", "listPage/contrat IPage", "endpoint
  HTTP/WS ou data plane admin", "décorateur route", "@IsGranted/@Idempotent", "realtime/WebSocket",
  "firewall", "certificats TLS", "structure d'un module", "defineConfig",
  "où brancher ce comportement ?".
---

# nodefony-framework-dev — kit de dev du cœur (backend)

> **Référence de développement du back Nodefony pour tout agent IA / LLM.** Playbook **déterministe** :
> produis du code **perf, sûr, typé** sans ré-explorer les ~15 `CLAUDE.md`/`MEMORY.md` — signatures,
> chemins et recettes sont ici (corps) + dans `references/` (chargé à la demande).
>
> **MAINTENANCE (lire avant d'éditer ce skill)** : ce skill décrit la **vérité courante**, pas un journal.
> Mettre à jour = **éditer la section concernée en place**. **Pas de changelog ni de retex daté** ici —
> l'historique vit dans `git log`. Une leçon durable se **fond en règle** dans `references/gotchas.md`.
> Le **détail** (recettes longues, API, RFC) vit dans `references/*.md` (progressive disclosure) — garder
> ce fichier **< 500 lignes**. Avancement/phases/roadmap = `MIGRATION_STATUS.md` **uniquement**, jamais ici.

> **Périmètre** : front (full-stack côté client) → **`nodefony-frontend-dev`** (skill JUMEAU) ; app admin Studio spécifique (UI kit/Mantine) → `nodefony-studio-dev` (dérive de frontend-dev). Scaffolder un module
> neuf → **`nodefony-create-module`** (ici = comment CODER dedans). RFC/normes → `references/rfc/` (bundlé
> offline) + skill `nodefony-rfc` (full-text rare). Types TS / `@types/node` → §1 « Doc TypeScript ».
> Sécurité review/attaque → `nodefony-security-review`.

## 🔗 Paire POLYMORPHE back ⇄ front (co-évolution OBLIGATOIRE)

`nodefony-framework-dev` (back) et `nodefony-frontend-dev` (front) sont les **deux faces d'UN kit full-stack**
(isomorphisme Nodefony : back/front partagent `nodefony`). **Ce skill PRODUIT le CONTRAT** ; le jumeau le
**CONSOMME** (l'app Studio dérive de frontend-dev). Le SEAM partagé :

- **Data-plane** `/nodefony/<mod>/api/*` (back l'expose via `IAdminApi` → front via `useResource`/`ApiClient`). Recette → `references/framework.md`.
- **Realtime** : la **socket** (`IRealtimeSocket`) = la prise métier (multiplexe des canaux) ; le **hub** (`RealtimeHub`) = broker serveur (canaux partagés + fan-out). Recette → `references/realtime.md`.
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

| Besoin                                                        | Skill                                          |
| ------------------------------------------------------------- | ---------------------------------------------- |
| Scaffolder un module DANS UNE APP (workspace `modules/<nom>`) | **CLI** : `nodefony create module`             |
| Scaffolder un package `@nodefony/*` du REPO (src/packages/)   | `nodefony-create-module`                       |
| Module à front Vite (React/Vue/Angular) — repo                | `nodefony-create-frontend-module`              |
| Frontend Studio (page/dashboard/composant React)              | `nodefony-studio-dev`                          |
| Lancer la suite mémoire (avant commit pipeline)               | `nodefony-check-memory-health`                 |
| Démarrer/redémarrer le serveur dev                            | `nodefony-start-server`                        |
| Conformité RFC HTTP/WS/CORS/cookies                           | `nodefony-rfc`                                 |
| Revue sécurité du diff avant commit                           | `nodefony-security-review`                     |
| Typer un truc tordu (utility types, @types/node)              | §1 « Doc TypeScript / @types/node » ci-dessous |
| Charge / stress HTTP+WS                                       | `nodefony-load-test`                           |

**Déclencher EN PLUS pendant le dev (orchestration — ne pas coder « de mémoire » sur ces sujets)** :

| Dès que tu touches…                                                                | Déclenche AVANT/PENDANT                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| HTTP/HTTP2/WS, headers, status, CORS, cookies, framing                             | **`nodefony-rfc`** (vérifier la RFC EXACTE — IETF/W3C bruts) |
| un type tordu, une API Node (`node:*`, `NodeJS.Timeout`, streams), un utility type | **§1 « Doc TypeScript / @types/node »** (sources brutes)     |
| auth, crypto, secrets, validation d'entrée, surface d'attaque, header de sécurité  | **`nodefony-security-review`** + sources OWASP/ANSSI (§10)   |
| Kernel / Container / pipeline request / mémoire                                    | **`nodefony-check-memory-health`** (avant commit)            |
| l'impact d'un refactor : qui étend / implémente / importe ce symbole               | **`nodefony-inspect`** (index, pas `grep`)                   |

> Règle : sur RFC, types Node/TS, ou sécurité/vulns, **TOUJOURS** consulter la source/skill — ne jamais
> trancher de mémoire. Ces skills sont gratuits en tokens tant qu'ils ne se déclenchent pas.

### Doc TypeScript / `@types/node` — sources brutes (jamais `typescriptlang.org`)

Pour un type tordu ou une signature `@types/node` exacte, `curl` la source brute + `grep` ciblé
(raw GitHub, proxy `https://r.jina.ai/` devant si besoin — jamais le site HTML lourd) :

- **Utility types** (`Pick`, `Omit`, `ReturnType`, `Parameters`…) — `lib.es5.d.ts` :
  `https://raw.githubusercontent.com/microsoft/TypeScript/main/src/lib/es5.d.ts`
- **Handbook — Everyday Types** (interfaces vs types) :
  `…/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/handbook-v2/Everyday%20Types.md`
- **Handbook — Do's and Don'ts** (declaration files, overloads, unsound types) :
  `…/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/declaration-files/Do's%20and%20Don'ts.md`
- **`@types/node`** (types natifs) — DefinitelyTyped `master`, ex. HTTP :
  `https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/node/http.d.ts`
  (idem `globals.d.ts`, `http2.d.ts`, `stream.d.ts`, …).

> Ne jamais lire un `.d.ts` entier : `grep "type Pick"` / la définition précise. Une signature
> réutilisée → la condenser dans le `MEMORY.md` du module pour ne plus la relire.

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

- **Une commande CLI qui doit LIRE l'état de l'app se déclare `kernelEvent: "onPostReady"`, pas
  `"onReady"`.** Le plan d'administration (`adminBroker`) est peuplé PAR un écouteur de `onReady`
  (`Framework.onKernelReady`), et l'action d'une commande **intégrée** est branchée avant qu'un
  seul module n'existe : à `onReady` elle passe donc AVANT celui qui remplit le registre, et ne
  trouve rien. Aucun port ne s'ouvre pour autant — `Kernel.initServers` respecte
  `runProfile.servers` (défaut console `false`). Une commande de MODULE, elle, est branchée après
  les modules : pour elle `onReady` suffit.
- **Un flux `--json` se protège dans le CONSTRUCTEUR de la commande** (`cli.quietBoot = true`,
  gardé sur `process.argv`). Le syslog est branché au tout début de `Kernel.start()`, donc avant
  le moindre hook : demandé depuis `generate()`, le silence arrive après que le boot a déjà écrit
  sur la sortie standard, et un `| jq` casse sur la première ligne de log. Les sévérités ≤ 3
  partent sur la sortie d'erreur — elles restent visibles sans polluer le flux.
- **Ne JAMAIS réimplémenter une donnée qu'un `IAdminApi` produit déjà.** Un handler admin est une
  fonction pure `IAdminRequest → donnée` : on l'appelle directement
  (`broker.list()` → `adminEndpoints()` → `handler(req)`), CLI et HTTP rendent alors le même objet
  par construction. Corollaire : la redaction des secrets vit DANS les handlers, donc elle
  s'applique aussi en local — une porte CLI ne révèle rien de plus.
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
- **🔒 Le serveur ÉCRIT dans les sources → SUSPENDRE le superviseur dev, sinon il se tue lui-même.**
  En dev, le `DevSupervisor` (process **parent**) watch `src/`, `nodefony/`, `index.ts`, `config/`,
  `nodefony.config.ts`, `env.ts` (cf `isIgnoredWatchPath` : `node_modules`/`dist`/`tests`/`*.test.ts`/
  non-`.ts`/`frontend` — sauf le paquet `@nodefony/frontend` — sont ignorés) et **redémarre l'enfant**
  à chaque `.ts` touché. Or certaines opérations SERVEUR écrivent précisément là : génération de code
  (`create module` depuis Studio), migration, installation d'un module. Le redémarrage tombe alors **au
  milieu** et **tue le `npm install` en cours** (le process npm est un enfant du serveur) → `node_modules`
  à moitié écrit. **Règle** : toute opération serveur qui touche aux fichiers surveillés encadre son
  travail par `suspendSupervisor(root, raison, detail?)` / `resumeSupervisor(root)` (barrel `nodefony`,
  source `service/dev/devProcess.ts`) ; le superviseur **diffère** son rechargement (les fichiers restent
  dans `#dirty`, rien n'est perdu) et repart **à la levée** — le code généré est donc bien chargé.
  - La **raison est obligatoire** et s'affiche (`⏸ génération de code — rechargement différé`) : un
    rechargement qui ne part pas **sans explication** est un mystère pour celui qui édite.
  - `resumeSupervisor` va dans le point de sortie **UNIQUE** de l'opération (succès ET échec ET annulation).
  - Le verrou est **fail-safe** (`readSupervisorSuspension`) : il n'est retenu que si son **PID est vivant**
    (`kill(pid,0)`) et qu'il a **< 15 min** — un serveur tué en plein job laisse son fichier derrière lui,
    et un verrou orphelin muselleraît le rechargement _pour toute la session_, sans que rien ne l'explique.
    Dans le doute → « pas suspendu » (le watcher travaille). Verrouillé par `src/tests/supervisorLock.test.ts`.
  - Canal = **fichier** (`node_modules/.cache/nodefony/supervisor.lock`), pas un IPC : parent et enfant n'en
    ont pas (`stdio: [ignore, pipe, pipe]`), et c'est déjà le patron du pidfile / du state file runtime.

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

## 4. Recettes & référence — `references/` (chargé À LA DEMANDE)

> **Comment l'utiliser** : trouve la ligne qui matche ta tâche → lis le fichier `references/…` indiqué
> (lui seul → 0 token gaspillé). **1 fichier = 1 module** : Partie A recettes copier-coller (usage) +
> Partie B API publique + internals + gotchas du module (vérifiés sur le source). Mettre à jour = éditer
> en place (pas de journal). Autosuffisant : tout est ici, même sans le source du core (cas projet consumer).

| Ta tâche                                                                                                                                                                                            | Lis ce fichier                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Service injectable (DI `@inject`), Module+hooks, CLI, lazy/cleanup, ALS, config (`defineConfig`/`env`), interfaces, erreurs ; + API core (Kernel/Container/Event/Syslog/Finder)                     | `references/core.md`                                 |
| Endpoint HTTP/WS (Controller + `@Get`/`@Post`/`@route`), contrat RFC du cycle, certificats TLS, tests d'intégration ; + API/internals pipeline http (Context/Request/Response/sessions/trust-proxy) | `references/http.md`                                 |
| Router/Resolver/Route, décorateurs (`@IsGranted`/`@RequireScope`/`@Idempotent`/`@Csp`/`@CsrfProtect`…), **admin data plane** (`IAdminApi`/broker) + lien full-stack, vues (Eta)                     | `references/framework.md`                            |
| Entité `@entity`, Repository (contrat CRUD complet : `upsert`/`createMany`/`exists`/`increment`/`deleteOne`/`findOneAndDelete`…), Service CRUD, tx, data plane ORM, multi-dialecte                  | `references/orm.md`                                  |
| Realtime : socket isomorphe, WS, hub, `RealtimeService`, Redis backplane, pont TCP/UDP/SIP                                                                                                          | `references/realtime.md`                             |
| Coder AVEC la sécurité (sources normatives, `npm audit`)                                                                                                                                            | `references/security.md`                             |
| **Normes/RFC exactes** (HTTP/WS/cookies/CORS/auth/crypto) — bundle offline                                                                                                                          | `references/rfc/` (index `references/rfc/README.md`) |
| **Gotchas TRANSVERSES & diagnostic** (perf, ALS, boot, build ; reproduire un bug)                                                                                                                   | `references/gotchas.md`                              |
| **Conventions de STRUCTURE** : arborescence du dépôt, squelette d'un module, `package.json`/`exports`/`.d.ts`, `defineConfig`+`env.ts` de l'app, config d'un module en 2 fichiers                   | `references/conventions.md`                          |

> Review/attaque sécurité d'un diff (red/blue-team, conformité) → skill **`nodefony-security-review`**.
> RFC full-text rare (hors `references/rfc/`) → skill **`nodefony-rfc`** (raw GitHub + proxy r.jina.ai).

## 5. Gates qualité (AVANT commit — l'ordre compte)

> **Si tu as touché à un canal ou une méthode de plateforme** (`nodefony:*`) :
> `node scripts/check-platform-channels.mjs` — il refuse tout nom écrit EN DUR. Le namespace est un
> contrat partagé entre le serveur et le navigateur : une chaîne recopiée d'un côté dérive de
> l'autre sans que rien ne le dise.

```bash
# 1. BUILD (rolldown, par module modifié ; clean+build si pull/merge/refactor croisé)
cd src/packages/@nodefony/<mod> && npm run build          # ou : npm run build (turbo, racine)

# 2. TYPECHECK — gate DISTINCT du build (tsgo rejette ce que le build ne voit pas : ex TS18036)
npm run typecheck                                          # racine (turbo) — core a `tsc --noEmit`
npx tsc --noEmit                                           # ou direct dans le module ciblé

# 3. TESTS unitaires
#    core   : cd src/nodefony && npm run test                  (vitest)  | coverage = npm run coverage (vitest v8) — migré 2026-06-05
#    http/fw: cd src/packages/@nodefony/<mod> && npm run test   (vitest)  | coverage = npm run coverage (vitest)

# 4. INTÉGRATION (serveur requis 5151/5152 — cf nodefony-start-server)
cd src/packages/@nodefony/<mod> && npm run test:integration

# 5. 🚨 SUITE LOURDE — si modif Kernel / pipeline request / cycle de vie / mémoire (OBLIGATOIRE)
cd src/packages/@nodefony/http && npm run test:memory   # vitest (mocha SUPPRIMÉ) — ou skill nodefony-check-memory-health

# 5bis. 🗄️ MATRICE STORE — si modif d'un store de persistance / résolution / session / provisionUsers
#   Les tests UNIT sont backend-AGNOSTIQUES (drizzle teste sur :memory: interne, security sur stores
#   memory — ils ne lisent PAS NF_STORE) → 1 seule passe. La matrice memory vs sqlite se joue sur le
#   SERVEUR LIVE : relancer test:integration sous les DEUX backends.
NF_STORE=memory bash .claude/skills/nodefony-start-server/start.sh   # tout en memory
cd src/packages/@nodefony/http && npm run test:integration          # doit passer 100% (idem sqlite)
bash .claude/skills/nodefony-start-server/start.sh                   # défaut = sqlite (drizzle)
cd src/packages/@nodefony/http && npm run test:integration          # 100%
#   ⚠️ Un test qui assert un backend précis (ex. « brique X = drizzle / a une location .db ») CASSE
#   sous NF_STORE=memory → l'écrire backend-AGNOSTIQUE (assert les invariants vrais des deux côtés :
#   available⊇resolved ; resolved=drizzle ⇒ .db sous var/ ; resolved=memory ⇒ pas de location).
#   Coût RPS attendu (route authentifiée) : memory ≈ gratuit, sqlite ~2× plus lent (SELECT sync) →
#   protocole wrk dans le skill nodefony-load-test (§ Matrice store memory vs sqlite).

# 6. Symboles (régénérés par le hook pre-commit, mais utile manuellement)
npm run generate-symbols
```

- **Pourquoi typecheck séparé** : le bundler (oxc) ne type-check PAS — `tsgo --noEmit` rejette (TS18036
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
