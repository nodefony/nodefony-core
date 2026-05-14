# Cli & Command — Documentation

> Modules : `src/nodefony/src/Cli.ts` et `src/nodefony/src/command/Command.ts`

---

## Features

- CLI de base sans kernel (`Cli`) — CliKernel l'étend pour le mode framework complet
- Intégration Commander.js : options globales `-i/-d/-v`, sous-commandes, alias
- Mode **standalone** : commandes exécutables sans kernel (utile pour les CLIs autonomes)
- Mode **kernel** : commandes déclenchées par les événements lifecycle du kernel
- UI intégrée : Progress, Spinner, Sparkline, Table (via `clui`, `cli-table3`)
- Utilitaires : semver, timers, niceBytes/niceUptime/niceDate, shelljs, emojis
- Gestion signaux (`SIGINT`, `SIGTERM`, etc.), rejets de promesses non gérées

---

## Installation

```bash
import Cli, { CliDefaultOptions } from "@nodefony/core";
import Command from "@nodefony/core"; // ou depuis le chemin direct
```

---

## Standalone mode

Le mode standalone permet d'utiliser `Cli` et `Command` **sans kernel Nodefony**.

### Créer un CLI minimal

```typescript
import Cli from "./Cli";
import Command from "./command/Command";

const cli = new Cli("my-tool", {
  version: "1.0.0",
  autostart: false,
  asciify: false,
  signals: false,
});
cli.commander?.exitOverride(); // évite process.exit si commande inconnue
```

### Créer une commande

```typescript
class BuildCommand extends Command {
  constructor(cli: Cli) {
    super("build", "Build the project", cli, {
      showBanner: false,
      progress: false,
    });
    this.addArgument("<target>", "Build target");
    this.addOption("-p, --prod", "Production mode");
  }

  override async generate(target: string): Promise<this> {
    console.log(`Building ${target}...`);
    return this;
  }
}

const cmd = cli.addCommand(BuildCommand);
cli.parse(process.argv);
```

### Pattern async (tests ou orchestration)

Commander ne retourne pas la Promise de `action()`. Utiliser un signal interne :

```typescript
class MyCommand extends Command {
  result: string = "";
  readonly done: Promise<void>;
  private _resolve!: () => void;

  constructor(cli: Cli) {
    super("my-cmd", "My command", cli, { showBanner: false });
    this.addArgument("<input>", "Input value");
    this.done = new Promise((r) => { this._resolve = r; });
  }

  override async generate(input: string): Promise<this> {
    this.result = input;
    this._resolve();
    return this;
  }
}

const cmd = cli.addCommand(MyCommand) as MyCommand;
cli.parse(["node", "script", "my-cmd", "hello"]);
await cmd.done;
console.log(cmd.result); // "hello"
```

---

## Kernel mode

En mode kernel, la commande n'est pas exécutée directement — elle attend un événement lifecycle.

```typescript
class StartCommand extends Command {
  constructor(cli: CliKernel) {
    super("start", "Start the framework", cli, {
      kernelEvent: "onReady",   // déclenchement sur kernel ready
    });
  }

  async onKernelRegister(): Promise<void> {
    // appelé sur "onRegister"
  }

  override async generate(...args: any[]): Promise<this> {
    console.log("Kernel is ready, starting...");
    return this;
  }
}
```

### Événements disponibles

| `kernelEvent`      | Déclenché quand                          |
|--------------------|------------------------------------------|
| `"onRegister"`     | Modules enregistrés (défaut)             |
| `"onBoot"`         | Kernel booté                             |
| `"onReady"`        | Kernel prêt (serveurs démarrés)          |
| `"onStart"`        | Kernel démarré                           |

---

## API

### `Cli`

#### Constructor

```typescript
new Cli(name?: string)
new Cli(name: string, options: CliDefaultOptions)
new Cli(name: string, container: Container | null, options: CliDefaultOptions)
new Cli(name: string, container: Container | null, event: Event | false, options: CliDefaultOptions)
```

#### Options clés (`CliDefaultOptions`)

| Option              | Type              | Défaut         | Description                          |
|---------------------|-------------------|----------------|--------------------------------------|
| `version`           | `string`          | `"1.0.0"`      | Version affichée par `-v`            |
| `autostart`         | `boolean`         | `true`         | Lance `onStart` automatiquement      |
| `asciify`           | `boolean`         | `true`         | Affiche le nom en ASCII art          |
| `clear`             | `boolean`         | `true`         | Efface le terminal au démarrage      |
| `signals`           | `boolean`         | `true`         | Gère SIGINT/SIGTERM/etc.             |
| `autoLogger`        | `boolean`         | `true`         | Initialise le syslog                 |
| `promiseRejection`  | `boolean`         | `true`         | Capture les rejets non gérés         |
| `commander`         | `boolean`         | `true`         | Active Commander.js                  |
| `pid`               | `boolean`         | `false`        | Stocke le PID du processus           |
| `environment`       | `EnvironmentType` | `"production"` | Environnement courant                |

#### Méthodes Commander

```typescript
cli.setCommandVersion(version: string): CommanderCommand   // -v, --version
cli.setCommandOption(flags, desc?, default?): CommanderCommand
cli.setCommand(nameAndArgs, desc, opts?): CommanderCommand
cli.parse(argv?, opts?): CommanderCommand
cli.parseAsync(argv?, opts?): Promise<CommanderCommand>
```

#### Gestion des commandes

