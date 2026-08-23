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

**Bilan de boot persisté** — `var/last-boot.json` (`checks/lastBoot.ts` = source
UNIQUE du nom, du chemin et de la forme ; écrivain Kernel, lecteur `check`) :

- `start()` = enveloppe MINCE autour de `startBoot()` : son seul rôle est
  `traceFatalBootFailure` au `catch` (`status:"failed"` + phase via
  `lastReachedPhase()` sur le bitmask `progress`). Les ~12 `catch` internes
  relancent — y répartir l'écriture donnerait 12 implémentations d'une règle.
- Succès : `writeBootSummary(report)` au point où le bilan est FIGÉ (après
  `captureBootServers` + `getBootReport()`, avant `onPostReady`) → `status:"ok"`
  - `bricksSkipped` (fail-soft AVEC raison), `bricksGated` (`policy`/`when`),
    warnings/errors, serveurs, remédiation.
- 🔴 **Rien n'est EFFACÉ sur un succès** : une commande console (`inspect`)
  démarre et réussit sans serveur ; effacer ferait disparaître le bilan d'un
  échec applicatif au premier `inspect` lancé pour le diagnostiquer.
- Lecture : `check` remonte à la racine de l'app (`findProjectRoot`) avant de
  lire, et l'ANNONCE si elle diffère du dossier de départ (`--cwd` déplace ce
  départ). Lu depuis `process.cwd()`, le bilan était introuvable dès qu'on
  lançait la commande dans un module — et l'absence se rendait « rien à
  signaler ». Même remontée dans `docsReader` du framework (`.ai/symbols.json`,
  `node_modules` hissés, docs du core, dépôt git).
- Écriture SYNCHRONE (chemin de mort du process) et best-effort — toute
  défaillance est avalée : une trace impossible à écrire ne doit pas masquer
  l'erreur de boot. Coût : 1 write par démarrage applicatif, hors hot path.
- ⚠️ `recordBootFailure(IBootFailure)` (existant) = échecs NON fatals d'un boot
  qui continue. Ne pas confondre avec `traceFatalBootFailure`.

> ⚠️ `booted=true` **précède** `captureBootServers()` (qui tourne dans `onReady`→`initServers`). Donc
> `booted:true` ≠ « serveurs prêts ». `getBootReport()` distingue `bootServers===null` (pas mesuré,
> boot en cours) de `[]` (mesuré, 0 serveur = vrai échec) via le flag `measured` → sinon `healthy`
> valait false pendant toute la montée des serveurs et `livez.degraded` criait « dégradé » à tort.

**Bilan de boot (`IBootReport`, vérité unique écran/log/Studio)** :

- `modulesSkipped` = **échecs fail-soft** (`IBootFailure`, `recordBootFailure`, lazy null) ≠
  `modulesGated` = **volontairement non chargés** (`IBootModuleGated`, gating `policy`/`when` de
  `resolveModuleEntries`, raison lisible, lazy null, reset à chaque résolution). Vocabulaire :
  fail-soft = « en échec », gating = « ignoré ».
- `warnings`/`errors` = journal du boot (comptage ring syslog : WARNING=sev 4, errors=sev 0-3 ;
  SPINNER=-1 exclu). **Figés** dans `bootLogCounts` quand `postReady` passe true (après, le ring
  mélange boot et runtime) ; comptage à la volée avant.
- Rendu dev = `BootReporter.#renderVerdict` (bloc « Bilan » : Modules/Vite/Process/Journal) ; la
  ligne Process = `discoverDevProcesses({includeSelf:true})` + `splitByProject(…, kernel.path).mine`
  (même source que `nodefony status`, scopée projet, sync best-effort). Les ports ne sont PAS
  re-sondés (la section Serveurs = vérité interne ; une liste sondée est une convention).
- Canal prod = `logBootVerdict` (NOTICE/WARNING/CRITIC, inclut ignorés + journal).

