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
npx nodefony security:user:add -a       # crée un utilisateur admin (module security)

# Futur (non implémenté)
npx nodefony orm:migrate
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

## Lanceur `bin/nodefony` — RÈGLE : le CLI de l'application prime

Le binaire global (`npm i -g nodefony`) est la **porte d'entrée** du framework : c'est lui qui fait
`create app` hors de tout projet. Mais **dans** une app, la version qui fait autorité est celle des
`node_modules` du projet — elle seule connaît ses modules, ses scaffolds et ses commandes. Le shim
`src/bin/nodefony.ts` remonte donc au projet (`findProjectRoot`) et, s'il y trouve un **autre** paquet
`nodefony` que lui-même, lui passe la main (`import` du bin de l'app, même process — ni spawn, ni double
kernel). Pattern du wrapper de projet (`gradlew`, `mvnw`) : _le projet gagne_.

Install cassée (paquet local présent, binaire absent) → **stderr + exit 1**, jamais de repli silencieux
sur le global : piloter une app avec une version de framework qu'elle n'a pas choisie est un faux
service. Détail des cas + variables (`NODEFONY_CLI_DELEGATED`, `NODEFONY_CLI_DEBUG`) : [`MEMORY.md`](./MEMORY.md).

> Conséquence pour le dev du framework : `npm link` depuis `src/nodefony` rend `nodefony` disponible
> partout et suit le checkout (symlink) ; dans le repo self-hosted comme dans une app `create app --link`,
> le paquet local EST le checkout (`same-package`) → aucun aller-retour.

## Complétion shell — `cli/completion.ts`

`nodefony completion <bash|zsh|fish>` imprime le script à sourcer ; au TAB le script appelle
`nodefony __complete -- <mots>` (fast-path standalone, 0 boot, exit TOUJOURS 0). La donnée =
**manifest cache** `node_modules/.cache/nodefony/cli-manifest.json`, écrit au boot DEV à
`onPreRegister` (commandes de module incluses), fire-and-forget (jamais d'impact boot, rien
en prod). Hors projet → fallback built-ins en mémoire (`CliKernel.buildBuiltinManifest()`).
Protocole candidats : dernier mot = en cours de frappe (le shell filtre par préfixe) ;
commande validée → ses options + globales, sinon noms + alias. Install zsh :
`source <(nodefony completion zsh)`.

## Scaffold — `cli/scaffold/` + `cli/create.ts` (3 fronts, UN moteur)

`nodefony create app [name] [--dir <path>] [--force] [--yes] [--preset <complete|minimal>]
[--frontend <none|react|vue|angular>] [--link|--no-link]` — **standalone 0-boot**
(fast-path `CliKernel.start`, cas nominal HORS projet : `npx nodefony create app`).

`nodefony create front <name> [--frontend <react|vue|angular>] [--route </page>]
[--module <nom>]` — ajoute un frontend Vite à une cible SANS front (app `none` ou
module) : coquille HTML (brique PARTAGÉE `templates/shared/front-shell/` — la même
que `create app`, zéro dérive), entry minimale du framework, controller de page
(`renderDocument(name, cspNonce)` — TSDoc = tout le flux dev HMR/prod/CSP/proxy),
registrar `register<Name>Entry` (fichier dédié documenté) ; wiring AUTO
`@controllers` + hook `onKernelBoot` (inséré si absent — un hook EXISTANT n'est
jamais édité : note actionnable) ; deps du framework ajoutées au package.json si
absentes. Gardes : cible avec `frontend/index.html` → throw ; `@nodefony/frontend`
manquant → throw actionnable.

**Versions npm des templates** : les paquets `nodefony`/`@nodefony/*` sont émis en
`^<%= it.nodefonyVersion %>` (version du paquet qui scaffolde — une release ne
réécrit RIEN) ; toutes les versions TIERCES vivent dans le catalogue UNIQUE
`scaffold/versions.ts` (`SCAFFOLD_VERSIONS`, consommé par `package.json.tpl` via
`it.pkg` et par `FRONTEND_PARAMS`) ; un test anti-dérive du banc compare le
catalogue aux manifests du monorepo (même MAJEURE exigée).

