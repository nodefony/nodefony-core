---
name: nodefony-framework-dev
version: 1.17.0
description: >
  Kit de dev du CŒUR (backend) de Nodefony : core (nodefony), @nodefony/http (pipeline/serveurs/WS/
  sessions/certifs), @nodefony/framework (Router/Controller/décorateurs) ; créer service, module,
  commande CLI, entité, repository, adapter ORM, endpoint HTTP/WS ou admin. Donne les RÈGLES ABSOLUES
  (perf-mémoire, TS strict, ESM, lazy alloc, cleanup listener, ALS, pas de deref kernel top-level), des
  recettes copier-coller vérifiées sur le source, les gates qualité (build/typecheck/tests/mémoire) et
  la cartographie. Couvre le realtime (WS natif + RealtimeService/IRealtimeHub TCP/UDP/Redis/SIP) et sait
  QUOI construire pour le non-fait (roadmap MIGRATION_STATUS + design figé, ex. P6 Security). Orchestre
  nodefony-rfc, nodefony-ts-docs, nodefony-security-review (OWASP/ANSSI), nodefony-check-memory-health.
  NE couvre PAS le frontend Studio (→ nodefony-studio-dev) ni le scaffold from scratch (→ nodefony-create-module).
  Déclencheurs : "dev core", "coder dans le kernel", "pipeline http", "créer un service", "service
  injectable", "module hooks", "command CLI", "controller nodefony", "décorateur route", "créer une
  entité", "repository", "adapter ORM", "endpoint data plane", "certificats TLS", "Core isomorphe",
  "RealtimeClient", "realtime", "TCP UDP", "RealtimeService", "P6 security", "firewall", "@IsGranted",
  "roadmap", "que reste-t-il à faire".
---

# nodefony-framework-dev — kit de dev du cœur (backend) pour agent IA