**Politique d'échec de boot (`isBootErrorFatal`)** : fatal = `critical !== false` && (`production`
OU **`BootConfigurationError`**). `BootConfigurationError` (kernel/BootConfigurationError.ts, export
barrel) = erreur de CONFIGURATION explicite non honorable (infra déclarée injoignable, entité non
portée sur le dialecte) → fatale MÊME en dev (le fail-soft produirait un serveur « vivant » aux
briques durables mortes — login impossible, cause noyée en WARNING, vécu). Guard `is()` tolérant
cross-copies (name check). Le tag `critical=false` d'un module garde la main (jamais fatal).
⚠️ **Un hook NON TAGUÉ est traité comme CRITIQUE** — et `static critical` ne tague QUE les hooks de
classe (`setEvents`). Tout hook posé à la main (service d'un module, décorateur `@services` /
`@controllers`) doit passer par **`Module.hookKernel(event, fn)`**, qui pose `owner` + `critical` du
module. Sinon la promesse `critical = false` ne couvre pas ce hook (vécu : adapters ORM — une base
injoignable interrompait le boot en production malgré `Mongoose.critical = false`, journal
« (anonyme) »). Sentinelles : `KernelLifecycle.test.ts` (contrôle négatif inclus) +
`bootHookPolicy.test.ts` de drizzle et mongoose.

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

- `addModule(Ctor, ...args)` → instancie, `modules[name] = mod`, appelle `mod.init(this)` si présente, sous `guardInitialize` (`Kernel.ts:1340`).
- `getModule(name)` / `getModules()`.
- `addKernelService(Ctor, ...args)` → instancie directement sur container kernel (pas sur module).
- `loadModule(name, build?)` → `import(resolveModuleEntry(this.path, name))` + addModule.

### ⚠️ RÈGLE — un module se résout DEPUIS L'APP, jamais depuis le core

`resolveModuleEntry(appRoot, name)` (`kernel/resolveModuleEntry.ts`) : `createRequire(<app>/package.json).resolve(name)` → URL `file://` absolue ; repli sur le **spécificateur nu** si échec (paquet exports `import`-only, absent).

**Pourquoi** : un `import(name)` écrit dans le code du core est résolu par Node relativement au paquet `nodefony`. Dès que le core vit hors de l'arbre `node_modules` de l'app (`--link`, monorepo, pnpm, hoisting), un module LOCAL de l'app (workspace `modules/*`) est introuvable (« Cannot find package ») alors qu'il l'est parfaitement depuis l'app. Le repo self-hosted masque le défaut : tout y vit sous le même `node_modules`.

