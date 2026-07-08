# MEMORY.md — Kernel / Module / CliKernel

> IA uniquement — ultra-concis. Voir README.md pour la doc humaine.

## Docs liées

- [`../../MEMORY.md`](../../MEMORY.md) — workspace core (Service base de Kernel/Module)
- [`injector/MEMORY.md`](injector/MEMORY.md) — DI utilisée dans `addService`/`addModule`
- [`../cli/MEMORY.md`](../cli/MEMORY.md) — Cli/Command (CliKernel `extends Cli`)
- [`../syslog/MEMORY.md`](../syslog/MEMORY.md) — logger via `initializeLog()`
- Consommateurs : [`../../../packages/@nodefony/http/MEMORY.md`](../../../packages/@nodefony/http/MEMORY.md) | [`../../../packages/@nodefony/framework/MEMORY.md`](../../../packages/@nodefony/framework/MEMORY.md)
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles projet

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

> ⚠️ `booted=true` **précède** `captureBootServers()` (qui tourne dans `onReady`→`initServers`). Donc
> `booted:true` ≠ « serveurs prêts ». `getBootReport()` distingue `bootServers===null` (pas mesuré,
> boot en cours) de `[]` (mesuré, 0 serveur = vrai échec) via le flag `measured` → sinon `healthy`
> valait false pendant toute la montée des serveurs et `livez.degraded` criait « dégradé » à tort.

**Politique d'échec de boot (`isBootErrorFatal`)** : fatal = `critical !== false` && (`production`
OU **`BootConfigurationError`**). `BootConfigurationError` (kernel/BootConfigurationError.ts, export
barrel) = erreur de CONFIGURATION explicite non honorable (infra déclarée injoignable, entité non
portée sur le dialecte) → fatale MÊME en dev (le fail-soft produirait un serveur « vivant » aux
briques durables mortes — login impossible, cause noyée en WARNING, vécu). Guard `is()` tolérant
cross-copies (name check). Le tag `critical=false` d'un module garde la main (jamais fatal).

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

**isConsole()**: `!runProfile.servers` (défensif : `false` si `runProfile` indéfini).
**isModule(cls)**: `isSubclassOf(cls, Module)`. **Throws TypeError** si `cls === null`.
**clusterIsMaster()**: `cluster.isPrimary`.
**stats()**: `{ memory: process.memoryUsage() }`.
**memoryUsage(msg?, sev?)**: log RSS/heapTotal/heapUsed/external via `CliKernel.niceBytes()`.
**setDomain()**: `options.domain === "selectAuto"` → 1ère IP externe IPv4 ou `"localhost"`.
**sendMessage(msg)**: `process.send(...)`. Throws si pas worker IPC.
**terminate(code?)**: fire `"onTerminate"` → `process.nextTick(() => CliKernel.quit(code))`. Si `quit()` throw → `reject(e as Error)` (pas `reject(quit())`). Le `fireAsync` est bornée par la **deadline GLOBALE `options.shutdownDeadline`** (défaut `config/defaults.ts` 15 000 ms, fallback interne `DEFAULT_SHUTDOWN_DEADLINE` ; `0` = filet off) : `Promise.race` avec un timer `unref` → au-delà, log CRITIC + **sortie forcée code 1** (jamais de process zombie attendant le SIGKILL orchestrateur). Rejet du drain capturé AVANT le race (sinon unhandledRejection si la deadline gagne) ; erreur listener → code 1 (inchangé). Garder `shutdownDeadline` > somme des drains nominaux (WS 600 ms + `http.servers.*.shutdownTimeout` ≤ 5 s/serveur) et < grace period orchestrateur (30 s k8s).

