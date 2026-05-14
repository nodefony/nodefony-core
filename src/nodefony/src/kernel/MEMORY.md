# MEMORY.md — Kernel / Module / CliKernel

> IA uniquement — ultra-concis. Voir README.md pour la doc humaine.

---

## Kernel (`Kernel.ts`)

**Purpose**: Orchestrateur principal du framework. `extends Service implements IKernel`.

**Lifecycle flags** (ordre strict, jamais régressifs):
```
started → preRegistered → registered → booted → ready → postReady
```
- `preRegistered` : set après `onPreRegister` (avant `onRegister`)
- `registered` : set après `onRegister` (dans `preRegister()`)
- `booted` : set après `onBoot` (dans `boot()`)
- `ready` : set après `onReady` (dans `onReady()`)
- `postReady` : set après `onPostReady` (dans `onReady()`)

**Events bitmask** (`Events`, frozen, exporté):
```
onInit=1  onPreStart=2  onStart=4  onPreRegister=8  onRegister=16
onPreBoot=32  onBoot=64  onReady=128  onServersReady=256  onPostReady=512  onTerminate=1024
```

**`progress`**: bitmask OR cumulatif. Valeur init = `Events.onInit` (=1).

**`setCommandComplete(p)`** → `this.progress |= Events[name]`, retourne `isCommandComplete(p)`.
**`isCommandComplete(p)`** → `!!(this.progress & Events[command.kernelEvent])`. Toujours `false` si `this.command === null`.

**Constructor** `new Kernel(env, cli?, options?)`:
- Appelle `Nodefony.setKernel(this)` — **pollue le singleton global**.
- Initialise: container (depuis cli), `Injector`, interfaces réseau OS, fire `"onInit"`.
- `kernelDefaultOptions.events.nbListeners = 60`.

**Chaîne async** (chaque maillon appelle le suivant si `!setCommandComplete`):
`start()` → `preRegister()` → `boot()` → `onReady()` → `initServers()`

**setEnv(env)**: `"dev"|"development"` → `this.environment = "development"`. Sinon → `"production"`.
**setNodeEnv(env)**: side-effects `process.env.NODE_ENV`, `BABEL_ENV`, `NODE_DEBUG`.

**initializeLog()**: reset tous listeners syslog → skip si `options.log.active === false` → délègue à `cli.initSyslog()` ou `this.initSyslog()`.

**checkPath(p)**: absolu → tel quel. Relatif → `resolve(this.path, p)`. Falsy → `null`.

**readConfig(config?)**: sans arg → retourne `this.options` sans mutation. Avec → `extend(this.options, config)` (merge in-place).

**interfacesFilter(filters?)**:
- Sans filtre → retourne `this.interfaces` brut.
- Avec `{ type: "external" }` → `!infos.internal`; `{ type: "local" }` → `infos.internal`.
- `condition` : `"&&"` (défaut), `"||"`. `"=="` → traité comme `"&&"`.
- Filtre vide `{}` → tous tableaux vides (matchType=false && matchFamily=false → false).

**isConsole()**: `type === "CONSOLE" || type === "console"`.
**isModule(cls)**: `isSubclassOf(cls, Module)`. **Throws TypeError** si `cls === null`.
**clusterIsMaster()**: `cluster.isPrimary`.
**stats()**: `{ memory: process.memoryUsage() }`.
**memoryUsage(msg?, sev?)**: log RSS/heapTotal/heapUsed/external via `CliKernel.niceBytes()`.
**setDomain()**: `options.domain === "selectAuto"` → 1ère IP externe IPv4 ou `"localhost"`.
**sendMessage(msg)**: `process.send(...)`. Throws si pas worker IPC.
**terminate(code?)**: fire `"onTerminate"` → `process.nextTick(() => CliKernel.quit(code))`. Si `quit()` throw → `reject(e as Error)` (pas `reject(quit())`).

**clean()**: `removeAllListeners() + this.modules = {}`. Ne jamais appeler directement en prod.

**isModule(subclass)**: signature `unknown` (pas `any`). Throws TypeError si `subclass === null`.

