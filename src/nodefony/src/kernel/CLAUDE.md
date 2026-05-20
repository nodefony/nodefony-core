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
│   ├── ProdCommand.ts       ← 🪦 mention PM2 deprecated, retrait Phase 16
│   ├── StagingCommand.ts
│   ├── InstallCommand.ts
│   ├── OutdatedCommand.ts
│   ├── pm2/Pm2Command.ts    ← 🪦 DEPRECATED — retrait Phase 16
│   └── KillCommnand.ts      ← (typo originale conservée pour compat)
├── injector/                ← DI decorators (@injectable, @inject, ...)
└── MEMORY.md / README.md / CLAUDE.md
```

## Classes — vue d'ensemble

| Classe | Extends | Rôle |
|--------|---------|------|
| **`Kernel`** | `Service` | Boot orchestrator, lifecycle events, modules registry |
| **`Module`** | `Service` | Unit fonctionnel (ex-Bundle) — hooks lifecycle, registration |
| **`CliKernel`** | `Cli` (PAS Kernel) | CLI runner — Commander, parseCommand, addCommand |
| **`Command`** | `EventEmitter` | Base class CLI command (lifecycle hooks `onKernelStart`, `generate`) |

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
import { Module, Service } from "nodefony";

@Service({ singleton: true })
export class MyModule extends Module {
  static readonly path: string = import.meta.url;  // OBLIGATOIRE — sert setPath()

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

**Constructor side effects** (TOUJOURS exécutés) :
- `kernel.once("onBoot", ...)` → récupère rollup/watcher
- `kernel.once("onPostReady", ...)` → démarre watch si dev + `options.watch`
- `setParameters("modules.${name}", options)`

→ **Conséquence** : 2 listeners attachés par module, indépendamment de tes hooks personnalisés.

**Hooks lifecycle attachés via `setEvents()`** (méthodes prototype obligatoires, pas property initializers) :
- `onKernelRegister` → `kernel.once("onRegister", ...)`
- `onKernelBoot` → `kernel.once("onBoot", ...)`
- `onKernelReady` → `kernel.once("onReady", ...)`
- `prependOnceListener("onPreBoot", ...)` → charge `package.json` + `readOverrideModuleConfig()`

⚠️ **CRITIQUE** : hooks **doivent** être méthodes prototype, pas property initializers ni arrow functions — `super()` tourne AVANT les initializers.

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
    (this.cli as CliKernel).setType("SERVER");
    this.cli.environment = "development";  // ← set ici
  }
}
```

### Type CLI
- `this.type = "CONSOLE"` (défaut) — propriété directe, PAS méthode `isConsole()` côté CliKernel
- `setType("SERVER")` → déclenche le démarrage des serveurs HTTP/WS via `@nodefony/http`

### Package manager
`this.packageManager = this.pnpm` par défaut. `setPackageManager("npm" | "yarn" | "pnpm")`.

## Commands — pattern Command

```typescript
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onPostReady",  // ← attend cette phase avant generate()
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

| Command | Alias | Status |
|---------|-------|--------|
| `Start` | — | ✅ |
| `Dev` | `dev` | ✅ |
| `Build` | — | ✅ |
| `Prod` | `prod` | 🪦 mention PM2 deprecated |
| `Staging` | — | ✅ |
| `Install` | — | ✅ |
| `Outdated` | — | ✅ |
| `Pm2` | — | 🪦 DEPRECATED — retrait Phase 16 (cf `project_pm2_deprecation`) |
| `Kill` | — | ✅ (note: typo `KillCommnand.ts` conservée) |

⚠️ **Tests CLI** : Phase 11 non finalisée. Les commands ne sont pas couvertes par des tests d'intégration. État réel à vérifier au cas par cas.

## Pollution singleton

`new Kernel()` → appelle `Nodefony.setKernel(this)`. Cela écrase le singleton global. **Conséquence tests** : isoler les tests Kernel avec un mock minimal pour ne pas casser les autres tests qui dépendent de `Nodefony.getKernel()`.

## Decorators de découverte modulaire

Cf [`injector/CLAUDE.md`](injector/CLAUDE.md) pour le détail.

| Décorateur | Phase déclenchée | Rôle |
|-----------|------------------|------|
| `@modules([...])` | `onPreRegister` | Liste des modules à charger |
| `@services([...])` | `onPreBoot` | Services à enregistrer dans le module |
| `@entities([...])` | `onBoot` | Entités ORM à enregistrer |
| `@injectable()` | runtime | Marque classe injectable |
| `@inject("name")` | runtime | Injection paramètre constructeur |
| `@Inject("name")` | runtime | Injection propriété (Phase A partielle) |

## Gotchas critiques

| Symptôme | Cause | Fix |
|----------|-------|-----|
| `Cannot read 'environment' of undefined` | Constructor CliKernel | Conditionner dans `onKernelStart()` |
| `Kernel not ready` (`addCommand`) | `cli === null` | Vérifier `kernel.cli` avant `addCommand` |
| Hook lifecycle pas appelé | Arrow function / property init au lieu de prototype | Méthode classique `async onKernelBoot() {}` |
| 2 listeners en trop par module | Module constructor toujours add onBoot + onPostReady | Comportement normal — accepter ou cleanup explicite |
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
- `docs/architecture/kernel.md` — vision architecturale