**resolveAppEntry() / isTrunk()**: détection d'app SANS import spéculatif. `resolveAppEntry` (mémoïsée) lit le `package.json` de l'app : exige le signal d'identité **`nodefony` déclaré en deps/devDeps/peers OU installé (`node_modules/nodefony`, couvre le monorepo self-hosted)**, puis résout l'entrée = `main` (fallback legacy `dist/index.js` puis `index.js`) vérifiée par **existence fs**. L'unique import réel + validation (`export default` = `Module`, diagnostic `bootConfigError`) = `loadApp` (qui consomme la même entrée résolue, ainsi que l'import `env` et `validateAppConfig` legacy). `isTrunk` = wrapper (valeur `"typescript"|"javascript"` purement informative — seule la truthiness est consommée). ⚠️ JAMAIS conditionner la détection à un fichier SOURCE (`index.ts`) : une image de prod ne déploie que package.json+dist+node_modules (bug vécu : toute app compilée → wizard). Hors projet : wizard « create project » SEULEMENT si `isTTY` ; sinon (container/CI) CRITIC + `terminate(1)`.

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
- `kernel.once("onBoot", ...)` → récupère le service `rollup` (build one-shot) — **toujours ajouté** (même sans hooks)
- ⚠️ watch runtime write-only RETIRÉ : plus de listener `onPostReady`/`Module.watch()`/`watcherService`. Dev = `DevSupervisor` (auto-restart, `src/service/dev/DevSupervisor.ts`) : parent spawn enfant `NODEFONY_DEV_CHILD=1` en **leader de groupe** (`detached`), watch backend (frontend exclu → HMR Vite intact), rebuild ciblé turbo+rollup, **group-kill** au restart (tue Vite, 0 orphelin) + attente ports libres (anti-EADDRINUSE) + retry crash borné. Activé par `DevCommand`
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
- - `kernel.prependOnceListener("onPreBoot", ...)` → charge `package.json` + `readOverrideModuleConfig()`
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
- `this.runProfile = {servers:false,lifetime:"oneshot",interactive:false}` (défaut console).
- `this.packageManager = this.pnpm` (défaut).

**setPackageManager(mgr?)**: `"yarn"` → yarn, `"pnpm"` → pnpm, `undefined`/autre → npm.

**setRunProfile(profile)**: pose `IRunProfile {servers,lifetime,interactive}` (ex `setType`) ; recopié dans `kernel.runProfile` à `onStart`. `isConsole()`=`!servers`. Ne pilote PAS le montage serveur (= `kernelEvent`+`HttpKernel`) ni le park. Cf `project_kernel_runmodes_introspection`.

**addCommand(Ctor)**: instancie, stocke `commands[name]`, enregistre dans commander.

- Type exporté: `CommandConstructor = new (cli: CliKernel) => Command`.

**parseCommand(argv?)** / **parseCommandAsync(argv?)**: délèguent à `commander.parse/parseAsync`.

**initSyslog(env?, debug?, opts?)**:

- Sans `this.kernel` → `super.initSyslog()`
- Avec kernel: severity `[0..6]`. debug → +7. SERVER+dev → +4,5.
- `commander.opts().json` → return immédiat (mode silencieux JSON).
- `Syslog.formatDebug(debug)` → ajoute condition `msgid` si objet.

**terminate(code?)**: avec kernel → `kernel.terminate(code)`. Sans → `super.terminate(code, quiet)`.

**start(options?)**: crée `Kernel`, ajoute 9 commandes (Start/Dev/Build/Prod/**Cluster**/Install/Outdated/**Status**/**Stop**), configure Commander, `parseAsync()` + `kernel.start()`. (Pm2/Kill retirées — C6 retrait PM2 ; staging retirée.)

