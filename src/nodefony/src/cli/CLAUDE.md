# CLAUDE.md — Cli / Command

> Sous-module `src/nodefony/src/cli/` du workspace `@nodefony/core` (+ `../command/`).
> Pour audience IA en cours de session. Complète [`MEMORY.md`](./MEMORY.md) et [`README.md`](./README.md).

## Rôle

Framework de commandes CLI de Nodefony. **Cli** = base class (Commander wrapper + helpers). **Command** = base class pour chaque commande (`development`, `build`, `test`, etc.). **CliKernel** (cf `../kernel/`) étend `Cli` et ajoute le lien au Kernel.

## Architecture

```
src/nodefony/src/cli/
├── Cli.ts                 ← base class (extends EventEmitter ou Service ?)
├── Tools.ts               ← niceBytes, timers, helpers
├── MEMORY.md / README.md / CLAUDE.md

src/nodefony/src/command/
├── Command.ts             ← base class pour chaque commande
└── (helpers communs)
```

## Cli — façade Commander

`Cli` enveloppe `commander` (npm) avec helpers Nodefony :

- `addCommand(Ctor)` — instancie + register dans commander
- `parseCommand(argv)` / `parseCommandAsync(argv)` — délègue à commander
- `setCommandVersion()` — `-v/--version` auto (NE PAS appeler 2× → throws)
- `setProcessTitle()`, `showBanner()`, `blankLine()`, `clear()`, `showAsciify()` — UI helpers
- `terminate(code, quiet?)` — exit propre avec event `onTerminate`
- `niceBytes(n)` (static) — `1024` → `"1.0 KB"`, `10240` → `"10 KB"`

## Command — pattern de base

```typescript
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onPostReady", // attend cette phase avant generate()
};

class DevCommand extends Command {
  constructor(cli: CliKernel) {
    super(
      "development", // name
      "Start dev server (Rollup watch)", // description
      cli,
      options,
    );
    this.alias("dev");
    this.addOption("--no-daemon", "Foreground mode");
  }

  override async onKernelStart(): Promise<void> {
    // Hook AVANT Kernel.boot() — config env, profil d'exécution, etc.
    (this.cli as CliKernel).setRunProfile({
      servers: true,
      lifetime: "longrunning",
      interactive: false,
    });
    this.cli.environment = "development";
  }

  override async generate(options: any): Promise<void | Kernel> {
    // Exécution principale — APRÈS la phase kernelEvent (onPostReady)
    // Le kernel est complètement booté ici, les serveurs écoutent
    return this.kernel as Kernel;
  }
}
```

## Lifecycle Command

```
1. Constructor
   ├── this.commandName = name
   ├── this.alias = []
   ├── this.options = OptionsCommandInterface
   └── this.setEvents()  ← guard eventsRegistered, idempotent

2. CliKernel.addCommand(Ctor)
   ├── new Ctor(cli)
   ├── this.commands[name] = instance
   └── instance.register()  ← commander.command(name).action(...)

3. CliKernel.parseCommand(argv)
   └── commander match → command.run()

4. command.run()
   ├── command.onKernelStart()  ← hook pré-boot
   ├── kernel.start()           ← boot complet
   └── command.generate(opts)   ← après phase kernelEvent
```

## OptionsCommandInterface

```typescript
interface OptionsCommandInterface {
  showBanner?: boolean; // affiche le banner ASCII au boot
  kernelEvent?: KernelEventKey; // phase à attendre avant generate()
  // défaut "onPostReady"
  // valeurs: onInit | onPreStart | onStart |
  //          onPreRegister | onRegister |
  //          onPreBoot | onBoot | onReady |
  //          onServersReady | onPostReady
}
```

**Choix de `kernelEvent`** :

- `"onPostReady"` (défaut) — serveurs HTTP/WS prêts. Pour les commands qui veulent les utiliser.
- `"onReady"` — services bootés mais serveurs pas démarrés. Pour les commands utilitaires (build, test).
- `"onBoot"` — modules instanciés. Pour debug/inspection précoce.
- `"onPreStart"` — quasi rien fait. Pour les commands ultra-light.

## Pattern d'usage CLI Nodefony

```bash
# Built-in
npx nodefony development        # DevCommand
npx nodefony build              # BuildCommand
npx nodefony test               # TestCommand (à confirmer)
npx nodefony production         # ProdCommand
npx nodefony --help             # liste tout
npx nodefony --version          # -v/--version

# Custom (futur — Phase 11)
npx nodefony orm:migrate
npx nodefony security:user:add
npx nodefony http:routes:list
npx nodefony frontend:create my-component
```

