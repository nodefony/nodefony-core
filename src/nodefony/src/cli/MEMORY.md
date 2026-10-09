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
**getCommandManager(mgr)** `@deprecated` : `"npm"|"yarn"|"pnpm"|"bun"` → string (`.cmd` sur win32, sauf bun). Sinon throw `"bad manager"`. `.cmd` NON lançable par `spawn` sans shell (CVE-2024-27980) → `runPackageManager` passe par `portableSpawn`.
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

Ordre : garde `NF_CLI_DELEGATED` → `findProjectRoot(cwd)` → `<root>/node_modules/nodefony`.

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
- `NF_CLI_DEBUG=1` → une ligne stderr `[nodefony] cli → <chemin>`. Silencieux par défaut (sinon
  pollue les sorties `--json`).
- Écart global ≠ projet → `versionMismatchNotice` (pure, `bin/resolveLocalCli.ts`) : 1 ligne stderr
  D'OFFICE, muette à versions égales, sous `--json`/`--json=` et `__complete`. Vit dans le bundle du
  bin → aucun import du core (garde `binBundle.test.ts`).
- `create app` → `startFreshnessCheck` (`cli/cliFreshness.ts`) lancé AVANT l'install, attendu à la
  fin, stderr. Compare TOUS les `dist-tags` (`latest` de `nodefony` = la 7.x !) ; stable → stable
  seulement, préversion → même majeure. Geste = `npm i -g nodefony@<tag réel>`. Borne 1,5 s, ne lève
  jamais. Coupé par `CI`, `NF_NO_UPDATE_CHECK`, `--link`, et dans les tests (`vitest.setup.ts`).
- Banc réel : scénario `global` de `npm run release:smoke` (préfixe `npm i -g --prefix` jetable).

## Environnement — `nodefony env`

- `runtime/loadEnv.ts` (ADR-0014) : `ENV_FILE = ".env"` ; `envFileOrder()` = **source UNIQUE**
  des fichiers lus (`[".env"]`, que `nodefony env` AFFICHE). `.env` = valeurs du POSTE, jamais
  commité ; `.env.example` = notice, jamais chargée ; production = aucun fichier. `process.env` >
  `.env` — `loadEnv` n'écrase JAMAIS une clé déjà posée.
- `findLegacyEnvFiles({cwd, runtimeEnv, appEnv})` : `.env.local`, `.env.<mode>`, `.env.*.local`
  présents DANS une app (`nodefony.config.ts`) → le bin sort en 78 avec `legacyEnvMessage`.
  `.env.example`, `.env.vault`, `.env.keys` ignorés ; hors app → `[]` (create app libre).
- `cli/envReport.ts` = calcul PUR ; `cli/env.ts` = I/O + rendu. Le rapport RECONSTRUIT la
  provenance (au moment du run, `process.env` est déjà peuplé) : 1ᵉʳ fichier portant la valeur
  effective = origine ; aucun → shell. Les suivants qui définissent la clé = `shadowed`.
- Catalogue lu par import de `<projet>/dist/index.js` → `getEnvCatalog(mod.env)`. Pas de build →
  `null`, et le rapport le DIT (`catalogAvailable: false` + note) au lieu d'échouer.
- Exit **78** (`EX_CONFIG`) si une variable requise manque. Requise = ni `default` ni `optional`,
  **ou** `requiredIn: ["production"]` quand l'environnement évalué correspond.
- `requiredIn` (`config/defineEnv.ts`) : exigence propre à un environnement. Règle UNIQUE
  `isEnvVarRequired(meta, stages)` — trois lecteurs : le boot (`defineEnv` lève avant le parse
  Zod, une `optional` passerait la validation par construction), `nodefony env`, `doctor`.
  `resolveEnvStages(source)` rend les étiquettes : `NODE_ENV`, plus le déploiement
  (`APP_ENV` > `NF_ENV`) s'il diffère → une preprod en `production` porte les deux.
  `<VAR>_FILE` satisfait l'exigence (résolu AVANT le contrôle). Chaîne vide = absente.
- 🔴 Au boot, la garde ne mord que si le run SERT — fait posé par `Kernel.loadApp` juste le temps
  de l'import (`runWillServeTraffic` : profil courant **OU** intention `servesTraffic` de la
  commande). `production`/`cluster`/`development` déclarent `servesTraffic: true` : leur profil
  serveur n'arrive qu'à `onKernelStart`, APRÈS l'import — lu sur le seul profil, la garde était
  morte pour eux. Une commande de lancement neuve DOIT le déclarer (test `KernelCommands`).
- `--env <e>` (sur `env` ET `doctor`) : évalue les exigences pour l'environnement VISÉ avec les
  valeurs d'ICI. Les étiquettes sont REMPLACÉES, pas cumulées (sinon `--env production` exigerait
  aussi les `requiredIn: ["development"]`). Rendu : `targetEnv` + `stages` dans le JSON, annoncé
  en tête du rendu humain.
- ⚠️ **La VALEUR d'une option ne doit jamais ressembler à une commande.** `detectEnvironmentFromArgv`
  (`runtime/engineEnvironment.ts` — elle a quitté le bin, qui s'exécute à l'import et ne
  s'éprouvait donc qu'en lisant son propre texte) ne lit que les mots AVANT la
  première option : `doctor --env production` faisait sinon basculer TOUT le processus en
  production — modules de prod chargés, catalogue de l'app en échec à l'import, repli SILENCIEUX
  sur un `dist` périmé (27 variables au lieu de 28).
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

