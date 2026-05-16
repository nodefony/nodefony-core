# MEMORY.md — Cli / Command

> IA uniquement — ultra-concis. Voir README.md pour la doc humaine.

## Docs liées

- [`../../MEMORY.md`](../../MEMORY.md) — workspace core (Cli/Command extends Service)
- [`../kernel/MEMORY.md`](../kernel/MEMORY.md) — CliKernel `extends Cli` ; Module.addCommand utilise Command
- [`../syslog/MEMORY.md`](../syslog/MEMORY.md) — `Cli.initSyslog()` initialise Syslog
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles projet

---

## Cli (`Cli.ts`)

**Purpose**: Base CLI sans kernel. `extends Service`. `CliKernel extends Cli` (pas l'inverse).

**Deux modes d'exécution**:
- **Standalone** (sans kernel): `Command.action()` appelé directement → `run()` → `generate()`
- **Kernel mode**: `Command.setEvents()` → lifecycle hooks → `kernel.once(kernelEvent, action)`

**Constructor** `new Cli(name?, options?)`:
- Surcharges: `(name)` / `(name, opts)` / `(name, container, opts)` / `(name, container, event, opts)`
- Merge `extend({}, defaultOptions, opts)` — dernier argument non-Container/Event = options
- Si `pid: true` → `this.pid = process.pid`. Sinon `null`.
- Si `commander: false` → `this.commander = null` (ne jamais appeler setCommandVersion ensuite)
- `initCommander()` ajoute `-i/--interactive`, `-d/--debug`, `-v/--version` automatiquement
- `autostart` / `asciify` / `signals` / `autoLogger` / `promiseRejection` : désactiver dans les tests

**Isolation tests** — makeCli():
```typescript
new Cli(name, { autostart:false, asciify:false, signals:false, autoLogger:false,
  promiseRejection:false, warning:false, clear:false, pid:false, version:"1.0.0" })
cli.commander?.exitOverride()  // évite process.exit sur commande inconnue
```

**Commander**:
- `initCommander()` → `new CommanderCommand()`, ajoute -i/-d/-v auto
- `setCommandVersion(v)` → throw si `!this.commander`
- `setCommandOption(flags, desc?, default?)` → throw si `!this.commander`
- `setCommand(nameAndArgs, desc, opts?)` → throw si `!this.commander`
- `parse(argv?, opts?)` → throw si `!this.commander`
- `parseAsync(argv?, opts?)` → throw si `!this.commander`

**Commandes**:
- `addCommand(Ctor)` → `new Ctor(this)`, stocke `commands[cmd.name]`, retourne l'instance
- `hasCommand(name)` → bool
- `getCommand(name)` → `Command | null`
- Commander passe l'instance `Cmd` comme **dernier** argument à `generate()` → `args[0]` = arg utilisateur

**checkVersion(v?)**:
- Sans arg (ou null/undefined) → utilise `this.version`
- `semver.valid(v)` → retourne string si OK, throw `Error("... semver ...")` sinon

**Timers**:
- `startTimer(name)` → throw si doublon (`in this.timers`)
- `stopTimer(name)` → throw si inconnu; `!name` → arrête tous les timers en boucle
- `this.timers: Record<string, string>` — clé = valeur = name

**niceBytes(x)**: règle `n >= 10 || l < 1 ? 0 décimale : 1`. `1024` → `"1.0 KB"`, `10240` → `"10 KB"`, `0` → `"0 bytes"`.

**niceUptime(date, suffix?)**: `moment(date).fromNow(suffix||false)`.
**niceDate(date, format?)**: `moment(date).format(format)`.

**setProcessTitle(name?)**: lowercase + suppression espaces → `process.title`. Sans arg → `this.name`.
**existsSync(p)**: throw si `!p`. Retourne `fs.existsSync(p)`.
**getCommandManager(mgr)**: `"npm"|"yarn"|"pnpm"` → string (`.cmd` sur win32). Sinon throw `"bad manager"`.
**getEmoji(name)**: `get(name)` si name fourni, sinon `random().emoji`.
**createProgress(size)** → `clui.Progress`. **getSpinner(msg, design?)** → `clui.Spinner`. **createSparkline(values, suffix)** → throw si `!values`. **displayTable(datas, opts, syslog?)** → `Table` cli-table3.
**setPid()** → `this.pid = process.pid`, retourne pid.
**showBanner()** → string si `options.version` défini, sinon `null`.
**logEnv()** → string avec `this.name` + `this.environment`.

---

## Command (`command/Command.ts`)

**Purpose**: Commande CLI. `extends Service`. Enregistre son action dans Commander au constructor.

**Constructor** `new Command(name, description, cli, options?)`:
- `this.cli = cli` ; `this.program = cli.commander as Cmd` (alias Commander root)
- `this.command = createCommand(name, desc)` → `new Cmd(name)` + `program.addCommand(cmd)`
- Enregistre `this.command.action((...args) => { kernel ? setEvents : action })`

**Mode standalone** (clé):
```typescript
// Dans le constructeur Command — pas de kernel → direct
this.command?.action((...args) => {
  if (this.kernel) { this.kernel.command = this; this.setEvents(...args); }
  else { this.action(...args); }  // DIRECT
});
```

**Chaîne d'appel standalone**: `action()` → `run()` → `generate()` (ou `interaction()` si interactive).

**action(...args)**: appelle `getCliOptions()` (lit debug/interactive depuis commander.opts()), showBanner si option, progress si option, puis `run(...args)`.

**run(...args)**: si `interactive || forceInteractive` → `interaction(...args).then(generate)`. Sinon → `generate(...args)`.

**generate(...args)**: méthode à override. Reçoit args utilisateur + **instance Cmd en dernier**.

**Pattern done:Promise** (pour tests async, Commander ne retourne pas la Promise):
```typescript
class MyCmd extends Command {
  done = new Promise<void>(r => { this._resolve = r; });
  override async generate(arg: string): Promise<this> {
    // utiliser arg
    this._resolve();
    return this;
  }
}
cli.parse(["node","test","my-cmd","val"]);
await cmd.done;
```

**addOption(flags, desc?)** → `new Option(flags, desc)`, ajouté à `this.command`. Throw si pas de command.
**addArgument(arg, desc?)** → `new Argument(arg, desc)`, ajouté à `this.command`. Throw si pas de command.
**alias(name)** → `this.command.alias(name)` — accessible par alias dans commander.
**description()** → `this.command.description()`.
**parse/parseAsync** → délèguent à `this.program` (= cli.commander racine).

**kernelEvent**: `"onRegister"` par défaut. Détermine quand `action()` est appelé en mode kernel.

**OptionsCommandInterface**: `{ progress?, sizeProgress?, showBanner?, kernelEvent? }`. Défauts: `progress:false, sizeProgress:100, showBanner:true, kernelEvent:"onRegister"`.

---

## Deps

- `Cli` → Service, Container, Event, Command, Tools(extend), FileClass, Syslog, Kernel, clui, cli-color, commander, moment, semver, asciify, shelljs, node-emoji
- `Command` → Service, Container, Cli, CliKernel, Tools(extend), Builder, commander, clui, @inquirer/prompts

## Gotchas

- `commander: false` → `cli.commander = null` → toute méthode Commander throw immédiatement
- `autostart: true` (défaut) → `fireAsync("onStart")` dans constructeur → toujours désactiver dans tests
- Commander passe `Cmd` comme dernier argument → `generate(userArg, cmd)`, pas `generate(userArg)`
- `stopTimer(null)` → branch `!name` → boucle sur tous timers → ne throw pas
- `stopTimer("unknown")` → throw `"not exist"`
- `existsSync(null|"")` → throw `"no path found"` (check falsy)
- `checkVersion()` sans arg → `null` → utilise `this.version`; `""` → semver.valid("") = null → throw
- `niceBytes` : `n >= 10 || l < 1` → 0 décimales; sinon 1 décimale (ex: 1.0 KB, 10 KB)
- `getEmoji(undefined)` → `random().emoji` (branche `else`); `getEmoji("name")` → `get("name")`
- `addCommand(Ctor)` stocke `commands[cmd.name]` → le nom vient du constructeur Command, pas du Ctor
- Alias Commander : `alias("al")` → la commande répond à `"al"` ET `"alias-cmd"`