`nodefony create module <name> [--controller <none|hello|rest|duplex|realtime|example>]
[--no-service] [--command] [--frontend <none|react|vue|angular>] [--description "…"]
[--no-install]` — scaffold **IN-PROJECT** d'un module applicatif : `modules/<name>/` =
**workspace npm** (package + `rolldown.config.ts` via `nodefony/bundler` + schéma Zod
`config/config.ts` + builder `defineModuleConfig.ts` + `docs/` + tests vitest ;
`CLAUDE.md`/`MEMORY.md` **seulement si le projet a un `CLAUDE.md` racine**). Câble l'app :
`workspaces: ["modules/*"]` + scripts `build`/`typecheck`/`test` chaînés
(`npm run X --workspaces --if-present`, build des modules AVANT l'app) + `use("@<app>/<name>", {})`
dans le manifeste `modules` (insertion GARDÉE : crochet fermant APPARIÉ, ancre absente = note
actionnable). **Zéro template dupliqué** : le controller et le front sont rendus par les
scaffolds `controller`/`front` EXISTANTS, ciblés sur le module (`--module`). Gardes AVANT
écriture : hors projet · module existant (sauf `--force`) · brique absente de l'app
(`@nodefony/realtime` pour `--controller realtime|duplex`, `@nodefony/frontend` pour un front).
Puis `npm install` (le symlink de workspace **est** ce qui rend le module chargeable) + build.

> **Pourquoi un workspace npm** : `Kernel.loadModule` importe un module PAR SON NOM → il doit être
> résolvable par npm. Bénéfice : le module naît paquet (publiable tel quel). Cf `resolveModuleEntry`
> (§ ci-dessous) — sans lui, ce nom n'était pas résolvable depuis l'app.

`nodefony create controller <name> [--kind <hello|realtime|rest>] [--route </api/x>]
[--module <nom>]` — scaffold **IN-PROJECT** (lancé DANS une app : `findProjectRoot`
remonte au `nodefony.config.ts`, refus propre hors projet). Cible = app racine ou un
module local (`listTargets` : app + `modules/*/` — consommé par le CLI ET le futur
formulaire Studio). Saveurs : `hello` = GET + WS echo MÊME classe (défaut — le
différenciateur) ; `realtime` = sous-classe `RealtimeController` (@nodefony/realtime :
canal `<nom>:ticker` décoré `@RealtimeChannel` + action `<nom>:ping`, TSDoc = snippet
client `RealtimeClient`) — garde actionnable si la dep manque (preset minimal) ;
`rest` = CRUD `@Get/@Post/@Put/@Delete` + `@Param/@Body` + echo WS. Wiring AUTO de
l'`index.ts` cible (`wireDecoratorList` : import + insertion `@controllers([...])`,
édition textuelle gardée — toute ambiguïté = throw actionnable, jamais de fichier
corrompu). Nom normalisé (`blog-post`→`BlogPostController`, suffixe strippé) ; route
défaut `/api/<kebab>` (couverte par la zone firewall du manifeste généré). Noms de
fichiers de templates : token `__NAME__` (`templates/controller/<kind>/.../__NAME__.ts.tpl`).

`nodefony create entity <Nom> [champs…] [--id <uuid7|uuid4|serial>] [--soft-delete]
[--no-timestamps] [--no-controller] [--no-service] [--no-tests] [--route </api/x>]
[--module <nom>] [--connector <nom>] [--dialect <sqlite|postgres|mysql>]` — scaffold
**IN-PROJECT** de la chaîne complète : table Drizzle **native** du dialecte
(`nodefony/entity/<Nom>.ts` + interface `<Nom>Row` + descripteur `defineEntity`),
schémas Zod d'entrée (`<Nom>.schema.ts` : `create…Schema` + `update… = create.partial()`),
service CRUD (`extends AbstractCrudService`, validation dans `beforeCreate`/`beforeUpdate` →
**tous les transports** en profitent ; repository résolu au **premier usage** car l'ORM ne
se connecte qu'à `onBoot`), controller (`extends ResourceController` — lectures en
`methods: ["GET","WEBSOCKET"]` = REST **et** socket dans la même méthode ; 201+`Location`,
204, 404, 422, `@Idempotent({required:false})` = mode souple), tests vitest (sqlite mémoire).
Champs : `nom:type[?|!][:index]` · `ref:<Entité>` · **non-null par défaut** (types :
`string text int float bool json date uuid`) — analyse + traduction Drizzle dans
`scaffold/entityFields.ts` (module PUR, 18 tests, 3 dialectes). Wiring : `wireEntitiesDecorator`
**crée** `@entities([...])` s'il n'existe pas (import **nommé** — un descripteur n'est pas un
default), + `@controllers`. Gardes AVANT écriture : hors projet · `@nodefony/drizzle` absent de
la cible · entité déjà déclarée · champ invalide. **Dit la vérité** : la table naît au prochain
boot dev (`CREATE TABLE IF NOT EXISTS`), la **modifier n'altère RIEN** (pas d'`ALTER`), aucune
migration n'est produite. Design + alternatives rejetées :
`create-entity-design-2026-07` (mémoire IA `core-dev/audits/`).