```typescript
cli.addCommand(Ctor: new(cli) => Command): Command
cli.hasCommand(name: string): boolean
cli.getCommand(name: string): Command | null
```

#### Utilitaires

```typescript
cli.checkVersion(v?: string | null): string    // throw si invalide (semver)
cli.startTimer(name: string): void             // throw si doublon
cli.stopTimer(name: string): void              // throw si inconnu; null/undefined → tout arrêter
cli.setProcessTitle(name?: string): string     // lowercase, sans espaces
cli.existsSync(path): boolean                  // throw si path falsy
cli.getCommandManager(manager: string): string // "npm"|"yarn"|"pnpm" → string
cli.setPid(): number
cli.showBanner(): string | null                // null si pas de version
cli.logEnv(): string

Cli.niceBytes(x: string | number): string      // "1.0 KB", "10 KB", etc.
Cli.niceUptime(date, suffix?): string          // "a few seconds ago"
Cli.niceDate(date, format?): string            // moment.format()

cli.createProgress(size: number): Progress
cli.getSpinner(msg: string, design?: string[]): Spinner
cli.createSparkline(values: number[], suffix: string): string  // throw si !values
cli.displayTable(datas: any[], options, syslog?): Table

cli.getEmoji(name?: string): string | undefined
```

#### Filesystem / Shell

```typescript
cli.existsSync(path): boolean
cli.createDirectory(path, mode?, force?): Promise<FileClass>
cli.rm(...files)
cli.cp(options, source, dest)
cli.cd(dir?)
cli.ln(options, source, dest)
cli.mkdir(...dirs)
cli.ls(...paths)
cli.chmod(...)
cli.spawn(command, args, options, close?): Promise<...>
cli.spawnSync(command, args, options): SpawnSyncReturns<string>
```

---

### `Command`

#### Constructor

```typescript
new Command(name: string, description: string, cli: Cli | CliKernel, options?: OptionsCommandInterface)
```

#### Options (`OptionsCommandInterface`)

| Option        | Type                  | Défaut          | Description                      |
|---------------|-----------------------|-----------------|----------------------------------|
| `showBanner`  | `boolean`             | `true`          | Affiche ASCII art au démarrage   |
| `progress`    | `boolean`             | `false`         | Active la barre de progression   |
| `sizeProgress`| `number`              | `100`           | Taille de la progress bar        |
| `kernelEvent` | `keyof typeof Events` | `"onRegister"`  | Événement kernel déclencheur     |

#### Méthodes à override

```typescript
async action(...args: any[]): Promise<any>      // orchestrateur principal
async run(...args: any[]): Promise<this>        // logique principale
async interaction(...args: any[]): Promise<any> // mode interactif
async generate(...args: any[]): Promise<any>    // méthode à surcharger
```

#### Méthodes utilitaires

```typescript
cmd.addOption(flags: string, desc?: string): Option
cmd.addArgument(arg: string, desc?: string): Argument
cmd.alias(name: string): Cmd
cmd.description(): string
cmd.parse(argv?, opts?): Cmd
cmd.parseAsync(argv?, opts?): Promise<Cmd>
cmd.forceInteractiveMode(): void
```

---

## Examples

### CLI autonome complet

```typescript
import Cli from "./Cli";
import Command from "./command/Command";

class ListCommand extends Command {
  constructor(cli: Cli) {
    super("list", "List all items", cli, { showBanner: false });
    this.addOption("-v, --verbose", "Verbose output");
  }

  override async generate(_arg: unknown, cmd: any): Promise<this> {
    const opts = cmd.opts();
    if (opts.verbose) {
      console.log("Verbose mode active");
    }
    console.log("Items: a, b, c");
    return this;
  }
}

const cli = new Cli("my-cli", { version: "1.0.0" });
cli.addCommand(ListCommand);
cli.parse(process.argv);
```

### Afficher la table de données

```typescript
const table = cli.displayTable(
  [["Name", "Version"], ["nodefony", "6.0.0"]],
  { head: ["Package", "Version"] }
);
// Affichée automatiquement via console.log
```

### Validation semver

```typescript
try {
  cli.checkVersion("2.0.0-alpha.1"); // OK
  cli.checkVersion("not-a-version"); // throw Error("... semver ...")
} catch (e) {
  console.error(e.message);
}
```

### Timers de performance

```typescript
cli.startTimer("build");
// ... opération longue ...
cli.stopTimer("build"); // affiche le temps écoulé
```

---

## Troubleshooting

| Problème | Cause | Fix |
|----------|-------|-----|
| `throw "Commander not found"` | `commander: false` ou `cli.commander = null` | Créer le Cli sans `commander: false` |
| `throw "Commender not found"` (typo) | setCommandVersion/setCommandOption sans commander | Idem |
| `throw "already exist"` | `startTimer(name)` doublon | Appeler `stopTimer(name)` d'abord |
| `throw "not exist"` | `stopTimer(name)` sur timer inconnu | Vérifier le nom avec `this.timers` |
| `throw "existsSync no path found"` | `existsSync(null\|"")` | Valider le path avant l'appel |
| `showBanner()` retourne `null` | `options.version` undefined | Passer `version` dans les options |
| generate() jamais appelé | Commander ne trouve pas la commande | Vérifier le nom exact (case-sensitive) |
| `process.exit()` appelé dans les tests | `commander.exitOverride()` non appelé | Toujours appeler `exitOverride()` en test |
| generate reçoit plus d'args qu'attendu | Commander passe `Cmd` en dernier | `args[last]` est toujours l'instance Cmd |