- Manifeste d'app `complete` : `"allowScripts": { "better-sqlite3": false }`. npm SYNTHÉTISE un
  `install: node-gyp rebuild` dès que l'arbre vient d'un `package-lock.json` — le `gypfile: false`
  du paquet n'est lu que sur un arbre bâti depuis le registre (npm/cli#9837). npm 11 (Node 24 LTS)
  avertit SANS bloquer ⇒ 2ᵉ `npm install` mort sur « find Python » ; npm 12 bloque. Le refus
  explicite est honoré par les deux. `minimal` n'a pas la clé (pas de drizzle, donc pas le paquet).
  Le `--ignore-scripts` du `Dockerfile.tpl` couvre l'IMAGE, pas le poste du développeur.
- Gestionnaire de paquets : `cli/packageManager.ts` = SEULE décision (`resolvePackageManager` :
  config > verrou > `npm_config_user_agent` > npm) + les gestes par outil (`packageManagerExecArgs`,
  `packageManagerCommandLines`, `needsWorkspaceProtocol`). Question `packageManager` de `create app`
  (`--package-manager`) : défaut STATIQUE `npm` dans la spec, remplacé au dialogue/non-interactif par
  le lanceur. Gabarit : `allowScripts` + `overrides` au package.json (npm, bun) · `resolutions` (yarn)
  · TOUT dans `pnpm-workspace.yaml` (pnpm ≥ 11 ignore le champ `pnpm` ; `packages: modules/*`,
  `allowBuilds`, `strictDepBuilds: false`, overrides `a>b`). `create module` : `"@app/x":
"workspace:*"` à la racine sous pnpm/bun seulement — npm le refuse (`EUNSUPPORTEDPROTOCOL`).
  Install/build/migration de `create` passent par le gestionnaire, jamais `npm` en dur.
  Forge + image : `packageManagerToolchain(pm)` (verrou, install stricte, cache `setup-node`, action
  d'outil, amorçage `npm i -g <outil>@<majeure>` glibc ET musl, cache image/projet, élagage) → gabarit
  `it.toolchain` (Dockerfile, ci.yml, production.yml, gitlab-ci, `.dockerignore`/`.gitignore`).
  `PACKAGE_MANAGER_TOOL_MAJOR` = pnpm 12, bun 1 ; yarn 1 + npm livrés par `node:*`. Copie de ces
  majeures dans `release-smoke.yml` verrouillée par test. `pnpm prune --prod` laisse un shim
  `.bin/vite` orphelin (paquet bien retiré). Preuve réelle : `release:smoke -- --scenario pm[:pnpm|yarn|bun]`
  (banc épingle les tarballs par champ du gestionnaire : sinon le PAIR `nodefony` d'un module local
  se résout au registre, même version, et le noyau refuse la double copie).

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

## progress.ts — attente et progression (Spinner, ProgressBar)

`Spinner` (indéterminé) · `ProgressBar` (done/total, `spin: true` ajoute un
tourniquet) · `LiveLine` (socle) · `renderBar()` PURE · `formatDuration()`.
5 jeux d'images (`BRAILLE_FRAMES` défaut, `LINE_FRAMES` ASCII, `ARC_FRAMES`,
`BLOCK_FRAMES`, `DOT_FRAMES`), 4 styles de barre (`BAR_STYLES`).

**Jamais par le Syslog** — animation = 10 Pdu/s au ring + transports + backplane.
Écrit DIRECTEMENT sur le flux (défaut `process.stdout` ; `doctor` passe `stderr`).

`shouldAnimate(stream, env)` refuse : pas de TTY · `CI` · `TERM=dumb` ·
`NF_NO_PROGRESS`. Hors animation, seule la ligne finale de `stop()` est écrite.

`supportsUnicode(env, platform)` — capacité CONSTATÉE, jamais déduite de
`process.platform` : repli `LINE_FRAMES` + `BAR_STYLES.ascii` sur un `cmd.exe` nu,
braille conservé sur Windows Terminal / VS Code. Les 2 paramètres sont injectés
→ le cas Windows s'éprouve depuis n'importe quelle machine.

Curseur masqué pendant l'animation, restauré par `guardTerminal`
(`runtime/terminalGuard.ts`) — le protocole de sortie UNIQUE, partagé avec le plein
écran du terminal de dev : `exit` (qui couvre l'exception non rattrapée : Node l'émet
AVANT d'imprimer la pile), `SIGINT`/`SIGTERM`/`SIGHUP`. Registre dans `globalThis`
(deux gardes séparées se compteraient l'une l'autre et avaleraient le signal) ;
écouteur de signal posé EN TÊTE (un `process.once` est retiré avant d'être appelé :
compté après lui, on se croyait seul et on tuait l'arrêt gracieux) ; réémission par
`process.kill`, repli `SIGINT` si la plateforme refuse le signal.

`fitToWidth(line, columns)` tronque sans compter les séquences ANSI (sinon la
ligne wrappe et `clearLine` n'en efface qu'une → traînée). Sortie synchronisée
mode 2026 (anti-scintillement). Minuteur `unref()`.

**Gotchas**

- ⚠️ **`spawnSync` fige l'animation** : la boucle d'évènements est bloquée, aucun
  `setInterval` ne se déclenche. Tout appelant doit attendre en ASYNCHRONE.
- ⚠️ `renderBar(NaN, n)` rendait "" (`repeat(NaN)`), d'où `safeCount`.
- ⚠️ Un test qui simule un terminal doit poser `animate: true` : sinon il lit
  `process.env`, où la forge pose `CI` — vert en local, rouge en CI.
- Une seule LIGNE : pas de rendu multi-lignes (laisserait des traînées).