## niceBytes — helper formatage

```typescript
import { Cli } from "nodefony";
Cli.niceBytes(0); // "0 B"
Cli.niceBytes(1024); // "1.0 KB"
Cli.niceBytes(10240); // "10 KB"
Cli.niceBytes(1048576); // "1.0 MB"
Cli.niceBytes(1073741824); // "1.0 GB"
```

**Règle** : `n >= 10 || l < 1 ? 0 décimales : 1`.

Utilisé dans Kernel.memoryUsage() pour afficher RSS/heap.

## Commandes existantes — `src/nodefony/src/kernel/commands/`

Toutes ces commandes sont **déjà migrées** en TS mais **non testées en intégration** (Phase 11).

| Command    | Alias  | Fichier              | Statut                         |
| ---------- | ------ | -------------------- | ------------------------------ |
| `Start`    | —      | `StartCommand.ts`    | ✅                             |
| `Dev`      | `dev`  | `DevCommand.ts`      | ✅                             |
| `Build`    | —      | `BuildCommand.ts`    | ✅                             |
| `Prod`     | `prod` | `ProdCommand.ts`     | ✅ foreground cloud-native     |
| `Cluster`  | —      | `ClusterCommand.ts`  | ✅ (remplace l'ancien staging) |
| `Install`  | —      | `InstallCommand.ts`  | ✅                             |
| `Outdated` | —      | `OutdatedCommand.ts` | ✅                             |

⚠️ **Bug pré-existant** : les commands par module (`http:*`, `framework:*`, `security:*`, `user:*`) sont cassées sur claude-ts (cf mémoire `project_cli_commands_broken_claude_ts`). À traiter dans une branche dédiée hors POC.

## Hooks Command

| Hook              | Quand                     | Use case                         |
| ----------------- | ------------------------- | -------------------------------- |
| `onKernelStart()` | AVANT `Kernel.start()`    | Config env, type, packageManager |
| `generate(opts)`  | APRÈS phase `kernelEvent` | Exécution principale             |
| `register()`      | Au moment de `addCommand` | Setup commander (options, args)  |

## Settings ProtoService cas spécial

⚠️ `Service.set()` pour les commands utilise un guard car le Container peut être absent au moment de l'enregistrement. Voir `Command.ts:register()`.

## Bug pré-existant — commands modules cassées

Cf mémoire `project_cli_commands_broken_claude_ts`. À résoudre dans une branche dédiée. Symptôme : `npx nodefony http:routes:list` → "command not found" ou crash boot.

Hypothèses :

- Module.addCommand() pas appelé au bon moment dans le lifecycle
- `kernel.cli` est `null` quand le module tente d'enregistrer
- Commander parsing fait avant que les commands modules soient registered

## ⚠️ Gotchas

| Symptôme                            | Cause                                        | Fix                                                     |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------- |
| `Cannot add option '-v, --version'` | `setCommandVersion()` appelé 2×              | Constructor `Cli` le fait déjà                          |
| Command pas matched par Commander   | `addCommand()` appelé après `parseCommand()` | Ordre : add → parse                                     |
| `onKernelStart` pas appelé          | Override sans `super` ? Vérifier signature   | Doit être `async onKernelStart(): Promise<void>`        |
| `generate()` pas appelé             | Mauvaise phase `kernelEvent`                 | Vérifier que le kernel fire bien cet event              |
| 2× registered listeners sur Command | `setEvents()` appelé 2×                      | Guard `eventsRegistered` ajouté 2026-05-14 — idempotent |

## Lancer des tests

```bash
cd src/nodefony && npm run test 2>&1 | grep -A 3 "Cli\|Command"
```

## Liens

- [`MEMORY.md`](./MEMORY.md) — internals IA détaillés (Cli + Command + niceBytes + timers)
- [`README.md`](./README.md) — doc humaine API
- [`../kernel/CLAUDE.md`](../kernel/CLAUDE.md) — CliKernel (étend Cli)
- [`../../CLAUDE.md`](../../CLAUDE.md) — workspace core
- `project_command_architecture` (mémoire IA) — refacto CLI, lifecycle
- `project_cli_commands_broken_claude_ts` (mémoire IA) — bug commands modules
- `project_clikernel_lifecycle` (mémoire IA) — environment undefined au constructor