**Architecture 3 fronts** (préparée pour Studio — créer app/module/entity depuis
l'admin web) :

- `scaffold/spec.ts` — questions DÉCLARATIVES 100 % JSON-able (name, preset,
  frontend, link `askIf: hasCheckout`) : contrat unique des trois fronts.
  Ajouter un choix = une entrée ici, aucun front à modifier.
- `scaffold/engine.ts` — moteur PUR (`resolveAnswers` valide/défaute contre la
  spec ; `runScaffold` rend les templates) : zéro I/O terminal, appelable par
  argv, readline ou un futur endpoint data plane. Exporté par l'index public
  (`getScaffoldSpec`/`runScaffold`).
- `scaffold/interactive.ts` — front readline NATIF (`node:readline/promises`,
  0 dep, streams injectables → testé sur PassThrough). En TTY sans `--yes`,
  les questions non couvertes par les flags sont posées + récap + confirmation ;
  hors TTY (CI, spawn) = défauts de la spec, stable pour les scripts.
- `create.ts` — adaptateur argv (flags → réponses partielles) + orchestration.

**Templates = LAYERS eta** (`templates/app/`, moteur eta — dep core, conditionnels
`preset × frontend` impossibles en overlays purs) : `base/` (commun : controller
Hello HTTP+WS même classe, tests vitest unit+e2e `--detach --wait`, eslint flat +
prettier + `typescript@6` API-JS-pour-eslint (typecheck = tsgo), vitest bloc oxc
décorateurs, `nodefony.config.ts`/`package.json`/`README` conditionnels) ·
`complete/` (compose.yaml redis+profils postgres/mariadb/mysql/tools/loki+grafana,
préfixé `<appName>`) · `frontend/shared/` (AppController : `renderTags(name,
this.context?.cspNonce)` — la CSP est émise par le firewall, le controller ne
fait que propager le nonce ; `getCspDirectives` N'EXISTE PAS) · `frontend/{react,
vue,angular}/` (entry+App par framework, `registerEntry` type `react19|vue3|
angular` + `apiProxyPaths: ["/api"]` dans `index.ts` à `onKernelBoot`, tsconfig
jsx pour react, `tsconfig.app.json` pour angular). Presets : `complete` = vitrine
totale (drizzle sqlite auto, realtime, security, frontend+studio dev, redis gated) ;
`minimal` = http+framework (+ `@nodefony/frontend` si un framework front est choisi).

**link (dev framework, AVANT release npm)** : réécrit les deps `nodefony`/
`@nodefony/*` en `file:<workspace>` vers le checkout (`resolveLocalWorkspaces` ;
hors checkout → erreur claire). `npm install` réel symlinke + installe les
transitives — app contrôlable bout en bout sans publication. Défaut spec =
`false` : un moteur ne câble JAMAIS file: sans demande explicite (interactif :
question posée si checkout ; API/flags : `--link`).

Tag eta résiduel dans un rendu = throw (projet corrompu refusé). Renames :
`gitignore.tpl` → `.gitignore` (npm strip les dotfiles publiés). Exit codes :
`OK`/`USAGE`/`CANTCREAT`/`SOFTWARE`. Tests `create.test.ts` (parse + spec +
moteur 2 presets × 4 fronts + interactif sur streams + e2e bin gate
`RUN_CLI_BOOT=1`). Preuves terrain : complete+react (install→build→tsgo→lint→
unit→e2e + page HMR nonce servie), minimal, vue, angular.

## Hooks Command

| Hook / méthode    | Quand                     | Use case                                            |
| ----------------- | ------------------------- | --------------------------------------------------- |
| constructeur      | à `addCommand`            | Setup commander : `addOption`/`addArgument`/`alias` |
| `onKernelStart()` | AVANT `Kernel.start()`    | Config env, type, packageManager                    |
| `generate(...)`   | APRÈS phase `kernelEvent` | Exécution principale (méthode à surcharger)         |
| `interaction()`   | mode interactif (TTY)     | Menu/prompt (ex. `start`)                           |

## Settings ProtoService cas spécial

⚠️ `Service.set()` pour les commands utilise un guard car le Container peut être absent au moment de l'enregistrement. Le setup commander (`createCommand`, `addOption`/`addArgument`) se fait dans le **constructeur** de `Command` (`command/Command.ts`) — il n'y a pas de méthode `register()`.

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