> **v1.17.0** · kit **VIVANT & VERSIONNÉ** — enrichi à CHAQUE session cœur (boucle d'auto-amélioration : cf §12).
> Versionné par git (history du fichier) + changelog interne (fin du doc) + SemVer en frontmatter.

Playbook **déterministe** pour développer le **cœur** de Nodefony : `nodefony` (core), `@nodefony/http`,
`@nodefony/framework`, et tout module/service/commande/adapter serveur. Produis du code **perf,
sûr, typé** sans ré-explorer les ~15 `CLAUDE.md`/`MEMORY.md` : signatures, chemins et recettes sont ici.

> Frontend Studio (React) → **`nodefony-studio-dev`**. Scaffolder un module neuf → **`nodefony-create-module`**
> (ce skill couvre comment CODER dedans, pas le squelette). Doc RFC → `nodefony-rfc`. Types TS → `nodefony-ts-docs`.

## 🔗 Paire POLYMORPHE back ⇄ front (co-évolution OBLIGATOIRE)

`nodefony-framework-dev` (back) et `nodefony-studio-dev` (front) sont les **deux faces d'UN kit full-stack**,
à l'image de l'isomorphisme Nodefony (back/front partagent `nodefony`). **Ce skill = produire le CONTRAT** ;
`nodefony-studio-dev` = le **consommer**. Le SEAM partagé :

- **Data-plane** `/nodefony/<mod>/api/*` (back l'expose via `IAdminApi` → front via `useResource`/`ApiClient`).
- **Realtime** : la **socket** (`IRealtimeSocket`) = la prise que tient le métier (multiplexe des canaux) ; le **hub** (`RealtimeHub`, framework) = broker serveur (canaux PARTAGÉS + fan-out). Back : `RealtimeController` délègue au hub ; canaux out via `createRealtimeChannel`, **entrants gated** via `realtimeInbound()` (SIP/bridge).
- **Types** : exports `nodefony` (isomorphes) + `I*Controller`/`I*Api` = **source de vérité unique** du contrat
  (jamais une copie figée dans un seul skill — sinon dérive contrat ↔ conso).

**RÈGLE DE CO-ÉVOLUTION (les skills « dev ensemble »)** : une feature qui traverse back+front →
**mettre à jour LES DEUX skills dans la MÊME session**, retex cross-liés (même apprentissage, 2 angles).
Quand tu changes ici un **canal / action / endpoint / type** consommé par le front → vérifier/MAJ la section
correspondante de `nodefony-studio-dev` (et inversement). Ouvrir le skill jumeau dès qu'une feature touche son côté.

**VERSION COMMUNE (lockstep)** : les deux skills partagent **UNE même version SemVer** (frontmatter) =
snapshot cohérent du contrat full-stack. **Bumper LES DEUX au même numéro** à chaque co-évolution
(même si un seul fichier change beaucoup, l'autre suit au minimum d'un patch + ligne changelog). Actuel : **1.16.1**
(session BACKEND : **durcissement framework F1+F4** — purge des `any` de dette (Controller/Resolver/Route/
décorateurs, idiomes mixins documentés) + couverture unit Controller 22→80 % / Resolver +newController ;
doc du **hook `initialize()`** (per-request, opt-in) ajoutée ci-dessous ; aucun contrat front touché →
`studio-dev` suit en lockstep **back-only**).

## 1. Quand l'utiliser / quand passer la main

**Utiliser** quand on touche :

- **core** (`src/nodefony`) : `Service`, `Container`, `Kernel`, `Module`, `CliKernel`, `Cli`/`Command`,
  `Injector`/DI, `Syslog`/`Pdu`, `RequestContext` (ALS), `Nodefony` façade, **lib client isomorphe**
  (`RealtimeClient`, subpaths `nodefony/client|react|roles|debugbar`).
- **pipeline http** (`@nodefony/http`) : `HttpKernel`, `Context`/`HttpContext`/`WebsocketContext`,
  `Request`/`Response`, serveurs, **certificats TLS** (`Certificate`/mkcert), `SessionsService`,
  `Profiler`, loggers/error-renderer, realtime WS JSON-RPC.
- **framework** (`@nodefony/framework`) : `Router`, `Resolver`, `Route`, `Controller`, décorateurs
  `@route`/`@controller`/`@Get`/`@Body`…, `AdminBroker`/data plane, Twig/EJS.
- créer un **service** (`@injectable`), une **commande CLI**, un **endpoint** HTTP/WS ou admin,
  une **entité** (`@entity`), un **repository**, un **service CRUD** (`AbstractCrudService`), un **adapter ORM**.

**Passer la main** :
| Besoin | Skill |
| ------ | ----- |
| Scaffolder un module vide (package.json/rollup/tsconfig/structure) | `nodefony-create-module` |
| Module applicatif avec front Vite (React/Vue/Angular) | `nodefony-create-frontend-module` |
| Frontend Studio (page/dashboard/composant React) | `nodefony-studio-dev` |
| Lancer la suite mémoire (avant commit pipeline) | `nodefony-check-memory-health` |
| Démarrer/redémarrer le serveur dev | `nodefony-start-server` |
| Conformité RFC HTTP/WS/CORS/cookies | `nodefony-rfc` |
| Revue sécurité du diff avant commit | `nodefony-security-review` |
| Typer un truc tordu (utility types, @types/node) | `nodefony-ts-docs` |
| Charge / stress HTTP+WS | `nodefony-load-test` |

**Déclencher EN PLUS pendant le dev (orchestration — ne pas coder « de mémoire » sur ces sujets)** :
| Dès que tu touches… | Déclenche AVANT/PENDANT |
| ------------------- | ----------------------- |
| HTTP/HTTP2/WS, headers, status, CORS, cookies, framing | **`nodefony-rfc`** (vérifier la RFC EXACTE — IETF/W3C bruts) |
| un type tordu, une API Node (`node:*`, `NodeJS.Timeout`, streams), un utility type | **`nodefony-ts-docs`** |
| auth, crypto, secrets, validation d'entrée, surface d'attaque, header de sécurité | **`nodefony-security-review`** + sources OWASP/ANSSI (§10) |
| Kernel / Container / pipeline request / mémoire | **`nodefony-check-memory-health`** (avant commit) |
| inspiration architecture (DI, guards, modules) | **`nodefony-nestjs`** (mot-clé « NestJS » uniquement) |

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
- Le root-hook `src/tests/perf-skip.cjs` skippe donc les perfs **par défaut** (titres `… < Nms` ou describe
  `performance`) ; elles sont **OPT-IN** : `RUN_PERF=1 npm test` (+ toujours skippées en CI). → `npm test`
  est **déterministe** (0 faux failing). **Mesurer une perf = la lancer ISOLÉE** (`RUN_PERF=1 npx mocha
src/tests/Tools.test.ts`), jamais sur la suite chaude. **Ne PAS desserrer un seuil** pour masquer la
  contamination — corriger l'environnement de mesure, pas le seuil.

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
@nodefony/framework                  Router · Resolver · Route · Controller · décorateurs · AdminBroker · Twig/EJS
   ↓
src/modules/test                     controllers d'intégration HTTP+WS

@nodefony/orm-core (LIB PURE)        IOrm/IEntity/IRepository/ITransaction · ormRegistry/entityRegistry
   ↑                                 @entity/@repository · AbstractCrudService · Criteria/FieldOperators
   └─ drivers (Modules) : @nodefony/drizzle (défaut SQL) · sequelize · mongoose  → auto-register au boot
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

## 4. Recettes + squelettes (copier-coller)

### Service injectable (DI)

```typescript
import { injectable, inject, Service } from "nodefony";

@injectable({ singleton: true, name: "user-service" }) // défaut scope=singleton
export class UserService extends Service {
  // ⚠️ tsx (tests) n'émet PAS design:paramtypes → TOUJOURS nommer @inject explicitement
  constructor(
    @inject("database") private db: Database,
    @inject("syslog") private log: Syslog,
  ) {
    super("user-service");
  }
  async findById(id: string): Promise<IUser | null> {
    this.log.log(`lookup ${id}`, "DEBUG");
    return this.db.query<IUser>("SELECT * FROM users WHERE id = ?", [id]); // bindé
  }
}
```

- `@inject("x")` (minuscule) = **paramètre ctor** (`inject:services` sur le constructeur).
- `@Inject("x")` (Majuscule) = **propriété** post-ctor (`inject:properties` sur le **prototype**),
  `private x!: T` (definite assignment ; `undefined` pendant `super()`). Confondre les deux = bug silencieux.
- Singleton déjà dans `kernel.get(name)` → court-circuit (pas de réinstanciation). `"transient"` → toujours new.
- Récup runtime : `kernel.get<UserService>("user-service")`.
- Sévérités log : `EMERGENCY ALERT CRITIC(!=CRITICAL) ERROR WARNING NOTICE INFO DEBUG` (+ `SPINNER=-1`).

### Logging (`Service.log` — tout service en hérite)

```typescript
this.log(payload, "INFO"); // → retourne un Pdu
this.log(err, "ERROR", "AUTH", "login failed"); // (payload, severity, msgid?, msg?)
this.spinlog("Chargement…"); // SPINNER (-1, non bufferisé)
```

- Sévérités (enum `SysLogSeverity`) : `EMERGENCY(0) ALERT(1) CRITIC(2) ERROR(3) WARNING(4) NOTICE(5)
INFO(6) DEBUG(7) SPINNER(-1)`. ⚠️ **`CRITIC`, jamais `CRITICAL`**. `pdu.severity`=number, `pdu.severityName`=string.
- `msgid` = catégorie (`"HTTP-KERNEL"`, `"ROUTER"`, `"FIREWALL"`…). Format console : `HH:MM:SS.mmm SEV MSGID : payload`.
- Ne **jamais** logger après `clean()` (syslog null → Pdu standalone perdu). Filtrage = AVANT `fire("onLog")` (CPU).
- Greps : strip ANSI `sed 's/\x1b\[[0-9;]*m//g'` (ou skill `nodefony-tail-error-logs`).
- **Sink = driver enfichable** (env `file`/`null`/`stdout-pipe`) : `FileSink` **async par défaut** (jamais bloquer
  l'event-loop sur disque lent), `sync` opt-in. **Invariant** : un fatal (sévérité ≤ 3) part en `writeSync` immédiat
  → jamais perdu au `SIGKILL`. Levier perf = coalescence (ring+tick), pas le fd-par-worker.

### Module (hooks lifecycle)

```typescript
import { Module, services } from "nodefony";

@services([UserService, MailerService]) // → enregistrés en onPreBoot
export class MyModule extends Module {
  static readonly path: string = import.meta.url; // OBLIGATOIRE (sert setPath)

  // hooks = méthodes PROTOTYPE (jamais arrow/property)
  async onKernelRegister(): Promise<this> {
    return this;
  } // kernel.once("onRegister")
  async onKernelBoot(): Promise<this> {
    return this;
  } // kernel.once("onBoot")
  async onKernelReady(): Promise<this> {
    return this;
  } // kernel.once("onReady")
}
```

- `@modules([...])` → `onPreRegister` · `@services([...])` → `onPreBoot` (erreurs **catchées**+log,
  boot continue → vérifier `container.has("x")`) · `@entities([...])` → `onBoot`.
- Le ctor `Module` attache **toujours** 1 listener (`onBoot` → service `rollup`) même sans hook : normal.
- `onKernelBoot` = bon endroit pour s'enregistrer comme **producteur admin** ou **storage de session**.

### Commande CLI

```typescript
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onReady",
};
// kernelEvent = phase attendue avant generate() : onPostReady(serveurs prêts) | onReady(services) |
//               onBoot(modules) | onPreStart(quasi rien). Défaut "onPostReady".

export class RoutesListCommand extends Command {
  constructor(cli: CliKernel) {
    super("http:routes:list", "Liste les routes", cli, options); // namespace <module>:<action>
    this.alias("routes");
    this.addOption("--json", "Sortie JSON");
  }
  override async onKernelStart(): Promise<void> {
    // AVANT Kernel.boot — config env/type
    (this.cli as CliKernel).setType("CONSOLE");
  }
  override async generate(opts: { json?: boolean }): Promise<this> {
    // APRÈS la phase kernelEvent
    // ⚠️ Commander passe l'instance Cmd en DERNIER arg → generate(userArg, cmd)
    return this;
  }
}
// enregistrement module : module.addCommand(RoutesListCommand) — nécessite kernel.cli != null
```

- `CliKernel extends Cli` (PAS Kernel). `this.environment` est **`undefined` au constructeur** →
  conditionner dans `onKernelStart()`, jamais dans le ctor. Ne PAS rappeler `setCommandVersion()`
  (le ctor `Cli` ajoute déjà `-v`). Built-in : Start/Dev/Build/Prod/Staging/Install/Outdated/Pm2(deprecated)/Kill.

### CLI — exécution & commandes (vue d'ensemble)

```bash
npx nodefony development          # DevCommand (alias `dev`) → DevSupervisor auto-restart
npx nodefony production --no-daemon   # foreground in-process (sans PM2 — cloud-native)
npx nodefony build               # rollup tous workspaces · npx nodefony --help / --version
npx nodefony <module>:<action>   # commande de module (ex. http:routes:list) — namespace obligatoire
```

- **2 modes** : _standalone_ (`Command.action()` → `run()` → `generate()`, sans kernel) ; _kernel_
  (`setEvents()` → `kernel.once(kernelEvent, action)`). `kernelEvent` = phase attendue avant `generate()` :
  `onPostReady`(serveurs prêts, défaut) / `onReady`(services) / `onBoot`(modules) / `onPreStart`(quasi rien).
- **Lifecycle** : ctor `addCommand` → `onKernelStart()` (pré-boot : env/type/packageManager) → `kernel.start()`
  → `generate(opts, cmd)` (⚠️ Commander passe l'instance `Cmd` en **dernier** arg). `setEvents()` idempotent (guard `eventsRegistered`).
- **Module CLI** : `module.addCommand(Ctor)` (nécessite `kernel.cli != null`). Namespace `<module>:<action>`
  (`security:user:add`, `orm:migrate`). ⚠️ **Commandes de module cassées sur claude-ts** (bug pré-existant,
  mémoire `project_cli_commands_broken_claude_ts`) → brancher dans une branche dédiée, Phase 11 non finalisée (0 test d'intégration).
- Helpers `Cli` : `niceBytes` (`1024`→`"1.0 KB"`), timers (`startTimer`/`stopTimer`), `setProcessTitle`, banner.
  Réf : `src/nodefony/src/{cli,command,kernel}/{CLAUDE,MEMORY}.md`.

### Endpoint HTTP/WS (Controller + décorateurs)

```typescript
import { Controller } from "@nodefony/framework";
import {
  controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  Header,
} from "@nodefony/framework";

@controller("/api/things")
export class ThingsController extends Controller {
  @Get("/") // requirements.methods=["GET"]
  list(@Query("limit") limit?: string) {
    return this.renderJson({ things: [] });
  }

  @Get("/{id}") // {id} = mono-segment [^/]+
  one(@Param("id") id: string) {
    return this.renderJson({ id });
  }

  @Post("/")
  @HttpCode(201)
  create(@Body() dto: ICreateThing) {
    return this.renderJson(dto);
  }
}
```

- **Lire la requête par décorateurs** : `@Body()`/`@Body("f")`, `@Param("x")`, `@Query("x")`, `@Header("x")`.
  ⚠️ **`this.context.body` est VIDE/non parsé** → un POST lu ainsi tombe sur le défaut en silence.
- En-têtes bruts : `this.context.request.headers.authorization` (clé **minuscule**, peut être `string|string[]`).
- `@Redirect("/url", 302)`. `redirect()` : whitelist RFC 9110 §15.4 `{301,302,303,307,308}`, **défaut = 302** (Found) ; code hors liste → fallback 302 + WARNING. 307/308 **préservent** méthode+corps, 303 force GET ; 301/302 peuvent muter POST→GET. (F5 2026-05-30 : avant, tout ≠ 302 était écrasé en 301 = bug fonctionnel.) Réponses : `renderJson` / `renderView`/`renderTwig`/`renderEjs` / `forward("mod:ctrl:action")`.
- **Vhosting** : `@Domain("regexp"|["a","b"])` (classe ou méthode, précédence `@route({host})` > méthode > classe) → **403** si l'`Host` ne matche pas (`domainMatcher` pur, conforme). Hosts de confiance = config **`trustedHosts`** (ex-`domainAlias`, renommé pour la sécu). ⚠️ ordre des checks : un **405** ne doit pas masquer un **403** (Router corrigé).
- **Ne jamais nommer une action** `session`/`request`/`response`/`context`/`method` (collision prop Controller → « Action not found »).
- **WS** : même controller. Handshake = `execute(null)` (⚠️ l'action reçoit `undefined`, **pas** `null` →
  tester `message == null`, ne jamais `.toString()` un message absent), puis `execute(message)`. Protocol =
  match exact string (mismatch → close 1002). Route résolue AVANT `connect()`.
- **Hook `initialize()`** (per-request, **opt-in**) : si le controller le définit, `Resolver.newController()`
  l'`await` **juste APRÈS l'instanciation DI (`Injector.instantiate`) et AVANT l'action** (HTTP **et** WS).
  Async, doit `return this`. Le `Controller` de base ne le déclare PAS (interface-marqueur `IInitializable`
  côté Resolver) → c'est un opt-in userland. Place idéale pour `this.startSession(...)`, précharger des
  données communes à toutes les actions, vérifs pré-action. Une exception levée ici **annule l'action**.
- **Session** : `this.startSession("name")` dans `initialize()` (HTTP **et** WS) ; accès direct via
  `@inject("session")`. Sessions = IoC (`SessionsService` registre statique, http n'importe aucun ORM ;
  handler config `session.handler`, défaut reco `drizzle`).
- **Cookies** : `this.context.cookies` (`Cookies` map) — `getCookie(name)` / `setCookie(new Cookie(name, val, opts))`.
  Conformité RFC 6265 (SameSite/Secure/HttpOnly) → skill `nodefony-rfc`. Réponse : `HttpResponse`/`Http2Response`
  (`setBody`/`setStatus`/`redirect`) — le cas courant passe par `renderJson`/`render*`.
- **Points d'extension HttpKernel** (pluggables, singleton stateless 0-alloc) : `setRequestLogger(IRequestLogger)`
  (`DefaultRequestLogger`/`PrettyRequestLogger`/`JsonAuditLogger`) · `setErrorRenderer(IErrorRenderer)`
  (`DefaultErrorRenderer` → override pour RFC 7807, hide-stack prod, auth-challenge headers).

### Contrat de réponse RFC du cycle (HTTP **et** WS — crucial realtime)

Le `Resolver.returnController` normalise le retour d'action. **Connaître le contrat évite le « trap »** :

- **`return <object|array>`** → **auto-JSON gardé** : `setContextJson()` + `render()`. Gardes : si `context.sended`
  déjà → no-op ; n'auto-JSON QUE `isPlainObject`/`isArray` (un stream/Buffer/instance n'est PAS sérialisé).
- **`return <string>`** → `ctx.send(result)`. **`return <Promise>`** → résolu puis re-normalisé.
- **`return undefined` SANS avoir `send/stream/render`** = **le trap** : la réponse reste pendante. En `development`,
  `HttpKernel.teardown` **WARN** (`waitAsync && !sended`) avec le nom de la route. → toujours `return` une valeur
  rendable, ou envoyer manuellement.
- **JSON sans charset** : `application/json` (et `+json`) émis **SANS** `; charset=` (RFC 8259 §11 — JSON = UTF-8
  par spec, un param charset est non conforme/ignoré). Le reste garde `; charset=utf-8`.
- **Headers par défaut** (RFC 9110) : `Content-Length` exact (omis sur HEAD/OPTIONS/TRACE + 204/304), `Date`
  (auto Node h1), `x-request-id` (généré ou echo du `X-Request-Id` client), `traceparent` echo. `statusMessage`
  réduit à l'ASCII imprimable avant `writeHead` (sinon `ERR_INVALID_CHAR`).
- **`forward("mod:Ctrl:action")`** = re-dispatch **interne** sur le **même** contexte (RFC : **pas** un 3xx, aucun
  `Location`, URL cliente inchangée, méthode/corps préservés). Status = celui du controller cible (défaut 200).
- **Codes de fermeture WS RFC 6455 §7.4** : coercition via le helper pur `toWsCloseCode(code)` (exporté de
  `WebsocketContext`). Émissibles conservés (1000-1003, 1007-1011, 3000-4999) ; HTTP 5xx→**1011**, 401/403→**1008**,
  autre 4xx (404…)→**4004** privé (⚠️ **PAS** de `4000+code`/`4404` inventé) ; 0-999 + réservés non émissibles
  (1004/1005/1006/1015)→1011. **`connection.on("error")` OBLIGATOIRE** sur toute socket ws (un `error` sans
  listener = crash process). Côté client (RealtimeClient) : politique de reco PAR code (cf `[[project_realtime_close_codes_client]]`).
- **`maxPayload` WS** (config `websocket.maxPayload`, défaut sûr **1 MiB** anti-DoS) → message trop gros = `ws`
  ferme **1009 « Message Too Big »** (RFC 6455 §7.4.1) ; l'`error` est captée par `onConnectionError` (pas de crash).
- **Throws** : pas de `try { … } catch (e) { throw e }` (no-op) ni `return await` dans le hot path (microtask
  en plus) — laisser l'erreur/le rejet remonter seul jusqu'à `HttpKernel.onError`.

### Tests d'intégration (terrain de jeu = `src/modules/test`)

Une route de test = à ajouter dans le **controller approprié** de `src/modules/test/nodefony/controller/`,
**un controller par feature** (ne pas gonfler `DefaultController`). Les tests `.ts` du pipeline tapent ces
routes (serveur requis). Écrire les tests **dans la même session** que le code. Existant : `/nodefony/test/*`
(context, crash sync/async/native, header-echo, memory), `…/rest/*` (session CRUD), `…/html/*` (stream/upload/media),
`…/als-test/*` (sondes ALS). Tout fichier test `.ts` commence par `/// <reference types="node" />`.

### Debug runtime — reproduire un bug de boot/shutdown/race (boot enfant direct)

Pour diagnostiquer un bug **runtime** (crash au boot, `unhandledRejection`, race de
shutdown au Ctrl+C, fuite, 500 intermittent) il faut un process **qu'on contrôle et
dont on capture le stdout**. Le `nodefony development` normal passe par le
**DevSupervisor** (parent CONSOLE + enfant SERVER) → son stdout file ailleurs et il
auto-restart. Bypass : forcer le **mode enfant direct** = 1 seul process, SIGINT-able,
loggable.

```bash
# 1. Stopper le serveur courant (libère 5151/5152). Superviseur = group-kill du parent.
kill -TERM "$(pgrep -f 'nodefony development' | head -1)" 2>/dev/null; sleep 1
lsof -ti:5151 -ti:5152 2>/dev/null || echo "ports libres"

# 2. Boot ENFANT DIRECT loggé (NODEFONY_DEV_CHILD=1 → DevCommand boote le serveur,
#    PAS le superviseur). spawn detached pour survivre au shell (cf SIGHUP).
LOG=/tmp/nf-repro.log; rm -f "$LOG"
NODEFONY_DEV_CHILD=1 node -e "
const {spawn}=require('child_process'),fs=require('fs');
const out=fs.openSync('$LOG','w');
const c=spawn('npx',['nodefony','development'],{cwd:process.cwd(),env:process.env,stdio:['ignore',out,out],detached:true});
fs.writeFileSync('/tmp/nf-repro.pid',String(c.pid));console.log('PID='+c.pid);c.unref();"
for i in $(seq 1 30); do grep -q 'Server Listen on' "$LOG" && { echo "BOOT $i s"; break; }; sleep 1; done

# 3. REPRODUIRE une race de shutdown : marteler une route PENDANT le SIGINT (une
#    requête in-flight au moment du terminate déclenche la race infra/serveurs).
PID=$(cat /tmp/nf-repro.pid)
( for r in $(seq 1 2500); do curl -sk -o /dev/null https://127.0.0.1:5152/ & curl -s -o /dev/null http://127.0.0.1:5151/ & done; wait ) >/dev/null 2>&1 &
HPID=$!; sleep 0.5; kill -INT "$PID"; sleep 4; kill $HPID 2>/dev/null; pkill -f 'curl -sk' 2>/dev/null

# 4. VERDICT — grep ciblé (strip ANSI). 0 partout = sain.
echo "rejection:$(grep -c unhandledRejection "$LOG")  500:$(grep -cE 'GET  500' "$LOG")  err:$(grep -c 'ERROR\|CRITIC' "$LOG")"
grep -nE 'unhandledRejection|PROMISE CHAIN BREAKING' "$LOG" | sed 's/\x1b\[[0-9;]*m//g'   # → stack complète juste après
```

- **Lire la vraie stack d'un `unhandledRejection`** : Nodefony logge `WARNING  !!! PROMISE
CHAIN BREAKING : <err>` + `Trace: Promise { <rejected> … at … }` (via `Cli.listenRejection`).
  C'est LA stack à suivre (pas la `[CI-DIAG]` de `terminate()`, qui ne trace que QUI appelle terminate).
- **Race de shutdown = motif récurrent** : un service infra (ORM, redis…) qui se déconnecte
  sur `onTerminate` AVANT que les serveurs http/WS aient drainé → toute requête en vol qui
  retouche l'infra jette. `fireAsync("onTerminate")` est **séquentiel en ordre d'enregistrement** ;
  un service enregistré tôt (module avant `http` dans `@modules`, handler posé au **ctor**/onPreBoot)
  tourne AVANT les serveurs. Fixes : (a) **catcher** toute promesse fire-and-forget du pipeline ;
  (b) **dégrader gracieusement** quand l'infra est `!isConnected()` au lieu de jeter. Cf RETEX §11.
- **Prouver qu'une erreur de type/tests est PRÉ-EXISTANTE** (pas ta régression) :
  `git stash && npx tsc --noEmit -p <pkg>/tsconfig.json ; git stash pop && npx tsc --noEmit -p …`
  → même erreur des deux côtés = antérieure (à noter, pas à corriger dans ce diff).
- **Tests à seuil mémoire** (`memory.test.ts`) flakent en **pleine suite** (pression GC) → rejouer
  le test isolé (`--grep "<nom>"`) ; s'il passe seul = flaky connu, pas une fuite.
- Pour un boot **stable** (suites de tests, pas de diagnostic shutdown) → `nodefony-start-server`.

### Endpoint admin data plane (Studio)

```typescript
// Producteur (module http/kernel/orm…) — importe SEULEMENT depuis "nodefony" (jamais framework : cycle)
import type { IAdminApi, IAdminRegistry } from "nodefony";

export function createXxxAdminApi(mod: MyModule): IAdminApi {
  return {
    adminNamespace: "xxx",
    adminDescriptor: () => ({ name: "xxx", order: 50 }),
    adminEndpoints: () => [
      {
        path: "/things",
        method: "GET",
        role: "ROLE_NODEFONY_ADMIN",
        handler: () => ({ things: [] }),
      }, // succès = donnée BRUTE (pas {body}, sinon double-wrap)
    ],
  };
}
// enregistrement dans onKernelBoot : (this.kernel.container.get("adminBroker") as IAdminRegistry).register(api)
```

- Routes admin = **≥3 segments** `/nodefony/<ns>/api/*` (jamais mono-segment → collision SPA Studio).
- L'enveloppe `{status,headers,body}` n'est lue que si `status` OU `headers` présent (sinon donnée brute).
- RBAC : `request.roles` vide tant que P6 absent → 403 inactif (mock), s'activera sans changer le code.
- Le front consomme `store.api.getAbsolute<T>("/nodefony/xxx/api/things")`. Per-instance (header `x-nodefony-instance`).

### Lazy alloc + cleanup listener (patterns perf canoniques)

```typescript
// Lazy : getter qui n'alloue qu'au 1ᵉʳ accès (cf Context.signal)
private _phaseIndex: Map<string, number> | null = null;
get phaseIndex(): Map<string, number> {
  if (this._phaseIndex === null) this._phaseIndex = new Map();   // jamais dans le ctor
  return this._phaseIndex;
}
// Cleanup d'une paire finish/close (once n'auto-detache PAS le jumeau)
const onEnd = () => { res.removeListener("finish", onEnd); res.removeListener("close", onEnd); /* … */ };
res.once("finish", onEnd); res.once("close", onEnd);
// Listener différé qui lit l'ALS → bind
res.once("close", AsyncResource.bind(() => { /* RequestContext.get() OK ici */ }));
```

### RequestContext (ALS) — propagation per-request

```typescript
import { RequestContext } from "nodefony";
RequestContext.run({ requestId, scheme, user }, async () => {
  /* tout le pipeline */
});
RequestContext.get(); // payload | undefined
RequestContext.getUserId(); // string | undefined  (rempli par security P6)
RequestContext.pushQuery({ sql, durationMs }); // no-op si !isProfiling() (gratuit en prod)
```

⚠️ Ne pas lire l'ALS depuis un callback détaché (pool ORM, listener non-bind) → capturer la réf du
buffer sur le contexte valide.

### Config de module (`nodefony/config/config.ts`)

```typescript
import path from "node:path";
import { Nodefony, type Kernel } from "nodefony";

export default {
  // Port d'écoute du sous-système. Défaut 0 = aléatoire. Prod : fixer via env.
  port: 0,
  connectors: {
    default: {
      // ⚠️ LAZY (getter) — le kernel n'existe PAS au moment de l'import → deref eager = crash.
      get filename() {
        return path.resolve(
          (Nodefony.getKernel() as Kernel).path,
          "nodefony/databases/x.db",
        );
      },
    },
  },
};
```

- **Commenter CHAQUE option** (FR) : rôle + valeur par défaut + reco prod + exemple de surcharge. Réf =
  `@nodefony/http/nodefony/config/config.ts`.
- ⚠️ **JAMAIS dérefencer le kernel au top-level** (config évaluée à l'import) → **getter lazy** (résolu
  au boot/merge) ou **guard** `Nodefony.getKernel()?.tmpDir?.path ?? "/tmp"`. Sinon module non-importable/testable.
- **Surcharge** : l'app pose `config/modules/<module>-config.ts` ; un module pose `Module-<name>` dans ses
  options → `readOverrideModuleConfig()` merge (`extend(mod.options, override)`).

### Certificats TLS (HTTPS 5152 / WSS — auto-générés, service `Certificate`)

Le service `Certificate extends Service` (`@nodefony/http`) génère le cert au boot (`onBoot`) — **rien à
lancer à la main** pour un dev HTTPS standard. **3 stratégies** (`resolveStrategy`) :
| Stratégie | Quand | Trust navigateur |
| --------- | ----- | ---------------- |
| `explicit` | `certificates.{ca,key,cert}` fournis en config (PROD) | selon ton cert |
| `mkcert` | dev + `dev.useMkcert` + binaire mkcert + CA locale | ✅ trustée → **requis HMR cross-origin/WSS** |
| `forge` | fallback auto-signé node-forge (CI, mkcert absent, prod sans cert) | ❌ non trusté (SAN présent) |

```jsonc
// config "module-http" : prod = fournir un vrai cert ; dev = laisser vide (auto)
certificates: { ca: "/etc/ssl/ca.pem", key: "/etc/ssl/private.key", cert: "/etc/ssl/cert.pem",
  dev: { useMkcert: true }, openssl: { size: 2048 } }   // size 4096 reco prod
```

- **HTTPS dev sans erreur navigateur** : `brew install mkcert nss && mkcert -install` (détecté via `mkcert -CAROOT`).
- `https.rejectUnauthorized` = `false` en dev (auto-signé), **TOUJOURS `true` en prod**.
- `npm run certificates` (`bin/generateCertificates.sh`) = **outil AVANCÉ** : PKI maison complète offline
  (root+intermediate CA + cert serveur + **cert client mTLS** + chain/haproxy.pem). CA **non** trustée navigateur.
  PAS le chemin par défaut. mTLS = token étendu sécurité (P6, `project_security_module_design`).

### Interfaces & types (standard universel — TOUS les modules)

```typescript
// nodefony/interfaces/IThing.ts  → puis barrel nodefony/interfaces/index.ts
export interface IThing {
  id: string;
  name: string;
}

// index.ts du module — re-exporter classes (valeur) ET types (effacés)
export { ThingService } from "./nodefony/service/ThingService";
export type { IThing } from "./nodefony/interfaces/IThing";
```

- **JAMAIS de `.d.ts` écrit à la main** (diverge du code) — types **générés** par Rollup dans `dist/types/`.
- `package.json` obligatoire : `"types": "./dist/types/index.d.ts"` + `"exports": { ".": { "types":
"./dist/types/index.d.ts", "import": "./dist/index.js" } }` (TS 4.7+ lit `exports.types` en priorité).
- Interfaces préfixées **`I`**, dossier `nodefony/interfaces/` + barrel. Type front isomorphe → tsconfig
  `customConditions: ["browser"]` (résout `nodefony` vers le build client). Audit dérive : `nodefony-check-externals`.

### Erreurs typées (`nodefonyError` / `HttpError`)

```typescript
import { nodefonyError } from "nodefony";
throw new nodefonyError("user not found", 404); // (message?: string | Error, code?: number)
try {
  /* … */
} catch (e) {
  throw new nodefonyError(e as Error, 500);
} // wrap : copie message/code/stack
```

- `nodefonyError` ajoute `code: number|null`, `errorType` auto-détecté (TypeError/SystemError/Assertion/
  Sequelize/Mongoose/ClientError), `toJSON()` **filtré** (exclut `context`/`resolver`/`container`/`secure` =
  réf circulaires + fuite). `getDefaultMessage()` remplit le message depuis `STATUS_CODES` si seul `code` fourni.
- Pipeline HTTP/WS : **`HttpError`** (`@nodefony/http`) `extends nodefonyError`, ctor `(message?, code?, context?)` →
  extrait `controller`/`action`/`jsonResponse` de `(context as any)?.resolver` (⚠️ http **ne peut PAS** importer
  framework → cycle ; toujours passer par `resolver` du context). Erreur métier d'un module = étendre `nodefonyError`
  (jamais `globalThis.Error` exporté tel quel — c'est `nodefonyError`, l'ancien export `Error` a été renommé).

### Core isomorphe / polymorphisme front-back (lib client + realtime)

**Le différenciateur** : `nodefony` se résout en **deux builds** selon l'environnement, **même import**.

```jsonc
// package.json "nodefony" — condition browser ⇒ bundle client ; sinon ⇒ build serveur
"exports": { ".": {
  "browser": { "import": { "default": "./dist/client/client/index.js" } },  // Vite/navigateur
  "import":  {            "default": "./dist/node/index.js" } } }            // Node serveur
// subpaths client : nodefony/client · nodefony/react · nodefony/roles · nodefony/debugbar · nodefony/debugbar.js
```

- **Isomorphe** (tourne des 2 côtés) : `RealtimeClient`, `Pdu`, `Syslog`, `Tools`, `roles` (`hasRole`…).
  Build client dédié (`createClientConfig` + `tsconfigClient.json` `types:[]` + shims `node:util/events/cli-color`,
  `preserveModules` → `RealtimeClient`/`Pdu` **partagés** entre subpaths, 0 dup, bundle ~25 KB gz).
- 🚨 **Frontière (sécu MAX)** : ne JAMAIS embarquer de code/données SERVEUR dans le bundle client. La
  condition `browser` résout vers le build client (sans `node:*`, sans services/secrets). Besoin d'un type
  serveur côté front → **type miroir local**, jamais d'import runtime. Seul pont front↔serveur = data plane
  `/nodefony/<module>/api/*` (JSON, secrets redactés serveur).
- **Côté front** (consommation) : hooks `nodefony/react` (`useNodefony*`) → skill `nodefony-studio-dev`.

**`RealtimeClient` (Core, JSON-RPC 2.0, isomorphe)** :

```typescript
import { RealtimeClient } from "nodefony"; // ou nodefony/client côté navigateur
const c = RealtimeClient.shared({ url: "/nodefony/studio/api/realtime" }); // singleton PAR URL (globalThis)
await c.connect();
c.subscribe("dashboard:stats"); // ref-compté (réseau émis aux seules transitions 0↔1)
const off = c.on("dashboard:stats", (p) => {
  /* … */
}); // off() pour se désabonner
const data = await c.request<T>("method", params); // RPC requête/réponse
await c.stream<TChunk>("method", params, (chunk) => {}); // RPC streaming
// getters : state · subscribedChannels · framesReceived · frameLog (ring lazy : émis seulement si listener)
```

- 🚨 **1 SEULE socket par origine** (`shared` singleton) — Studio ET debug bar la partagent. **TOUS** les
  consommateurs ref-comptent (`subscribe`/`unsubscribe`) ; JAMAIS de `emit("subscribe")` brut (un unsub à
  ref→0 couperait le canal pour tous). Normaliser `http(s)→ws(s)` (clé + WebSocket) sinon 2 sockets/throw.

### Architecture « la socket Nodefony » (NORTH STAR — 2026-05-23)

Le realtime est **stratifié** ; seul le transport diffère client/serveur, tout le reste est **isomorphe** :

```
4. Hub        IRealtimeHub        ← LE PATRON : subscribe/publish/on + stats        ⬜ (RealtimeService P13)
3. Endpoint   IRealtimePeer       ← request/notify/receive (1 connexion)            ✅
2. Peer       JsonRpcPeer         ← protocole JSON-RPC 2.0 (discrimination)         ✅
1. Transport  IRealtimeTransport  ← octets : WS / ws / TCP / UDP / SIP / Redis      ✅ (seam polymorphe)
```

> Vision complète : mémoire `project_realtime_nodefony_socket_vision`. Backplane Redis = fan-out cross-pod
> (cloud-native) derrière le MÊME hub (le front ne change pas). « le hub, c'est le patron » : une page parle
> au hub, JAMAIS au socket brut.

**`JsonRpcPeer` (core `src/realtime/`, ISOMORPHE, `implements IRealtimePeer`)** — moteur protocole écrit
UNE fois, composé des 2 côtés. ZÉRO dépendance node (pub/sub via `Map`+callbacks, pas d'`Event`) → aucun shim.

- **Discrimination par `method`, PAS par `id`** (règle absolue) : `method`+`id`=requête → `result`/`error` ;
  `method` seul=notification ; `id` sans `method`=réponse (matchée au pending, ignorée si aucun). `id` string|number.
  Inconnu → `-32601` ; handler qui throw → `-32603` **message générique** (détail via `onError`=Zero Trust).
- API : `register/unregister/methods` (actions entrantes) · `request/requestStream/notify` (sortant) · `receive`
  (entrant) · `dispose`. Bug à NE PAS refaire : le stream doit pousser dans `pending.chunks` (sinon résout `[]`).

**`IRealtimeTransport` (core, seam)** — `connect/send/close/readyState` + `onOpen/onMessage/onClose/onError`.
`TransportState` (0..3, aligné WebSocket). `BrowserWsTransport` (navigateur, wrap `WebSocket`) ; `WsConnectionTransport`
(serveur, wrap `ctx.connection` — inbound poussé par `feed()`, fermeture par `fireClose()`). Le transport est « bête » ;
reconnect/backoff/heartbeat vivent au-dessus (`RealtimeClient` crée un transport NEUF par tentative).

**Endpoint SERVEUR = étendre `RealtimeController` (framework)** — le protocole (handshake/welcome, dispatch,
pub/sub, cleanup) est factorisé ; le contrôleur ne déclare QUE son métier :

```typescript
@controller("/nodefony/<mod>/api")
class MyRealtime extends RealtimeController {
  @route("ws", { path: "/realtime", requirements: { methods: ["WEBSOCKET"] } })
  async realtime(message: string | Buffer | null) {
    this.handleRealtime(message);
  } // délègue tout

  // SEUL point obligatoire : provider d'un canal au subscribe → dispose (appelé au unsubscribe ET au close)
  createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    if (channel === "my:chan") return createMyTicker(publish); // null = canal inconnu
    return null;
  }
  protected override realtimeActions() {
    return { "kernel:ping": () => ({ pong: true }) };
  } // requête→result
  protected override realtimeChannels() {
    return ["my:chan"];
  } // annoncés au welcome (+ methods auto)
}
```

- 1 connexion = 1 `JsonRpcPeer` + 1 `WsConnectionTransport` (le MÊME peer que le client). `peer.dispose` + dispose
  des canaux sur `ctx.once("onFinish")`. Le `welcome` annonce `channels` + `methods` (découverte côté client).
- 🚨 **Le générique va dans la lib/le framework**, jamais dupliqué : protocole=`JsonRpcPeer`, plomberie=`RealtimeController`.
  Studio/debugbar/apps partagent. (Avant : chaque controller hand-rollait `dispatchRequest` → dérive. Supprimé.)
- ⚠️ Push hors handshake : `ctx.send()` rejette (`requestEnded`) → la base pousse sur `ctx.connection` brute
  (`WsConnectionTransport`, garde `readyState===1`). **SSE supprimé** (mort + `flushHeaders` absent sur `Http2ServerResponse`
  → `code=000`) ; tout futur SSE écoute `rawRes.once("close")` (RESPONSE), pas `request` (fire trop tôt HTTP/2).

**Côté client (lib, déjà là)** : `client.request<T>("kernel:ping")` (Promise id-matchée) ; helper réutilisable
`client.ping()` (RTT). Le générique vit dans `RealtimeClient`, pas le front.

**Tests realtime (BÉTON, sans navigateur)** :

- `JsonRpcPeer` : `send` capturé dans un tableau, `receive(frame)` → asserte la discrimination + le cycle req/rép
  (`src/nodefony/src/tests/JsonRpcPeer.test.ts`, 14).
- `RealtimeClient` : transport **mock** injecté (2e param ctor) + délais réels → connect/reconnect/heartbeat/disconnect
  (`RealtimeClientTransport.test.ts`, 6) ; discrimination + `ping()` en stubant `request` (`RealtimeClient{Dispatch,Ping}.test.ts`).
- `RealtimeController` : **faux Context** `{ connection: mockConn, once }` (Controller se construit avec `{} as ContextType`),
  sous-classe de test → handshake/welcome/subscribe/actions/-32601/-32603/réponse-ignorée/onFinish
  (`@nodefony/framework` vitest `RealtimeController.test.ts`, 12) + `WsConnectionTransport.test.ts` (7).
- Le dispatch d'action est **async** (microtask) → flusher (`await new Promise(r=>setTimeout(r,0))`) avant d'asserter.

**Auto-observabilité = la sonde de la Socket Nodefony** (`RealtimeHub.probe()`, livré 2026-05-24) —
« la socket s'observe à travers elle-même ». Le multiplexing N canaux/1 WS est bon mais déplace 3 risques
sur le hub → la sonde les rend MESURABLES **avant** d'optimiser :

- `RealtimeHub.probe(): IRealtimeProbe` — lecture PURE (0 alloc, jamais throw) : canaux+`subscribers`+`messages`,
  `publishTotal`/`fanoutTotal` (=publish×abonnés), `inboundTotal`, connexions, `bytes/messagesSentTotal`,
  **`backpressure`{max/totalBufferedAmount, slowConsumers}** (= risque #1, `bufferedAmount` du slow-consumer).
- **Compteurs always-ON** (≠ flux ORM gaté) : intégers O(1) sur `publish`/`send`, **0 syscall/stringify** → la
  backpressure (blocker #1) doit être visible sans flag. (Le flux ORM, lui, chronométrait CHAQUE requête → gaté.)
- `bufferedAmount` vit sur la conn `ws` brute → seul `WsConnectionTransport` l'expose (`implements IRealtimeConnProbe`,
  `bytesSent`/`messagesSent` cumulés dans `send`). `RealtimeController` `registerConnection`/`unregisterConnection`
  (handshake/onFinish, **symétrique**) auprès du hub (registre lazy, lu QUE dans `probe`). Cumuls **monotones** →
  débit dérivé côté lecteur (delta total/ts, comme CPU%/flux ORM). `SLOW_CONSUMER_BYTES=1 MiB` (alerte, **pas** de drop).
- Endpoint `GET /nodefony/realtime/api/health` (`buildRealtimeHealth`=probe+`instanceId`, namespace `realtime` →
  déménagera dans `@nodefony/realtime` P13.1) + canal Studio `realtime:health` (ticker broker `createBrokerTicker`).
- **Ordre des optims** (la sonde = préalable « mesurer avant d'optimiser ») : sonde → **stringify unique broadcast**
  (gratuit, 1× par publish au lieu de N) → **seuil bufferedAmount** drop (latest-wins) / close 1013 (slow-consumer) →
  coalescing si la sonde le justifie. Panneau Studio Hub = côté `nodefony-studio-dev`. [[project_realtime_socket_probe]].

> **NOMMAGE** : « **la Socket Nodefony** » (MAJUSCULE) = le patron/concept entier (prose, docs, pitch) ;
> minuscule/code = vocabulaire stratifié précis (`socket`/`IRealtimeSocket`=prise, `RealtimeHub`=broker,
> `channel`, `transport`/`peer`). Analogie « le Web » vs « un web ». [[project_realtime_nodefony_socket_vision]].

- **Placement** : hub/sonde/controller vivent dans **`@nodefony/framework`** (le broker y est déjà ; `http` ne peut
  pas importer framework = cycle) → déménageront **d'un bloc** dans `@nodefony/realtime` (P13.1, session dédiée — NE PAS
  l'extraire au milieu d'une autre feature). Config realtime future → section `realtime` de `@nodefony/http` (transport :
  `bufferedAmount`/maxPayload) ; cadence des canaux → Studio.
- **Build** : modif Core/subpath `nodefony/*` ou framework → rebuild **puis restart** (Vite ré-optimise au boot).
  Règle perf/mémoire Core s'applique. memory.test obligatoire (touche pipeline WS).
- Réfs : `project_realtime_nodefony_socket_vision`, `project_realtime_socket_probe`, `project_client_lib_subpaths_decision`,
  `project_studio_realtime_ws`, `project_decisions_realtime_isomorphic`, `project_realtime_granularity_clientlib` (AIMD).

**Backplane cross-process — port `IBackplane`** (framework, LIVRÉ Phase 1, `ac21bec`) — l'abstraction de
fan-out **cross-process** du hub. Le hub fait le fan-out LOCAL ; le backplane propage aux **autres pairs**
(workers IPC, pods Redis) et réinjecte localement. **Même contrat, backings interchangeables** → on prouve
l'archi multi-process AVANT toute infra (c'est le mode cluster sans PM2 : cf [[project_cluster_backplane_vision]]).

- `IBackplane` (`interfaces/IBackplane.ts`) : `originId` (identité pair, anti-echo) · `publish(channel,payload)`
  (→ autres pairs, **PAS** de fan-out local) · `onMessage(handler)` (ingress, echo déjà filtré) · `start/stop`.
  Sémantique **best-effort / at-most-once** (pub/sub — 0 garantie ordre/delivery, le client re-sync ; ne pas sur-concevoir).
- `LoopbackBackplane` (no-op, aucun pair) = impl de référence + cible de test.
- **Hub câblé** : `publish` = `publishLocal` **+** `#backplane?.publish` ; `publishLocal` = fan-out local
  SEUL = **voie d'ingress** (jamais re-propagée). `setBackplane(bp)` câble `bp.onMessage→publishLocal` + `bp.start()`.
  **`#backplane = null` par défaut** → 0 overhead mono-process (seul un test `!== null` sur le hot path, style lazy).
  `clear()` détache sans `stop` (lifecycle externe = owner du backplane). Getter `backplane`.
- 🚨 **Anti-boucle = 2 barrières** : (1) ingress → `publishLocal` (jamais `publish`) → pas de re-forward ;
  (2) le backplane filtre son propre `originId`. Une publication LOCALE part au backplane ; un message REÇU n'en repart jamais.
- Impls à venir : **`ClusterBackplane`** (IPC **master-gateway** : worker→`process.send` ; master sert 0 HTTP =
  relay IPC + agrège les sondes + **pont unique** Redis = 1 conn/pod, worker découplé) puis **`RedisBackplane`** (P13, drop-in).
- ⚠️ **Politique par canal** (à trancher Phase 3) : `publish` forward TOUT pour l'instant. Or un canal per-instance
  (`realtime:health` = snapshot du pod) ne doit PAS se mélanger cross-pod. Le harnais cluster RÉVÉLERA ces cas =
  l'intérêt de tester tôt. Phase 2 = lifecycle cluster core (`nodefony cluster`, fork cgroup-aware, respawn, `isPrimary`).

## 5. ORM — Entity / Repository / Service CRUD

**Archi = Repository multi-ORM (pas Active Record)** — ADR-0003. `@nodefony/orm-core` = **lib pure**
(contrats + registres + base classes, JAMAIS un Module, jamais dans `@modules()`). Les **drivers** sont
les Modules et s'auto-enregistrent dans `ormRegistry` à leur boot. **ORM par défaut = Drizzle** (SQL,
schema-as-code) ; Sequelize/Mongoose = legacy/NoSQL. Un nouvel adapter → **commencer par Drizzle**.
Contrats (core) : `IOrm` · `IEntity<S,M>` (+`IEntityRelation`) · `IRepository<T>` (+`Criteria<T>`/`FieldOperators`) · `ITransaction`.

### A. Définir une entité — `@entity` schema-as-code (Drizzle, RECOMMANDÉ)

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { entity } from "@nodefony/orm-core";

export const articleTable = sqliteTable("Article", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()), // ⚠️ $defaultFn (JS), PAS .default()
  title: text("title").notNull(),
  tags: text("tags", { mode: "json" }).$defaultFn(() => []), // colonnes JSON = mode:"json"
  authorId: text("authorId").notNull(),
  published: integer("published", { mode: "boolean" }).$defaultFn(() => false),
  createdAt: integer("createdAt")
    .notNull()
    .$defaultFn(() => Date.now()),
});
export interface ArticleRow {
  id: string;
  title: string;
  tags: unknown;
  authorId: string;
  published: boolean;
  createdAt: number;
}

@entity({
  orm: "default",
  name: "Article",
  schema: articleTable,
  module: "blog",
  relations: [
    {
      type: "many-to-one",
      target: "User",
      field: "author",
      foreignKey: "authorId",
    },
  ],
})
class ArticleEntity {} // classe VIDE — le descripteur vient des options
export default ArticleEntity;
```

- ⚠️ **Défauts via `$defaultFn` (JS-level), JAMAIS `.default()` SQL** : le DDL est dérivé de
  `getTableConfig()` qui **n'émet pas** les `DEFAULT` → une colonne `NOT NULL` sans valeur casserait l'INSERT.
- `@entity` enregistre le descripteur dans `entityRegistry` **au chargement du module** (0 instanciation) →
  `DrizzleOrm` crée la table à la connexion. `module:` sert au regroupement ERD Studio.
- **Binding ORM dynamique** (nom de connecteur dépend de la config, ex. User) → pas d'`@entity` figé :
  `createXxxEntity(orm)` + `registerXxxEntity(orm)` appelé **avant** `orm.connect()`.

### B. Entité legacy — classe `Entity` (Sequelize)

```typescript
import { Entity, Module } from "nodefony";
class Boat extends Entity {
  constructor(module: Module) {
    super(module, "boat", "sequelize", "myconnector");
  } // (module, name, orm, connector)
  getSchema() {
    return {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING },
    };
  }
  override registerModel(db: sequelize.Sequelize) {
    /* Model.init(this.getSchema(), {sequelize: db, modelName: this.name}) */
  }
}
```

### C. Repository — contrat portable (`IRepository<T>`)

```typescript
const repo = orm.getRepository<ArticleRow>("Article");
await repo.find(
  { published: true, createdAt: { $gte: cutoff } }, // Criteria<T> typé + opérateurs riches
  {
    relations: ["author"],
    order: [["createdAt", "DESC"]],
    limit: 20,
    offset: 0,
  },
); // RepositoryReadOptions
await repo.findOne({ id });
await repo.create({ title: "x", authorId }); // → entité persistée (id/défauts générés)
await repo.update({ id }, { published: true }); // → entité|null
await repo.delete({ id }); // → number supprimé
await repo.count({ published: true });
```

- **Opérateurs riches** (`FieldOperators`, combinés en AND) : `$eq $ne $gt $gte $lt $lte $in $nin $like`
  (`$like` = SQL `%`/`_`). `{ age: { $gte: 18, $lt: 65 } }`. Échappatoire : `OrmCriteria` (`Record<string,unknown>`).
- **Eager-load** = `options.relations` (assos **déclarées** dans `@entity`). Jointure arbitraire →
  trappe native `orm.getNativeConnection<C>()` (SQL/commandes brutes — anti-blocage).
- Tout est **bindé/paramétré** (jamais de concat de valeurs).

### D. Service CRUD — `AbstractCrudService<T, R>` (la source de vérité métier)

```typescript
import { AbstractCrudService, type ServiceWiring } from "@nodefony/orm-core";
import { injectable, inject } from "nodefony";

