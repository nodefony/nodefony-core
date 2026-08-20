# CLAUDE.md — Kernel / Module / CliKernel

> Sous-module `src/nodefony/src/kernel/` du workspace `@nodefony/core`.
> Pour audience IA en cours de session. Complète [`MEMORY.md`](./MEMORY.md) (ultra-concis internals) et [`README.md`](./README.md) (humain).

## Rôle

Orchestration du framework. **Kernel** boot l'application, charge les modules, expose les events lifecycle. **Module** est l'unité fonctionnelle (ex-Bundle). **CliKernel** est la spécialisation CLI (Commander wrapping).

## Architecture du sous-module

```
src/nodefony/src/kernel/
├── Kernel.ts                ← orchestrateur boot (extends Service)
├── Module.ts                ← unité fonctionnelle (extends Service)
├── CliKernel.ts             ← Cli wrapping + Commander (extends Cli, PAS Kernel)
├── commands/                ← commandes CLI built-in (Dev, Build, Prod, ...)
│   ├── StartCommand.ts
│   ├── DevCommand.ts
│   ├── BuildCommand.ts
│   ├── ProdCommand.ts       ← foreground cloud-native (topologie via --workers)
│   ├── ClusterCommand.ts    ← cluster multi-worker (remplace l'ancien staging)
│   ├── InstallCommand.ts
│   ├── OutdatedCommand.ts
│   ├── StatusCommand.ts     ← introspection runtime dev/prod/cluster (ps + sonde ports, standalone)
│   ├── StopCommand.ts       ← arrêt propre de tout runtime Nodefony (group-kill, standalone)
│   ├── CompletionCommand.ts ← script de complétion shell bash/zsh/fish (standalone)
│   └── CreateCommand.ts     ← scaffold projet/module/entité (standalone)
├── injector/                ← DI decorators (@injectable, @inject, ...)
└── MEMORY.md / README.md / CLAUDE.md
```

## Classes — vue d'ensemble

| Classe          | Extends            | Rôle                                                                 |
| --------------- | ------------------ | -------------------------------------------------------------------- |
| **`Kernel`**    | `Service`          | Boot orchestrator, lifecycle events, modules registry                |
| **`Module`**    | `Service`          | Unit fonctionnel (ex-Bundle) — hooks lifecycle, registration         |
| **`CliKernel`** | `Cli` (PAS Kernel) | CLI runner — Commander, parseCommand, addCommand                     |
| **`Command`**   | `EventEmitter`     | Base class CLI command (lifecycle hooks `onKernelStart`, `generate`) |

⚠️ **Piège fondamental** : `CliKernel` étend **`Cli`** pas `Kernel`. Le `Kernel` est instancié séparément et linké à `CliKernel.kernel`. Ne pas confondre.

## Lifecycle Kernel — bitmask `progress`

```
Events bitmask (frozen):
  onInit=1  onPreStart=2  onStart=4  onPreRegister=8  onRegister=16
  onPreBoot=32  onBoot=64  onReady=128  onServersReady=256  onPostReady=512  onTerminate=1024

Flags chronologiques:
  started → preRegistered → registered → booted → ready → postReady
```

`progress` = OR cumulatif. `setCommandComplete(p)` → `progress |= Events[p]`. `isCommandComplete(p)` = `!!(progress & Events[command.kernelEvent])`.

**Chaîne async** (chaque maillon appelle le suivant si `!setCommandComplete`) :
`start() → preRegister() → boot() → onReady() → initServers()`

## Module — pattern d'utilisation

```typescript
import { Module, services } from "nodefony";

// ⚠️ `@Service({ … })` N'EXISTE PAS (le barrel exporte `injectable`, `inject`, `services`).
// Un Module ne se décore pas pour « être un singleton » : il l'est par construction.
// Le seul décorateur utile ici = `@services([...])`, qui déclare SES services.
@services([MyService])
export class MyModule extends Module {
  static readonly path: string = import.meta.url; // OBLIGATOIRE — sert setPath()

  async onKernelRegister(): Promise<this> {
    this.log("Registering MyModule", "DEBUG");
    return this;
  }

  async onKernelBoot(): Promise<this> {
    this.log("Booting MyModule", "DEBUG");
    return this;
  }

  async onKernelReady(): Promise<this> {
    this.log("MyModule ready", "INFO");
    return this;
  }
}
```