**Registre modules**:
- `addModule(Ctor, ...args)` → instancie, `modules[name] = mod`, appelle `mod.initialize(this)` si présente.
- `getModule(name)` / `getModules()`.
- `addKernelService(Ctor, ...args)` → instancie directement sur container kernel (pas sur module).
- `loadModule(name, build?)` → dynamic import + addModule.

---

## Module (`Module.ts`)

**Purpose**: Unité fonctionnelle (ex-Bundle). `extends Service implements IModule`. Path propre, options, services, controllers.

**Constructor** `new Module(name, kernel, path, options)`:
- `setPath(path)` → résout vers répertoire
- `setEvents()` → wire hooks lifecycle
- `kernel.once("onBoot", ...)` → récupère rollup/watcher — **toujours ajouté** (même sans hooks)
- `kernel.once("onPostReady", ...)` → démarre watch si `options.watch && env === "development"` — **toujours ajouté**
- `setParameters("modules.${name}", options)`

**setPath(p)**:
- `file://...` → fileURLToPath d'abord
- `basename(dirname(p)) === "dist"` → remonte 2 niveaux
- sinon → `dirname(p)` (1 niveau)
- Passer un path vers `package.json` → retourne son répertoire parent

**setEvents()**:
- `onKernelRegister` → `kernel.once("onRegister", fn.bind(this))`
- `onKernelBoot` → `kernel.once("onBoot", fn.bind(this))`
- `onKernelReady` → `kernel.once("onReady", fn.bind(this))`
- + `kernel.prependOnceListener("onPreBoot", ...)` → charge `package.json` + `readOverrideModuleConfig()`
- **CRITIQUE** : hooks = méthodes prototype (pas property initializers). `super()` tourne avant les initializers.

**Lifecycle hooks** (optionnels, méthodes prototype):
```typescript
async onKernelRegister(): Promise<this> { ... }
async onKernelBoot(): Promise<this> { ... }
async onKernelReady(): Promise<this> { ... }
async initialize?(kernel?: IKernel): Promise<this> { ... }
```

**readOverrideModuleConfig(deep?)**: keys `Module-<name>` dans `this.options` → `extend(mod.options, override)`. Warn si module inconnu.

**addService(Ctor, ...args)**: `Injector.instantiate(svc, this, ...args)` → container → `initialize(module)` si présente.

**getDependencies()**: `dependencies + peerDependencies` (PAS devDependencies). Pas de dedup — doublon possible si présent dans les deux.

**getPackageJson(cwd?)**: lit `${this.path}/package.json` via `loadJson()`.

**loadJson(url, cwd?)**: absolu → direct. Relatif → `resolve(cwd, url)`. Throws si JSON invalide ou fichier absent.

**addCommand(Ctor)**: nécessite `kernel.cli !== null`, sinon throws `"Kernel not ready"`.

**install(force?)** / **outdated()**: délèguent à `kernel.cli.packageManager`. Throws si pas de packageManager.

**getController(name)**: lookup dans `Module.controllers` (static). Throws si absent ou name falsy.

**log()**: surcharge → `msgid` défaut = `"MODULE ${this.name}"`.

**Static**: `Module.controllers` — registre partagé toutes instances.

---

## CliKernel (`CliKernel.ts`)

**Purpose**: CLI du framework. `extends Cli` (**PAS Kernel**). Pas de méthode `isConsole()`.

**Constructor** `new CliKernel(environment?)`:
- `super("NODEFONY", cliOptions)` → enregistre `-v/--version` automatiquement.
- **Ne pas appeler** `setCommandVersion()` à nouveau → throws "Cannot add option '-v, --version'".
- `this.type = "CONSOLE"` (prop directe).
- `this.packageManager = this.pnpm` (défaut).

**setPackageManager(mgr?)**: `"yarn"` → yarn, `"pnpm"` → pnpm, `undefined`/autre → npm.

**setType(type)**: `toLocaleUpperCase()` → KernelType.