@injectable({ singleton: true, name: "article-service" })
export class ArticleService extends AbstractCrudService<
  ArticleRow,
  IArticleRepository
> {
  constructor(
    @inject("repository.article") repository: IArticleRepository,
    ...wiring: ServiceWiring
  ) {
    super("articles", repository, ...wiring); // ServiceWiring = [container?, nc?, options?] forwardé (fin du tunneling)
  }
  // hérité : find/findOne/findById/count (délégation pure, hot path) · create/update/delete (hooks + events)
  // override les hooks template-method pour le métier :
  protected override async beforeCreate(data: Partial<ArticleRow>) {
    return { ...data, title: data.title?.trim() };
  }
  // events émis si mutation effective : "onCreated"(entity) / "onUpdated"(entity) / "onDeleted"(criteria, count)
}
```

- **Singleton stateless LÉGITIME** : l'état par requête (user/tenant/tx) vit dans `Context`/ALS, **jamais**
  un champ du service. Service = transport-agnostique → REST/WS/GraphQL/CLI = adaptateurs minces qui l'appellent.
- `findById(id)` suppose **PK `id` string** (override sinon). 2ᵉ générique `R` = garde les finders métier
  (ex. `UserService extends AbstractCrudService<IUser, IUserRepository>`, `super("users", repository, ...wiring)`).
- **DI** : `@inject("repository.<entity>")` (le binding repo↔ORM est fait par l'adapter) — JAMAIS l'ORM en dur.
  `@repository(name, {entity, orm?})` = tag pur lien repo↔entity.

### E. Transactions (une tx = un ORM ; 2PC cross-ORM NON garanti)

```typescript
await orm.transaction(async (tx) => {
  const txRepo = repo.withTransaction(tx);        // vue liée à la tx (résout « repo non tx-aware »)
  await txRepo.create({ ... }); await txRepo.update({ id }, { ... });
});                                                // commit auto au retour, rollback si throw
```

### F. Data plane ORM (Studio/IA)

`describeEntity(name)` (surchargé par Drizzle via `getTableConfig`) alimente le graphe canonique
(`buildOrmGraph` → ERD React Flow + contexte IA + DBML). Monté par le module driver
(`registerOrmAdminApi(broker)` en `onKernelBoot`, idempotent) → `/nodefony/orm/api/{orms,entities,entity/{name},graph,counts,connection/health,flow,export/{format}}`.

**3 sondes ORM, ne pas confondre** (patron sondes+hub) :

- **profiler par-requête** (`RequestContext.queries`, debug bar) : SQL de CHAQUE requête tracée, dev-only, **coût nul hors requête tracée** (buffer ALS absent).
- **santé** (`connection/health` + canal `orm:health`) : état/ping/latence-fenêtre/erreurs/reconnexions + sonde profonde `IOrm.probe()` (storage PRAGMA / pool). Générique (`buildConnectionHealth` itère `ormRegistry`, ping+probe), **émet une requête** (ping).
- **flux** (`flow` + canal `orm:flow`, `queryFlowMonitor`, 2026-05-23) : DÉBIT (queries/s) + latence moy/EWMA + requêtes lentes. **Process-wide, indépendant de l'ALS**, **OFF par défaut** (gaté par le driver : `setEnabled(env!==production)`, override `NODEFONY_ORM_FLOW`). Lazy, ring slow borné 20, `toSQL()` **seulement sur le chemin lent**. **Per-connecteur** : `Map<connecteur>` (clé = nom registre, pas vendor) → le repo passe son `ormName` au tap. Débit/s **dérivé** (delta `total`/`ts`), **0 persistance** (RAM, reset au restart — une sonde n'écrit jamais dans la base qu'elle observe). Câblé : **Drizzle** seul (Sequelize deprecated, Mongoose = TODO middleware). Ticker realtime = `createBrokerTicker` générique (réutilisé santé+flux).
- **lean cluster** (`buildOrmLeanHealth()` orm-core, 2026-05-25) : agrégat **per-instance** de TOUS les connecteurs (registre + `queryFlowMonitor` + `connectionMonitor`) → `IOrmLeanHealth` (`connectors/connected/queryTotal/slowTotal/errorTotal/reconnectTotal/maxEwmaMs`). **0 ping / 0 toSQL**, O(N connecteurs). Branché dans le report de sonde cluster via le **seam core** `setOrmHealthProvider(buildOrmLeanHealth)` (driver Drizzle au boot) → **`framework` n'importe PAS `orm-core`**. Lu par `buildOwnHealth` (`IRealtimeHealth.orm`), agrégé pod dans `mergeClusterHealth.totals.orm`. Cf RETEX §11 + [[project_cluster_drilldown_kit]].
- **rich @pid (drill cluster, 2026-05-25)** : diagnostic ORM COMPLET d'UN worker EXACT (`{ health: buildConnectionHealth(), flow: buildOrmFlow() }`) pour la page `/nodefony/orm/<pid>` en cluster. **Calqué `dashboard:supervision@<pid>`** (voie B1 : enrichir le colis broadcast, pas un 2ᵉ flux). Pièces : (1) **facette d'enrich** `ClusterProbeFacet` (`"process"|"orm"`, défaut process) sur `IClusterProbeCtl`/`IClusterProbeEnrich` (core) → 2 drills indépendants, « on paie ce qu'on regarde » par sonde ; (2) **seam core** `setOrmRichProvider(async ()=>blob)`/`readOrmRich()` (driver Drizzle, **async** car `connection/health` ping) — opaque côté core/framework ; (3) `ClusterProbeClient` : facette `"orm"` → **ticker de cache async** `#startOrmRich` (le report sync joint `payload.ormRich`, absent hors drill) ; (4) studio `orm:rich@<pid>` = **canal combiné** (1 canal = 1 enrich = **pas de ref-count**, le hub dédoublonne par nom) → local broker ticker si `pid===process.pid`, sinon `createClusterOrmTicker` (`requestEnrich(pid,true,"orm")` au sub, `false` au dispose). Prouvé e2e cross-process (`cluster-orm-rich-e2e.mjs`). Cf RETEX §11 + [[project_cluster_drilldown_kit]].