**`Status`/`Stop` = commandes SYSTÈME « standalone »** (`nodefony status`/`stop`): outillage de process PUR, **interceptées par le fast-path de `CliKernel.start`** (`isStandaloneDevCommand`/`runStandaloneDevCommand`, `service/dev/devStatusReport.ts`) AVANT tout boot kernel → **marchent HORS trunk** (de n'importe où), insensibles au dist, sans effet de bord (pas de singleton pollué, pas de fallback « create project »). `StatusCommand`/`StopCommand` ne servent qu'au help (leur `generate()` = filet). Helpers `service/dev/devProcess.ts` (PARTAGÉ avec DevSupervisor : `devSupervisorPidFile`/`defaultDevPorts` anti-divergence). **Vérité = `ps`, pas le pidfile** (PID recyclé). `discoverDevProcesses()` = `ps -A` sous **`LC_ALL=C`** (⚠️ piège vécu : `%CPU` virgule décimale FR cassait la détection) → `parsePsRow` pur, s'auto-exclut. **MULTI-MODE** : `classify` reconnaît les 3 runtimes par leur `process.title` et attache un champ **`mode: "dev"|"prod"|"cluster"`** → dev `nodefony-dev-supervisor`/`-server`/`-vite[…]` · prod `nodefony server` (mono) · cluster `nodefony master [cluster Nw]` + `nodefony worker N [cluster]`. ⚠️ `nodefony-dev-server` (tiret) ≠ `nodefony server` (espace) → 0 collision `includes`. Helpers purs : `detectRuntimeMode` (priorité dev>cluster>prod), `runtimeModes` (Set, Vite exclu), `findRuntimeConflict(procs, intended)` (process principaux d'un AUTRE mode = collision). **status** (`devStatusReport.ts` `runStatusReport`): libellé selon le mode (`Nodefony dev|production|cluster`), tableau ANSI colonne RÔLE dynamique (détail bundles Vite / `Nw` master / `#id` worker en 2ᵉ ligne) + synthèse adaptative (segments non-nuls) + warnings fail-loud conscients du mode (cohabitation multi-runtime, pidfile périmé, orphelins **dev**, empilement ; workers cluster ≠ empilement). **stop** (`devStop.ts` `runStopReport`): arrête **tout** runtime — group-kill des « racines » (`signalProcessGroup` `-pid` → emporte enfant+Vite, ou master→workers ; SIGTERM déclenche le graceful shutdown du ClusterManager) SIGTERM→SIGKILL + attente ports libres + `clearSupervisorPidFile` ; idempotent. **GARDES anti-collision** (fail-loud, exit `SysExit.UNAVAILABLE`, JAMAIS de kill cross-mode auto) : `DevSupervisor.#claimSingleInstance` ne tue que les résiduels `mode==="dev"` et refuse de démarrer sur un prod/cluster ; `launchTopology`/`assertNoConflictingRuntime` (`runtimeLauncher.ts`) refuse prod/cluster sur un autre runtime préexistant.

## Cluster (mode multi-process sans PM2 — Phases 2+3)

> `service/cluster/` (core). Refonte « beaucoup mieux » de `StagingCommand` (legacy `os.cpus()` + 0 respawn). Vision : mémoire IA `project_cluster_backplane_vision`.

**`ClusterCommand`** (`nodefony cluster`, alias aucun, `kernelEvent:"onStart"`, `--workers N`) : master (`cluster.isPrimary`) → pose `process.env.NODEFONY_CLUSTER="1"` (héritage au fork) + crée le **`ClusterRelay`** (gateway) + `cluster.on("fork"→attach / "exit"→detach)` (couvre forks initiaux ET respawns, attaché AVANT `manager.start()`) + `ClusterManager.start()+installSignalHandlers()` (0 HTTP) ; worker → `new Kernel().start()`. `onKernelStart` (via `launchTopology`) : mono/worker → profil serveur `setRunProfile({servers:true,lifetime:"longrunning"})` ; **master reste console** (park) ; env production + `MODE_START="cluster"`.

