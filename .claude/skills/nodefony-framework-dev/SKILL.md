---
name: nodefony-framework-dev
version: 1.2.0
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

> **v1.2.0** · kit **VIVANT & VERSIONNÉ** — enrichi à CHAQUE session cœur (boucle d'auto-amélioration : cf §12).
> Versionné par git (history du fichier) + changelog interne (fin du doc) + SemVer en frontmatter.

Playbook **déterministe** pour développer le **cœur** de Nodefony : `nodefony` (core), `@nodefony/http`,
`@nodefony/framework`, et tout module/service/commande/adapter serveur. Produis du code **perf,
sûr, typé** sans ré-explorer les ~15 `CLAUDE.md`/`MEMORY.md` : signatures, chemins et recettes sont ici.

> Frontend Studio (React) → **`nodefony-studio-dev`**. Scaffolder un module neuf → **`nodefony-create-module`**
> (ce skill couvre comment CODER dedans, pas le squelette). Doc RFC → `nodefony-rfc`. Types TS → `nodefony-ts-docs`.

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
- `@Redirect("/url", 302)` (sinon `redirect()` défaut = **301**). Réponses : `renderJson` / `renderView`/`renderTwig`/`renderEjs` / `forward("mod:ctrl:action")`.
- **Ne jamais nommer une action** `session`/`request`/`response`/`context`/`method` (collision prop Controller → « Action not found »).
- **WS** : même controller. Handshake = `execute(null)` (⚠️ l'action reçoit `undefined`, **pas** `null` →
  tester `message == null`, ne jamais `.toString()` un message absent), puis `execute(message)`. Protocol =
  match exact string (mismatch → close 1002). Route résolue AVANT `connect()`.
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

**Côté serveur (push WS)** — provider transport-agnostique + controller WS JSON-RPC :

```typescript
// provider : createXxx(publish) démarré au subscribe, dispose() au unsubscribe ET ctx.once("onFinish")
```

- ⚠️ Après le handshake, `ctx.send()` **rejette** (`requestEnded`) → pousser sur la **connexion brute**
  `ctx.connection.send(str, cb)` (garde `readyState===1`). **SSE** : écouter `rawRes.once("close")` (RESPONSE),
  jamais `request.on("close")` (fire trop tôt en HTTP/2).
- **Build** : modif du Core/d'un subpath `nodefony/*` → `cd src/nodefony && npm run build` **puis restart**
  (Vite ré-optimise les deps au boot ; un subpath neuf n'est pas résolu à chaud). Règle perf/mémoire Core s'applique.
- Réfs : core `MEMORY.md` (section client), mémoires `project_client_lib_subpaths_decision`,
  `project_realtime_framework_bindings`, `project_studio_realtime_ws`, `project_decisions_realtime_isomorphic`.

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
(`registerOrmAdminApi(broker)` en `onKernelBoot`, idempotent) → `/nodefony/orm/api/{orms,entities,entity/{name},graph,export/{format}}`.

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

| Symptôme                                                      | Cause                                                   | Fix                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Cannot read … of null` à l'import d'un module                | `Nodefony.getKernel()` au top-level                     | getter lazy / guard `?.`                                                                           |
| Hook lifecycle jamais appelé                                  | hook en arrow/property                                  | méthode **prototype** `async onKernelBoot() {}`                                                    |
| `RequestContext.get()` = undefined dans message/close/finish  | listener non bindé                                      | `AsyncResource.bind(fn)` au bind                                                                   |
| `Cannot read 'environment'` (CliKernel ctor)                  | env `undefined` au ctor                                 | set dans `onKernelStart()`                                                                         |
| `@inject()` sans nom ne résout pas                            | tsx n'émet pas `design:paramtypes`                      | `@inject("nom")` explicite                                                                         |
| `does not provide an export named 'default'/'Error'/'kernel'` | ancienne API                                            | `import { Nodefony }`/`nodefonyError`/`getKernel()`                                                |
| TS18036 / build vert mais CI rouge                            | rollup avertit, tsc rejette                             | `npm run typecheck` avant push                                                                     |
| 404 sur route pourtant définie                                | dist périmé (test module)                               | rebuild test + restart (`nodefony-start-server`)                                                   |
| `Cannot add option '-v, --version'`                           | `setCommandVersion()` 2×                                | le ctor `Cli` le fait déjà                                                                         |
| Turbo rejoue de vieux logs/tests                              | fix dans dep non déclarée n'invalide pas le cache       | `--force` ou build direct du module                                                                |
| `ERR_INVALID_CHAR` statusMessage                              | Node poison le natif avant validation                   | `replace(/[^\x20-\x7E]/g,"")` avant `writeHead`                                                    |
| WS array protocol ne matche pas                               | `['a','b']`→header `"a, b"`≠`"a"`                       | string exacte ou `""` (accepte tout)                                                               |
| HTTP/2 réponse sans `x-request-id`                            | `stream.respond()` bypasse `super.writeHead`            | poser le header dans le chemin http2 aussi                                                         |
| Superviseur dev orphelins saturent la machine                 | spawn detached sans garde                               | pidfile + SIGHUP + group-kill (déjà en place) ; ne JAMAIS spawn serveur en background sans cleanup |
| SSE/long-polling : cleanup ne fire pas (HTTP/2)               | `request.on("close")` fire dès la fin du stream request | écouter `rawRes.once("close")` (la RESPONSE)                                                       |
| `pdu.severity === "INFO"` faux                                | severity = number                                       | comparer `pdu.severityName === "INFO"` ; nom = `CRITIC` pas `CRITICAL`                             |
| `url.parse()` deprecated                                      | API legacy                                              | `new URL(str, "http://localhost")` partout                                                         |
| `@controllers` absents avant boot                             | enregistrés sur `onBoot`                                | accéder aux controllers après le boot kernel                                                       |

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
5. Git versionne le fichier (history) ; le changelog interne = mémoire lisible par l'agent au prochain chargement.

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