### Gotchas ORM

- **`Entity` ne s'auto-register PAS au ctor** (init des champs de la sous-classe APRÈS `super()` → `name`/`orm`
  seraient `undefined`). Auto-register = job du décorateur `@entity` (métadonnée de classe). Sans déco → `entity.register()` explicite.
- **`@entity` OU `register()`, jamais les deux** (registre throw sur doublon `name+orm`). Tests décorateurs → `unregister` (scopé à l'orm) en `afterEach`.
- **orm-core = décorateurs SANS reflect-metadata** (WeakMap maison) → 0 dep runtime ; diverge du DI core/framework (eux ont besoin de reflect).
- `Orm.connect()` = template method → surcharger `onConnect()`, pas `connect()` (sinon `onOrmReady` plus émis).
- `localKey`/`targetKey` figés à `"id"` (entité référencée DOIT avoir PK `id`). FK : one-to-many `<source>Id` sur target ; many/one-to-one `<target>Id` sur source.
- Réfs détail : `@nodefony/orm-core/{CLAUDE,MEMORY}.md`, `@nodefony/drizzle/{CLAUDE,MEMORY}.md`, ADR-0003, mémoires `project_p7_4_kit`/`project_crud_pattern_decision`/`project_orm_default_positioning`.

## 6. Realtime — LE différenciateur (WS natif + RealtimeService TCP/UDP/Redis)

Le temps réel est **le patron** de Nodefony (HTTP et WS co-citoyens, même pipeline). Protocole =
**JSON-RPC 2.0 maison** (pas Socket.IO : contrôle total, type-safe de bout en bout, 0 dep lourde) :
RPC bidirectionnel typé + streaming + **fallback HTTP long-polling** auto (résilience proxy/firewall).

**Architecture cible (3 couches)** :

```
[Serveurs physiques : WS(5151/5152) · TCP · UDP · Unix]
        ↓ normalise tout en { event, payload, meta }
[RealtimeService (façade centrale)]  ── crée un RequestContext (ALS) même pour TCP/UDP/Unix
        ↓ publish/subscribe                  ── filtre les échos cluster (tag originPod)
[IRealtimeHub driver : Local | Redis | Kafka]
```

### A. WebSocket — le socle (BUILT, `@nodefony/http`)

- 2 serveurs `ws@8` : `ws://5151` (sur http) + `wss://5152` (sur https). **Même pipeline Controller que HTTP**.
- Flow : `connection` → `handleWebsocket` → `createWebsocketContext` → `handleFrontController` (**route résolue
  AVANT accept**) → check protocole (mismatch → close **1002**) → `connect()` (handshake) → `execute(null)`
  (handshake, message=**undefined**) → `execute(message)`. `IWsRequestExtension` (`request.url` = `URL`).
- **Push serveur→client** : après handshake `ctx.send()` **REJETTE** (`requestEnded`) → `ctx.connection.send(str, cb)`
  (garde `readyState===1`). `broadcast()` = `wss.clients.forEach` (inclut l'émetteur). SSE = `rawRes.once("close")`.
- **ALS WS** : listeners `message`/`close` attachés dans la bulle `RequestContext.run` → `AsyncResource.bind`.
- **Pub/sub par canal on-demand** (pattern Studio) : client `subscribe`/`unsubscribe {channel}` → serveur démarre/
  arrête un **provider** transport-agnostique (`createXxx(publish)`). État `Map<channel,dispose>` sur le ctx,
  `dispose()` garanti `ctx.once("onFinish")`, câblage 1× au handshake (flag), `setInterval` **unref**.
- **Back-pressure (S2)** : push borné par `bufferedAmount` → consommateur lent = **drop latest-wins** puis close
  **1013** (Try Again Later) si le buffer reste saturé. Superviser ≠ tomber la prod : budget borné + dégradable.
- Stress mesuré : ~16k connexions (plafond ports éphémères loopback) / ~40k msg/s fan-out propre / ~120k =
  saturation. Lag Studio résolu par **coalescing** (ring buffer + flush). Bench → skill `nodefony-load-test`.

### B. `RealtimeService` + `IRealtimeHub` (P13 — DESIGN : comment on va le faire)

```typescript
interface IRealtimeHub {
  // driver swappable par DI
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(channel: string, onMessage: (msg: unknown) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}
```

| Driver             | Cas d'usage                                                      | Phase |
| ------------------ | ---------------------------------------------------------------- | ----- |
| `LocalRealtimeHub` | dev mono-instance (loop in-memory)                               | P13.x |
| `RedisRealtimeHub` | cluster pub/sub low-latency (chat, broadcast, sessions UI)       | P13.2 |
| `KafkaRealtimeHub` | massif, persistant (commit log), agents IA (P12), audit immuable | P13.x |

- **`RealtimeService` central** : normalise tout protocole entrant (TCP/UDP/Unix/WS) en `{event, payload, meta}` ;
  **crée un `RequestContext`** pour TCP/UDP/Unix (un paquet UDP brut = même bulle ALS qu'un POST HTTP — cohérence
  P1.4) ; **filtre les échos cluster** (tag `originPod` au `publish`, ignore au receive si même origine).
- Décorateurs cible : `@RealtimeController('/media')` + `@RealtimeEvent('media:joinRoom')(payload, ctx: RequestContext)`.
- **Multi-process** : un `publish` ne touche que les clients du **même worker** → fan-out cross-process =
  **Redis pub/sub** (1 instance reçoit → broadcast → toutes forward à leurs WS). Sans Redis = per-instance
  (dashboard per-pod + `instanceId`). Cf [[project_multiprocess_scaling]].
- **Forward-compat (le cœur de la demande)** : le realtime Studio actuel (`StudioRealtimeController`) migrera en
  **LOCAL** vers `realtimeService.publish(channel, payload)` — **mêmes providers, front inchangé** (canaux + format
  identiques). Concevoir tout provider realtime comme déjà branchable sur le service.

### C. `@nodefony/realtime` — sockets bas niveau (P13.1, NEW, indépendant)

Serveurs **TCP / UDP / Unix** bas niveau (IoT, IPC, protocoles binaires/texte). Ref JS `bundles/realtime-bundle/`.
⚠️ **WS reste dans `@nodefony/http`** — `@nodefony/realtime` = le **non-WS**. Module différable (indépendant).

### D. `@nodefony/redis` (refactor P13.2) — bus cluster + storage

Cluster + pub/sub (`RedisRealtimeHub`) + storage (cache / **session** / lock). Débloque `RedisSessionStorage`
(P5.12, via le registre IoC `SessionsService.registerStorage`) et le scaling multi-instance. Client à figer début
P13.2 : `ioredis` (cluster mature) vs `node-redis@4` (officiel).

### E. Pont protocolaire universel (P15 — la valeur centrale vs Socket.IO)

Un navigateur **n'ouvre pas** de socket TCP/UDP. `RealtimeService` **proxifie** : le browser parle
`<protocole>-over-WS` → Nodefony décapsule → socket TCP/UDP natif côté serveur. Ex. **SIP-over-WS → Asterisk**
(qui ne parle que TCP/UDP). À penser comme **fondation** (pas mediasoup-only).

- **mediasoup** (P15) : `PlainTransport` (RTP/RTCP brut, **pas** WebRTC navigateur), `PipeTransports` pod-to-pod
  (bypass Redis/Kafka pour les flux media binaires). Test ultime de l'archi (perf P1 + ALS + agents P12). Cible :
  agent IA vocal PSTN (téléphone → Asterisk → STT → LLM → TTS → retour).

### Réfs realtime

mémoires `project_decisions_realtime_isomorphic` (IRealtimeHub/RealtimeService/JSON-RPC/SIP/mediasoup) ·
`project_phase13_realtime_redis_client` (3 modules) · `project_studio_realtime_ws` (pattern built + forward-compat +
gotcha push) · `project_multiprocess_scaling` (Redis fan-out) · `project_realtime_vision_studio_beta` (vision) ·
`project_ws_stress_studio_lag` (limites). Roadmap détaillée → skill **`nodefony-roadmap`** (Phase 13). RFC WS → `nodefony-rfc`.

### F. Choix de runtime / langage — boussole stratégique (TOUJOURS à l'esprit)

> Contexte permanent pour tout raisonnement sur la couche realtime/perf. Question posée par le user
> (2026-05-23) : « quel langage choisir pour Nodefony et ses specs temps réel ? ». La réponse oriente
> chaque décision d'archi du hot path.

**Le plafond observé = famine de l'event-loop MONO-THREAD** (test de charge 2026-05-23 : WS 1300 +
80k msg/s → 0 % err MAIS realtime figé par vagues, ping ORM gonflé 8 s = ordonnancement pas la base).
C'est un **artefact du modèle Node**, pas une fatalité. Garder ça en tête : sous charge, le
**différenciateur (realtime) meurt EN PREMIER** car tout (CPU-bound, sérialisation, ticker, ORM
synchrone) se bat sur un thread.

**Runtimes où ce problème n'existe pas** (pour situer nos choix, PAS pour réécrire) :

- **Elixir/BEAM** = réponse de manuel pour le pur realtime : process préemptifs (une requête lente ne
  gèle pas les autres), Phoenix Channels (= notre patron canal/ref-count natif), clustering distribué
  natif (= notre fan-out Redis gratuit), supervision/« let it crash » (résilience cloud-native),
  backpressure first-class (GenStage = notre AIMD). **Origine télécom → colle au Phase 15 SIP.**
- **Go** : goroutines = 1 conn = 1 goroutine, vrai parallélisme, tue le fan-out de connexions.
- **Rust** : perf/p99 ultimes, 0 GC — mais vélocité trop lente (solo) + ergonomie DI/agentic pénible.

**MAIS le pari #1 de Nodefony = le Core ISOMORPHE** (même code client+serveur : `RealtimeClient`
partagé, debug bar, hooks). **Seul TS tourne nativement dans le navigateur** — aucun langage
compilé/BEAM n'est isomorphe. Changer = tuer l'isomorphisme (re-créer une lib cliente = ce que P13.3
a justement supprimé).