**addCommand(Ctor)**: instancie, stocke `commands[name]`, enregistre dans commander.
- Type exporté: `CommandConstructor = new (cli: CliKernel) => Command` (2026-05-14).

**parseCommand(argv?)** / **parseCommandAsync(argv?)**: délèguent à `commander.parse/parseAsync`.

**initSyslog(env?, debug?, opts?)**:
- Sans `this.kernel` → `super.initSyslog()`
- Avec kernel: severity `[0..6]`. debug → +7. SERVER+dev → +4,5.
- `commander.opts().json` → return immédiat (mode silencieux JSON).
- `Syslog.formatDebug(debug)` → ajoute condition `msgid` si objet.

**terminate(code?)**: avec kernel → `kernel.terminate(code)`. Sans → `super.terminate(code, quiet)`.

**start(options?)**: crée `Kernel`, ajoute 9 commandes (Start/Dev/Build/Prod/Staging/Install/Outdated/Pm2/Kill), configure Commander, `parseAsync()` + `kernel.start()`.

**ICliKernel** (`src/types/ICliKernel.ts`): interface minimale pour `Kernel.ts` — évite import circulaire. Propriétés: `commander`, `environment`, `type`, `debug`, `pid`. Méthodes: `setProcessTitle`, `showBanner`, `blankLine`, `clear`, `showAsciify`, `parseCommandAsync`, `runCommandAsync`, `setPackageManager`, `setCommandVersion`, `initSyslog`.

**niceBytes(n)** (static hérité Cli): `1024` → `"1.0 KB"`, `10240` → `"10 KB"`. Règle: `n >= 10 || l < 1 ? 0 décimales : 1`.

---

---

## Injector (`injector/injector.ts`) + Decorators (`decorators/kernelDecorator.ts`)

**Purpose**: Registre statique de services injectables + résolution DI.

**Static API**:
- `Injector.register(name, Ctor)` → throw si name vide ou Ctor null. Retourne Ctor.
- `Injector.isRegistered(name)` → `name in injectables` (O(1)).
- `Injector.get(name)` → throw `"not found or not injectable"` si absent.
- `Injector.inject(Ctor, ...args)` = alias `instantiate`.
- `Injector.injectables` → Record statique partagé. Accès direct possible (test + debug).

**`Injector.instantiate(Ctor, ...argsClass)`** — algorithme:
1. Lit `inject:services` (tableau sparse indexé par position, via `@inject`)
2. Lit `design:paramtypes` (émis par TypeScript si `emitDecoratorMetadata + 1 decorator`)
3. Si aucune metadata → `Reflect.construct(Ctor, argsClass)` (backward compat)
4. Sinon, pour chaque position i :
   - `inject:services[i]` présent → `_resolve(name)` (priorité absolue)
   - `paramTypes[i]` enregistré dans injectables → `_resolve(typeName)` (auto-injection)
   - Sinon → `argsClass[explicitIdx++]` (arg explicite)
5. Append `argsClass` restants.

**`_resolve(name, argsClass)`**:
- Kernel dispo + `kernel.get(name)` non-null → **réutilise** l'instance du container
- Sinon → `Injector.instantiate(Injector.get(name), ...argsClass)` (récursif)

**`design:paramtypes` limitation tests**: tsx/esbuild ne supporte pas `emitDecoratorMetadata`.
Émettre manuellement dans les tests : `Reflect.defineMetadata("design:paramtypes", [TypeA], MyClass)`.

**DIScope** : `"singleton"` (défaut) | `"transient"` (toujours new, ignore kernel container). Stocké via `Reflect.defineMetadata("di:scope", scope, Ctor)`.

**`Injector.getScope(name)`** → `DIScope` — lit la metadata `di:scope` du constructeur enregistré. Retourne `"singleton"` si absent ou inconnu.

