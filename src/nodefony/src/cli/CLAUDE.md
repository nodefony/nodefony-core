# CLAUDE.md — Cli / Command

> Sous-module `src/nodefony/src/cli/` du workspace `@nodefony/core` (+ `../command/`).
> Pour audience IA en cours de session. Complète [`MEMORY.md`](./MEMORY.md) et [`README.md`](./README.md).

## Rôle

Framework de commandes CLI de Nodefony. **Cli** = base class (Commander wrapper + helpers). **Command** = base class pour chaque commande (`development`, `build`, `test`, etc.). **CliKernel** (cf `../kernel/`) étend `Cli` et ajoute le lien au Kernel.

## Architecture

```
src/nodefony/src/cli/
├── Cli.ts                 ← base class (extends Service)
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

Filet d'intégration : `CliIntegration.test.ts` (`NF_RUN_CLI_BOOT=1` pour les boots réels).

| Command      | Alias         | Fichier                | Note                                                          |
| ------------ | ------------- | ---------------------- | ------------------------------------------------------------- |
| `Start`      | —             | `StartCommand.ts`      | menu interactif (TTY)                                         |
| `Dev`        | `dev`         | `DevCommand.ts`        | + `--detach/--wait/--health/--log` (fast-path standalone)     |
| `Build`      | `compile`     | `BuildCommand.ts`      | point d'arrêt `onRegister`                                    |
| `Prod`       | `prod`        | `ProdCommand.ts`       | foreground cloud-native, `--workers`, `--detach`              |
| `Cluster`    | —             | `ClusterCommand.ts`    | `--workers`, `--detach`                                       |
| `Install`    | —             | `InstallCommand.ts`    |                                                               |
| `Outdated`   | —             | `OutdatedCommand.ts`   | `-j/--json`, `-a/--all` (cf § outdated)                       |
| `Status`     | —             | `StatusCommand.ts`     | **standalone** (0 boot)                                       |
| `Stop`       | —             | `StopCommand.ts`       | **standalone** (0 boot)                                       |
| `Completion` | —             | `CompletionCommand.ts` | **standalone** — script bash/zsh/fish (cf § Complétion)       |
| `Create`     | —             | `CreateCommand.ts`     | **standalone** — scaffold projet (cf § Scaffold)              |
| `Env`        | —             | `EnvCommand.ts`        | **standalone** — cascade `.env` + provenance (cf § env)       |
| `Card`       | `devkit:card` | `CardCommand.ts`       | **standalone** — carte de visite de l'app (cf § card)         |
| `Check`      | `doctor`      | `CheckCommand.ts`      | **standalone** — diagnostic STATIQUE (cf § check)             |
| `Inspect`    | —             | `InspectCommand.ts`    | état RÉEL de l'app, `onPostReady` sans serveur (cf § inspect) |
| `Symbols`    | —             | `SymbolsCommand.ts`    | **standalone** — signature + TSDoc depuis le graphe publié    |
| `ai:sync`    | —             | `cli/aiSync.ts`        | **standalone** — pointeurs de skills (cf § ai:sync)           |
| `git:hooks`  | —             | `cli/gitHooks.ts`      | **standalone** — hooks git natifs (cf § git:hooks)            |

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
service. Détail des cas + variables (`NF_CLI_DELEGATED`, `NF_CLI_DEBUG`) : [`MEMORY.md`](./MEMORY.md).

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

## `nodefony outdated` — les dépendances en retard, agrégées par paquet

`nodefony outdated [-j|--json] [-a|--all]` — **UNE** interrogation `npm outdated --json --long`
à la racine (`kernel.path`), jamais une par module : un `npm` lancé dans un sous-dossier
d'espace de travail remonte à la racine, donc boucler sur les modules réaffichait N fois la
table entière (mesuré ici : 47 couples paquet/dépendant → 8 lignes).

Architecture en deux morceaux, comme `env` : `cli/outdated.ts` = calcul **PUR**
(`aggregateOutdated` / `classifySeverity` / `toTableRows` / `formatHeadline` — reçoit le
document npm, conclut ; testé sans kernel) ; la commande = adaptateur (spawn, capture, rendu).

Trois choses que le brut de npm ne dit pas : les **dépendants regroupés** (« 22 paquets » ;
`--all` les nomme) · une plage **ÉPINGLÉE** (`wanted === current` → un `npm update` ne fera
rien, c'est la plage qu'il faut décider de changer) · un paquet **en AVANCE** sur le registre,
mis à part (`semver.gt(current, latest)` — un espace de travail local non publié, que npm
présente comme un retard).

⚠️ **Le gestionnaire n'est pas deviné** : sans `package-lock.json` à la racine, la commande sort
en **69** (`EX_UNAVAILABLE`). `pnpm outdated --json` et `yarn outdated --json` rendent un
document de FORME différente, que l'agrégateur lirait mal sans rien signaler.

⚠️ `npm outdated` sort en **1** dès qu'un paquet est en retard — c'est son cas NOMINAL, et
`error.stdout` porte alors le rapport. Sans stdout, c'est un vrai échec.

`Module.outdated()` (`kernel/Module.ts`) reste l'API par-module, pour une app hors monorepo.

## `nodefony env` — l'environnement, en entier (standalone 0-boot)

`nodefony env [--json] [--cwd <path>]` (+ `--example [--check]` : dérive/vérifie `.env.example` depuis le catalogue, ADR-0006) — cascade des `.env`, variables déclarées, valeur
EFFECTIVE de chacune et sa PROVENANCE, puis ce qui est ignoré. Standalone **par nécessité**
(même raison que `check`, en plus tranchée) : on cherche une variable précisément quand l'app
NE démarre pas. Sort en **78** (`EX_CONFIG`) si une variable requise manque.

Architecture en deux morceaux : `cli/envReport.ts` = calcul **PUR** (`buildEnvReport` — reçoit
la cascade déjà lue + l'env effectif, conclut) ; `cli/env.ts` = adaptateur (lecture fichiers,
import du catalogue depuis `dist/index.js` de l'app, rendu humain/JSON).

**L'ordre des fichiers vient de `envFileOrder`** (`runtime/loadEnv.ts:72`, extrait de `loadEnv`
pour cette raison) — jamais d'une copie : un ordre AFFICHÉ qui différerait de l'ordre APPLIQUÉ
serait pire que pas d'affichage, puisqu'on le croirait sur parole.

Ce que le rapport reconstruit sans instrumenter `loadEnv` : au moment où la commande tourne,
`process.env` est déjà peuplé et la trace de « qui a posé quoi » est perdue. On la recalcule —
le PREMIER fichier de la cascade qui porte la valeur effective EST l'origine ; aucun ne
correspond → c'est le shell, qui gagne toujours. Les niveaux suivants qui définissent la même
clé sont rendus **masqués** (le piège n°1).

Quatre sorties, dont trois qu'aucun autre outil ne donne : les **masquées**, les **NF\_
inconnues** (faute de frappe → suggestion par `closestMatch`, la brique de `envOverride`), les
**surcharges `NF__<MODULE>__<CHEMIN>`** distinguées des variables déclarées, et les **requises
manquantes**. Secrets jamais rendus en clair (`pathLooksSecret` — même regex que partout).

## `nodefony card` — la carte de visite (standalone 0-boot)

`nodefony card [--json] [--cwd <path>]`, alias **`devkit:card`** (son nom
d'origine, écrit dans les `AGENTS.md` déjà générés — et l'alias partage le
fast-path, sinon il partirait en dispatch différé, donc en boot). Rend l'identité
de l'application, ses modules, **où aller** (`AGENTS.md`, catalogue, docs des
modules, console d'admin) et **quoi lancer**.

⚠️ **C'est la première commande d'un arrivant : elle ne peut avoir AUCUNE
condition d'accès.** Elle en avait deux, toutes deux constatées sur une app
fraîchement générée : (1) l'app n'était pas encore CONSTRUITE, et
`diagnoseUnbootableProject` répond « lance `npm run build` » à tout ce qui exige
un Kernel ; (2) portée par une commande du module `@nodefony/devkit`
(`policy: "dev"`), elle **n'existait pas** sans `NODE_ENV=development` — le CLI
répondait `unknown command`, sans piste.

Architecture en deux morceaux, comme `env` : `cli/cardReport.ts` = composition
**PURE** (`buildCard` — reçoit l'état, ne le lit pas) + rendu (`renderCard`) ;
`cli/card.ts` = adaptateur (lecture des fichiers, exit codes). Le module
`@nodefony/devkit` importe les deux pour sa route HTTP : **une composition, deux
portes**, aucune divergence possible.

**Ce qu'elle ne peut pas savoir, elle le DIT** : sans boot, la liste est celle
des modules **installés** (`node_modules/@nodefony/*` + `modules/*` + deps
déclarées — le disque fait foi, sinon un dépôt en espaces de travail rend « 0
module »), pas des modules **chargés**. La ligne le mentionne et renvoie à
`npx nodefony inspect modules`. Sort en 66 (`EX_NOINPUT`) hors projet.

## `nodefony check` / `doctor` — le diagnostic STATIQUE (standalone 0-boot)

`nodefony check [--json] [--cwd <path>]`, alias **`doctor`**. Ne lit que des fichiers
(`package.json` + sources) — donc il fonctionne sur une application **qui ne démarre plus**, et
c'est sa raison d'être. Fast-path `CliKernel.ts:230` : le faire booter coûterait un démarrage
complet pour une réponse qui n'en dépend pas, et noierait le rapport sous le journal du Kernel.

⚠️ **La cible est l'APPLICATION, pas le dossier où l'on a tapé.** La commande remonte au premier
dossier portant `nodefony.config.ts` (`findProjectRoot` — la MÊME définition de « où commence
l'app » que le lanceur et les scaffolds), et **annonce cette racine** quand elle diffère du dossier
de départ. Sans cette remontée, un `check` lancé dans `modules/blog/` — le cas courant, on est dans
le module qu'on développe — ne trouvait ni le manifeste ni `var/last-boot.json`, et concluait
« rien à signaler » : un outil de diagnostic silencieux, et rassurant à tort. Hors projet, le
dossier de départ reste la cible (ce dépôt-ci, un dossier de paquets). `--cwd` déplace le point de
départ de la remontée, comme pour `env`.

⚠️ **L'alias DOIT partager le fast-path.** Sans l'entrée `requested === "doctor"`, commander ne le
voit pas parmi les intégrées avant le chargement des modules → dispatch différé → boot, exactement
ce que le raccourci évite.

**Neuf règles**, en deux familles :

- **Câblage** (`kernel/checks/wiring.ts`, 6) — `orphan-entity` / `orphan-controller` /
  `orphan-service` (classe écrite que rien n'enregistre : ni la compilation ni un test ne le
  voient) · `reserved-entity` · `missing-brick` · `route-colon-param` (un segment `/api/x/:id`
  compile, se monte, s'affiche dans `inspect routes` — et ne correspond à AUCUNE URL, Nodefony
  écrit `{id}`).
- **Dépendances** (`kernel/checks/packageDeps.ts`, 3) — `undeclared-import` (paquet importé sans
  être déclaré) · `unreachable-types` · `stale-exception` (une exception de la liste qui ne
  correspond plus à rien — la liste se périme, donc elle se contrôle).

> **Le contre-exemple à garder** : la règle `route-colon-param` a d'abord lu `path:` PARTOUT et
> accusé les cinq routes react-router du frontend Studio, où `:id` est la syntaxe JUSTE. Un contrôle
> qui accuse du code correct est le pire mode de défaillance — il fait « corriger » ce qui marchait.
> D'où le bornage à `@route(`. **Une règle neuve se lance sur le dépôt entier avant qu'on y croie** :
> une garde « surface réservée de `Service` » écrite dans le même esprit a rendu **37 signalements,
> tous sur du code qui compile**, et a été abandonnée (redéfinir un nom hérité est légal tant que la
> signature reste assignable).

## `nodefony inspect` — l'état RÉEL de l'app (boot console, 0 serveur)

`nodefony inspect <sujet> [--json]` — sujets : `routes` · `modules` · `services` · `config` ·
`stores` · `entities` · `graph`. Appelle les **mêmes** handlers que le data plane d'administration
(une source, deux portes). C'est le verbe qui répond à « qu'est-ce qui est VRAIMENT monté ? » quand
le code laisse croire autre chose.

⚠️ **`kernelEvent: "onPostReady"`, et pas `onReady` malgré les apparences** (`InspectCommand.ts:11`) :
le plan d'administration est monté PAR un écouteur de `onReady` (`Framework.onKernelReady`), or
l'action d'une commande intégrée est branchée avant que le moindre module n'existe. À `onReady` elle
passerait AVANT celui qui peuple le registre, et ne trouverait rien à inspecter. Aucun serveur
n'écoute pour autant : le profil console (`servers: false`) est respecté par `Kernel.initServers`.

> **Deux verbes, une frontière** : `check` est STATIQUE (des fichiers, marche sur une app cassée),
> `inspect` est RUNTIME (elle boote, sans port). Un agent n'a que ces deux-là à retenir.

## `nodefony ai:sync` — les skills d'agent livrés par les paquets (standalone 0-boot)

`nodefony ai:sync [--dry-run] [--json] [--cwd <path>]` — pose dans `.agents/skills/` un
**pointeur** par skill trouvé dans les paquets installés (`node_modules/@nodefony/*/skills/`
**et** les modules locaux `modules/*/skills/` : rien dans la mécanique n'est propre à un paquet,
et un module tiers doit être servi par la même commande). Standalone pour la raison qui a fait
remonter `card` au cœur : portée par un module `policy: "dev"`, elle répondrait
`unknown command` dans un terminal sans `NODE_ENV`.

Architecture en deux morceaux, comme `env` et `card` : `cli/aiSyncReport.ts` = composition **PURE**
(`planSync` — reçoit les skills découverts et ce que le projet porte déjà, conclut `pose` /
`remplace` / `inchange` + les orphelins ; `renderPointer`, `renderPlan`) ; `cli/aiSync.ts` =
adaptateur (découverte disque, écriture, exit codes) et porte **`syncSkillPointers`**, le geste
entier appelé par ses DEUX consommateurs — la commande et `create app`. Une seule implémentation :
recopier la boucle d'écriture dans le scaffold aurait produit deux gestes divergeant au premier
réglage, chacun vert sur ses propres tests.

**Le contenu n'est jamais COPIÉ** — il vit dans le paquet et suit `npm update`. Un skill dont le
`name` ne correspond pas à son dossier est ÉCARTÉ (les clients l'écarteraient : poser un pointeur
vers un skill que personne n'activera est pire que rien). Idempotence au sens FORT : un pointeur
identique n'est pas réécrit, l'horodatage ne bouge pas — une commande de synchronisation qui salit
l'arbre est une commande qu'on hésite à lancer. Un pointeur orphelin est **nommé**, jamais
supprimé. Sort en 66 (`EX_NOINPUT`) hors projet.

⚠️ **Aucun `postinstall`**, volontairement : `--ignore-scripts` est courant, les scripts
d'installation sont un vecteur d'attaque connu de l'écosystème npm, et écrire dans un dossier
VERSIONNÉ à chaque installation produirait des différences surprises. `create app` pose une fois
(après l'install, avant le premier commit) ; cette commande remet à jour quand on le demande.

## `nodefony ai:mcp --agent` — déclarer la porte CHEZ l'agent, par SA CLI

`nodefony ai:mcp [--agent <claude,gemini,vibe,codex|all|none>] [--remove]`. Après avoir écrit
`.mcp.json`, la commande déclare la porte chez chaque agent demandé **en appelant sa ligne de
commande** — jamais en écrivant son fichier de configuration. Frontière : _Nodefony possède le
JETON et l'URL, l'agent possède le format de sa déclaration._ La table unique vit dans
`cli/agentTargets.ts` (cœur), consommée AUSSI par `security:token` (module `security`) qui y pose
le secret : deux tables auraient divergé au premier agent ajouté d'un seul côté.

**Aucun agent est un CHOIX, pas un oubli.** Sans `--agent`, en terminal, une case à cocher propose
les agents présents **rien de coché** ; entrée sur une liste vide ne touche à rien et le DIT
(« tu codes seul, c'est un choix »). Hors terminal, sans `--agent`, rien n'est déclaré : écrire
dans la configuration d'un autre outil ne peut pas être un effet de bord. `--agent` refuse une clé
inconnue en nommant celles qui existent (exit `64`), jamais en l'ignorant.

⚠️ **Ce que le code de sortie ne dit pas.** Mesuré : `gemini mcp remove nodefony` répond « not found
in project settings », **sort en 0**, et laisse l'entrée que `gemini mcp add` venait d'écrire. Le
verdict se prend donc au CONSTAT — la commande de lecture de l'agent (`argvListe`), relancée après
le geste : porte encore là après un retrait ⇒ état `sans-effet`, dit tel quel. Sans lecture possible
(Vibe n'a pas de `mcp list`), on ne prétend rien.

⚠️ **La CLI de l'agent est lancée depuis la RACINE du projet** (`cwd: projectRoot`), jamais depuis
le dossier de l'appelant : un agent en portée projet écrit relativement à SON répertoire courant,
et la commande créait sinon un second `.gemini/` dans un sous-dossier, invisible à l'agent.
Constaté au disque — aucun code de sortie ne le signale.

**Portée : lire ≠ écrire.** Les quatre agents savent LIRE une configuration de projet ; seuls deux
savent en ÉCRIRE une. `codex mcp add` répond « Added **global** MCP server », et Vibe subordonne la
persistance à la source `user` (`persist_allowed`). Leur portée projet existe (`.codex/config.toml`,
`.vibe/config.toml`) mais elle est conditionnée à un dossier **de confiance** — un geste de sécurité
qui appartient à l'utilisateur, dans son agent. On passe donc par leur CLI, donc en global, **et on
l'annonce** : deux applications Nodefony sur un poste se disputent sinon le même nom de serveur, et
la seconde efface la première. L'écrasement d'une déclaration visant une AUTRE URL est signalé.

## `nodefony git:hooks` — hooks git natifs, zéro dépendance (standalone 0-boot)

`nodefony git:hooks [--dry-run] [--json] [--cwd <path>]` — pose `.githooks/`
(`pre-commit` = typecheck+lint LÉGER, `pre-push` = `verify`) et
`git config core.hooksPath`. **Natif exprès** : husky v9 n'est qu'un habillage
de `core.hooksPath`, et un `postinstall` est refusé pour les mêmes raisons
qu'`ai:sync` (`--ignore-scripts`, vecteur d'attaque) — la pose est un geste
explicite. Doctrine : le hook local reste léger, le filet complet est la CI.

Architecture en deux morceaux, comme `env`/`card`/`ai:sync` :
`cli/gitHooksReport.ts` = composition **PURE** (`renderGitHook`/`planGitHooks`/
rendu) ; `cli/gitHooks.ts` = adaptateur (`installGitHooks` — lecture, écriture,
`git config`). **Deux appelants, une implémentation** : la commande, et
`create app --git-hooks` (question `advanced` de la spec — jamais posée en
dialogue, le défaut SANS hooks est la doctrine). Le scaffold pose les hooks
ENTRE `git init` et le commit initial (ils entrent dans le premier commit) et
ce commit passe en `--no-verify` : le hook fraîchement posé s'exécuterait sur
du contenu tout juste généré, sans `node_modules` en `--no-install` — son
premier geste serait de bloquer la création de l'app qu'il sert.

Trois refus, tous TOTAUX (rien d'à-moitié posé, exit `CANTCREAT`) : un hook
existant **sans le marqueur d'appartenance** (`GIT_HOOKS_MARKER`) n'est JAMAIS
écrasé · un `core.hooksPath` déjà posé ailleurs n'est pas volé · hors dépôt
git = `UNAVAILABLE` + « git init ». ⚠️ **Un `core.hooksPath` relatif se résout
depuis le TOPLEVEL git**, pas depuis l'app : app en sous-dossier d'un monorepo
→ la valeur posée est `apps/<x>/.githooks` (vue du toplevel), calculée sur des
chemins passés par `realpath` — git rend `/private/var/…` quand l'appelant
tient le symlink `/var/…`, et sans ça `path.relative` fabrique un `../../..`
qui sort du dépôt : les hooks ne s'exécutent alors jamais.

## Scaffold — `cli/scaffold/` + `cli/create.ts` (3 fronts, UN moteur)

`nodefony create app [name] [--dir <path>] [--force] [--yes] [--preset <complete|minimal>]
[--frontend <none|react|vue|angular>] [--link|--no-link] [--git-hooks]` — **standalone 0-boot**
(fast-path `CliKernel.start`, cas nominal HORS projet : `npx nodefony create app`).
L'app naît **agent-ready** : `AGENTS.md` racine (devise + générateurs + table
tâche→doc dérivée des deps réelles + gates + zone préservée `<!-- app-notes:start/end -->`)
avec `CLAUDE.md` pointeur (écrit seulement s'il n'existe pas), **et les pointeurs de
skills dans `.agents/skills/`** (`syncSkillPointers`, appelé APRÈS l'install — les skills
vivent dans `node_modules` — et AVANT `git init`, parce que ces fichiers sont faits pour
être versionnés). Sans ce geste, le lot ne servirait qu'à qui connaît déjà `ai:sync` :
personne n'apprend un verbe absent. Régénération BORNÉE :
`create module` réécrit l'`AGENTS.md` depuis l'état réel (inventaire `modules/*`)
en réinjectant la seule zone `app-notes` (`renderProjectAgents`/`preserveAppNotes`,
`engine.ts`). Sans frontend, `GET /` répond (HomeController JSON accueil — avec
front, `AppController` tient `/`). Suites franches : e2e EXCLUS de
`vitest.config.ts`, ciblés par `vitest.e2e.config.ts` seule (`npm test` n'affiche
jamais de skipped-vert).

> **Le dépôt ne teste pas ce qu'il GÉNÈRE** : ses assertions lisent des chaînes dans des
> fichiers rendus. Toute évolution des gabarits, de la grammaire de champs ou du moteur se
> prouve en générant une app et en lui faisant passer SES gates (install → typecheck → test →
> HTTP réel), plus un agent lâché dedans. Protocole, décor, bancs et interprétation des
> échecs : skill **`nodefony-devkit-bench`** — le charger AVANT de conclure, pas après un
> résultat rouge.

`nodefony create front <name> [--frontend <react|vue|angular>] [--route </page>]
[--module <nom>]` — ajoute un frontend Vite à une cible SANS front (app `none` ou
module) : coquille HTML (brique PARTAGÉE `templates/shared/front-shell/` — la même
que `create app`, zéro dérive), entry minimale du framework, controller de page
(`renderDocument(name, cspNonce)` — TSDoc = tout le flux dev HMR/prod/CSP/proxy),
registrar `register<Name>Entry` (fichier dédié documenté) ; wiring AUTO
`@controllers` + hook `onKernelBoot` (inséré si absent — un hook EXISTANT n'est
jamais édité : note actionnable) ; deps du framework ajoutées au package.json si
absentes. Gardes : cible avec `frontend/index.html` → throw ; `@nodefony/frontend`
absent de l'**APPLICATION** → throw actionnable. Absent du seul **module** visé, il
y est POSÉ en peer : un module local est un workspace, rien ne s'y installe pour
son compte propre, et exiger une édition manuelle du `package.json` revenait à
réclamer à la main ce que ce scaffold existe pour écrire (mesuré sur un agent
tiers). Le framework front (`react`/`vue`/`@angular/*`) part en
**`devDependencies`** — aucun fichier hors `frontend/` ne l'importe, Vite l'inline
dans le bundle, et `npm prune --omit=dev` doit pouvoir le retirer de l'image.

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
`AGENTS.md` local **toujours rendu** — précédence « le plus proche gagne »). Câble l'app :
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
formulaire Studio). **`--module` accepte le nom npm (`@app/blog`) ET le nom court
du dossier (`blog`)** — celui qu'on a tapé pour créer le module ; ambigu (deux
dossiers de workspaces, même nom court), il est refusé en NOMMANT les candidats.
Une seule implémentation, `resolveScaffoldTarget`, appelée par les cinq scaffolds
in-project : la résolution y était recopiée à l'identique, donc corrigeable cinq
fois. Saveurs : `hello` = GET + WS echo MÊME classe (défaut — le
différenciateur) ; `realtime` = sous-classe `RealtimeController` (@nodefony/realtime :
canal `<nom>:ticker` décoré `@RealtimeChannel` + action `<nom>:ping`, TSDoc = snippet
client `RealtimeClient`) — garde actionnable si la dep manque (preset minimal) ;
`rest` = CRUD `@Get/@Post/@Put/@Delete` + `@Param/@Body` + echo WS. Wiring AUTO de
l'`index.ts` cible (`wireDecoratorList` : import + insertion `@controllers([...])`,
édition textuelle gardée — toute ambiguïté = throw actionnable, jamais de fichier
corrompu). Nom normalisé (`blog-post`→`BlogPostController`, suffixe strippé) ; route
défaut `/api/<kebab>` (couverte par la zone firewall du manifeste généré). Noms de
fichiers de templates : token `__NAME__` (`templates/controller/<kind>/.../__NAME__.ts.tpl`).

`nodefony create service <Nom> [--description "…"] [--module <nom>]` — scaffold
**IN-PROJECT** d'un service injectable dans `<cible>/nodefony/service/<Nom>Service.ts`,
accompagné de son interface (`nodefony/interfaces/I<Nom>Service.ts`). Classe
`@injectable()` `extends Service`, avec les DEUX noms explicités en TSDoc : le décorateur
nomme la CLASSE (`@inject("…")`), le `super("nom", …)` nomme l'INSTANCE
(`container.get("…")`). Gabarit `templates/service/` **autonome** — aucune dépendance à un
`config/config.ts`, contrairement au service rendu par `create module`
(`templates/module/service/`), qui lui vit toujours à côté de son schéma Zod : une cible
in-project n'en a pas forcément. Wiring : `wireDecoratorList(…, "services")` — **seul
décorateur que le moteur CRÉE quand il manque** (`app/base` ne rend jamais
`@services([...])`, donc refuser aurait rendu la commande inutilisable à la racine d'une
app) ; l'import `{ services }` est posé dans la même passe, et l'ancre tolère
`export class X extends Module`.

> **Pourquoi cette commande existe** : mesuré au banc de découvrabilité — en décor
> ISOLÉ (sans accès aux sources du framework), un agent chargé d'écrire un service
> produit une classe à méthodes `static`. Elle compile, elle marche, et elle reste
> invisible au conteneur. La cause n'était pas un défaut de documentation mais une
> ABSENCE : `@injectable` n'apparaissait nulle part dans une app fraîche, et
> `nodefony/service/` n'était atteignable que comme sous-produit de `create entity`.

`nodefony create command <action> [--phase <onReady|onRegister|onPostReady>]
[--description "…"] [--service] [--module <nom>]` — scaffold **IN-PROJECT**
d'une commande CLI dans `<cible>/nodefony/command/<Action>Command.ts`. Le nom
complet est **DÉRIVÉ** : `<module>:<action>`, où le module est celui que
l'`index.ts` de la cible DÉCLARE (`super("blog", …)`) — pas le nom npm du paquet
(`@app/blog`), qui peut différer et n'existe pas au runtime. Écrire le préfixe
soi-même est toléré (strippé) ; le donner SEUL (`create command blog` dans le
module `blog`) est refusé — `blog:blog` n'est la commande de personne. Wiring
AUTO : import + `this.addCommand(X)` inséré **juste après le `super(…)`** du
constructeur (`wireCommandCall` — l'ancre est le `super`, seule ligne dont
l'existence est garantie ; un appel AVANT lèverait « must call super before
accessing this »). `--service` fait appeler le service de la cible par sa **clé
de conteneur**, et refuse AVANT d'écrire s'il n'y a pas de service appelable
(`nodefony/service/*Service.ts` exposant `greet()`) — plutôt que de produire un
appel qui ne compile pas. `create module --command` **délègue** ici (zéro
template dupliqué, même patron que controller/front) : la classe porte donc
l'ACTION (`HelloCommand`), pas le module — un module peut avoir N commandes.

> ⚠️ **Piège eta des templates** : un tag en FIN de ligne fait avaler le saut de
> ligne suivant (`autoTrim: [false, "nl"]`) → TSDoc recousu, type coupé en deux.
> Toujours du texte après un `<%= … %>`. Contrôlé par un test de FORME
> (`/^ \*.*\S \*$/m`), que les assertions de contenu ne voient pas.

`nodefony create entity <Nom> [champs…] [--id <uuid7|uuid4|serial>] [--soft-delete]
[--no-timestamps] [--no-controller] [--no-service] [--no-tests] [--route </api/x>]
[--module <nom>] [--connector <nom>] [--dialect <sqlite|postgres|mysql>]
[--table <nom_sql>] [--column-case <camel|snake>] [--id-name <colonne>]` — scaffold
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
`scaffold/entityFields.ts` (module PUR, 3 dialectes). **Index de TABLE** :
`--index "colA,colB"` / `--unique "colA,colB"`, **répétables** (un par index) — les seuls à
porter PLUSIEURS colonnes, donc les seuls qui expriment comment une table réelle est
interrogée (mesuré : sur les 73 index du schéma Umami, **28 sont composites**). **Épouser une
table EXISTANTE** : `--table` (nom SQL littéral — la pluralisation ne se devine pas à l'envers),
`--column-case snake` et `--id-name`. Ces trois-là ne touchent QUE le SQL — la propriété
TypeScript reste `id`/`siteId`, parce que le service, le controller, le tri par défaut et les
tests générés la nomment ainsi : faire suivre le TS aurait transformé un réglage de nommage en
refonte de la chaîne. Dimensionné sur un schéma réel : des 134 renommages qu'exige Umami,
**115 sont le passage mécanique au `snake_case` et 18 la clé primaire** — d'où deux réglages
globaux plutôt qu'un dictionnaire par champ. Le nom d'index, objet SQL, suit la casse des
colonnes ; les colonnes VISÉES restent nommées côté Drizzle (`t.siteId`). Question de
spec de type `"list"` : chaque valeur reste entière, là où la normalisation en texte fondrait
deux index de deux colonnes en un de quatre. Colonne inconnue, répétée, ou implicite absente
(`createdAt` sans horodatages) → **refus AVANT écriture**, avec les colonnes disponibles ;
même jeu de colonnes déclaré par `:index` ET `--index` → **un seul index émis** (sinon la
création de la table échoue au démarrage). **`ref:` ⇒ colonne INDEXÉE d'office**
(sauf `!`, qui pose déjà l'index) : c'est la colonne de jointure (`?include=` = `IN (…)`).
L'index n'est PAS la FK — un `JOIN` n'exige aucune contrainte ; les **FOREIGN KEY ne sont pas
émises** par le DDL dev (déclarées dans le `CREATE TABLE`, elles n'atteindraient jamais une base
existante) → domaine des migrations. Wiring : `wireEntitiesDecorator` **crée** `@entities([...])`
s'il n'existe pas (import **nommé** — un descripteur n'est pas un default), + `@controllers`.
Gardes AVANT écriture : hors projet · `@nodefony/drizzle` absent de la cible · entité déjà
déclarée · **nom RÉSERVÉ par un module du framework** (`scaffold/reservedEntities.ts` : `User`,
`session`, `access_token`, `audit_event`… ; casse et séparateurs ignorés — registre ORM PLAT, un
homonyme dépossède le module et l'app ne démarre plus sur un message de « colonne inconnue » ;
table tenue honnête par le gate `NF_RUN_CLI_BOOT=1` de `CliIntegration.test.ts` qui la confronte à
`nodefony inspect entities --json`) · champ invalide. Ajoute `drizzle-orm` au `package.json` de
l'app si absent (le code produit l'importe EN DIRECT — sans la dep, seul le hissage npm sauvait
la résolution, absent en `--link`) et l'ANNONCE (`npm install` requis). **La SUPPRESSION naît gardée** : `@IsGranted("ROLE_ADMIN")` sur `destroy` dès que
`@nodefony/security` est dans les deps de la cible — le gabarit `rest` de `create controller`
protège déjà le même DELETE, et deux générateurs qui produisent la même route destructrice ne
peuvent pas avoir deux doctrines. Sans le module, la garde n'est pas émise (le décorateur
n'existerait pas) et le TSDoc DIT que la route n'est protégée par rien, avec le geste pour la
protéger. Le décor e2e généré fournit l'identité qui va avec (`connexionAdmin`, `NF_ADMIN_PASSWORD`
posé pour la suite seule : la production ne sème aucun compte sans mot de passe explicite), et le
test e2e d'entité éprouve les DEUX faces — l'admin supprime, l'anonyme est refusé et la donnée
survit. Mesuré avant correction, sur une application réelle : le CRUD généré répondait **204 à un
DELETE anonyme** (banc de découvrabilité, tâche 20). **Dit la vérité** : la
table naît au prochain boot dev (`CREATE TABLE IF NOT EXISTS`), la **modifier n'altère RIEN**
(pas d'`ALTER`), aucune migration n'est produite. Design + alternatives rejetées :
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
décorateurs, `nodefony.config.ts`/`package.json`/`README` conditionnels,
**`Dockerfile` + `.dockerignore`** — cf § ci-dessous) ·
`complete/` (compose.yaml redis + **la SEULE base retenue** + profils
tools/loki+grafana, préfixé `<appName>` — cf § base SQL ci-dessous) ·
`frontend/shared/` (AppController : `renderTags(name,
this.context?.cspNonce)` — la CSP est émise par le firewall, le controller ne
fait que propager le nonce ; `getCspDirectives` N'EXISTE PAS) · `frontend/{react,
vue,angular}/` (entry+App par framework, `registerEntry` type `react19|vue3|
angular` + `apiProxyPaths: ["/api"]` dans `index.ts` à `onKernelBoot`, tsconfig
jsx pour react, `tsconfig.app.json` pour angular). Presets : `complete` = vitrine
totale (drizzle sqlite auto, realtime, security, frontend+studio dev, redis gated) ;
`minimal` = http+framework (+ `@nodefony/frontend` si un framework front est choisi).

**Base SQL — `--database <sqlite|postgres|mariadb|mysql>` (défaut `sqlite`)** : le
générateur connaît le dialecte, donc l'app ne reçoit ni les deux services qu'elle
n'utilisera pas, ni une URL à recomposer. `DATABASE_PARAMS` + `resolveDatabase`
(`engine.ts`) sont la SOURCE UNIQUE du service, du port publié et de
`NF_DATABASE_URL` — trois gabarits en parlent (`compose.yaml`, `.env`,
`README.md`) et un écart entre eux ne se voit qu'à la connexion refusée. Le
service retenu est rendu **sans `profiles:`** (ce n'est pas une option : `docker
compose up -d` doit le monter), et `.env` porte l'URL **active** — donc le récap
de `create app` place `npm run infra:up` AVANT `npm run dev`. En `sqlite` :
aucun service SQL, URL commentée, l'app démarre sans rien allumer.

> La question porte `askWhen: { key: "preset", equals: "complete" }` — condition
> sur une RÉPONSE précédente, là où `askIf` interroge l'environnement. Non
> satisfaite, la valeur retombe au DÉFAUT (le layer `complete` porte le
> `compose.yaml` : en minimal il n'y aurait aucun fichier où l'écrire). Le récap
> interactif applique le même filtre, sinon il annoncerait un choix ignoré.

**link (dev framework, AVANT release npm)** : réécrit les deps `nodefony`/
`@nodefony/*` en `file:<workspace>` vers le checkout (`resolveLocalWorkspaces` ;
hors checkout → erreur claire). `npm install` réel symlinke + installe les
transitives — app contrôlable bout en bout sans publication. Défaut spec =
`false` : un moteur ne câble JAMAIS file: sans demande explicite (interactif :
question posée si checkout ; API/flags : `--link`).

**L'image de container naît avec l'app** (`base/`, donc les DEUX presets — la doctrine
cloud-native n'est pas une option de la vitrine). Ce que ces lignes tiennent ne produit
aucune erreur quand il disparaît : **forme EXEC** du `CMD` (sinon `/bin/sh` est PID 1, ne
transmet pas le SIGTERM, et chaque déploiement tue les requêtes en vol), `USER node`,
sonde sur `/readyz`, et un `.dockerignore` qui écarte `*.local` — un secret entré dans une
couche y reste, même effacé par la suivante. Un test de FORME les contrôle en ligne entière
(un `include` se serait contenté de `**/*.local` pour prouver `*.local`).

⚠️ **Le `COPY . ./` précède l'installation**, contre le patron canonique du monde Node. Une
dépendance ici peut être LOCALE — workspaces `modules/*`, archive `file:` avant publication —
et installer avant de l'avoir copiée échoue sur elle. Le cache de couche perdu est repris par
un **cache mount npm** (`--mount=type=cache,target=/root/.npm`), qui laisse l'installation
vierge. Le stage d'exécution copie `/app` d'un seul geste : nommer les chemins ferait échouer
la construction sur le premier dossier absent (`modules/`, `public/`), inconnus à la génération.

Tag eta résiduel dans un rendu = throw (projet corrompu refusé). Renames :
`gitignore.tpl` → `.gitignore`, `dockerignore.tpl` → `.dockerignore` (npm strip les
dotfiles publiés). Exit codes :
`OK`/`USAGE`/`CANTCREAT`/`SOFTWARE`. Tests `create.test.ts` (parse + spec +
moteur 2 presets × 4 fronts + interactif sur streams + e2e bin gate
`NF_RUN_CLI_BOOT=1`). Preuves terrain : complete+react (install→build→tsgo→lint→
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

| Symptôme                            | Cause                                        | Fix                                              |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| `Cannot add option '-v, --version'` | `setCommandVersion()` appelé 2×              | Constructor `Cli` le fait déjà                   |
| Command pas matched par Commander   | `addCommand()` appelé après `parseCommand()` | Ordre : add → parse                              |
| `onKernelStart` pas appelé          | Override sans `super` ? Vérifier signature   | Doit être `async onKernelStart(): Promise<void>` |
| `generate()` pas appelé             | Mauvaise phase `kernelEvent`                 | Vérifier que le kernel fire bien cet event       |
| 2× registered listeners sur Command | `setEvents()` appelé 2×                      | Guard `eventsRegistered` ajouté — idempotent     |

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