**→ Décision (boussole) :**

- **Le framework reste TypeScript** : l'isomorphisme EST Nodefony, non négociable. Le plafond
  event-loop se **mitige** (worker_threads pour le CPU-bound, AIMD/backpressure, sortir l'ORM
  synchrone du thread principal).
- **Si l'isomorphisme était négociable & seul le realtime à l'échelle comptait → Elixir/Phoenix.**
- **Geste malin (polyglotte ciblé)** : `RealtimeService`/`IRealtimeHub` est **déjà
  transport-agnostique** → c'est LE seam pour pousser, le jour du mur, le hot path du hub (pump WS,
  fan-out, backpressure) dans un **addon natif Rust (napi-rs)** in-process OU un **sidecar Go/Elixir**
  parlant notre JSON-RPC, **sans toucher au framework**. L'abstraction déjà en place vaut de l'or
  précisément pour ça. Réfs : [[project_realtime_granularity_clientlib]] (AIMD), [[project_decisions_realtime_isomorphic]].

## 7. Ce qu'il reste à construire — roadmap + design figé (orientation action)

Le skill décrit l'EXISTANT (§1-6) **ET** sait quoi BÂTIR pour le non-fait. **Réflexe début de tâche** :
lire `MIGRATION_STATUS.md` (P0→P16 + chemin critique + deps) ; charger le skill **`nodefony-roadmap`**
pour les phases futures. Pour une phase au design **déjà figé** (ci-dessous) : **coder dessus, ne pas
re-débattre l'acté**. Toujours charger les mémoires de design de la phase avant de coder.

### P6 — Security (design FIGÉ, à coder ; module `@nodefony/security` à créer)

**Infra prérequise déjà en place** : ALS `RequestContext` (P1.4) · hooks kernel `beforeResolve`/`afterAuth`/
`onAuthFailure` (P1.7) · HTTP **stateless JWT cookie** (décision) · module **`@nodefony/user`** livré
(IUser/BaseUser/AnonymousUser/BcryptEncoder/UserService + repos Drizzle, P5.6/P5.9). → le firewall peut se brancher.

**À construire (le plan)** :

- **`IAuthenticator`** (Spring-like, **PAS** Bridge/Factory) : `supports/createToken/authenticate/onSuccess/onFailure` ;
  `IToken` (`getUser/isAuthenticated/getRoles/getCredentials`). Classes : `Anonymous`/`UserPassword`/`Jwt` (CORE)
  - `OAuth2`/`MTls` (ÉTENDU). Vendors : **`jose`** (JWT), **`arctic`** (OAuth 50+ providers), bcrypt (via user).
    ⚠️ **NE PAS migrer** le legacy LDAP/openid/github/google (LDAP → plugin externe `@nodefony/auth-ldap` ; OIDC/social fusionnés dans `OAuth2`).
- **`firewall.ts`** (réécrit du `firewallService.js`, découper A/B/C) : matche les **areas** (regex `pattern`),
  chaîne d'authenticators, **Zero Trust par défaut**. + **`cors.ts`** + **`csrf.ts`** (double-submit + Origin check, stateless).
- **`defineSecurityConfig()`** (builder type-safe + **Zod** au boot, style Vite) : `encoders`, `roleHierarchy`,
  `areas{pattern,stateless,authenticators,accessControl,waf}`, `oauth2.providers`. Secrets → SecretProvider (P16). Détecte conflits de patterns au boot.
- **Authorization (P6.8) — 3 niveaux** : **A** `roleHierarchy` + `RoleHierarchyWalker` (flatten DFS précomputé au
  boot, **throw sur cycle**) ; **B** RBAC ORM `IRole`/`IPermission` (`PERM_*`) ; **C** Voters `IAccessVoter`
  (`GRANT/DENY/ABSTAIN`, **affirmative + DENY veto**, **default DENY** si tous ABSTAIN, découverte DI auto).
  Dispatch par préfixe `ROLE_*` → A, `PERM_*` → B, sinon Voter.
- **Décorateurs (P6.8b)** : `@IsGranted` · `@Anonymous`/`@Public` · `@HasAnyRole`/`@HasAllRoles`/`@HasCurrentRole`
  · `@CurrentUser` (ALS, jamais null grâce à `AnonymousUser`) · `@AuditLog` · `@WafGuard` · `@CsrfProtect` ·
  `@RateLimit`. Via `Reflect.metadata("security:requirements")` lu au hook **`beforeResolve`**. AND implicite, 1er DENY stoppe.
- ⚠️ **20 sous-décisions différées AU CODE** (10 authz + 10 décorateurs) → trancher avec un **cas concret**
  (controller test combinant plusieurs décorateurs + un Voter), figer les signatures, tests dans la foulée, MAJ MIGRATION_STATUS.
- Réfs design : mémoires `project_security_module_design` · `project_nodefony_user_module` ·
  `project_security_authorization_pending` · `project_security_decorators_pending` ·
  `project_security_stateless_http_decision` · `project_decisions_p5_p6_orm`.

### Carte des phases P0→P16 (lire MIGRATION_STATUS pour % + détail réels)

- **P1-P4 ✅ BUILT → recettes §4** : lifecycle/ALS/hooks (P1), Context teardown/abort/timing (P2), logs
  structurés/audit/error-renderer (P3), symbiose http↔framework (P4).
- **P5 ✅** orm-core + `@nodefony/user` · **P6 ⬜** Security (design figé ci-dessus) · **P7 ⬜** drivers ORM
  prod (Postgres/MySQL Drizzle, MikroORM) + User Sequelize/Mongoose (P5.7/5.8).
- **P8 / P11** CLI + monitoring + commandes par module (cf recette CLI §4 ; bug commandes-module à traiter) ·
  **P9** polish/clôture.
- **P10** Studio admin (frontend → `nodefony-studio-dev`) · **P12** couche IA agentic
  (llm/rag/vector/agent/memory/**agent-guard**/**mcp** — _squelettes vides_, dernière migration).
- **P13** realtime/redis/client → **cf §6** · **P14** frontend Vite (→ `nodefony-create-frontend-module` /
  `nodefony-studio-dev`) + Core isomorphe (cf §4) · **P16** cloud-native (reusePort `--workers N`, SecretProvider, retrait PM2).

### Méthode pour une phase non-faite