**Constructor** : `setParameters("modules.<name>")` + `setPath()` + `setEvents()` — qui ne pose un
hook que s'il EXISTE sur la classe (`if (this.onKernelRegister)`), plus le
`prependOnceListener("onPreBoot")` qui charge le `package.json` et les overrides de config.
**Aucun listener de build** : le build passe par la toolchain CLI (turbo + rolldown), le
rechargement dev par le `DevSupervisor` (`Module.ts:115` le dit au source).

> Le watch Rollup runtime write-only (listener `onPostReady` + `Module.watch()` + service `watcherService`) a été RETIRÉ : il ne rechargeait rien. Le dev = **`DevSupervisor` auto-restart** (`src/service/dev/DevSupervisor.ts`, activé par `DevCommand` en mode `development`) : un process parent (type CONSOLE, ne boote pas de serveur) `spawn` le serveur enfant (`NODEFONY_DEV_CHILD=1`) en **leader de groupe** (`detached:true`), watch les sources backend (frontend exclu → HMR Vite préservé), rebuild **ciblé** (`turbo --filter` + `rollup -c` racine) puis **group-kill** l'enfant (tue les instances Vite filles → 0 orphelin) et relance après **attente des ports libres** (anti-`EADDRINUSE`) avec retry crash borné. Validé runtime (boot/restart 1.2s/anti-orphelin/multi-Vite/Ctrl+C propre). Le `stop.sh`/`start.sh` du skill `nodefony-start-server` reste l'option « boot direct » pour les suites de tests (serveur stable sans superviseur).

**Hooks lifecycle attachés via `setEvents()`** (méthodes prototype obligatoires, pas property initializers) :

- `onKernelRegister` → `kernel.once("onRegister", ...)`
- `onKernelBoot` → `kernel.once("onBoot", ...)`
- `onKernelReady` → `kernel.once("onReady", ...)`
- `prependOnceListener("onPreBoot", ...)` → charge `package.json` + `readOverrideModuleConfig()`

⚠️ **CRITIQUE** : hooks **doivent** être méthodes prototype, pas property initializers ni arrow functions — `super()` tourne AVANT les initializers.

⚠️ **Hook posé HORS `setEvents()` → `module.hookKernel(event, fn)`, jamais `kernel.once(...)`.** `static critical` ne tague que les hooks de classe ; un listener non tagué est traité comme **critique** par la politique de boot. Un service qui pose sa connexion avec `kernel.once("onBoot", …)` fait donc échouer le boot en production même si son module se déclare optionnel — et le journal désigne « (anonyme) ». `hookKernel` fait hériter propriétaire et criticité. Vaut aussi pour les décorateurs qui enveloppent un module (`@services`, `@controllers`).

## CliKernel — spécificités

### Pattern de construction

```typescript
new CliKernel(environment?: string)
//   ↑ environment peut être undefined au constructor !
```

**⚠️ Piège connu** (cf mémoire `project_clikernel_lifecycle`) : `this.environment` est `undefined` dans le constructor. Tout setup conditionnel doit être dans `onKernelStart()` (hook command), JAMAIS dans le constructor.

```typescript
// ❌ FAUX
class CliKernel {
  constructor(env?: string) {
    super(...);
    if (this.environment === "production") { /* ... */ }  // env est undefined !
  }
}

// ✅ JUSTE — déléguer à la sous-commande
class DevCommand extends Command {
  override async onKernelStart(): Promise<void> {
    (this.cli as CliKernel).setRunProfile({
      servers: true, lifetime: "longrunning", interactive: false,
    });
    this.cli.environment = "development";  // ← set ici
  }
}
```

### Profil d'exécution (`runProfile` — ex `type` SERVER/CONSOLE, refondu)

