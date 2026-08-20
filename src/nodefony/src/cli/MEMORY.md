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

**Signaux idempotents (`handleSignals`)** : `signalHandler` arme `shuttingDown` au 1ᵉʳ signal (drain gracieux → `terminate()`) ; un 2ᵉ signal (Ctrl+C insistant, ou SIGTERM du DevSupervisor qui suit le SIGINT du terminal) → `process.exit(128 + SIGNUM[signal])` FORCÉ (SIGINT=2/SIGTERM=15/SIGHUP=1/SIGQUIT=3). Avant : handler non idempotent → 2ᵉ signal relançait un `terminate()` complet (double `onTerminate`, double SHUTDOWN serveurs). Pattern graceful standard : 1ᵉʳ draine, 2ᵉ tue.

**Isolation tests** — makeCli():

```typescript
new Cli(name, {
  autostart: false,
  asciify: false,
  signals: false,
  autoLogger: false,
  promiseRejection: false,
  warning: false,
  clear: false,
  pid: false,
  version: "1.0.0",
});
cli.commander?.exitOverride(); // évite process.exit sur commande inconnue
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
  if (this.kernel) {
    this.kernel.command = this;
    this.setEvents(...args);
  } else {
    this.action(...args);
  } // DIRECT
});
```

**Chaîne d'appel standalone**: `action()` → `run()` → `generate()` (ou `interaction()` si interactive).

**action(...args)**: appelle `getCliOptions()` (lit debug/interactive depuis commander.opts()), showBanner si option, progress si option, puis `run(...args)`.

**run(...args)**: si `interactive || forceInteractive` → `interaction(...args).then(generate)`. Sinon → `generate(...args)`.

**generate(...args)**: méthode à override. Reçoit args utilisateur + **instance Cmd en dernier**.

**Pattern done:Promise** (pour tests async, Commander ne retourne pas la Promise):