**Decorators** (tous dans `kernelDecorator.ts`):
- `@injectable(name?)` — rétro-compat string.
- `@injectable({ name?, scope? })` — API objet. scope absent → `"singleton"`.
- `@inject("name")` → stocke `inject:services[paramIndex] = name` sur le constructeur (class-level, sans propertyKey). Appel direct possible : `(inject("X") as Function)(MyClass, undefined, 0)`.
- `@modules(path)` → sur Module, `kernel.once("onPreRegister", ...)` → `loadModule(path, false)` ou `addModule(Ctor)` (si `kernel.isModule(Ctor)`). Array : idem pour chaque élément.
- `@services(path)` → sur Module, `kernel.once("onPreBoot", ...)` → `addService(Ctor)` ou `loadService(path)`. Erreurs catchées + loguées.
- `@entities(path)` → sur Module, `kernel.once("onBoot", ...)` → `addEntity(Ctor)` ou `loadEntity(path)`.

**Routage dans @modules array** : `isModule(elt)` → `addModule`, sinon → `loadModule` (strings ET ctors non-Module traités comme path).

**Test pattern pour les décorateurs** (`Decorators.test.ts`):
```typescript
// Stub kernel avec fireEvent
const stub = makeKernelStub(); // container.set("kernel", stub) + once/prependOnceListener
// Mock getPackageJson pour éviter I/O (setEvents prependOnceListener l'appelle sur onPreBoot)
mod.getPackageJson = async () => ({...} as PackageJson);
// Spy addService/loadService pour @services
mod.addService = async (Ctor) => { calls.push(Ctor); return {} as Service; };
// Déclencher
await stub.fireEvent("onPreBoot");
```

**onPreBoot listener order** : `prependOnceListener` (setEvents) → index 0. `once` (@services) → dernier.

**Gotchas injection**:
- `@inject` parameter decorator : tsx/esbuild nécessite `--tsconfig` avec `experimentalDecorators: true`. En prod (rollup), ça marche.
- `@inject` sans nom → throw immédiat dans le decorator (pas à l'instantiation).
- `Injector.get(name)` throw si absent → uncaught dans `_resolve` → propagé à `instantiate`.
- `Fetch` auto-enregistré dans `new Injector(kernel)` — pas avant.
- Design intent: args explicites couvrent les params non-injectables, dans l'ordre.

## Deps

- Kernel → Container, Service, Injector, FileClass, Nodefony, CliKernel, Module, @nodefony/http
- Module → Service, Kernel, Injector, Container, CliKernel, RollupService, watcherService
- CliKernel → Cli, Kernel, Command, Syslog/Pdu
- Injector → Service, Container, Event, Kernel, Nodefony, Fetch, reflect-metadata

## Types CLI (2026-05-14)

**ICommand** (`src/types/ICommand.ts`):
```typescript
export type KernelEventKey = "onInit"|"onPreStart"|"onStart"|"onPreRegister"|"onRegister"|"onPreBoot"|"onBoot"|"onReady"|"onServersReady"|"onPostReady"|"onTerminate";
export interface ICommand { name: string; kernelEvent: KernelEventKey; action(...args: unknown[]): Promise<unknown>; }
```
Redéfini localement — import circulaire `IKernel→Kernel→Command→IKernel` impossible.

**Command.kernelEvent**: était `keyof typeof Events` (= `string`). Remplacé par `KernelEventKey` (union littérale).

**Command.setEvents()**: guard `eventsRegistered` — empêche double-registration si appelé plusieurs fois.

**preRegister() double-parsing**: bloc `if (this.cli && !this.command) { parseCommandAsync() }` supprimé — redondant (Commander a déjà parsé dans `CliKernel.start()`).

## Gotchas

- `new Kernel()` → toujours `Nodefony.setKernel(this)` → pollue singleton → isole les tests avec mock minimal
- `isModule(null)` → TypeError (pas false)
- Module hooks : prototype method obligatoire, pas arrow/property
- `setCommandComplete` sans `this.command` → toujours false
- Module constructor ajoute toujours 2 listeners (onBoot + onPostReady) indépendamment des hooks
- `interfacesFilter({})` → tous vides (ni type ni family spécifiés → matchs false, condition && → false)
- `getDependencies()` : devDependencies exclus, doublons possibles si dep dans deux sections
- `Command.setEvents()` : `eventsRegistered` guard ajouté (2026-05-14) — idempotent