- `this.runProfile = { servers, lifetime, interactive }` (défaut console : `{false,"oneshot",false}`) — remplace l'ancien binaire `type` (`KernelType`, double casing) qui écrasait 3 axes.
- `setRunProfile(profile)` côté CliKernel → recopié dans `kernel.runProfile` à `onStart`.
- `isConsole()` = `!runProfile.servers` (dérivé). Le montage serveur reste piloté par `kernelEvent` + présence `HttpKernel`. **`lifetime` est EFFECTIF** (Phase B) : `Kernel.finishOrPark(code)` parke (daemon `longrunning` + `!servers`) au lieu de terminer, via `Kernel.park({keepAlive})` = **source unique** du park (remplace les `new Promise(()=>{})` inline de DevSupervisor parent / master cluster / daemon). `keepAlive:true` ref un timer (daemon sans handle) ; superviseurs = `false` (handles propres). Cf `project_kernel_runmodes_introspection`.
- `isTTY` (champ résolu 1× au boot, `process.stdout.isTTY`, surchargeable `NO_TTY`) : volet ENVIRONNEMENT complétant `runProfile.interactive` → interactif possible SSI `interactive && isTTY`. Affiché dans le banner dev (`tty yes/no`). Cloud-native → `false`.

### Package manager

`this.packageManager = this.pnpm` par défaut. `setPackageManager("npm" | "yarn" | "pnpm")`.

## Commands — pattern Command

```typescript
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onPostReady", // ← attend cette phase avant generate()
};

class MyCommand extends Command {
  constructor(cli: CliKernel) {
    super("mycommand", "Description", cli, options);
    this.alias("mc");
    this.addOption("--verbose", "Verbose mode");
  }

  override async onKernelStart(): Promise<void> {
    this.cli.environment = "development";
    // Setup pré-boot (env, type, packageManager...)
  }

  override async generate(options: any): Promise<void | Kernel> {
    // Exécution principale — appelée APRÈS la phase kernelEvent
    return this.kernel as Kernel;
  }
}
```

## Commandes built-in

<!-- prettier-ignore -->
| Command | Alias | Status |
| --- | --- | --- |
| `Start` | — | ✅ |
| `Dev` | `dev` | ✅ |
| `Build` | — | ✅ |
| `Prod` | `prod` | ✅ foreground cloud-native (topologie `--workers`) |
| `Cluster` | — | ✅ cgroup-aware + respawn backoff + graceful shutdown |
| `Install` | — | ✅ |
| `Outdated` | — | ✅ **UNE** interrogation npm à la racine, agrégée par paquet (`-j/--json`, `-a/--all`) — refuse hors projet npm |
| `Status` | — | ✅ introspection **multi-mode** (dev superviseur/serveur/Vite · prod `nodefony server` · cluster master/workers) + ports — **standalone, hors trunk** |
| `Stop` | — | ✅ arrêt propre de **tout** runtime Nodefony (dev/prod/cluster, group-kill, remplace `pkill -9`) — **standalone, hors trunk** |

⚠️ **Tests CLI** : Phase 11 non finalisée. Les commands ne sont pas couvertes par des tests d'intégration. État réel à vérifier au cas par cas.

### Dispatch built-in vs commande de module

Les built-ins ci-dessus sont enregistrés dans commander par `CliKernel.start()` **avant** le parse argv. Les **commandes de module** (`frontend:build`, `network`, …, posées par les modules à `onPreRegister` via `addCommand`) ne sont pas encore connues à cet instant → un parse immédiat échouait (`unknown command`) et tombait dans le fallback qui **bootait un serveur** (bug `project_cli_commands_broken_claude_ts`).

Fix : `CliKernel` classe la commande demandée (helper `getRequestedCommandName` vs `getBuiltinCommandNames`, dérivé de commander — 0 hardcode). Si ce n'est pas un built-in → **dispatch différé** (`dispatchModuleCommand`) : un listener `onPreRegister` (posé via `onStart` pour passer APRÈS le chargement des modules du manifeste `config.modules`, `emitAsync` séquentiel) parse argv une fois les modules enregistrés. Kernel reste **CONSOLE** (0 serveur) ; commande introuvable → `terminate(1)`, jamais de fallback serveur.

