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
      "Start Server in development Mode", // description
      cli,
      options,
    );
    this.alias("dev");
  }

  override async onKernelStart(): Promise<void> {
    // Hook à onStart — env + profil DYNAMIQUE (parent/enfant, master/worker).
    // Un profil STATIQUE se déclare plutôt dans les options (`runProfile: {...}`),
    // appliqué par resolveCommand — marche AUSSI pour une commande de module.
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

## Lifecycle Command (parse PUR — refacto `resolveCommand`)

```
1. Constructor
   ├── this.kernelEvent / this.lifetime / this.runProfile ← DÉCLARÉS via options
   └── createCommand(name) → commander ; l'action() ne fait que SIGNALER le match

2. CliKernel.addCommand(Ctor)
   ├── new Ctor(cli)
   └── this.commands[name] = instance

3. parse commander → action() → CliKernel.resolveCommand(cmd, args)  ← POINT UNIQUE
   ├── kernel.command / kernel.commandArgs
   ├── applique command.runProfile DÉCLARÉ (setRunProfile → resync kernel.runProfile)
   └── cmd.setEvents(args)  ← hooks onKernelX + once(kernelEvent, action) ; guard eventsRegistered

4. Kernel boot → à CHAQUE phase : setCommandComplete(phase)
   ├── phase cible atteinte → finishOrPark(0)  ← terminate one-shot OU park daemon
   └── action() → run() → generate()  ← fire à la phase kernelEvent
```

Commandes de MODULE (posées à `onPreRegister`) : dispatch DIFFÉRÉ (cf `../kernel/CLAUDE.md`),
même `resolveCommand` — le `runProfile` déclaré étant resynchronisé à la résolution, une
commande de module peut être SERVEUR (`servers: true` + `kernelEvent: "onPostReady"`).

## OptionsCommandInterface

```typescript
interface OptionsCommandInterface {
  showBanner?: boolean; // affiche le banner ASCII
  kernelEvent?: KernelEventKey; // phase d'exécution + POINT D'ARRÊT du boot
  // défaut "onRegister"
  // valeurs: onPreStart | onStart | onPreRegister | onRegister |
  //          onPreBoot | onBoot | onReady | onServersReady | onPostReady
  lifetime?: "oneshot" | "longrunning"; // daemon CONSOLE → park au lieu de terminate
  runProfile?: IRunProfile; // profil DÉCLARATIF { servers, lifetime, interactive }
  // appliqué par resolveCommand ; les profils DYNAMIQUES (dev parent/enfant,
  // master/worker) restent posés par setRunProfile() dans onKernelStart
}
```

**Choix de `kernelEvent`** (= point d'arrêt du boot — le kernel s'ARRÊTE à cette phase) :

- `"onPostReady"` — serveurs HTTP/WS prêts. Pour les runtimes serveur (dev/prod/cluster).
- `"onReady"` — tout est booté SAUF les serveurs. Pour les commands qui introspectent
  la config/les services sans écouter (`proxy:generate`, `assets:publish`).
- `"onBoot"` — services kernel créés. Ex : `http:certificates`.
- `"onRegister"` (défaut) — modules enregistrés. Ex : `build`, `install`, `http:network`.
- `"onStart"` — app chargée, aucun module. Pour l'ultra-light (menu `start`).

## Pattern d'usage CLI Nodefony

```bash
# Built-in
npx nodefony development        # DevCommand (--detach pour le mode détaché)
npx nodefony build              # BuildCommand
npx nodefony production         # ProdCommand
npx nodefony --help             # liste tout (commandes de module incluses)
npx nodefony --version          # -v/--version

# Commandes de module (posées par les modules à onPreRegister)
npx nodefony http:network -j
npx nodefony proxy:generate nginx
npx nodefony frontend:build

# Futur (P11.3/11.4)
npx nodefony orm:migrate
npx nodefony security:user:add
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

Filet d'intégration : `CliIntegration.test.ts` (`RUN_CLI_BOOT=1` pour les boots réels).

| Command      | Alias     | Fichier                | Note                                                      |
| ------------ | --------- | ---------------------- | --------------------------------------------------------- |
| `Start`      | —         | `StartCommand.ts`      | menu interactif (TTY)                                     |
| `Dev`        | `dev`     | `DevCommand.ts`        | + `--detach/--wait/--health/--log` (fast-path standalone) |
| `Build`      | `compile` | `BuildCommand.ts`      | point d'arrêt `onRegister`                                |
| `Prod`       | `prod`    | `ProdCommand.ts`       | foreground cloud-native, `--workers`, `--detach`          |
| `Cluster`    | —         | `ClusterCommand.ts`    | `--workers`, `--detach`                                   |
| `Install`    | —         | `InstallCommand.ts`    |                                                           |
| `Outdated`   | —         | `OutdatedCommand.ts`   |                                                           |
| `Status`     | —         | `StatusCommand.ts`     | **standalone** (0 boot)                                   |
| `Stop`       | —         | `StopCommand.ts`       | **standalone** (0 boot)                                   |
| `Completion` | —         | `CompletionCommand.ts` | **standalone** — script bash/zsh/fish (cf § Complétion)   |
| `Create`     | —         | `CreateCommand.ts`     | **standalone** — scaffold projet (cf § Scaffold)          |

Les commandes de MODULE (`http:network`, `proxy:generate`, `frontend:build`…) passent par le
dispatch différé de `CliKernel` — happy-path couvert e2e (exit 0, 1 Kernel, 0 serveur).

## Complétion shell — `cli/completion.ts`

`nodefony completion <bash|zsh|fish>` imprime le script à sourcer ; au TAB le script appelle
`nodefony __complete -- <mots>` (fast-path standalone, 0 boot, exit TOUJOURS 0). La donnée =
**manifest cache** `node_modules/.cache/nodefony/cli-manifest.json`, écrit au boot DEV à
`onPreRegister` (commandes de module incluses), fire-and-forget (jamais d'impact boot, rien
en prod). Hors projet → fallback built-ins en mémoire (`CliKernel.buildBuiltinManifest()`).
Protocole candidats : dernier mot = en cours de frappe (le shell filtre par préfixe) ;
commande validée → ses options + globales, sinon noms + alias. Install zsh :
`source <(nodefony completion zsh)`.

## Scaffold — `cli/create.ts`

`nodefony create app <name> [--dir <path>] [--force] [--link]` — génère un projet
depuis les templates shippés (`templates/app/`, tokens `{{appName}}`/`{{nodefonyVersion}}`,
substitution regex simple — pas de moteur ; bascule eta prévue si `create module`
exige des conditionnels). **Standalone 0-boot** (fast-path `CliKernel.start` — cas
nominal HORS projet : `npx nodefony create app mon-app`). L'app générée = VITRINE
COMPLÈTE du framework, TOUTES les briques (prouvée boot dev ET prod) : controller
Hello **HTTP + WS echo dans la MÊME classe** (différenciateur), `drizzle` (ORM —
sans `NF_DATABASE_URL` : sqlite local `var/databases/`, sessions + idempotence
persistent en `store:"auto"`), `realtime` (backplane cluster 0-dep), `security {}`
(pass-through audité, boote sans DB), `frontend` + `studio` (`policy: "dev"` — en
prod, zone firewall d'abord ; sert le build React pré-compilé du paquet, 0 Vite
prod), `redis` gated `when: ctx.infra.cache` (NF_REDIS_URL ⇔ chargé), build
rolldown 3 lignes via `nodefony/bundler` (`externalDeps: true`), typecheck
**tsgo** (`@typescript/native-preview`).

**Outillage dev généré (parité core)** : `compose.yaml` (redis défaut + profils
`postgres`/`mariadb`/`mysql`/`tools`/`loki`+grafana provisionné — noms/projet
préfixés `<appName>`, cohabite avec l'infra du repo), `tests/` vitest (unit
« l'app se charge » + `e2e.test.ts` gate `RUN_E2E` : boot RÉEL
`production --detach --wait` + fetch HTTP + WS natif Node + `/livez`, arrêt
`nodefony stop`), `eslint.config.mjs` flat + prettier (devDep `typescript@6` =
API JS pour eslint ; le typecheck reste tsgo — 2 outils, 2 rôles),
`vitest.config.ts` (bloc oxc décorateurs OBLIGATOIRE, commenté). Scripts :
`test`/`test:e2e`/`lint`/`format`/`infra:up`/`infra:down`/`stop`/`status`.

**`--link` (dev framework, AVANT release npm)** : réécrit les deps
`nodefony`/`@nodefony/*` du package.json généré en `file:<workspace>` vers le
checkout (`resolveLocalWorkspaces` remonte depuis le paquet ; hors checkout →
erreur claire `SOFTWARE`). `npm install` réel symlinke + installe les transitives
— une app `--link` est contrôlable de bout en bout (install → build → tests e2e)
sans aucune publication. Les deps publiques (zod, rolldown…) restent au registre.

Token inconnu dans un template = throw (zéro `{{` résiduel). Renames :
`gitignore.tpl` → `.gitignore` (npm strip les dotfiles publiés). Exit codes :
`OK`/`USAGE`/`CANTCREAT`/`SOFTWARE`. Tests `create.test.ts` (+ e2e bin gate
`RUN_CLI_BOOT=1`).

## Hooks Command

| Hook              | Quand                     | Use case                         |
| ----------------- | ------------------------- | -------------------------------- |
| `onKernelStart()` | AVANT `Kernel.start()`    | Config env, type, packageManager |
| `generate(opts)`  | APRÈS phase `kernelEvent` | Exécution principale             |
| `register()`      | Au moment de `addCommand` | Setup commander (options, args)  |

## Settings ProtoService cas spécial

⚠️ `Service.set()` pour les commands utilise un guard car le Container peut être absent au moment de l'enregistrement. Voir `Command.ts:register()`.

## Commandes de module — dispatch différé (RÉSOLU)

Les commandes de module ne sont connues de commander qu'après leur enregistrement à
`onPreRegister` → `CliKernel` classe la commande demandée (built-in vs module) et diffère le
parse pour les secondes (détail : `../kernel/CLAUDE.md` § Dispatch). Commande introuvable →
exit `EX_USAGE` (64), **jamais** de fallback serveur. Happy-path ET typo couverts e2e.

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
- `project_cli_module_command_dispatch` (mémoire IA) — dispatch différé + refacto parse-pur
- `project_clikernel_lifecycle` (mémoire IA) — environment undefined au constructor