1. `MIGRATION_STATUS.md` (scope/deps/chemin critique) + skill `nodefony-roadmap`. 2. Charger les mémoires de
   design figé (ne pas re-débattre l'acté). 3. `nodefony-create-module` si nouveau module. 4. Coder avec les
   recettes **§4-6** (Service/DI/Module/Entity/Realtime). 5. Gates **§8** + sécu **§10** + RETEX **§11**.

## 8. Gates qualité (AVANT commit — l'ordre compte)

```bash
# 1. BUILD (rollup, par module modifié ; clean+build si pull/merge/refactor croisé)
cd src/packages/@nodefony/<mod> && npm run build          # ou : npm run build (turbo, racine)

# 2. TYPECHECK — gate DISTINCT du build (tsc rejette ce que rollup ne fait qu'AVERTIR : ex TS18036)
npm run typecheck                                          # racine (turbo) — core a `tsc --noEmit`
npx tsc --noEmit                                           # ou direct dans le module ciblé

# 3. TESTS unitaires
#    core   : cd src/nodefony && npm run test              (tsx + mocha)  | coverage = npm run coverage (monocart)
#    http/fw: cd src/packages/@nodefony/<mod> && npm run test   (vitest)  | coverage = npm run coverage (vitest)

# 4. INTÉGRATION (serveur requis 5151/5152 — cf nodefony-start-server)
cd src/packages/@nodefony/<mod> && npm run test:integration

# 5. 🚨 SUITE LOURDE — si modif Kernel / pipeline request / cycle de vie / mémoire (OBLIGATOIRE)
cd src/packages/@nodefony/http && TS_NODE_PROJECT=tsconfig.tests.json \
  npx mocha --config .mocharc.load.json --grep "Memory"   # ou skill nodefony-check-memory-health

# 6. Symboles (régénérés par le hook pre-commit, mais utile manuellement)
npm run generate-symbols
```

- **Pourquoi typecheck séparé** : rollup tolère/avertit là où `tsc --noEmit` rejette (TS18036
  `static #x` + décorateur de classe a cassé toute la CI le 2026-05-22). Toujours typecheck avant push.
- **Filet local = hooks git** (posés 2026-05-22) : **pre-push** `tsc --noEmit`, **commit-msg** commitlint,
  **pre-commit** lint-staged (prettier-only) + pré-filtre symbols. eslint racine = `warn` (jamais
  bloquant au commit). Tout bypassable `--no-verify`.
- **Tests perf à seuil temporel** : ne gatent PAS la CI (runners non déterministes) → skippés si `CI`
  (root hook mocha `perf-skip.cjs`). Ne pas les « réparer » en CI, c'est voulu.
- `npm run build` (sans clean) ne recompile que les workspaces modifiés (cache turbo) → après
  pull/merge/changement d'`index.ts` public → `npm run clean && npm run build`.
- Vérif dist à jour : `grep -E "^export\s*\{" src/packages/@nodefony/<mod>/dist/index.js | head -1`.

## 9. Gotchas (table condensée)

| Symptôme                                                      | Cause                                                                 | Fix                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Cannot read … of null` à l'import d'un module                | `Nodefony.getKernel()` au top-level                                   | getter lazy / guard `?.`                                                                           |
| Hook lifecycle jamais appelé                                  | hook en arrow/property                                                | méthode **prototype** `async onKernelBoot() {}`                                                    |
| `RequestContext.get()` = undefined dans message/close/finish  | listener non bindé                                                    | `AsyncResource.bind(fn)` au bind                                                                   |
| `Cannot read 'environment'` (CliKernel ctor)                  | env `undefined` au ctor                                               | set dans `onKernelStart()`                                                                         |
| `@inject()` sans nom ne résout pas                            | tsx n'émet pas `design:paramtypes`                                    | `@inject("nom")` explicite                                                                         |
| `does not provide an export named 'default'/'Error'/'kernel'` | ancienne API                                                          | `import { Nodefony }`/`nodefonyError`/`getKernel()`                                                |
| TS18036 / build vert mais CI rouge                            | rollup avertit, tsc rejette                                           | `npm run typecheck` avant push                                                                     |
| 404 sur route pourtant définie                                | dist périmé (test module)                                             | rebuild test + restart (`nodefony-start-server`)                                                   |
| `Cannot add option '-v, --version'`                           | `setCommandVersion()` 2×                                              | le ctor `Cli` le fait déjà                                                                         |
| Turbo rejoue de vieux logs/tests                              | fix dans dep non déclarée n'invalide pas le cache                     | `--force` ou build direct du module                                                                |
| `ERR_INVALID_CHAR` statusMessage                              | Node poison le natif avant validation                                 | `replace(/[^\x20-\x7E]/g,"")` avant `writeHead`                                                    |
| WS array protocol ne matche pas                               | `['a','b']`→header `"a, b"`≠`"a"`                                     | string exacte ou `""` (accepte tout)                                                               |
| HTTP/2 réponse sans `x-request-id`                            | `stream.respond()` bypasse `super.writeHead`                          | poser le header dans le chemin http2 aussi                                                         |
| Superviseur dev orphelins saturent la machine                 | spawn detached sans garde                                             | pidfile + SIGHUP + group-kill (déjà en place) ; ne JAMAIS spawn serveur en background sans cleanup |
| SSE/long-polling : cleanup ne fire pas (HTTP/2)               | `request.on("close")` fire dès la fin du stream request               | écouter `rawRes.once("close")` (la RESPONSE)                                                       |
| `pdu.severity === "INFO"` faux                                | severity = number                                                     | comparer `pdu.severityName === "INFO"` ; nom = `CRITIC` pas `CRITICAL`                             |
| `url.parse()` deprecated                                      | API legacy                                                            | `new URL(str, "http://localhost")` partout                                                         |
| `@controllers` absents avant boot                             | enregistrés sur `onBoot`                                              | accéder aux controllers après le boot kernel                                                       |
| Params de route mélangés entre requêtes concurrentes          | `Route.variablesMap` vivait sur l'instance Route **statique** (bleed) | lire via `Resolver.getMatchedParams()` (snapshot per-requête), jamais d'état requête sur la Route  |

## 10. Sécurité & conformité (PRIORITÉ MAX — directive permanente)

Nodefony doit être une **référence** sécurité (dev classique + agentic). Sur CHAQUE diff :

- SQL/ORM **bindé** ; **0 secret** loggé/renvoyé en clair (redaction serveur) ; **0 `any`** ;
  **Zero Trust** (API admin → 403 sans rôle) ; JWT stateless cookie HttpOnly Secure SameSite ;
  crypto mdp (bcrypt/argon2, jamais MD5/SHA1) ; entrées **validées** au boundary ;
  endpoints qui EXÉCUTENT (run tests/scaffold) → **DEV-ONLY** (403 hors `development`).
- **Avant commit** → passer le diff au skill **`nodefony-security-review`**. Signaler tout écart proactivement.

### Sources normatives à CONSULTER (ne jamais trancher de mémoire)

| Domaine                                                  | Source / skill                                                                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocole HTTP/HTTP2/WS/CORS/cookies                     | skill **`nodefony-rfc`** (RFC 9110/9113/6455/6265, Fetch — IETF/W3C bruts)                                                                                                                                              |
| Types TS / API Node.js                                   | skill **`nodefony-ts-docs`** (handbook, @types/node)                                                                                                                                                                    |
| Sécu applicative (checklist vérifiable)                  | **OWASP** : ASVS + Cheat Sheet Series en **raw GitHub** — `raw.githubusercontent.com/OWASP/ASVS`, `raw.githubusercontent.com/OWASP/CheatSheetSeries` ; Top 10 via proxy                                                 |
| Recommandations & vulnérabilités (FR, autorité étatique) | **ANSSI / CERT-FR** via **proxy** : guides `https://r.jina.ai/https://cyber.gouv.fr/publications` (sécurisation web, RGS crypto) ; avis/alertes `https://r.jina.ai/https://www.cert.ssi.gouv.fr/avis/` et `.../alerte/` |

⚠️ **Règle universelle** (CLAUDE.md racine) : NE JAMAIS charger les pages HTML lourdes
(`owasp.org`, `cyber.gouv.fr`, `cert.ssi.gouv.fr`, `tools.ietf.org`) directement → toujours **raw
GitHub** ou **proxy `https://r.jina.ai/`**. Citer la source (RFC §, OWASP ASVS V#, CERT-FR n°) dans le
commit/diff quand un choix sécu/conformité s'y appuie.

> Réflexe : touche à de la crypto / un header de sécu / une entrée non maîtrisée / une dépendance
> sensible → vérifier OWASP (Cheat Sheet du sujet) **et** un éventuel avis ANSSI/CERT-FR sur la lib/version
> AVANT de livrer, puis `nodefony-security-review`. La sécurité prime sur la vitesse.

### Dépendances & supply-chain — `npm audit` (OWASP A06 : composants vulnérables)

Une faille la plus fréquente n'est pas TON code mais une **dépendance**. AVANT d'ajouter/bumper une dep,
et périodiquement :

```bash
npm audit                       # CVE connues dans tout l'arbre (workspaces inclus)
npm audit --omit=dev            # ne garder QUE les deps de prod/runtime (ce qui ship réellement)
npm audit --audit-level=high    # gate : échoue si ≥ high (utile en CI)
npm outdated                     # versions en retard (ou commande `npx nodefony outdated`)
```

- ⚠️ **`npm audit fix --force` = INTERDIT sans accord** (bump majeur → casse). Lire l'avis, bumper la
  version **précise** corrigée, re-tester (build + typecheck + suite). `--force` rebascule des majeures.
- **Distinguer prod vs dev** : une CVE dans une devDep (build/test) ≠ une CVE runtime exploitable.
  Prioriser `--omit=dev` ; documenter le résiduel accepté.
- **Avant TOUTE nouvelle dep runtime** (règle CLAUDE.md) : peser bundle size + mémoire + maintenance +
  surface d'attaque ; préférer l'API Node native. Vérifier mainteneur/téléchargements/dernière release
  (typosquatting, paquet abandonné). Une nouvelle dep doit être **externalisée** dans le rollup si peerDep
  (cf skill `nodefony-check-externals`).
- **Lockfile** : commiter `package-lock.json` ; ne jamais éditer l'arbre à la main. Croiser une CVE avec
  un **avis CERT-FR/ANSSI** (§ sources) sur la lib/version pour la criticité réelle.
- Idéal CI/hook : `npm audit --omit=dev --audit-level=high` en avertissement (non bloquant au commit,
  comme eslint), revu périodiquement.

## 11. RETEX — problèmes & solutions (kit VIVANT, à enrichir)

> Format : symptôme → cause → fix. Compléter à CHAQUE fin de session touchant le cœur.

- _(2026-05-31)_ **Trace full-stack du Log Backplane** (commit `c48858b` back). 4 leçons : (a) un log de
  **FIN** de cycle émis APRÈS le teardown ALS (hors bulle `AsyncLocalStorage`) perd son `requestId` → ne
  JAMAIS compter sur l'ALS pour la corrélation en SORTIE de pipeline : attacher le `requestId` **depuis le
  `context`** (qui le porte explicitement) au moment du log teardown (`Context.ts` / `WebsocketContext.ts`).
  (b) **L'ordre chronologique d'un flux de logs = l'`uid` monotone du Pdu, PAS `Date.now()`** : deux Pdu de
  la même ms se départagent par uid (l'horloge n'a pas la résolution). (c) **`maxStack` est un produit de
  config**, pas une constante magique — exposé/bornable (un trace full-stack non borné = DoS mémoire sur
  burst d'erreurs). (d) **Le driver de démo (console queryable) vit dans le MODULE TEST** (`DbController`),
  JAMAIS dans le core : le core expose `ILogDriver`/`filterPdus`, l'app branche son driver. **Méta-leçon** :
  toute corrélation (requestId, traceId) qui dépend d'un contexte async DOIT survivre au teardown → la porter
  sur un objet explicite, jamais sur l'ALS qui se vide.

- _(amorce 2026-05-22)_ **TS18036** (`static #storages` + décorateur de classe `sessions-service.ts`) :
  build rollup vert mais `tsc --noEmit` rouge → CI cassée (job build rouge ⇒ tests jamais lancés).
  Fix : `private static` au lieu de `static #`. **Leçon** : typecheck = gate distinct, désormais hook pre-push.
- _(amorce)_ **Superviseur dev** lancé `detached` sans garde → instances orphelines empilées (16) →
  machine saturée. Fix : single-instance (pidfile + SIGHUP + group-kill). **Leçon** : ne JAMAIS spawn
  serveur/superviseur en background sans cleanup dans la même tâche.
- _(amorce)_ **Tests perf à seuil absolu** flakaient en CI (runners non déterministes) → skip si `CI`.
- _(2026-05-22)_ **Race de shutdown session-sur-Drizzle** (`unhandledRejection: DrizzleOrm "default":
no entity table registered under "session"`, code 401, au Ctrl+C) : `DrizzleService` déconnecte
  l'ORM sur `onTerminate` (annule ses tables) AVANT que les serveurs http aient drainé → une requête
  en vol (page Twig → firewall `startSession`) retouche l'ORM mort. Aggravé par le **GC probabiliste
  de session lancé fire-and-forget SANS `.catch()`** (`sessions-service.start`) → rejet non géré qui
  casse le process. Fix double : (1) le GC opportuniste catche+loggue ; (2) `SessionStorage` (Drizzle)
  dégrade gracieusement quand `!orm.isConnected()` (read→vide, write/gc/destroy/open→no-op). **Leçons** :
  (a) toute promesse fire-and-forget dans le pipeline DOIT `.catch()` ; (b) un service infra doit tolérer
  d'être sollicité pendant le shutdown ; (c) reproduire une race de shutdown = boot enfant direct +
  marteler une route + SIGINT (cf recette §4 « Debug runtime »). Commit `ce181ba`.
- _(2026-05-22)_ **Passe RFC complète du cycle** (HTTP+WS). (a) `application/json` portait `; charset=utf-8` →
  retiré (RFC 8259 §11). (b) Auto-JSON gardé + WARN dev sur retour pendant (le « trap »). (c) Codes close WS
  refaits via helper pur `toWsCloseCode` (pas de `4404` inventé — 4xx→4004) + `connection.on("error")` ajouté
  (manquait → crash process possible sur erreur socket). (d) **`maxPayload` WS** câblé (n'était PAS passé à `ws`
  → 100 MiB implicite = DoS mémoire) défaut 1 MiB → close 1009. (e) `forward` du module test pointait un
  controller **inexistant** (`app:AppController` → forward cassé). **Leçons** : (1) toujours vérifier la RFC EXACTE
  d'un comportement « raisonnable » (charset JSON, 4xxx privé) via `nodefony-rfc` ; (2) toute socket ws SANS
  `on("error")` peut crasher le process ; (3) une option de lib (`maxPayload`) « par défaut » non passée = trou
  silencieux — l'auditer. Commits `50d21cf` (1009) + tests headers/forward/stream-load.
- _(2026-05-22)_ **turbo restaure du dist caché** : `clean && build` ne busте pas le cache → runtime sur vieux
  code (route qui hang, header périmé). Fix systématique : `npx turbo run build --force --filter=…` avant test
  runtime d'un diff non commité. (Promu en piège structurel §2.)
- _(2026-05-23)_ **Sonde flux ORM = nouveau hot path → gating env-aware par le driver**. Un compteur
  global force à chronométrer CHAQUE requête (même sans ALS) → contraire au « coût nul prod ». Réconcilié
  SANS perdre l'observabilité dev : `queryFlowMonitor.enabled` **OFF par défaut**, activé par le driver au
  boot (`setEnabled(env!==production)`). Les bancs `test:load` instancient l'adapter **hors kernel** →
  flux reste OFF → **0 régression** mesurée (insert 16k ops/s, scan 1M ops/s inchangés). **Leçons** :
  (1) une sonde always-on doit être **gatée par le composant qui connaît l'env** (orm-core lib pure ne le
  connaît pas → c'est le module driver) ; (2) `toSQL()`/sérialisation **seulement sur le chemin lent**
  (rare) — l'agrégat ne paie jamais le texte au cas nominal ; (3) débit/s **dérivé** (delta `total`/`ts`,
  comme CPU%) → 0 état de lecture, robuste sous saturation event-loop ; (4) **0 persistance** (une sonde
  n'écrit jamais dans la base qu'elle observe : amplification absurde + pollution hot path). Validé live :
  248k requêtes comptées, slow réelles capturées (SQL paramétré, 0 credential). Per-connecteur via `ormName`
  passé au tap (≠ vendor).
- _(2026-05-24)_ **Sonde Socket Nodefony — compteurs always-ON (≠ flux ORM gaté) + bufferedAmount via le transport**.
  Contraste assumé avec la sonde flux ORM : ici les compteurs (`publish`/`send`) sont **toujours actifs** car ce ne
  sont que des **incréments d'intégers O(1)** (0 syscall, 0 stringify, 0 alloc) — alors que le flux ORM chronométrait
  CHAQUE requête (`performance.now()`+`toSQL()`) → lui devait être gaté. **Leçon** : « gater une sonde » dépend de
  son COÛT unitaire réel, pas d'un réflexe ; un compteur entier ne se gate pas, un timer/serializer si. Le
  `bufferedAmount` (risque #1) vit sur la conn `ws` brute → la sonde ne peut PAS le lire depuis le hub (qui n'a que
  des sinks opaques) : exposé par `WsConnectionTransport` (seul à tenir la conn), connexions inscrites au registre du
  hub par le controller (handshake/onFinish, **symétrique** = 0 fuite). Cumuls **monotones** → débit dérivé côté
  lecteur (réutilise le patron CPU%/flux ORM). Validé live (curl + WS subscribe → connectionCount/canal/fan-out
  reflétés, canal disposé au close). **Décision archi** (questions user) : pas de module `@nodefony/realtime` au milieu
  de la feature (scope ×3, contre 1 feature=1 session) → hub/sonde restent dans framework, déménageront en bloc P13.1 ;
  config realtime future = section `realtime` de `@nodefony/http`. Nommage « la Socket Nodefony » (cf §4 + mémoires).
- _(2026-05-24)_ **Port `IBackplane` AVANT toute impl (Phase 1 cluster sans PM2)** : refacto du hub pour séparer
  `publish` (fan-out local **+** propagation cross-process) de `publishLocal` (fan-out local SEUL = voie d'ingress).
  **Leçon archi** : définir le PORT et le PROUVER avec un backplane factice + un `LoopbackBackplane` no-op AVANT
  d'écrire l'IPC/Redis — sinon on code une API qui ne marche qu'avec Redis. Tester le contrat avec **2 backings dès
  le départ** = la garantie du drop-in. **Anti-boucle = 2 barrières** (ingress→`publishLocal` jamais `publish` ; le
  backplane filtre son `originId`). **Perf** : `#backplane=null` par défaut (lazy, comme le reste du hub) → 0 overhead
  mono-process, pas même un appel de méthode no-op ; le Loopback matérialise le contrat sans être sur le hot path.
  Refacto pur (runtime inchangé) → mémoire WS 8/8 verte, 0 régression. Commit `ac21bec`,
  [[project_cluster_backplane_vision]]. PROCHAINE = Phase 2 (lifecycle cluster CORE : `nodefony cluster`, fork
  **cgroup-aware** — jamais `os.cpus()` aveugle en conteneur —, respawn backoff, `isPrimary`) → session core dédiée.
- _(2026-05-25)_ **Généraliser une agrégation cluster = enrichir le COLIS, pas l'agrégateur** (santé pod ORM+erreurs,
  P16.H.7, commits `aa9b6fc`/`7ab9219`). `ClusterProbeAggregator` est **opaque** (garde le dernier payload/worker +
  broadcast) → l'étendre « aux 3 sondes » = **0 ligne dans l'agrégateur** : on ajoute des champs **additifs** au report
  per-worker (`IRealtimeHealth.orm`/`.errors`, comme `process?`/`rich?` l'avaient été) et le merge pod les somme.
  **Leçons** : (1) un agrégat opaque ne se généralise PAS en le modifiant, mais en enrichissant ce qu'il transporte
  (chercher l'opacité AVANT de coder) ; (2) **dépendance propre par seam core** : `framework` (assemble le report) ne
  doit PAS importer `orm-core` → contrats `IOrmLeanHealth`/`IInstanceErrorHealth` + `setOrmHealthProvider`/`readOrmHealth`
  dans le CORE (plus bas dénominateur commun), le **driver** branche l'impl au boot (même pattern que `setClusterProbeClient`) ;
  (3) **gater une sonde dépend de son coût unitaire** (revu) : compteurs erreurs Syslog = 2 incréments entiers gardés
  `sev>=0 && sev<=3` dans le SEUL `pushStack` → **always-ON** (mémoire 8/8, 0 ΔMB), comme la sonde socket et ≠ flux ORM
  (qui chronométrait → gaté) ; lean ORM = lecture pure des singletons déjà alimentés (0 ping/0 toSQL). (4) **`mergeX`
  avec champs optionnels** : annoter `const totals: IX["totals"] = {…}` (sinon TS infère le type fermé → `totals.orm =`
  rejeté). Tests : core 5 / orm-core 2 (agrégat en **delta** baseline avant/après car singletons sans reset) / framework 13.
- _(2026-05-25, PROCESS)_ **`.git/index.lock` orphelin = `git stash pop`/commit échouent silencieusement** (« error:
  could not write index »). Vécu en faisant un `git stash -u` pour prouver une erreur pré-existante : le pop a échoué,
  les edits sont **restés dans le stash** (working tree = original) → fausse impression de perte. Fix : `rm -f
.git/index.lock` puis `git stash pop`. **Leçons** : (a) après tout `git` qui « réussit » mais dont l'effet manque,
  vérifier `.git/index.lock` + `git stash list` (le pop a-t-il vraiment eu lieu ?) AVANT de recoder ; (b) prouver une
  erreur pré-existante via `git stash` est utile mais **risqué avec un hook/lock husky** — préférer `git worktree` ou un
  `tsc` sur le commit parent. Garde-fou husky `index.lock` = [[project_retex_improvements_kit]] #I (le + rentable).
- _(2026-05-25, RELAIS ORM RICHE @pid)_ **Généraliser un drill @pid existant = AJOUTER UNE FACETTE, pas un 2ᵉ flux.**
  Le drill supervision (`dashboard:supervision@<pid>`) avait déjà tout le câblage IPC (ctl→enrich→report `rich`→
  snapshot→`clusterProbeInstance`). Pour le drill ORM, **0 nouveau kind/flux** : on a ajouté un champ **`facet`
  (`"process"|"orm"`)** optionnel (défaut process = rétro-compat) aux messages ctl/enrich → 2 sondes riches
  **indépendantes** (le drill ORM n'allume pas la sonde process). **Leçons** : (1) chercher le mécanisme EXISTANT
  le plus proche et le PARAMÉTRER (facette) plutôt que dupliquer un pipeline ; (2) **gérer l'ASYNC d'une sonde riche
  par un cache** : `RichProcessProbe.read()` est sync, mais le rich ORM (`buildConnectionHealth` **ping** = async) ne
  peut pas être lu dans le report sync → ticker `#startOrmRich` qui rafraîchit `#ormRich`, le report joint le cache
  (absent = 0 surcoût) ; (3) **seam core opaque** (`setOrmRichProvider(()=>Promise<unknown>)`/`readOrmRich`) comme le
  lean → `framework` n'importe pas `orm-core`, le **driver** branche `{health,flow}` ; (4) **canal combiné** `orm:rich@<pid>`
  (pas `orm:health@pid` + `orm:flow@pid`) = **1 canal = 1 enrich**, le RealtimeHub dédoublonne déjà par nom de canal
  → **pas de ref-count** d'enrich (2 canaux séparés → un unsub couperait l'autre). (5) **Caveat assumé (= supervision)** :
  2 workers drillant le MÊME pid → un `stop` côté master coupe pour les deux (pas de ref-count master-side ; best-effort,
  rare). Tests : core 4 (facette guards + seam rich + aggregator forward) / framework 4 (ctl orm + report ormRich on/off +
  facette n'active pas process) / **e2e cross-process `cluster-orm-rich-e2e.mjs`** (A drille pidB → ormRich marqué "B" +
  health/flow → stop = absent). memory.test 7/8 (sync-crashes = flake GC connu, vert isolé ; mon code cluster-only).
- _(2026-05-29, RÉSILIENCE BOOT Ph.3 + GAIN emitAsync + DETTE CONFIG ordering)_ **Séparer MÉCANIQUE (Event) de
  POLITIQUE (Kernel) → hot path nu CONSERVÉ et même accéléré.** `Event.emitAsyncGuarded(event, options, …args)`
  (série + try/catch + timeout/listener + `{results,errors,stopped}` + callbacks `onListenerError`/`onListenerSlow`)
  = mécanique pure ; `Kernel.fireLifecycle` = politique (tags owner/critical via `kernel/lifecycleTags`, fatal si
  `critical&&prod` sinon fail-soft+WARNING) ; migrée sur `onPreRegister→onPostReady` SEULEMENT (pas onPreStart/
  onStart = flux commander/--help). `Module.static critical` (false : studio/redis/realtime/mediasoup/test-frontend-\*).
  `withTimeout`/`TimeoutError` (`runtime/`) + `guardInitialize` (timeout autour de addModule/addKernelService.initialize).
  Env `NODEFONY_BOOT_TIMEOUT_MS` (dev 20s/prod 60s) / `_WARN_MS` (5s). **Leçons** : (1) **`Service` COMPOSE `Event`
  (`this.nc`), n'étend PAS EventEmitter** → toute nouvelle méthode event = ajout à Event ET re-export Service
  (délégation miroir) ; `super.emitAsyncGuarded` depuis Kernel échoue (TS2339) tant que Service ne la déclare pas.
  (2) **`once()` wrappe le listener** → `rawListeners` rend le wrapper, pas la fn taguée → `readListenerTags` DÉBALLE
  `.listener`. (3) **GAIN `emitAsync` sans risque** : `if (listenerCount===0) return false` AVANT `rawListeners`
  (évite l'alloc array du cas dominant 0-listener) + `await` conditionnel (skip microtask si retour non-thenable)
  → microbench **A/B inline hors repo** (vieux vs neuf côte à côte, PAS git stash) = **+14→30 %**. (4) **isomorphe** :
  guarded AUTONOME dans Event (0 import — `runtime/withTimeout` node-only, absent du build client ; timeout via
  sentinelle Symbol locale + `Date.now`). (5) **`Module.critical` = STATIC** (lue au ctor via `(this.constructor as
typeof Module).critical`, AVANT les initializers de sous-classe → `critical=false` en property d'instance serait
  trop tard). (6) **DETTE CONFIG ordering RÉSOLUE** : l'override `module-<name>` ne peut PAS être un listener
  `onPreRegister` (les modules sont construits PENDANT ce fire → un listener ajouté en cours d'emit n'est jamais
  rappelé) → `Kernel.applyModuleConfigOverrides()` centralisé APRÈS le fire onPreRegister, AVANT onRegister
  (validation Zod) ; prouvé runtime (backplane realtime `driver=redis` enfin pris en compte). (7) tests encodant
  l'ANCIEN contrat (throw en dev fait rejeter le boot) → réécrits sur le nouveau (fail-soft dev / fatal prod).
  Commits `f3b749d` + `55b7202`. memory.test 8/8 (async-crashes = flake isolé). Diagnostic dette CLI
  commander↔kernel + changelog commander 15 ESM-only → [[project_cli_module_command_dispatch]] ·
  [[project_config_ordering_chantier]] RÉSOLU.
- _(2026-05-30, F5 GOTCHAS DÉCORATEURS — confirmer terrain AVANT de coder)_ **Un « gotcha » daté peut être
  déjà résolu OU un vrai bug RFC.** Audit des 5 gotchas [[project_framework_decorators]] : #5 `queryGet ?name`
  **déjà corrigé** (`Request.ts` `QS.parse(search.slice(1))` — le `.slice(1)` retire le `?`) → ne pas « re-fixer »
  un truc résolu ; #3 `redirect()` **vrai bug** : `if (status===302){…}else{status=301}` forçait TOUT code ≠ 302
  → 301 → un `redirect(url, 307|308)` perdait **silencieusement** la préservation de méthode (POST→GET) = faille
  fonctionnelle, et 301 par défaut = cache permanent navigateur quasi irréversible. Fix : whitelist RFC 9110 §15.4
  `{301,302,303,307,308}` (Set module-level **0 alloc/appel**), **défaut 302** (aligné Express/Symfony), invalide
  → fallback 302 + WARNING. **Leçons** : (1) **confirmer chaque gotcha contre le SOURCE** avant de coder (la moitié
  étaient périmés/voulus, un seul réel) ; (2) un `else { force }` au lieu d'une **whitelist** est le motif récurrent
  du bug « valeur valide écrasée » — chercher ce pattern ; (3) **citer la RFC** (skill `nodefony-rfc`, ici §15.4 :
  307/308 préservent méthode+corps, 303 force GET) plutôt que trancher « 302 c'est raisonnable » ; (4) impact
  back-compat = 0 (défaut 301 = bug, pas contrat ; les 301 EXPLICITES restent dans la whitelist → intég 59 fw +
  720 http verts). #1 collision noms d'action (`session`/`request`/…) = TOUJOURS présent mais **doc juste** → pas
  de garde au boot (sur-ingénierie hors scope F5). Tests `Response.test.ts` +7. memory 8/8 (native-crash vert isolé).

## 12. Fin de session (OBLIGATOIRE) + auto-audit de complétude

À toute fin de session touchant le cœur : ajouter ICI (§11 RETEX) les problèmes rencontrés + fix, et
toute nouvelle brique/convention. Répartition : **stats** de session → `docs/session-retros/` ;
**leçons cœur** → ICI ; **fait isolé/décision archi** → mémoire IA dédiée + lien `[[name]]`.

### Vérifier que ce skill n'a RIEN oublié (audit reproductible)

On ne « se fie » pas à la mémoire : on **diffe le skill contre la surface réelle du repo** (3 sources de
vérité). À relancer quand on ajoute un module/une phase, ou avant de figer le skill :

```bash
SK=.claude/skills/nodefony-framework-dev/SKILL.md
# 1. PACKAGES : chaque @nodefony/* est-il cité ?
for d in src/packages/@nodefony/*/; do n=$(basename "$d"); grep -qi "$n" "$SK" || echo "❌ pkg absent : $n"; done
# 2. SYMBOLES CORE : chaque brique exportée a-t-elle une recette/mention ?
jq -r '.symbols|to_entries|map(select(.value.module=="nodefony" and .value.exported))|.[].key' .ai/symbols.json \
  | while read s; do grep -q "$s" "$SK" || echo "⚠️ symbole non cité : $s"; done
# 3. PHASES : chaque phase de MIGRATION_STATUS est-elle dans la carte §7 ?
grep -oE "P[0-9]+" MIGRATION_STATUS.md | sort -uV | while read p; do grep -q "\b$p\b" "$SK" || echo "—  phase non citée : $p"; done
```

- **Interpréter, pas appliquer aveuglément** : un symbole interne ou un module hors cœur (frontend/studio/IA)
  **n'a pas** à être détaillé ici — il doit juste être **aiguillé** (vers `nodefony-studio-dev`,
  `nodefony-create-frontend-module`, `nodefony-roadmap`). Un absent légitime = OK ; un absent **cœur** = trou à combler.
- **Autres garde-fous** : (a) **vérifier les recettes contre le SOURCE** (pas seulement les docs MEMORY — elles
  dérivent) ; (b) **dry-run** mental : « avec CE skill seul, puis-je créer une entité / coder P6 sans rouvrir le repo ? » ;
  (c) **description ≤ ~1100 car.** (sinon tronquée → triggers perdus) ; (d) éval triggering via `skill-creator`.
- ⚠️ **Granularité** : l'audit symboles sur http/framework remonte des **alias de types** (`HttpRequestType`,
  `IErrorHttpResult`…) = **bruit**, pas des trous → auditer au niveau **concepts-clés** (classes/décorateurs/services
  qu'un dev écrit), pas chaque export. Le check `nodefony` (core) lui est propre = significatif.
- Dernier audit : 2026-05-22 → core 100 % cité ; packages `agent-guard`/`mcp` = squelettes vides (P12, aiguillés) ;
  P1-P4 BUILT (recettes §4). **Trous comblés suite à l'audit** : Cookies + points d'extension logger/error-renderer
  (§4). Reste = bruit d'alias de types (non pertinent).

### 🔁 Maintenance & versionnement — boucle d'auto-amélioration (OBLIGATOIRE)

Ce skill **doit s'améliorer à chaque session cœur** — sinon il pourrit. À CHAQUE session qui touche le
cœur (avant le commit final) :

1. **Mettre à jour la/les section(s) concernée(s)** : nouvelle recette/signature/gotcha → l'intégrer DANS
   la bonne section (pas un dépotoir en fin de doc). Une décision archi figée → la refléter (§7 pour le futur).
2. **RETEX §11** : ajouter symptôme→cause→fix de tout piège rencontré.
3. **Bump SemVer** (frontmatter `version`) : **patch** = gotcha/fix/précision · **minor** = nouvelle recette/section ·
   **major** = refonte structurelle. + **ligne au changelog** ci-dessous (date + résumé).
4. **Re-lancer l'audit de complétude** (ci-dessus) si un module/une phase a bougé.
5. **CO-ÉVOLUTION du skill jumeau** (cf « Paire polymorphe » en tête) : si la feature a touché le **contrat
   consommé par le front** (canal/action/endpoint/type), **MAJ `nodefony-studio-dev` dans la MÊME session**
   (retex cross-lié, même apprentissage 2 angles). Les deux skills « dev ensemble » → jamais l'un sans l'autre
   sur une feature full-stack.
6. Git versionne le fichier (history) ; le changelog interne = mémoire lisible par l'agent au prochain chargement.

> But (directive user) : que l'IA **apprenne à développer Nodefony parfaitement** et **s'auto-développe** —
> chaque session cœur rend ce kit plus juste. Vérité = le **source** (vérifier, ne pas se fier aux docs seules).

## Réfs (CLAUDE.md/MEMORY.md — détails)

Core : `src/nodefony/{CLAUDE,MEMORY}.md` + sous-modules `src/{kernel,kernel/injector,cli,syslog,finder}/MEMORY.md` ·
http : `src/packages/@nodefony/http/{CLAUDE,MEMORY}.md` · framework : `…/framework/{CLAUDE,MEMORY}.md` ·
test : `src/modules/test/{CLAUDE,MEMORY}.md`.
Mémoires IA : `feedback_perf_memory_rule`, `feedback_security_rfc_rigor`, `project_als_ws_bug`,
`project_command_architecture`, `project_injection_plan`, `project_clikernel_lifecycle`,
`feedback_watch_rollup_pitfall`, `project_studio_page_playbook` (gabarit frontend).

## Changelog (SemVer — cf §12)

- **1.17.0** (2026-05-31) — **Trace full-stack du Log Backplane** (commit `c48858b` back + `3d6158e` front ;
  lockstep avec studio-dev 1.17.0 — un contrat front+back EST touché → bump MINOR partagé). BACK (`@nodefony/core`) :
  `Kernel.ts` émet une trace de cycle ; `Syslog.ts` `maxStack` configurable ; `Context.ts`/`WebsocketContext.ts`
  attachent le `requestId` **depuis le context** au log teardown (survit à la sortie de bulle ALS) ; `ILogDriver`
  + `filterPdus` (data plane) ; driver console queryable de DÉMO posé dans le **module test** (`DbController`),
  pas dans le core. Ordre chrono = `uid` du Pdu (pas l'horloge). Gate : tsc 0 · boot OK · memory 8/8.
  RETEX §11 (corrélation async survit au teardown ; uid > horloge ; maxStack = config ; driver de démo hors core).
- **1.16.3** (2026-05-30) — **Durcissement framework F7 — config Zod validée au boot.** `nodefony/config/schema.ts`
  (Zod, source unique) + `config.ts` dérivé `parse({})` + hook `onKernelRegister` (parse + try/catch message clair +
  réassigne `this.options`, AVANT instanciation `@services`). peerDep `zod ^4.4.3` + `"zod"` ajouté à `rollup.config.ts`
  external. `meta` (flag `reserved`) **importé de `@nodefony/http`** (0 duplication, sens framework→http légal).
  Audit étape 0 : `watch` réservé HMR + `router`/`adminBroker` = bags d'options Service → `z.looseObject().optional()`
  (ne RIEN stripper, car le hook réassigne `this.options`). `frameworkConfigJsonSchema()` exposé (Studio). Tests
  `schema.test.ts` +8 (176 unit). Gate : tsc 0 · boot OK · memory 8/8 (1000 GET flake vert isolé) · intég framework
  59 + http 719 (flake abort vert isolé). [[feedback_config_validation_zod]] (audit → framework ✅). Lockstep
  **studio-dev 1.16.3** (back-only — config framework n'est pas un contrat front). Cf §4 « Config de module » (Zod).
- **1.16.2** (2026-05-30) — **Durcissement framework F5 — gotchas décorateurs confirmés terrain** (commit à venir).
  Audit des 5 gotchas [[project_framework_decorators]] : #5 `queryGet ?name` **déjà résolu** (`Request.ts` `slice(1)`),
  #2 voulu, #4 OK, #1 collision noms = doc juste (pas de garde) ; **#3 redirect = BUG RFC corrigé** (`@nodefony/http`
  `Response.ts`) : whitelist RFC 9110 §15.4 `{301,302,303,307,308}` (Set module-level 0 alloc) + **défaut 302** (était
  301, écrasait 307/308 = perte préservation méthode) + fallback 302/WARNING sur code invalide. §4 Controller MAJ
  (`redirect()` whitelist/302). Tests `Response.test.ts` +7. Gate : tsc 0 · unit http 321 · memory 8/8 (native-crash
  vert isolé) · intég framework 59 + http 720 (301/302 explicites conservés). RETEX §11 (confirmer un gotcha daté
  contre le source ; `else{force}` = motif du bug « valeur valide écrasée » → préférer whitelist ; citer la RFC).
  Lockstep **studio-dev 1.16.2** (back-only — `redirect()` n'est pas un contrat front).
- **1.16.1** (2026-05-30) — **Durcissement framework F1+F4** (commit `18cd612` F1). F1 : purge des `any` de
  dette → `unknown` + narrowing dans `Controller`/`Resolver`/`Route`/`router`/décorateurs ; 6 `any`
  idiomatiques (mixins ctor + décorateur dual `@Domain`) **conservés & documentés inline**. F4 : tests unit
  via proxy `Object.create` + vrai Controller (Container+Event) → couverture **Controller 22→80 %**, Resolver +`returnController` HTTP **et** WS + `getMatchedParams` + `newController`. **Nouveau** : doc du hook
  **`initialize()`** (per-request, opt-in, `await` après instanciation DI / avant action — §4 Controller).
- **1.16.0** (2026-05-29) — **Résilience de boot Ph.3 (garde du cycle de boot) + GAIN perf `emitAsync` +
  dette config ordering RÉSOLUE** (commits `f3b749d` / `55b7202`). MÉCANIQUE `Event.emitAsyncGuarded` ⟂
  POLITIQUE `Kernel.fireLifecycle` (tags owner/critical `kernel/lifecycleTags`, fatal si critique+prod sinon
  fail-soft+WARNING, migrée `onPreRegister→onPostReady`) ; `Module.static critical` ; `withTimeout`/`TimeoutError`
  (`runtime/`, node-only) ; `guardInitialize` ; env `NODEFONY_BOOT_TIMEOUT_MS`/`_WARN_MS`. **OPTIM hot path
  `emitAsync`** (court-circuit `listenerCount` 0-alloc + await conditionnel sync) = **+14→30 %** (microbench A/B
  inline). **Dette config** : `Kernel.applyModuleConfigOverrides()` en `preRegister` AVANT validation Zod —
  prouvé runtime (backplane realtime `driver=redis` pris en compte). RETEX §11 (Service compose Event ; `once()`
  unwrap ; guarded isomorphe autonome ; `Module.critical` static ; bench A/B inline ; tests ancien contrat
  réécrits). Diagnostic dette CLI (2 effets de bord commander↔kernel + changelog commander 15 **ESM-only**) →
  [[project_cli_module_command_dispatch]]. Tests : core **1449** / memory.test **8/8** / realtime **155**.
  Lockstep **studio-dev 1.16.0** (back-only — aucun contrat front touché).
- **1.15.0** (2026-05-25) — **Relais backend ORM riche @pid** (drill `/nodefony/orm/<pid>` exact en cluster, full-stack).
  §5.F : nouvelle lecture **rich @pid** (`{health:buildConnectionHealth(), flow:buildOrmFlow()}`), calquée
  `dashboard:supervision@<pid>` (voie B1). **Core** : `ClusterProbeFacet` (`"process"|"orm"`) + champ `facet?` sur
  `IClusterProbeCtl`/`IClusterProbeEnrich` (+ guards) ; aggregator propage la facette ; seam `setOrmRichProvider`/
  `readOrmRich` (async opaque). **Framework** : `ClusterProbeClient` facette `"orm"` → ticker cache async `#startOrmRich`,
  report joint `payload.ormRich` ; `IRealtimeHealth.ormRich?` ; `requestEnrich(pid,enable,facet)`. **Drizzle** : branche
  `setOrmRichProvider`. **Studio back** : canal combiné `orm:rich@<pid>` (`createClusterOrmTicker` + local broker ticker
  si pid courant). RETEX §11 (généraliser = facette pas 2ᵉ flux ; async sonde = cache ; canal combiné = pas de ref-count).
  Tests core 4 / framework 4 / **e2e `cluster-orm-rich-e2e.mjs`** PASS. Lockstep **studio-dev 1.15.0** (front consomme
  `orm:rich@<pid>` → supprime l'alerte « autre worker »). [[project_cluster_drilldown_kit]].
- **1.14.0** (2026-05-25) — **Lockstep** (session FRONT : page drill ORM `/nodefony/orm/:pid` par worker, commit
  `0533180`). Côté back, seul changement = **fallback SPA littéral** `@Get("/orm/{pid}")` dans `StudioController`
  (deep-link/F5 sur la page React à 2 segments — MÊME règle figée que `modules/:name` & `cluster/:pid` : segment
  **littéral**, JAMAIS de catch-all `/{section}/{page}` qui masquerait les routes des autres modules → régression 21
  tests http). Contrat data plane (`/nodefony/orm/api/*`, `/nodefony/realtime/api/health`) + canaux (`orm:health`/
  `orm:flow`/`realtime:health`) **inchangés** — le front consomme l'existant. Relais ciblé **ORM riche @pid** (master→
  worker, calqué `dashboard:supervision@<pid>`) reste le TODO backend. [[project_cluster_drilldown_kit]].
- **1.13.0** (2026-05-25) — **Lockstep** (session FRONT : dashboard ORM cluster-aware + verdict « Santé ORM »).
  **Back inchangé** : la sonde lean pod (`IOrmLeanHealth` via `setOrmHealthProvider`, canal `realtime:health`)
  livrée en 1.12.0 (P16.H.7) suffit — le front la consomme désormais pour le verdict 3 états (Derringer-Suich)
  et le breakdown par worker. Bump de cohérence (cf `nodefony-studio-dev` 1.13.0). Rappel contrat consommé :
  `realtime:health.totals.orm` (pod, sommes + `maxEwmaMs`=pire worker) + `.instances[].orm` (par worker).
- **1.12.0** (2026-05-25) — §5.F **Santé pod ORM + erreurs par worker** (P16.H.7, commits `aa9b6fc`/`7ab9219`).
  4ᵉ lecture ORM **lean cluster** (`buildOrmLeanHealth` orm-core → `IOrmLeanHealth`, 0 ping/0 toSQL) branchée via le
  **seam core** `setOrmHealthProvider`/`readOrmHealth` (driver Drizzle au boot → `framework` n'importe PAS `orm-core`) ;
  compteurs erreurs Syslog **always-ON** (`errorTotal`/`criticTotal`, 2 incréments gardés dans `pushStack`) ;
  champs **additifs** `IRealtimeHealth.orm`/`.errors` (comme `process?`) → agrégés pod dans `mergeClusterHealth.totals`.
  RETEX §11 (généraliser un agrégat opaque = enrichir le colis pas l'agrégateur ; seam core dep-propre ; gater = coût
  unitaire ; `mergeX` champs optionnels = annoter `totals` ; **gotcha `.git/index.lock` orphelin → stash/commit muets**).
  Lockstep **studio-dev 1.12.0** (front = cartes ORM/erreurs par worker dans la page Cluster). [[project_cluster_drilldown_kit]].
- **1.10.0** (2026-05-24) — §4 **Backplane cross-process — port `IBackplane`** (Phase 1 du mode cluster sans
  PM2, commit `ac21bec`) : abstraction de fan-out cross-process du `RealtimeHub` (Loopback → Cluster IPC → Redis,
  **interchangeables**). Hub split `publish` (local **+** propagation) / `publishLocal` (local SEUL = ingress) ;
  `setBackplane` câble `onMessage→publishLocal` (anti-boucle) + `start` ; `#backplane=null` défaut = 0 overhead
  mono-process. `LoopbackBackplane` no-op de référence. RETEX §11 (définir+PROUVER le port avant l'impl ; anti-boucle
  2 barrières ; lazy null). Re-aligne le **lockstep** sur studio-dev 1.10.0 (backplane = pas de contrat front →
  studio-dev inchangé). [[project_cluster_backplane_vision]].
- **1.9.0** (2026-05-24) — §4 **Sonde de la Socket Nodefony** (auto-observabilité du `RealtimeHub`,
  « la socket s'observe à travers elle-même ») : `RealtimeHub.probe(): IRealtimeProbe` (canaux/abonnés/
  messages, publish/fanoutTotal, inbound, connexions, bytes/msg, **backpressure** max/total `bufferedAmount`
  - slowConsumers = risque #1) ; compteurs **always-ON** (intégers O(1), ≠ flux ORM gaté) ; `bufferedAmount`
    exposé par `WsConnectionTransport` (`IRealtimeConnProbe`), connexions registre hub (controller, symétrique) ;
    `buildRealtimeHealth` + endpoint `/nodefony/realtime/api/health` (namespace `realtime`) + canal Studio
    `realtime:health`. **Décision nommage** « la Socket Nodefony » (majuscule=concept, minuscule=couche) +
    **placement** (reste framework, déménage P13.1 ; config future = section `realtime` de `@nodefony/http`).
    RETEX §11 (gater dépend du coût unitaire ; bufferedAmount via transport). Lockstep studio-dev 1.9.0 (canal
    documenté ; panneau Hub = à coder côté studio-dev). [[project_realtime_socket_probe]].
- **1.8.1** (2026-05-24) — §2 **Doctrine Node « ne pas bloquer l'event-loop »** (source canonique
  proxy) : callback borné O(1)/O(n) + partition `setImmediate`/Worker Pool, ReDoS = faille sécu,
  JSON borné, Worker Pool variance, mesure = event-loop latency/p99. + **Tests de perf isolés &
  opt-in `RUN_PERF=1`** (`perf-skip.cjs` skippe par défaut ; microbench-en-suite ne mesure rien —
  vécu `extend` 536 ms suite / 162 ms isolé ; ne pas desserrer un seuil pour masquer la contamination).
  (Patch doc framework-only ; studio-dev reste 1.8.0.)
- **1.8.0** (2026-05-24) — **Granularité 1ʳᵉ classe + cadence adaptative (AIMD) dans la lib cliente**
  (Core isomorphe). (a) **`channelRate`** (`src/realtime/channelRate.ts`, isomorphe) : convention de
  cadence PARTAGÉE client↔serveur — `rateChannel(base,ms,default)` (fabrication), `parseRate(channel,
base,bounds)` (résolution+bornage serveur), `isRateChannel`, `RateBounds` ; fin de la dérive
  `:${ms}` (front) vs `slice+clamp` (serveur) dupliqués 6×. 1 canal = 1 cadence = 1 ref-count.
  (b) **`AdaptiveRate`** + **`bindAdaptiveChannel`** (`src/client/realtime/AdaptiveRate.ts`) : AIMD
  **client-driven niveau 1** (0 changement serveur) — machine à états PURE (testable sans timer :
  `noteFrame`/`checkStarvation`, hystérésis MD immédiat/AI fenêtré) + glue socket (watchdog injectable,
  re-subscribe `base:ms` plus grossier sous famine / plus fin si sain). Option **`enabled`** (off =
  abonnement fixe). `RealtimeClient.adaptiveChannel()` + hook React **`useNodefonyAdaptiveChannelData`**
  (`nodefony/react`). Réservé canaux d'ÉTAT (latest-wins). Tests : `channelRate` 14 + `AdaptiveRate`
  (machine/limites/glue) verts. Côté front Studio = studio-dev 1.8.0 (switch Hub global + calm UI).
  Réfs : [[project_realtime_granularity_clientlib]] · [[project_realtime_nodefony_socket_vision]].
- **1.7.0** (2026-05-24) — §6 **Hub serveur + full-duplex + vocabulaire socket**. (a) **`RealtimeHub`**
  (framework, broker per-instance) : canaux **PARTAGÉS** (1 provider/canal/pod au lieu de N per-connexion)
  - fan-out + dispose au dernier abonné ; `RealtimeController` délègue subscribe/publish/cleanup au hub
    (1 sink/connexion) ; **factory passée par `subscribe`** → le provider capture des deps **long-lived**
    (survit à la connexion créatrice, ne JAMAIS capturer `this`/ctx). Seam backplane Redis = `RealtimeHub.publish`
    (fan-out local + forward ; ingress = `publishLocal` only = anti-boucle). (b) **Full-duplex entrant gated** :
    hook `realtimeInbound()` → client `publish(channel)` sur un canal DÉCLARÉ → `RealtimeInboundHandler
(params, reply)` per-connexion ; **sûr par défaut** (aucun canal entrant sinon ; params NON FIABLES Zero
    Trust). Seam SIP/bridge. (c) **VOCAB figé** : `IRealtimeHub`→**`IRealtimeSocket`** (la prise que tient le
    métier, multiplexe des canaux) ; « hub » réservé au **broker serveur** (`RealtimeHub`). RETEX : trancher le
    vocab AVANT d'écrire un contrat (rename mid-feature = ~10 edits). PROCHAINE = AIMD (prérequis : granularité
    1ʳᵉ classe dans la lib). Doc `docs/architecture/realtime-socket-nodefony.md`.
- **1.6.0** (2026-05-23) — §6 **Architecture « la socket Nodefony »** (extraction isomorphe) : pile
  Hub > Endpoint(`IRealtimePeer`) > Peer(`JsonRpcPeer`) > Transport(`IRealtimeTransport`). `JsonRpcPeer`
  (core, 0 dep node) = protocole écrit une fois, composé des 2 côtés. `IRealtimeTransport` = seul seam
  (WS/ws/TCP/UDP/SIP/Redis) ; `BrowserWsTransport`/`WsConnectionTransport`. **Endpoint serveur = étendre
  `RealtimeController`** (framework) → ne déclare que `createRealtimeChannel` + `realtimeActions`/`realtimeChannels`
  (fini le `dispatchRequest` hand-rollé par controller). Patterns de TEST béton (peer pur / transport mock /
  faux Context). Vision : mémoire `project_realtime_nodefony_socket_vision` (backplane Redis cloud-native +
  AIMD-dans-le-hub à venir). RETEX : « le hub, c'est le patron » ; le générique va dans le framework/la lib.
- **1.5.0** (2026-05-23) — §6 **Actions WS (requête→réponse)** : discrimination de frame JSON-RPC
  par **`method`** (pas `id`) — une réponse (id sans method) n'est plus prise pour une requête,
  une requête entrante n'est plus prise pour une réponse ; `id` string|number ; `-32601`/`-32603`
  (msg générique, détail loggé = Zero Trust). Helper réutilisable `RealtimeClient.ping()` (RTT) **dans
  la lib**, pas le front. MVP serveur `kernel:ping`/`kernel:gc` (Studio). Tests core `RealtimeClient{Ping,Dispatch}`.
  RETEX : le générique realtime va dans la lib cliente ; **piste = base `RealtimeController` + `IRealtimeController`** (framework) pour DRY le protocole (cf §6).
- **1.4.0** (2026-05-23) — §5.F **3 sondes ORM** (profiler par-requête / santé / **flux**) :
  `queryFlowMonitor` (orm-core) = débit/latence-EWMA/slow **process-wide, OFF par défaut** (gaté driver,
  per-connecteur via `ormName` au tap, ring slow 20, `toSQL` slow-only, débit dérivé delta `total`, **0
  persistance**) + endpoint `orm/api/flow` + canal `orm:flow` (ticker générique `createBrokerTicker`).
  Câblé Drizzle seul (Sequelize deprecated, Mongoose TODO). Front : carte « Flux ORM » + tableau slow
  intelligent (Studio). **0 régression load** (flux OFF hors kernel). RETEX : tap multi-sonde gardé.
- **1.3.0** (2026-05-23) — §6.F **« Choix de runtime / langage — boussole stratégique »** : plafond =
  famine event-loop mono-thread (vu en charge : WS 1300 + 80k msg/s, 0 % err mais realtime figé) ;
  Elixir/BEAM = réponse pure-realtime (mais pas isomorphe) ; **décision : TS reste (isomorphisme non
  négociable) + seam polyglotte sur `IRealtimeHub`** (Rust napi-rs / sidecar Go-Elixir) le jour du mur.
  À garder à l'esprit pour TOUTE décision hot path. (Note : préparer le terrain au fil de l'eau →
  durcir l'abstraction realtime + isomorphe à chaque passe.)
- **1.2.0** (2026-05-22) — Section **« Contrat de réponse RFC du cycle »** (§4) : auto-JSON gardé + le « trap »
  (WARN dev), JSON sans charset (RFC 8259 §11), headers défaut (RFC 9110), `forward` interne (pas un 3xx), codes
  close WS (`toWsCloseCode` RFC 6455, pas de `4404`), `maxPayload`→1009, throws sans no-op. §2 : I/O sync interdit
  (`FileClass.from`/`getFileAsync`) + piège **turbo restaure du dist caché** (`--force`). §11 : 2 RETEX (passe RFC, turbo).
- **1.1.0** (2026-05-22) — Recette **« Debug runtime »** (§4) : boot enfant direct
  (`NODEFONY_DEV_CHILD=1`), reproduction d'une race de shutdown (martèlement + SIGINT), lecture de la
  vraie stack d'`unhandledRejection` (`PROMISE CHAIN BREAKING`), preuve d'erreur de type pré-existante
  (`git stash`/`tsc`), rejouer un test mémoire flaky isolé. RETEX §11 : race session-sur-Drizzle au
  Ctrl+C (GC fire-and-forget non catché + ORM déconnecté trop tôt) + leçon « fire-and-forget DOIT
  catcher » et « infra tolère le shutdown ». Premier usage debug réel du kit (commit `ce181ba`).
- **1.0.0** (2026-05-22) — Création. 12 sections : règles absolues (perf/mémoire, TS, ALS, lazy/cleanup),
  cartographie + lookup symbols, recettes vérifiées sur le source (Service/DI, Logging, Module, CLI,
  Controller+décorateurs, tests, admin data plane, Config, Certificats TLS, Interfaces/types, Erreurs,
  Core isomorphe), **ORM** (Entity/Repository/AbstractCrudService/tx), **Realtime** (WS + RealtimeService/
  IRealtimeHub/TCP-UDP/Redis/SIP), **roadmap + design figé** (P6 Security…), gates qualité, gotchas,
  sécu (RFC/OWASP/ANSSI/npm audit), RETEX, auto-audit de complétude + boucle de maintenance. Orchestre
  rfc/ts-docs/security-review/check-memory-health. Audit complétude : 0 trou cœur.