**Backplane IPC (Phase 3 — master-gateway).** Protocole de fil `clusterMessage.ts` (core) : `CLUSTER_RT_KIND="nf:rt"` + `isClusterMessage()` (UNE source du tag, le framework l'importe via `"nodefony"` → 0 magic-string dupliqué). **`ClusterRelay`** (core, master) : routeur de messages OPAQUES — reçoit une publication realtime d'un worker, la rebroadcast aux AUTRES (`#route` exclut la source = anti-echo de routage) ; ignore les autres kinds (sondes Phase 4 = agrégées ailleurs) + malformés ; seam `IRelayWorker`{id,send,onMessage} → routage testé sans forker (11 tests `ClusterRelay.test.ts`). 0 dépendance `@nodefony/framework` (respect framework→core). Côté worker : `ClusterBackplane` (framework) branché sur le hub par le module `Framework` à `onCluster("WORKER")` (gardé `NODEFONY_CLUSTER`). `Kernel.initCluster` worker : `process.on("message")` **filtre les rt** (consommés par le backplane → ni log ni re-fire, anti-flood) ; ne re-fire `onMessage` que pour les messages de contrôle. **Bench fil IPC** : `.claude/skills/nodefony-load-test/scripts/cluster-ipc.mjs` (fork réel, mesuré : ~300k publishes/s @256B, fan-out sature le master @4KB×7sub ~176 MB/s, RTT 4-sauts p50 0.40 ms).

**`resolveWorkerCount(opts)`** (`cpuQuota.ts`, PUR) : ordre = (1) `--workers N` explicite, **non borné** (harnais backplane : sur-souscrire OK) → (2) quota cgroup arrondi, borné par `availableParallelism` → (3) `os.availableParallelism()`. Toujours `>= 1`. **`readCgroupCpuQuota(read)`** : v2 `cpu.max` (`"max"`=null) → v1 `cfs_quota/period` (`-1`=null). LE fix du bug conteneur (`os.cpus()` lit l'hôte, ignore cgroup).

**`ClusterManager`** (master-only, hors hot path request) : fork N, **respawn backoff** (`computeBackoff`= base·2^(n-1) capé ; reset si worker vit ≥ `stableMs`), **graceful shutdown** (`shutdown()` : SIGTERM tous → SIGKILL survivants après `shutdownTimeoutMs` → `exit`). Tout seam injecté (`IClusterRuntime`/`ClusterScheduler`/`exit`/`log`) → state machine testée sans forker (30 tests `ClusterManager.test.ts`+`cpuQuota.test.ts`). `installSignalHandlers()` : `removeAllListeners(SIGTERM/SIGINT)` (le master prend la main : sinon `Cli.handleSignals`→`terminate()` tuerait le master avant drain). Seam IPC Phase 3 (ClusterBackplane) = `Kernel.initCluster` (`onCluster`/`onMessage` worker déjà câblés).

**ICliKernel** (`src/types/ICliKernel.ts`): interface minimale pour `Kernel.ts` — évite import circulaire. Propriétés: `commander`, `environment`, `type`, `debug`, `pid`. Méthodes: `setProcessTitle`, `showBanner`, `blankLine`, `clear`, `showAsciify`, `parseCommandAsync`, `runCommandAsync`, `setPackageManager`, `setCommandVersion`, `initSyslog`.

**niceBytes(n)** (static hérité Cli): `1024` → `"1.0 KB"`, `10240` → `"10 KB"`. Règle: `n >= 10 || l < 1 ? 0 décimales : 1`.

---

---

## Injector + Decorators DI

> Détail complet dans [`injector/MEMORY.md`](injector/MEMORY.md).

**Résumé clés** :

- Registre statique `injectables: Record<string, Ctor>` — global, partagé
- `@injectable` → register + scope. `@inject` → param ctor. `@Inject` → propriété post-ctor.
- `instantiate` → `_instantiateWithStack(Ctor, [], args)` — circular detection + property injection
- Stack par valeur `[...stack, name]` — async-safe. Singleton dans kernel.get() → court-circuit.
- `inject:services` sur **constructeur**. `inject:properties` sur **prototype**. Confusion = bug silencieux.
- tsx : pas de `design:paramtypes` → appel fonctionnel `(inject("X") as Function)(Cls, undefined, 0)`.

**Chargement modules** : `config.modules` (manifeste ordonné) → Kernel `resolveModules()`/`loadModulesFromManifest()` à `onPreRegister` (décorateur `@modules` RETIRÉ). Cf `project_module_loading_architecture`.

**Decorators module** (`@services`/`@entities`) :

- `@services` → `onPreBoot` → addService|loadService (erreurs catchées)
- `@entities` → `onBoot` → addEntity|loadEntity
- `prependOnceListener` (setEvents) toujours index 0 avant `once` (@services/@entities)

**Roadmap** : ✅ A (property) ✅ C (circular) ⬜ B (scoped/ALS) ⬜ D (namespace) ⬜ E (lazy)

## Deps

- Kernel → Container, Service, Injector, FileClass, Nodefony, CliKernel, Module, @nodefony/http
- Module → Service, Kernel, Injector, Container, CliKernel, RollupService (build one-shot)
- CliKernel → Cli, Kernel, Command, Syslog/Pdu
- Injector → Service, Container, Event, Kernel, Nodefony, Fetch, reflect-metadata

## Types CLI

**ICommand** (`src/types/ICommand.ts`):

```typescript
export type KernelEventKey =
  | "onInit"
  | "onPreStart"
  | "onStart"
  | "onPreRegister"
  | "onRegister"
  | "onPreBoot"
  | "onBoot"
  | "onReady"
  | "onServersReady"
  | "onPostReady"
  | "onTerminate";
export interface ICommand {
  name: string;
  kernelEvent: KernelEventKey;
  action(...args: unknown[]): Promise<unknown>;
}
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
- `Command.setEvents()` : `eventsRegistered` guard ajouté — idempotent