**Help global enrichi** : `nodefony`, `nodefony --help`, `nodefony -h` listent désormais **AUSSI les commandes de module** (`network`, `frontend:build`, `test:batch`…), plus seulement les built-ins. Helpers `isGlobalHelpRequested()` (nu OU que des options dont `-h`/`--help` ; exclut `--version` et `nodefony <cmd> --help`) + `dispatchGlobalHelp()` : même mécanique de timing que `dispatchModuleCommand` — boot CONSOLE jusqu'à `onPreRegister` (modules instanciés → leurs commandes posées dans commander), `showHelp(false)` puis `terminate(0)`. Boot KO (hors d'une app) → fallback help built-in seul. `--version` reste résolu par commander **sans** booter les modules.

> Limite restante (dette `project_cli_module_command_dispatch`) : une commande de module ne peut pas être de type SERVER (son `onKernelStart` ne fire pas — `onStart` déjà passé). Le câblage propre (parse pur + registry + `type`/`kernelEvent` déclaratifs) reste la cible.

## Pollution singleton

`new Kernel()` → appelle `Nodefony.setKernel(this)`. Cela écrase le singleton global. **Conséquence tests** : isoler les tests Kernel avec un mock minimal pour ne pas casser les autres tests qui dépendent de `Nodefony.getKernel()`.

## Decorators de découverte modulaire

Cf [`injector/CLAUDE.md`](injector/CLAUDE.md) pour le détail.

> **Chargement de modules** : plus de décorateur `@modules` (RETIRÉ). La liste vit dans `config.modules` (manifeste ordonné, policy/`when`/env) ; le Kernel la résout + charge à `onPreRegister` (`resolveModules`/`loadModulesFromManifest`). Cf mémoire IA `project_module_loading_architecture`.

<!-- prettier-ignore -->
| Décorateur | Phase déclenchée | Rôle |
| --- | --- | --- |
| `@services([...])` | `onPreBoot` | Services à enregistrer dans le module |
| `@entities([...])` | `onRegister` | Entités ORM à enregistrer — **fourni par `@nodefony/orm-core`**, pas par le core (`import { entities } from "@nodefony/orm-core"`). `onRegister` et non `onBoot` : les connecteurs créent les tables à `onBoot`. |
| `@injectable()` | runtime | Marque classe injectable |
| `@inject("name")` | runtime | Injection paramètre constructeur |
| `@Inject("name")` | runtime | Injection propriété — **interne** : défini (`kernelDecorator.ts:155`) mais PAS exporté par le barrel (`src/nodefony/src/index.ts` n'expose que `injectable`, `inject`, `services`) → indisponible pour une app. Utiliser l'injection par constructeur. |

## Gotchas critiques

<!-- prettier-ignore -->
| Symptôme | Cause | Fix |
| --- | --- | --- |
| `Cannot read 'environment' of undefined` | Constructor CliKernel | Conditionner dans `onKernelStart()` |
| `Kernel not ready` (`addCommand`) | `cli === null` | Vérifier `kernel.cli` avant `addCommand` |
| Hook lifecycle pas appelé | Arrow function / property init au lieu de prototype | Méthode classique `async onKernelBoot() {}` |
| `setCommandComplete` retourne false | `this.command === null` | Vérifier qu'une command est attachée |
| `isModule(null)` → TypeError | Pas false, vraiment throw | Vérifier null avant |
| `getDependencies()` doublons | dep dans deps + peerDeps | Ne pas se fier à l'unicité |
| `Cannot add option '-v, --version'` | `setCommandVersion()` appelé 2× | Le constructor le fait déjà |

## Lancer le code

```bash
# Boot kernel via CLI
npx nodefony development        # CliKernel → DevCommand → Kernel boot
npx nodefony build              # CliKernel → BuildCommand → Rollup tous workspaces
npx nodefony --help             # commandes disponibles

# Tests kernel
cd src/nodefony && npm run test  # ~230 tests
```

## Liens

- [`MEMORY.md`](./MEMORY.md) — internals IA détaillés
- [`README.md`](./README.md) — doc humaine API
- [`injector/CLAUDE.md`](injector/CLAUDE.md) — DI decorators (à créer)
- [`../cli/CLAUDE.md`](../cli/CLAUDE.md) — Cli / Command (à créer)
- [`../../CLAUDE.md`](../../CLAUDE.md) — workspace core
- [`../../docs/kernel.md`](../../docs/kernel.md) — vision architecturale (relocalisé `src/nodefony/docs/`, ADR-0001)