```typescript
class MyCmd extends Command {
  done = new Promise<void>((r) => {
    this._resolve = r;
  });
  override async generate(arg: string): Promise<this> {
    // utiliser arg
    this._resolve();
    return this;
  }
}
cli.parse(["node", "test", "my-cmd", "val"]);
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

## Lanceur `bin/nodefony` — le CLI de l'APP prime sur le global

`src/bin/nodefony.ts` = **shim** (bundle unique `bin/nodefony`, rolldown `binConfig`, shebang en banner).
Décision PURE dans `src/bin/resolveLocalCli.ts` (`resolveLocalCli({cwd, selfDir, env})`), 8 tests
(`tests/resolveLocalCli.test.ts`).

Ordre : garde `NODEFONY_CLI_DELEGATED` → `findProjectRoot(cwd)` → `<root>/node_modules/nodefony`.

<!-- prettier-ignore -->
| Cas | `reason` | Effet |
| --- | --- | --- |
| déjà délégué (le CLI de l'app tourne) | `already-delegated` | soi-même (anti-boucle) |
| hors projet (`create app`) | `no-project` | soi-même (rôle du global) |
| deps non installées | `no-local-cli` | soi-même (rend service) |
| `realpath` local === self (monorepo, `--link`, `npm link`) | `same-package` | soi-même (0 aller-retour) |
| paquet local DIFFÉRENT | `local-cli` | `await import(<app>/bin/nodefony)` — même process, argv intact |
| bin déclaré mais absent (paquet non construit) | `local-cli-broken` | **stderr + exit 1** (jamais piloter l'app avec une autre version) |

- `findProjectRoot` vit dans `cli/projectRoot.ts` (0 dep) — PAS dans `scaffold/engine.ts` : le bundle du
  bin tirerait `eta` + tout le moteur de templates, payé à chaque invocation. `engine.ts` le ré-exporte.
- Les imports du core sont **dynamiques** dans le shim (`await import("nodefony")`, external rolldown) :
  quand on délègue, le core de CE paquet n'est jamais chargé (sinon 2 frameworks en mémoire).
- `NODEFONY_CLI_DEBUG=1` → une ligne stderr `[nodefony] cli → <chemin>`. Silencieux par défaut (sinon
  pollue les sorties `--json`).

## Environnement — `nodefony env`

- `runtime/loadEnv.ts` : `envFileOrder(opts)` = **source UNIQUE** de l'ordre des `.env` (extraite
  de `loadEnv`, que `nodefony env` AFFICHE). 7 niveaux : `process.env` > `.env.<appEnv>.local` >
  `.env.<mode>.local` > `.env.local` > `.env.<appEnv>` > `.env.<mode>` > `.env`. Règle mnémo :
  les `*.local` priment ; à rang égal, le plus spécifique gagne. `loadEnv` n'écrase JAMAIS une clé
  déjà posée → la précédence est une CONSÉQUENCE de l'ordre de lecture, rien à synchroniser.
- `appEnv === runtimeEnv` → les niveaux `appEnv` sont sautés (pas de doublon).
- `cli/envReport.ts` = calcul PUR ; `cli/env.ts` = I/O + rendu. Le rapport RECONSTRUIT la
  provenance (au moment du run, `process.env` est déjà peuplé) : 1ᵉʳ fichier portant la valeur
  effective = origine ; aucun → shell. Les suivants qui définissent la clé = `shadowed`.
- Catalogue lu par import de `<projet>/dist/index.js` → `getEnvCatalog(mod.env)`. Pas de build →
  `null`, et le rapport le DIT (`catalogAvailable: false` + note) au lieu d'échouer.
- Exit **78** (`EX_CONFIG`) si une variable requise manque. Requise = ni `default` ni `optional`.
- `NF_` (variable d'app, déclarée dans `env.ts`) ≠ `NF__MODULE__CHEMIN` (surcharge directe d'une
  clé de module, rien à déclarer) ≠ `<VAR>_FILE` (secret monté). Les 3 sont rendus séparément.
- Secrets : `pathLooksSecret` (`envOverride.ts`) — MÊME regex partout, jamais de valeur en clair.

## Scaffold — transaction, simulation, mode machine

- `scaffold/writer.ts` = `ScaffoldWriter` : TOUTES les écritures du moteur y passent, en mémoire ;
  seul le scaffold RACINE `commit()`. Les lectures aussi (`read`/`exists`/`listDir`) — une étape voit
  ce que les précédentes ont produit (2 câblages dans un même `index.ts`, module rendu puis ciblé).
- Conséquence : un refus, même tardif (nom pris, `@controllers` introuvable, tag eta résiduel,
  workspace de link absent), ne laisse RIEN sur disque. Les gardes n'ont plus à être placées avant
  les rendus.
- `runScaffold(request, version, { dryRun })` → `result.changes: IScaffoldChange[]`
  (`create` | `overwrite` + `previous`). `{ writer }` = transaction héritée d'un scaffold appelant
  (`create module` délègue à `command`/`controller`/`front`) : le sous-scaffold n'y commit pas.
- Câblage d'un `index.ts` : `wireDecoratorList` (liste d'un décorateur —
  `@controllers`/`@entities`/`@services`) et `wireCommandCall` (`this.addCommand(X)` inséré APRÈS le
  `super(…)` du constructeur ; regex `super\([^()]*\);` — parenthèse imbriquée = REFUS, pas de
  devinette). Même contrat : ambiguïté → throw actionnable, fichier jamais corrompu.
- ⚠️ `@services` est le SEUL décorateur que `wireDecoratorList` **crée** quand il est absent
  (import `{ services }` posé dans la même passe, décorateur inséré au-dessus de la classe) :
  `@controllers`/`@entities` sont toujours rendus par les gabarits, `@services` ne l'est jamais
  par `app/base` — refuser aurait rendu `create service` inutilisable à la racine d'une app.
  L'ancre tolère `export class X extends Module` (forme montrée par la doc du kernel, donc
  celle d'une app reprise à la main) ; le décorateur se pose AVANT `export`, ce qui est valide.
- `readNodefonyName(file)` = le `super("…")` d'un `Module`/`Service` : c'est la CLÉ du conteneur, et
  pour un module le préfixe de ses commandes CLI. Ni le nom npm (`@app/blog`) ni le nom de classe —
  les trois peuvent différer, seul celui-là existe au runtime.
- ⚠️ **eta avale le saut de ligne qui suit un tag en FIN de ligne** (`autoTrim: [false, "nl"]`) : la
  ligne suivante se recolle. Toujours du texte après un `<%= … %>`, sinon TSDoc recousu / type coupé
  en deux — invisible pour le contrôle « tag résiduel », d'où un test de FORME.
- `diffLines(before, after)` (writer.ts) : diff LCS, calculé au moteur pour que CLI et Studio
  décrivent le même changement. Au-delà de 1000 lignes → remplacement en bloc.
- CLI : `--dry-run`/`-n` (plan + diff des réécritures, sort AVANT install/build/git) ·
  `--describe-json` (catalogue JSON : types, questions, caps, cibles du projet ; sans type = tout) ·
  `--answers-json <fichier|->`. Les flags l'emportent sur le fichier ; une clé hors spec = EX_USAGE
  (`resolveAnswers` l'ignorerait en silence — invisible pour un appelant automatique).
- `scaffold/steps.ts` : `SCAFFOLD_STEPS` + `SCAFFOLD_STEP_COMMANDS` — étapes post-écriture partagées
  avec Studio (`ScaffoldService`), qui les MONTRE autrement (canal temps réel vs terminal hérité).
- Templates partagés : `shared/front-entry/<fw>` (point de montage), `shared/front-registrar`
  (déclaration d'entry — `it.entryName`/`it.pascal`), `shared/front-shell`. Le controller d'accueil
  d'une app est rendu par le gabarit `controller/hello` (`it.indexPath`, `it.helloName`,
  `it.secureRoute`) — pas de copie propre à `create app`.
- ⚠️ Un front généré importe du CSS → `types: ["node", "vite/client"]` dans le tsconfig de l'app,
  sinon `npm run typecheck` échoue en TS2882 sur un projet qui, lui, se construit très bien.

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