Spec figée par `src/tests/resolveModuleEntry.test.ts` (6 tests, dont la régression : résoudre depuis un dossier étranger → repli, depuis l'app → trouvé).

---

## Module (`Module.ts`)

**Purpose**: Unité fonctionnelle (ex-Bundle). `extends Service implements IModule`. Path propre, options, services, controllers.

**Constructor** `new Module(name, kernel, path, options)`:

- `setPath(path)` → résout vers répertoire
- `setEvents()` → wire hooks lifecycle
- ⚠️ watch runtime write-only RETIRÉ : plus de listener `onPostReady`/`Module.watch()`/`watcherService`. Dev = `DevSupervisor` (auto-restart, `src/service/dev/DevSupervisor.ts`) : parent spawn enfant `NF_DEV_CHILD=1` en **leader de groupe** (`detached`), watch backend (frontend exclu → HMR Vite intact), rebuild ciblé turbo+rolldown, **group-kill** au restart (tue Vite, 0 orphelin) + attente ports libres (anti-EADDRINUSE) + retry crash borné. Activé par `DevCommand`
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
- Tous tagués `tagListener(fn, name, static critical)`.

**hookKernel(event, fn)**: pose un hook `once` AU NOM du module (owner + criticité), pour tout hook
hors `setEvents` — services (`this.module.hookKernel("onBoot", …)`), décorateurs `@services`
(`onPreBoot`) et `@controllers` (`onBoot`). Remplace `kernel.once(...)` nu, qui perdait la politique.

**Lifecycle hooks** (optionnels, méthodes prototype):

```typescript
async onKernelRegister(): Promise<this> { ... }
async onKernelBoot(): Promise<this> { ... }
async onKernelReady(): Promise<this> { ... }
async init?(kernel?: IKernel): Promise<this> { ... }
```

⚠️ `init`, PAS `initialize`. `initialize()` est le hook du **Controller** (appelé
sans argument à CHAQUE requête, `Resolver.ts:293`) ; `init(owner)` est celui du
Module et du Service (une fois au démarrage, sous garde de boot). Deux cycles de
vie, deux noms.

**getMcpTools?(): IMcpTool[]** (optionnel, prototype) : outils que le module publie sur la porte MCP
de l'application. **Lu à la demande** par `collectMcpTools` (cœur, `src/mcp/tools.ts`) quand une
requête `tools/list`/`tools/call` arrive — jamais au boot, rien n'est enregistré. Pas
d'implémentation par défaut sur `Module` : une méthode rendant `[]` coûterait un appel par module et
par requête. Handlers = fermetures sur `this`. Écart (nom hors `^[a-zA-Z0-9_-]{1,64}$`, nom déjà
pris, handler absent, déclaration qui lève) → écarté + `onSkip`, jamais silencieux.

**readOverrideModuleConfig(deep?)**: keys `Module-<name>` dans `this.options` → `extend(mod.options, override)`. Warn si module inconnu.

**addService(Ctor, ...args)**: `Injector.instantiate(svc, this, ...args)` → container → `init(module)` si présente (`Module.ts:377`), sous `guardServiceInitialize` quand un kernel est présent. L'injecteur CONSTRUIT seulement — il n'appelle aucun hook.

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

**`Status`/`Stop` = commandes SYSTÈME « standalone »** (`nodefony status`/`stop`): outillage de process PUR, **interceptées par le fast-path de `CliKernel.start`** (`isStandaloneDevCommand`/`runStandaloneDevCommand`, `service/dev/devStatusReport.ts`) AVANT tout boot kernel → **marchent HORS trunk** (de n'importe où), insensibles au dist, sans effet de bord (pas de singleton pollué, pas de fallback « create project »). `StatusCommand`/`StopCommand` ne servent qu'au help (leur `generate()` = filet). Helpers `service/dev/devProcess.ts` (PARTAGÉ avec DevSupervisor : `devSupervisorPidFile`/`defaultDevPorts` anti-divergence). **Vérité = `ps`, pas le pidfile** (PID recyclé). `discoverDevProcesses()` = `ps -A` sous **`LC_ALL=C`** (⚠️ piège vécu : `%CPU` virgule décimale FR cassait la détection) → `parsePsRow` pur, s'auto-exclut. **MULTI-MODE** : `classify` reconnaît les 3 runtimes par leur `process.title` et attache un champ **`mode: "dev"|"prod"|"cluster"`** → dev `nodefony-dev-supervisor`/`-server`/`-vite[…]` · prod `nodefony server` (mono) · cluster `nodefony master [cluster Nw]` + `nodefony worker N [cluster]`. ⚠️ Le titre est **ANCRÉ EN TÊTE** (`startsWith` sur la commande trimée), jamais cherché dedans : poser un `process.title` REMPLACE l'argv, donc `ps` rend le titre SEUL. Un `includes` classait `tail -f /dev/null nodefony server` comme serveur prod — et `stop --all`, qui ne filtre par aucun projet, l'aurait TUÉ. Contrepartie assumée : la fenêtre PRÉ-titre d'un boot (`npm exec nodefony development`) n'est pas détectée — mieux vaut manquer un process de 200 ms que tuer celui d'autrui. Helpers purs : `detectRuntimeMode` (priorité dev>cluster>prod), `runtimeModes` (Set, Vite exclu), `findRuntimeConflict(procs, intended)` (process principaux d'un AUTRE mode = collision). **status** (`devStatusReport.ts` `runStatusReport`): libellé selon le mode (`Nodefony dev|production|cluster`), tableau ANSI colonne RÔLE dynamique (détail bundles Vite / `Nw` master / `#id` worker en 2ᵉ ligne) + synthèse adaptative (segments non-nuls) + warnings fail-loud conscients du mode (cohabitation multi-runtime, pidfile périmé, orphelins **dev**, empilement ; workers cluster ≠ empilement). **stop --all** exige une **SECONDE preuve indépendante du titre** (`scopeAllToNodefonyProjects`, PURE/injectable) : le process travaille dans un projet Nodefony (`isNodefonyProjectDir` sur son cwd ou un ancêtre — cas Vite) ; cwd illisible ⇒ épargné. Les écartés sont NOMMÉS. Sans projet de référence, le titre serait le seul rempart d'un `kill -9` trans-projets. **stop** (`devStop.ts` `runStopReport`): arrête **tout** runtime — group-kill des « racines » (`signalProcessGroup` `-pid` → emporte enfant+Vite, ou master→workers ; SIGTERM déclenche le graceful shutdown du ClusterManager) SIGTERM→SIGKILL + attente ports libres + `clearSupervisorPidFile` ; idempotent. **CIBLE EXPLICITE `stop <nom|chemin>`** (`devProjects.ts`, PUR) : `buildProjectTable` compose les projets vivants (nom = `package.json#name`, repli sur le dossier avec `nameSource` CONSTATÉ) et `resolveProjectTarget` n'accepte qu'UNE correspondance exacte — 0 ⇒ `inconnu`, ≥ 2 ⇒ `ambigu`, les deux REFUSENT (exit `1`, rien n'est tué) : un arrêt est irréversible, « le plus proche » tuerait le mauvais serveur sur une faute de frappe. Résolue, la cible ne fait que SUBSTITUER sa racine au cwd — une seule mécanique d'arrêt. `--all` + cible = contradiction refusée. ⚠️ Le fast-path court AVANT commander : l'argument se lit sur `process.argv` (`standaloneTarget`, premier mot sans `-`), et `runStandaloneDevCommand` rend désormais le CODE que `CliKernel` propage — un `stop` qui n'a pas compris sa cible ne doit pas sortir 0. **status** affiche la même table (`formatProjectTable`) UNIQUEMENT s'il existe un projet étranger, et elle reste HORS de `DevStatusReport` : ce rapport est le contrat du data plane, et nommer les projets coûte un `package.json` par voisin que la console d'admin n'a pas demandé. **GARDES anti-collision** (fail-loud, exit `SysExit.UNAVAILABLE`, JAMAIS de kill cross-mode auto) : `DevSupervisor.#claimSingleInstance` ne tue que les résiduels `mode==="dev"` et refuse de démarrer sur un prod/cluster ; `launchTopology`/`assertNoConflictingRuntime` (`runtimeLauncher.ts`) refuse prod/cluster sur un autre runtime préexistant.

### Ports : le state file runtime (multi-app)

Depuis `servers.portPolicy: "auto"` (défaut dev, cf `@nodefony/http/MEMORY.md`), **le port d'écoute n'est plus une certitude** : un port occupé fait glisser le serveur (5151 → 5153). Tout l'outillage process sondait `[5151, 5152]` **en dur** → il serait devenu aveugle.

- **Canal** : `runtimeStateFile(cwd)` = `node_modules/.cache/nodefony/runtime.json` (à côté du pidfile). Le serveur PUBLIE (`writeRuntimeState`, appelé par `@nodefony/http` après le listen) `{pid, ports, desiredPorts, ts}` ; `status`/`stop`/readiness LISENT (`readRuntimeState`). Best-effort : un échec d'écriture ne fait jamais tomber un serveur qui écoute.
- **`defaultDevPorts(cwd)` — ordre de vérité** : `NF_DEV_PORTS` (l'opérateur gagne toujours) > **state file** (les ports RÉELS) > `[5151, 5152]` (convention, 1ᵉʳ boot). ⚠️ prend un `cwd` (le state file est PAR PROJET).
- Un state file dont le **process est mort** est ignoré ET purgé (sinon `status` sonderait les ports d'hier).
- **`DevSupervisor`** : `#ports` est un **getter** (jamais figé au ctor) ; `#observedPorts` retient les ports de l'enfant (au restart il est mort + son state file purgé, mais il faut attendre que SES ports se libèrent, sinon il en prendrait de nouveaux à chaque reload → onglet navigateur cassé). `#foreignHeldPorts` = ports d'un AUTRE projet : ni attendus (ils ne se libéreront pas), ni pris pour une readiness.
- ⚠️ **Readiness et faux positif** : « un port écoute » ne prouve RIEN quand un autre projet tient les ports par défaut — ce serait SON serveur. `#anyPortListening` (et `launchDetached`) exigent alors le **state file** (seule preuve que c'est notre enfant). Sinon → pas prêt.
- **Cross-projet n'est plus un refus** : le superviseur INFORME (l'enfant glissera) au lieu d'`exit(UNAVAILABLE)`. Le refus subsiste pour un doublon **du même projet** (single-instance, `mine`). En `portPolicy: "strict"`, c'est l'enfant qui échoue au bind — le seul endroit qui SAIT.
- **Warnings `status` scopés au PROJET** (`splitByProject`) : 2 apps en parallèle est NORMAL ; le compte global criait « empilement anormal » sur le cas nominal.
- **`stop`** lit ses ports AVANT le kill (après, le state file est purgé → il aurait rapporté les ports du VOISIN comme « encore occupés » sur un arrêt impeccable) puis `clearRuntimeState`.
- Banc : `src/tests/devProcess.test.ts` (state file : aller-retour, purge process mort, priorité env, corruption, isolation par projet).

## Cluster (mode multi-process sans PM2 — Phases 2+3)

> `service/cluster/` (core). Refonte « beaucoup mieux » de `StagingCommand` (legacy `os.cpus()` + 0 respawn). Vision : mémoire IA `project_cluster_backplane_vision`.

**`ClusterCommand`** (`nodefony cluster`, alias aucun, `kernelEvent:"onStart"`, `--workers N`) : master (`cluster.isPrimary`) → pose `process.env.NF_CLUSTER="1"` (héritage au fork) + crée le **`ClusterRelay`** (gateway) + `cluster.on("fork"→attach / "exit"→detach)` (couvre forks initiaux ET respawns, attaché AVANT `manager.start()`) + `ClusterManager.start()+installSignalHandlers()` (0 HTTP) ; worker → `new Kernel().start()`. `onKernelStart` (via `launchTopology`) : mono/worker → profil serveur `setRunProfile({servers:true,lifetime:"longrunning"})` ; **master reste console** (park) ; env production + `NF_MODE_START="cluster"`.

**Backplane IPC (Phase 3 — master-gateway).** Protocole de fil `clusterMessage.ts` (core) : `CLUSTER_RT_KIND="nf:rt"` + `isClusterMessage()` (UNE source du tag, le framework l'importe via `"nodefony"` → 0 magic-string dupliqué). **`ClusterRelay`** (core, master) : routeur de messages OPAQUES — reçoit une publication realtime d'un worker, la rebroadcast aux AUTRES (`#route` exclut la source = anti-echo de routage) ; ignore les autres kinds (sondes Phase 4 = agrégées ailleurs) + malformés ; seam `IRelayWorker`{id,send,onMessage} → routage testé sans forker (11 tests `ClusterRelay.test.ts`). 0 dépendance `@nodefony/framework` (respect framework→core). Côté worker : `ClusterBackplane` (framework) branché sur le hub par le module `Framework` à `onCluster("WORKER")` (gardé `NF_CLUSTER`). `Kernel.initCluster` worker : `process.on("message")` **filtre les rt** (consommés par le backplane → ni log ni re-fire, anti-flood) ; ne re-fire `onMessage` que pour les messages de contrôle. **Bench fil IPC** : `.claude/skills/nodefony-load-test/scripts/cluster-ipc.mjs` (fork réel, mesuré : ~300k publishes/s @256B, fan-out sature le master @4KB×7sub ~176 MB/s, RTT 4-sauts p50 0.40 ms).

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

- `@services` → `onPreBoot` → addService|loadService (ordre de la liste = ordre d'instanciation)
  - **Échec d'un service → politique de criticité du boot** (`Module.handleServiceBootError` →
    `Kernel.serviceBootErrorFatal` → `isBootErrorFatal`) : **fatal en production** (ou
    `BootConfigurationError`), **fail-soft ANNONCÉ** ailleurs (agrégé au BootReport → « boot
    DÉGRADÉ »). ⚠️ Le `catch` se contentait de `log(e,"ERROR")` : l'échec n'atteignait ni la
    politique (jamais fatal, même en PROD → pod amputé qui se dit sain) ni le BootReport (boot
    cassé affiché « UP »). Un service qu'on ne peut pas CONSTRUIRE suit la règle de celui qu'on ne
    peut pas INITIALISER — on gardait `init`, pas le `new`.
  - ✅ **L'ordre de la liste NE COMPTE PLUS** : `orderServicesByDependencies` (`injector/serviceOrder.ts`)
    trie par dépendances déclarées (`inject:services` + `design:paramtypes`) AVANT d'instancier.
    Tri **STABLE** → une liste déjà correcte sort inchangée ; cycle → erreur qui NOMME le cycle ;
    les chemins `string` (deps inconnaissables sans charger) et les ctors hors registre gardent leur
    position. Avant : `HttpKernel` descendu de 3 lignes dans `http/index.ts:52` → 499
    « sessionService not found » sur chaque requête.
    ⚠️ **Le tri ne sauve QUE les services dont le nom round-trippe** (`@injectable` == clé `super()`,
    cas de `HttpKernel`) : un `super("probeDep")` sous `@injectable()` → `"ProbeDep"` reste
    irrésoluble malgré un ordre correct (dette des noms, cf `injector/MEMORY.md`).
- `@entities` → `onBoot` → addEntity|loadEntity
- `prependOnceListener` (setEvents) toujours index 0 avant `once` (@services/@entities)

**Avancement** : `MIGRATION_STATUS.md` — jamais ici (un MEMORY décrit ce que le code FAIT).

## adminPlane (`adminPlane/`) — porte UNIQUE du plan d'administration

`executeAdmin.ts` : `executeAdminEndpoint({endpoint, request, requiredRole, gate, onServerError?})`
→ `{status, headers?, body}`. Ordre FIXE : RBAC → porte → handler → normalisation → traduction.
Aucun transport, aucun conteneur. Les appelants ne diffèrent que par la RÉSOLUTION de l'endpoint.

- `AdminApiController.runAdmin` (framework) résout par **nom de route** (Router) puis délègue.
- `callAdminEndpoint` (`inspect/adminSubjects.ts`) résout par **namespace + chemin** puis délègue.
  Consommateurs : commande `inspect`, serveur MCP (`src/mcp/tools.ts`).
- `adminRbac.ts` : `isAdminGranted(roles, requiredRole)` (pure, fail-closed) ·
  `resolveAdminRole(endpoint)` = `public ? "" : (role ?? ADMIN_DEFAULT_ROLE)` — la règle est ICI,
  le broker l'appelle.

Règles :

- **Le corps d'un refus appartient au producteur, jamais à la porte.** Un 404 « section inconnue »
  joint le plan de la page ; le résumer en « introuvable » fait conclure que la page n'existe pas.
  `InspectResult.body` le porte ; MCP (`mcpEchecAdmin`, borné 4 ko) et CLI `inspect` le rendent.
- **Panne ≠ refus.** Un handler qui lève est notifié par `onServerError` — ne pas le deviner depuis
  un 500, qu'un producteur peut rendre lui-même. Une 4xx portée par `nodefonyError` est une faute
  du CLIENT : restituée telle quelle, jamais journalisée.
- `gate: null` est un CHOIX écrit (lectures seules), pas un paramètre omis. L'idempotence vit au
  framework (`idempotency.ts`) : son second consommateur est le seam `Resolver`/`@Idempotent`.
- **L'identité se PRÉSENTE** (`IAdminCaller` : `user`, `roles`, `label`), elle n'est plus fabriquée.
  `localOperatorCaller()` pour une commande locale (qui la lance possède déjà le processus) ;
  `adminCallerFromMcp` pour la porte MCP. Le 3ᵉ paramètre de `callAdminEndpoint` est OBLIGATOIRE :
  le compilateur force chaque porte à dire au nom de qui elle appelle.
- **Rôle ∧ scope, et les deux bornes existent** : `rolesFromScopes` n'accorde le rôle qu'à un jeton
  portant `admin:read`/`admin:write` ; `refusedAdminScopes` empêche un non-administrateur de les
  OBTENIR (appliqué à l'émission par `TokenService.#grantableScopes`). Porter le rôle ne suffit pas
  à avoir le scope, porter le scope ne suffit pas à avoir le rôle. Session cookie = pas de
  délégation = rôles seuls (Studio inchangé).
- `mcpCallerRoles` (`src/mcp/caller.ts`) : la règle unique de toute porte MCP — non protégée →
  opérateur (son périmètre EST sa protection) · protégée + jeton → ses scopes · protégée + anonyme
  toléré → rien. Toute porte future (module d'agents) l'appelle au lieu de la réécrire.
- `forbidden` est une raison DISTINCTE de `not-found` : confondre « pas le droit » et « n'existe
  pas » envoie chercher une autre cible au lieu d'un meilleur jeton.
- ⚠️ Asymétrie NOMMÉE, non fermée : un jeton présenté sur la porte HTTP (`ExternalJwtAuthenticator`,
  `subjectPolicy:"require"`) hérite des rôles du compte local SANS intersection avec ses scopes —
  les routes du plan sont montées par le broker, donc sans `@RequireScope`. Le même porteur obtient
  plus par HTTP que par MCP.
- ⚠️ Un seul rôle ouvre les 94 endpoints : c'est du RBAC **fail-closed**, pas du moindre privilège.
  La granularité suppose que `IAdminEndpoint.role` se différencie.

## Deps

- Kernel → Container, Service, Injector, FileClass, Nodefony, CliKernel, Module, @nodefony/http
- adminPlane → types/IAdminApi, Error (zéro transport, zéro conteneur)
- Module → Service, Kernel, Injector, Container, CliKernel
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
- `interfacesFilter({})` → tous vides (ni type ni family spécifiés → matchs false, condition && → false)
- `getDependencies()` : devDependencies exclus, doublons possibles si dep dans deux sections
- `Command.setEvents()` : `eventsRegistered` guard ajouté — idempotent
