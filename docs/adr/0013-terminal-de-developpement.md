---
adr: 13
title: Terminal de développement — un seul propriétaire, un modèle d'écran pur, une invite à actions
lang: fr
navTitle: Terminal de développement
date: 2026-10-04
status: proposed
deciders: [Christophe CAMENSULI]
tags: [cli, dev, terminal, supervisor, ia]
---

# ADR-0013 — Terminal de développement : un seul propriétaire, un modèle d'écran pur, une invite à actions

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0013**

## Statut

Proposé (2026-10-04), contre-revu avant toute ligne de code. **Livré en partie** : les §1 à 6
(propriétaire unique, modèle d'écran pur, foyers, `DevTerminal`, canal IPC) et l'annotation des
outils MCP le sont — #535, #536, #537 et #540 fermés. Restent proposés le §7 (l'invite, #538) et
le §8 (l'assistant local, #539), ouverts sans jalon : l'ADR passera à « accepté » quand ils seront
tranchés ou retirés.

**Amendement proposé (2026-11-23)**, issu de l'audit du terminal
([#896](https://github.com/nodefony/nodefony-core/issues/896)), décisions D1 à D7 validées par
l'auteur et portées par [#903](https://github.com/nodefony/nodefony-core/issues/903) : le §11
(zone centrale à plusieurs vues) est neuf ; les §2, §3, §5, §6, §7, §8 et §9 sont amendés en
place, chaque amendement marqué **« Amendement #903 »** ; la section « Normes et antériorités »
est ajoutée. Aucune ligne de code avant la relecture de l'auteur. Epic
[#534](https://github.com/nodefony/nodefony-core/issues/534) ; sous-tickets
[#535](https://github.com/nodefony/nodefony-core/issues/535) (modèle d'écran),
[#536](https://github.com/nodefony/nodefony-core/issues/536) (propriétaire unique),
[#537](https://github.com/nodefony/nodefony-core/issues/537) (barre figée),
[#538](https://github.com/nodefony/nodefony-core/issues/538) (invite),
[#540](https://github.com/nodefony/nodefony-core/issues/540) (annotations des outils MCP),
[#539](https://github.com/nodefony/nodefony-core/issues/539) (assistant local). Prolonge l'écran
de démarrage de [#533](https://github.com/nodefony/nodefony-core/issues/533). Compatible avec
l'[ADR-0004](0004-inference-llm-backend-supervise.md) (inférence orchestrée, jamais embarquée) et
le [livre blanc de la couche IA](../ia/livre-blanc-couche-ia.md).

## Contexte

`nodefony development` fait tourner **deux processus dans un terminal** : le superviseur (premier
plan, surveille les sources, reconstruit, relance) et le serveur (enfant détaché, son propre
groupe de processus). Depuis #533, le serveur dessine une barre d'état en bas du terminal ; le
superviseur efface cette barre avant chacune de ses écritures, par un protocole d'effacement
croisé sur le canal IPC.

Trois besoins dépassent ce modèle :

1. **La barre doit rester en bas pendant qu'on remonte le journal.** Elle n'est aujourd'hui que la
   dernière ligne écrite : elle défile avec l'historique du terminal.
2. **Une invite `❯`** dans la barre, pour lancer une commande du CLI sans second terminal.
3. **Un assistant** répondant en langage naturel, adossé à un modèle qui tourne sur la machine.
4. **Plusieurs sorties à la fois** (amendement #903). Le superviseur devient l'hôte du
   développement : la sortie du serveur, celle de Vite (#692), celle d'une commande de l'invite,
   plus tard celle de l'assistant (#539) et de sous-agents, en onglets ou en écran partagé, avec
   des menus en surimpression. Le modèle de #535 ne connaît qu'UN historique, UN état de
   défilement et trois zones empilées pleine largeur ; y brancher Vite ou l'invite puis le
   refaire paierait le travail deux fois, et réécrirait à chaque fois le défilement, qui a déjà
   coûté cher (#533 à #537).

Les faits qui contraignent la solution, au code :

- `src/nodefony/src/service/dev/DevSupervisor.ts#DevSupervisor.#spawnChild` — le serveur est lancé `detached` sous
  POSIX : un groupe en arrière-plan qui LIT le terminal reçoit `SIGTTIN` et est suspendu. Seul le
  superviseur (il reçoit Ctrl+C, `SIGINT` — `DevSupervisor.ts#DevSupervisor.#forceShutdown`) peut lire le clavier.
- `src/nodefony/src/service/dev/DevSupervisor.ts#DevSupervisor.#clearSpin` — `stdio: ["inherit", "inherit", "inherit",
"ipc"]` : le serveur écrit directement dans le terminal.
- `src/nodefony/src/service/dev/DevSupervisor.ts#DevSupervisor.#symbolsFailed` (`#log`) et `src/nodefony/src/service/dev/DevSupervisor.ts#DevSupervisor.#log` (`#startSpin`) — le
  superviseur écrit lui aussi en direct, et anime son spinner de build par `\r`.
- Un terminal ne fige rien dans son propre historique. Une zone de défilement (`DECSTBM`) a été
  essayée en #533 : historique vidé, Windows Terminal ne garde pas ce qui en sort, terminal cassé
  au `kill -9`.
- `src/nodefony/src/runtime/isTerminal.ts#isTerminal` (`isTerminal`, qui lit `isTTY`) — la porte unique où le code constate « suis-je dans
  un terminal ? ». Quatorze lectures directes de `process.stdout.columns` la contournent encore,
  dans sept fichiers.
- Vite n'est PAS concerné : son hôte tourne en tube, sans couleur
  (`src/packages/@nodefony/frontend/nodefony/service/viteFamily.ts#ViteFamily.addedEnv`,
  `FORCE_COLOR: "0"`), et `clearScreen: false` lui est imposé
  (`src/packages/@nodefony/frontend/nodefony/service/viteHost.ts#viteHostInlineConfig`) ; il ne
  touche jamais le terminal et n'efface jamais l'écran.
  L'amendement #903 n'y change rien : quand le superviseur portera Vite (#692), sa sortie aura
  un canal à elle (§11), et n'écrira toujours pas dans le terminal.

Faits ajoutés par l'audit de #896 (amendement #903) :

- `src/nodefony/src/service/dev/DevTerminal.ts#DevTerminal` — un seul historique pour toutes les
  sources, un seul état de défilement (ancre, hauteurs, plancher, sélection).
- `src/nodefony/src/service/dev/devTranscript.ts#TranscriptSource` — union FERMÉE de cinq
  sources, sans Vite ni identifiant d'agent ; `devTranscript.ts#DevTranscript.indexOf` suppose
  des `seq` contigus, donc aucune vue filtrée.
- `src/nodefony/src/service/dev/devFrame.ts#frameLayout` — trois zones pleine largeur ;
  `DevTerminal.ts#DevTerminal.#drawFrame` termine chaque ligne par `ESC[K`, qui effacerait un
  volet voisin.
- `src/nodefony/src/service/dev/DevTerminal.ts#DevTerminal.addFocus` — sans plein écran, aucun
  foyer n'est branché : aucune saisie en surface `inline`. Et `suspend` (§5) n'existe pas encore.
- En rafale en direct, chaque ligne se décale : le diff par ligne réécrit tout l'écran à chaque
  image (jusqu'à ~62 par seconde). Le retour de `write` est ignoré : aucune image n'est sautée
  quand le terminal ne suit pas.

## Décision

### 1. Le superviseur est le SEUL propriétaire du terminal

Il lit le clavier, écrit l'écran, tient l'historique. La sortie du serveur transite par lui
(`stdio: ["ignore", "pipe", "pipe", "ipc"]`, en rendu humain dans un terminal hors `--debug`). Le
protocole d'effacement croisé (`guardSharedTerminal`, `status` / `status-erased`) disparaît.

- **Le superviseur lui-même n'écrit plus jamais sur son flux en propre** : ses lignes `[dev]` et
  son spinner de build passent par `DevTerminal.ingest("supervisor", …)`. Sans quoi il y aurait de
  nouveau deux écrivains — le superviseur et son propre écran.
- **Verdict transmis au serveur** : `NF_DEV_TERMINAL` porte ce que le superviseur a constaté. Le
  serveur le lit UNE fois à la porte (`isTerminal`, plus une voisine `terminalSize`), le mémoïse,
  puis le **retire de `process.env`** : un petit-enfant du serveur (`npm install`, une commande
  lancée depuis la console d'administration) n'en hérite pas et ne se croit pas en terminal. Le
  verdict déclare `input: false` : `isTerminal(process.stdin)` reste faux, aucune commande du
  serveur n'attend une saisie qu'elle ne recevra jamais.
- **`FORCE_COLOR`** est posé pour les bibliothèques de couleur du processus serveur (nom de
  l'écosystème, qu'on ne possède pas). Les deux lecteurs de couleur du dépôt qui consultent
  `isTTY` en direct passent par la porte : le défaut d'import de `src/nodefony/src/syslog/logColor.ts`
  et `shouldAnimate` de `src/nodefony/src/cli/progress.ts#shouldAnimate`.
- **Deux tubes ne garantissent pas l'ordre relatif entre `out` et `err`** (aujourd'hui, `inherit`
  ordonne par appel système). C'est le prix du champ `stream` de l'historique ; il est accepté.
- **Sans superviseur** (`--no-watch`), le serveur garde `StatusLine` et dessine lui-même, comme
  aujourd'hui : `StatusLine` est partagée, pas déplacée.

### 2. Deux surfaces, un modèle

| Surface      | Ce qu'elle fait                                                                                                           | Quand                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullscreen` | écran alternatif, historique tenu par nous, molette traduite ou captée ; journal, invite et barre dessinés à chaque image | par défaut sous macOS et Linux, DEMANDÉ sous Windows (`--ui` ou `NF_DEV_UI=1`) ; toujours : clavier en terminal, et le terminal répond à la sonde |
| `inline`     | le rendu de #533 : le contenu part dans l'historique natif, invite et barre redessinées en dernières lignes               | par défaut sous Windows ; ailleurs en repli : terminal muet, clavier hors terminal, `--no-ui`, `NF_DEV_UI=0`                                      |

- **Le plein écran est le défaut sous macOS et Linux, opt-in sous Windows.** Les preuves sont
  faites là où il est le défaut — capture de la souris et sélection par l'application,
  contre-revue du code de la grappe, essais dans un terminal réel et bancs sous pseudo-terminal ;
  il ne l'est pas sous Windows, où rien n'a jamais été exécuté : c'est une POLITIQUE dite comme
  telle, pas une capacité déduite de la plateforme — la sonde, elle, constate toujours le
  terminal. Sans demande, un terminal muet ou un clavier hors terminal retombent en `inline` sans
  un mot ; demandé, le repli est nommé. Un agent qui pilote un pseudo-terminal l'écarte d'un
  signal EXPLICITE (`--no-ui`, `NF_DEV_UI=0`, `--output plain`) : on ne devine jamais « c'est une
  IA ». Une valeur de `NF_DEV_UI` autre que `0` ou `1` est ignorée, et nommée.
- **La sonde** est une requête de position du curseur (`ESC[6n`, réponse `ESC[ligne;colonneR`),
  universelle chez les terminaux à séquences VT : une réponse ⇒ écran alternatif utilisable. La
  sortie synchronisée (mode `2026`) est demandée EN PLUS par DECRQM et reste optionnelle. Le plein
  écran n'est jamais conditionné à DECRQM, extension que tous les terminaux n'implémentent pas.
- **La souris** — deux régimes, un interrupteur (`--mouse` / `--no-mouse` / `NF_DEV_MOUSE`) :
  - **laissée au terminal** (le défaut) : seul le défilement alterné (mode `1007`) est posé ; le
    terminal traduit la molette en flèches, la sélection native marche sans touche. Ce régime
    perd la molette là où le terminal ne traduit pas : Terminal.app par défaut, tmux, JediTerm ;
  - **captée** (`--mouse`) : clics (`1000`), glisser bouton tenu (`1002`), coordonnées SGR
    (`1006`) — jamais `1003` (tout mouvement : une inondation) ni `1004`. C'est le seul régime
    qui rend la molette uniforme partout où la souris est rapportée. La sélection est alors
    DESSINÉE par l'application (patron Claude Code, opencode, Textual) : extrémités en (entrée,
    colonne) de l'historique, jamais en coordonnées d'écran — un défilement pendant le glisser,
    une ligne qui arrive, un repli différent ne la perdent pas ; double clic = mot (un chemin
    suivi de sa ligne et de sa colonne, une URL), triple = ligne logique ; glisser au bord fait défiler ; copie au
    relâchement. Hors du journal, un CLIC sur une adresse (la barre d'état) la copie : les zones se
    lisent sur la ligne affichée (`devSelection.ts#lineZones`) — la cible d'un lien OSC 8 fait foi, sinon
    l'adresse écrite en clair ; une adresse raccourcie à l'écran (`…`) est DITE, jamais copiée fausse.
    Le type de zone est une union ouverte : les zones que le serveur publiera (actions de l'invite
    #538, services portés par le superviseur #692) s'y brancheront sans changer le geste.
    La sélection native reste possible avec la touche du terminal, que l'aide de
    l'invite (#538) nommera (`fn` sous Terminal.app, `⌥` sous iTerm2, `maj` ailleurs) — la barre ne
    porte pas d'aide permanente.
  - `1007` est posé dans les deux régimes : là où la capture est refusée par un réglage du
    terminal (iTerm2, Terminal.app, Warp), la molette arrive encore, en flèches. Un cran capté
    défile de trois lignes, comme un cran traduit.
  - **Le presse-papiers se choisit sur le contexte** : session SSH ⇒ OSC 52 seule (un outil
    distant copierait sur la MAUVAISE machine, sans erreur) ; tmux ⇒ son tampon d'abord ;
    poste ⇒ `pbcopy`, `wl-copy`, `xclip`, `xsel`, PowerShell `Set-Clipboard` (jamais
    `clip.exe`), OSC 52 en dernier. « Copié » n'est dit que sur le code 0 d'un outil ; OSC 52
    n'a aucun accusé de réception et se dit « non confirmée ».
  - La capture suit le plein écran : par défaut sous macOS et Linux, opt-in sous Windows.
    `--no-mouse` rend la souris au terminal — la sélection native redevient directe, au prix
    de la molette là où le terminal ne la traduit pas.
- **Windows** : PgUp/PgDn/Début/Fin défilent partout. La console ne rapporte la souris à un
  programme en mode brut que depuis Node 24.2 (libuv 1.51) : en deçà, `--mouse` est refusé en le
  disant — c'est une DÉDUCTION de la version, assumée, car l'activer pour la constater ferait aussi
  perdre la molette de `1007`. La molette reste à prouver à la main sous Windows Terminal.
- Un pseudo-terminal qui répond à la sonde (tmux lancé par un agent) n'obtient le plein écran que
  si on le lui demande ; `--no-ui` et `--output plain` restent les issues, documentées.

Les deux surfaces consomment le **même modèle** et rendent la **même** invite.

**Amendement #903 (D3) — `inline` est un repli DÉGRADÉ, pas une seconde surface complète.**

- Il rend le flux FUSIONNÉ des canaux, chaque ligne préfixée par son canal quand il y en a plus
  d'un, plus une invite d'UNE ligne. Onglets, écran partagé et bandes en surimpression (§11)
  n'existent qu'en plein écran.
- UNE écriture par paquet : effacement de la barre, contenu, barre redessinée, composés par
  `DevTerminal` en une chaîne. L'interception de `StatusLine` (`statusLine.ts#StatusLine`) reste
  un filet pour le mode sans superviseur, pas le chemin nominal.
- Les foyers y sont branchés : l'invite existe aussi en `inline` (aujourd'hui, aucun foyer hors
  plein écran).
- **Garde-fou ConPTY** : sous Windows Terminal, des écritures positionnées peuvent laisser des
  fragments — Claude Code le documente et force une repeinte complète. Le plein écran y repeint
  donc toute image au lieu de la différencier, tant qu'un banc à la main n'a pas prouvé le diff.
  Le plein écran par défaut sous Windows reste conditionné à cette preuve. Livré à l'étape 6
  (`outputMode.ts#readDevPaint`) : `"full"` sous Windows, `"scroll"` ailleurs, le repli DIT au
  démarrage ; `NF_DEV_PAINT` (`scroll`, `diff`, `full`) l'emporte, c'est la porte de ce banc à la
  main. Une DÉDUCTION assumée : rien ne distingue de l'intérieur une console ConPTY, et repeindre
  est juste partout, seulement plus cher.

### 3. Le modèle d'écran est pur — quatre briques, sans terminal

Fichiers à plat dans `src/nodefony/src/service/dev/` (#535). Identifiants en anglais, prose en
français.

```typescript
// devTranscript.ts — ce que l'écran a montré, borné
type TranscriptSource =
  "server" | "supervisor" | "command" | "user" | "assistant";
interface ITranscriptEntry {
  readonly seq: number; // monotone : un lecteur reprend « depuis seq N », même après éviction
  readonly source: TranscriptSource;
  readonly stream: "out" | "err";
  readonly text: string; // UNE ligne logique, assainie, bornée (16 Kio, tronquée avec marque)
  readonly at: number; // Date.now() à la réception
  readonly run?: number; // relie `❯ status` (source user) à sa sortie (source command)
}
// push(…) · at(i) · since(seq) → entrées postérieures · bytes / length
```

- **Deux plafonds** : 10 000 entrées ET **8 Mio de mémoire** — le second est celui qui compte
  (10 000 × 16 Kio feraient 160 Mio). Éviction par la tête tant que l'un est dépassé. La mémoire
  se compte par entrée (`devTranscript.ts#transcriptEntryCost`) : une surcharge fixe (objet, chaîne,
  case) plus un octet par caractère, deux dès qu'une ligne sort de l'ASCII — compter les octets
  UTF-8 du texte seul laissait passer huit fois le plafond sur des lignes courtes.

**Amendement #903 (D1, D4) — un anneau PAR CANAL, le canal remplace la source fermée.**

- Le canal est un identifiant OUVERT : `server`, `supervisor`, `vite:<nom>`, `run:<n>` (une
  commande de l'invite, sa ligne `❯` comprise), `agent:<id>`. L'union fermée `TranscriptSource`
  disparaît : un producteur neuf (sous-agent, second serveur Vite) ne rouvre pas le modèle.
- Un `DevTranscript` par canal, créé au premier octet reçu (aucun anneau alloué d'avance). Le
  `seq` reste monotone, mais **GLOBAL** à tous les canaux : `since(seq)` et le fil fusionné de
  `inline` se lisent par fusion des anneaux sur `seq`, et un lecteur reprend sans savoir combien
  de canaux existent. Un `seq` n'est donc plus contigu dans un anneau : `indexOf` passe par
  dichotomie (O(log n)).
- **Plafond par canal ET plafond global de 8 Mio** : une rafale de Vite n'évince jamais la pile
  d'un crash du serveur. Retenu : le plafond global évince dans le canal le plus GROS (parts
  égales, `devHistory.ts#DevHistory`) ; une part pondérée se réglerait au banc, l'invariant non.
- Les canaux sont le modèle de données du SUPERVISEUR, pas de l'écran : le terminal n'en est
  qu'un lecteur ; l'assistant en est un autre (il lit le serveur et Vite, écrit les siens) ; la
  console d'administration et le serveur MCP pourront l'être par le lot à la demande (§6).
- **Un seul anneau dans le dépôt** : `CircularBuffer`, jusque-là interne à `Syslog.ts`, sort
  dans `src/nodefony/src/runtime/` (`src/nodefony/src/runtime/CircularBuffer.ts#CircularBuffer`), ÉTENDU de `at(i)` et `shift()` (O(1), sans
  copie — `toArray()` à chaque image allouerait 10 000 cases soixante fois par seconde). `Syslog`
  le réimporte sans changer d'API.
- **Découpe sur le `Buffer`**, une ligne décodée à la fois (`buf.toString("utf8", a, b)`), avec
  `StringDecoder` pour un caractère coupé entre deux paquets : décoder un paquet entier puis le
  découper produirait des chaînes qui retiennent chacune le paquet parent.
- **Une ligne en cours par couple (source, flux)** — `Object.create(null)`, une dizaine de clés au
  plus : le serveur et l'assistant écrivent des fragments en même temps. `\r` réinitialise la
  ligne en cours (un spinner réécrit sa ligne, il n'empile pas cent entrées).
- **Assainissement de TOUTE source** (serveur, commande, modèle) et des chaînes de la barre.
  Gardés : couleurs (SGR), `\r`, effacement de ligne, hyperliens OSC 8 dont l'URL est `http`,
  `https` ou `file` (le serveur en émet, `#hyperlinks` à `BootReporter.ts#BootReporter.#hyperlinks`). Retiré : tout le reste —
  déplacement de curseur, titre de fenêtre, presse-papiers OSC 52, changement d'écran. Rendu ET
  sécurité : une ligne de journal ne pilote pas le terminal du développeur.
- **L'effacement d'écran a un sens** : `ESC[2J` (`CLEAR_SCREEN`, écrit par le serveur au boot,
  `supervisorLink.ts#SupervisorLink.prepareDevScreen`, et au `ready`, `BootReporter.ts#IFrontendReadyPayload.ready`) n'est pas relayé brut ; il devient
  `DevTerminal.clear()` — retour au direct et séparateur en plein écran, `CLEAR_SCREEN` réémis
  dans le repli. La « page propre » de #533 survit.

```typescript
// inputDecoder.ts — octets → évènements, TOUTES les touches dès le premier jour
type InputEvent =
  | { kind: "text"; text: string } // frappe ordinaire, UTF-8 recomposé
  | { kind: "key"; key: Key; ctrl: boolean; alt: boolean; shift: boolean }
  | { kind: "paste"; text: string } // collage entre crochets, UN évènement
  | { kind: "wheel"; direction: "up" | "down"; column: number; row: number }
  | {
      kind: "report";
      report: "cursor-position" | "mode";
      values: readonly number[];
    } // réponses de sonde
  | { kind: "unknown"; bytes: string };
// feed(chunk) → InputEvent[] ; flush() pour un Échap isolé (délai ~50 ms : ESC seul ≠ début de séquence)
// un collage qui CONTIENT `ESC[201~` est tronqué là, jamais réinterprété
```

```typescript
// devFrame.ts — l'image, à trois zones fixes
interface IFrame {
  readonly lines: readonly string[];
  readonly cursor: { row: number; column: number } | null; // null tant qu'il n'y a pas d'invite
}
// renderFrame(model, { columns, rows }) → IFrame ; diffFrame(previous, next) → lignes à réécrire
// zones : journal (fenêtre + « ↑ N nouvelles lignes — Fin ») · invite (hauteur 0 avant #538) · barre
// hauteur repliée de chaque entrée mémoïsée par largeur, invalidée au redimensionnement
```

**Amendement #903** : les trois zones fixes deviennent une liste de RÉGIONS rendue par une
fonction pure (§11). Le cache de repli porte les LIGNES repliées, plus seulement leur hauteur —
c'est ce qui permet de comparer une ligne inchangée par identité (§9).

```typescript
// terminalCapability.ts — le verdict, constaté, transmis
interface ITerminalVerdict {
  readonly columns: number;
  readonly rows: number;
  readonly colorDepth: 1 | 4 | 8 | 24;
  readonly charset: ScreenCharset; // startupScreen.ts, règle du logo (cli/brand.ts)
  readonly input: boolean; // false pour le serveur : il ne lit jamais le clavier
  readonly fullscreen: boolean; // le terminal a répondu à la position du curseur
  readonly synchronized: boolean; // DECRQM a vu le mode 2026
}
```

### 4. Les touches vont à un FOYER

Le décodeur alimente une chaîne de foyers ; le premier qui consomme l'évènement l'arrête.

```typescript
interface IInputFocus {
  handle(event: InputEvent): boolean; // true = consommé
}
```

#537 pose trois foyers : **souris** quand elle est captée (sélection, Échap l'efface),
**défilement** (molette, flèches, PgUp/PgDn, Début, Fin) et **global** (Ctrl+C, Ctrl+D ⇒ arrêt
propre). #538 insère l'**invite** en tête. ↑↓ restent au défilement — sans capture, la molette
ARRIVE en ↑↓, et la confier à l'historique de l'invite rejouerait des commandes à chaque cran ;
l'historique de l'invite prend Ctrl+P / Ctrl+N, et l'aide le dit. La chaîne est atteignable hors clavier
(`DevTerminal.dispatch`) : une entrée venue d'ailleurs, plus tard, y entre sans rien rouvrir.

### 5. Une classe compose le tout : `DevTerminal`

Côté superviseur. `DevSupervisor` (déjà 1 664 lignes) lui délègue au lieu de grossir.

```typescript
type DevPhase = "booting" | "building" | "ready" | "restarting" | "crashed";
class DevTerminal {
  ingest(
    source: TranscriptSource,
    stream: "out" | "err",
    chunk: Buffer | string,
    run?: number,
  ): void;
  setStatus(
    view: IStartupView | null,
    context: IStatusContext,
    phase: DevPhase,
  ): void;
  addFocus(focus: IInputFocus): void; // #538 y branche l'invite
  dispatch(event: InputEvent): void; // la chaîne de foyers
  since(seq: number): readonly ITranscriptEntry[];
  clear(): void; // sens de ESC[2J
  suspend<T>(task: () => Promise<T>): Promise<T>; // rend le terminal à un sous-processus, puis le reprend
  close(): void; // restauration, idempotente
}
```

- **La phase appartient au superviseur.** La barre survit désormais au serveur : pendant un build,
  un redémarrage ou après un crash, c'est lui qui sait quoi afficher. `view` est `null` quand le
  serveur n'a rien dit.
- **`suspend`** : l'ingestion continue (borné par l'anneau), le rendu s'arrête, le terminal repasse
  en mode cuit. Un `SIGINT` reçu pendant `suspend` interrompt la commande, jamais le superviseur.
- **`close`** s'appuie sur le protocole de sortie déjà porté par `src/nodefony/src/cli/progress.ts`
  (n'agir que si seul écouteur, se retirer, réémettre par `process.kill`, jamais `process.exit`),
  extrait dans `src/nodefony/src/runtime/` et partagé. Jamais un second protocole sur les mêmes
  signaux : l'un gagnerait, l'autre laisserait un terminal cassé.

**Amendement #903 — la surface de `DevTerminal` suit les canaux et les vues (§11).**

```typescript
class DevTerminal {
  ingestBytes(channel: string, stream: "out" | "err", chunk: Buffer): void; // octets d'un enfant
  appendText(channel: string, text: string, stream?: "out" | "err"): void; // producteur interne (jetons du modèle)
  addView(view: IDevView): void; // une vue de la zone centrale (onglet ou volet)
  openBand(band: IDevBand): () => void; // bande modale ; rend sa fermeture
  setStatus(
    view: IStartupView | null,
    context: IStatusContext,
    phase: DevPhase,
  ): void;
  addFocus(focus: IInputFocus): void;
  dispatch(event: InputEvent): void;
  since(seq: number): readonly ITranscriptEntry[]; // fil fusionné, tous canaux
  clear(): void;
  suspend<T>(task: () => Promise<T>): Promise<T>;
  close(): void;
}
```

- **Deux portes d'ingestion, parce que deux natures de données.** `ingestBytes` découpe sur le
  `Buffer` et décode une ligne à la fois (§3) — ce que l'ingestion actuelle ne fait pas : elle
  décode le paquet entier, puis l'historique refait un aller-retour `Buffer.from` / `toString`
  par ligne. `appendText` reçoit des chaînes déjà décodées (jetons d'un modèle) et ne les
  ré-encode pas. Chacune tient UNE ligne en cours par (canal, flux), affichée par les vues, et
  replie incrémentalement la seule dernière ligne : un flux de jetons ne repaie pas le repli de
  toute la ligne à chaque jeton.
- **`suspend` reste dû** : prévu dès la première version de ce paragraphe, il n'est toujours pas
  implémenté. Il arrive avec #538, qui en est le premier consommateur.
- **Une mutation marque sa région** (§11), elle ne programme pas une image complète : `setStatus`
  → la barre ; une ingestion → les vues qui montrent ce canal ; une frappe → l'invite.

### 6. Le canal IPC reste le seul contrat superviseur ⇄ serveur

`src/nodefony/src/service/dev/devChannel.ts`, union discriminée. Il gagne :

```typescript
interface IDevStatusView {
  channel: "nf-dev";
  type: "status-view";
  view: IStartupView;
  context: IStatusContext;
} // serveur → superviseur
interface IDevResize {
  channel: "nf-dev";
  type: "resize";
  columns: number;
  rows: number;
} // superviseur → serveur
```

- **Aucun type neuf pour la barre** : `IStartupView` (`startupScreen.ts#IStartupView`) est déjà un objet
  plat (le rendu `json` le sérialise), consommé tel quel par `renderStatusBlock` /
  `renderStatusLine` avec `IStatusContext`.
- **Le redimensionnement** : `terminalSize()` lit le verdict au boot puis le dernier `resize` reçu ;
  l'écoute s'installe à la porte, dans le cœur.
- Il perd `status` et `status-erased`.
- **Les lignes du journal ne passent jamais par l'IPC au fil de l'eau** (un JSON par ligne
  coûterait) : elles empruntent les tubes. Un **lot borné à la demande** (`transcript-request` /
  `transcript-batch`, servi par `since(seq)`) reste un membre légitime de l'union, le jour où la
  console d'administration ou un agent lira l'historique par le plan d'administration.
- ~~**Ni l'invite ni l'assistant n'ajoutent de message**~~ — **Amendement #903 (#538)** :
  l'assistant n'en ajoute toujours aucun (il parle à l'application par son serveur MCP), mais
  l'INVITE ajoute une paire requête / résultat et une annulation, pour lire l'état vivant du
  serveur en mémoire (§7) :

```typescript
interface IDevCommandRequest {
  channel: "nf-dev";
  type: "command-request";
  id: number;
  name: string;
  args: readonly string[];
  columns: number;
} // superviseur → serveur
interface IDevCommandResult {
  channel: "nf-dev";
  type: "command-result";
  id: number;
  result: ICommandResult; // borné : au-delà, refus explicite, jamais une troncature muette
} // serveur → superviseur
interface IDevCommandCancel {
  channel: "nf-dev";
  type: "command-cancel";
  id: number;
} // superviseur → serveur
```

- Un consommateur UNIQUE côté serveur, aiguillé dans `supervisorLink.ts#SupervisorLink.listen`,
  installé après `onPostReady`, sous l'identité de l'opérateur local. Un flux (`command-chunk`)
  ne s'ajoute qu'au second lot, si une commande `live` le demande.
- Repli par phase : serveur en build ou en démarrage → attente bornée et annulable ; enfant mort
  → requêtes en vol rejetées ; `crashed` → la voie sous-processus (§7).
- Les LIGNES du journal ne passent toujours pas par l'IPC : la règle ci-dessus tient.
- **Services portés par le superviseur (#692)** : le canal gagne `held-plan` (serveur →
  superviseur, l'état voulu des services d'un propriétaire), `held-plan-ack` et `held-state`
  (superviseur → serveur). Contrat, remparts et branchement d'un backend d'inférence :
  [ADR-0030](0030-services-portes-par-le-superviseur.md).

### 7. Une action d'invite — le contrat que partagent commandes et assistant

Posé par #538, figé ici pour que #539 ne le rouvre pas.

```typescript
interface IPromptAction {
  readonly id: string;
  matches(input: string): boolean;
  complete?(prefix: string): readonly string[] | Promise<readonly string[]>;
  run(input: string, io: IPromptIO, signal: AbortSignal): Promise<number>; // code de sortie
}
interface IPromptIO {
  write(text: string, stream?: "out" | "err"): void; // vers l'historique, au fil de l'eau (jeton par jeton)
  confirm(request: IConfirmRequest): Promise<IConfirmDecision>;
  suspend<T>(task: () => Promise<T>): Promise<T>; // une commande interactive prend le terminal
  readonly columns: number;
}
interface IConfirmRequest {
  readonly title: string;
  readonly detail?: string;
  readonly action?: {
    tool: string;
    arguments: Readonly<Record<string, unknown>>;
  };
  readonly risk: "read" | "write" | "destructive";
}
interface IConfirmDecision {
  readonly action: "accept" | "decline" | "cancel"; // même triplet que l'elicitation MCP
  readonly id: string;
  readonly at: number;
}
```

- `decline` est rendu au modèle ; `cancel` arrête le tour. Une approbation ne vaut que pour
  l'appel qu'elle accompagne, jamais « pour la session ».
- Implémentations : **verbes du superviseur** (`restart`, `clear`, `help`, `quit`) et **commandes
  du CLI** (`nodefony <cmd>` en sous-processus, complétion par `readCliManifest` /
  `computeCompletions`, `src/nodefony/src/cli/completion.ts#readCliManifest` et `src/nodefony/src/cli/completion.ts#computeCompletions`) en #538 ;
  **assistant** en #539.

**Amendement #903 (#538) — trois voies d'exécution, routées par une capacité DÉCLARÉE.**
`IPromptAction` et `IPromptIO` ne bougent pas ; ce qui change, c'est la seule phrase « `nodefony
<cmd>` en sous-processus ». Mesuré : `npx nodefony inspect routes --json` prend 3,1 s (médiane de
5 runs ; `--version` seul : 0,6 s). Le sous-processus ne peut être que le REPLI.

| Voie                                | Pour                                                                                                          | Comment                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| IPC → noyau du serveur (en mémoire) | lectures de l'état vivant : `/routes`, `inspect <sujet>`, puis d'autres par extraction d'un producteur pur    | `command-request` (§6) ; `src/nodefony/src/kernel/inspect/adminSubjects.ts#readAdminSubject` est déjà pur et sérialisable      |
| Dans le superviseur                 | verbes (`restart`, `clear`, `help`, `quit`, `status` depuis l'état qu'il tient), menu `/nodefony`, complétion | modèle pur du menu `src/nodefony/src/cli/startMenu.ts#buildStartMenu`, rendu en bande (§11) ; complétion sur `readCliManifest` |
| Sous-processus (repli universel)    | écrit ou génère, long ou lourd, interactif (terminal cédé par `suspend`), serveur absent ou en crash          | tubes vers un canal `run:<n>` ; `AbortSignal` → arbre tué par `devProcess.ts#signalProcessGroup`                               |

- **La voie se déclare** : `execution: "live" | "local" | "process"` dans les options de
  commande (défaut `process`), publié dans le manifeste des commandes. Le superviseur route sans
  interroger le serveur, même mort.
- **Une commande `live` fournit `query(args, ctx) → ICommandResult`** (`{ ok, code, data,
render? }`, calqué sur le résultat de `inspect`) : ni sortie standard, ni `terminate`, ni
  `process.exitCode`. Son `generate()` devient `render(await query())` puis `terminate` — la CLI
  reste identique.
- **Jamais `Command.generate()` dans le serveur vivant.** Les bloqueurs sont ceux du CADRE, pas
  du calcul : `terminate()` tuerait le serveur (`src/nodefony/src/kernel/commands/InspectCommand.ts#Inspect.generate`),
  `process.exitCode` est global, `kernel.command` est écrasé (`src/nodefony/src/command/Command.ts#Command.run`),
  la sortie va sur `process.stdout`, `process.argv` est partagé, l'exécution s'accroche à une
  phase de boot déjà passée.
- **Le superviseur ne sert pas ces lectures lui-même** : son noyau est parqué avant le chargement
  des modules (`src/nodefony/src/kernel/commands/DevCommand.ts#Dev.onKernelStart`) — ni modules,
  ni conteneur.
- **Le cycle de vie n'est jamais lancé depuis l'invite** (`development`, `stop`, `production`…) :
  il tuerait le superviseur ou son serveur. Le refus nomme le verbe équivalent ; la liste dérive
  de la déclaration des commandes, jamais d'une liste écrite à la main.
- **`confirm` et la complétion s'affichent en bande** (§11), pas par une bibliothèque d'invite
  qui prendrait l'entrée et la sortie standard.

### 8. L'assistant : un client de l'application, jamais un passe-droit

- **Inférence** : `@nodefony/llm`, backend externe supervisé —
  [ADR-0004](0004-inference-llm-backend-supervise.md), jamais dans le processus du superviseur.
  `OllamaProvider` ne transmet aujourd'hui aucun outil et ne diffuse que des jetons : #539 dépend
  de l'audit d'état de l'art ([#245](https://github.com/nodefony/nodefony-core/issues/245)) et
  d'un fournisseur réel ([#246](https://github.com/nodefony/nodefony-core/issues/246)).
- **Boucle d'outils** : `@nodefony/agent` (`IAgent.stream()` → évènements jeton / appel d'outil /
  résultat) consommé comme **bibliothèque** — jamais une boucle propre au superviseur, qui
  deviendrait un second moteur d'agent. Le **foyer** de la boucle est tranché par #245, sur ce
  compromis : dans le superviseur (hôte), la conversation survit aux rechargements que l'agent
  provoque lui-même (auto-développement, livre blanc §6.6), mais sans conteneur, sans syslog ni
  RBAC propres ; dans le serveur, tout cela existe, mais l'état meurt à chaque rechargement.
- **Outils** : ceux du serveur MCP de l'application (`POST /nodefony/mcp`,
  `src/packages/@nodefony/devkit/nodefony/controllers/McpController.ts#McpController.mcp`) — les MÊMES qu'un
  agent externe, soumis au même RBAC. Aucun outil propre à l'invite.
- **Confirmation** : pour tout outil dont `annotations.readOnlyHint !== true`. Ce champ, la
  définition d'outil du dépôt (`IMcpTool`, `src/nodefony/src/types/IMcpTool.ts#IMcpTool`) ne le porte
  PAS encore — `rg -c readOnlyHint src/nodefony/src` ne rend rien :
  [#540](https://github.com/nodefony/nodefony-core/issues/540) l'ajoute et l'émet dans
  `tools/list` AVANT #539 — sans lui, les défauts de la spécification rendent tout outil
  destructif. Les annotations d'un serveur local de l'application sont tenues pour fiables ;
  celles d'un serveur tiers, non.
- **Audit** : l'`id` de la décision voyage dans `tools/call._meta` ; c'est le SERVEUR qui
  journalise l'appel et la décision (syslog, RBAC) — une piste d'audit, un seul endroit.
- **Contexte** : d'abord les journaux STRUCTURÉS et déjà expurgés des secrets, par le plan
  d'administration (`logs/search`, `src/packages/@nodefony/framework/nodefony/src/SyslogAdminApi.ts#createSyslogAdminApi`) ;
  ensuite l'historique de l'écran, réduit aux sources `user` / `command` / `assistant` et à N
  lignes du serveur, borné. L'écran brut ne passe par aucun gestionnaire qui expurge.
- **Souveraineté** (livre blanc §3.1) : aucun envoi de contexte à un fournisseur `mode: "cloud"`
  sans confirmation explicite.
- **Garde-fous chiffrés** du livre blanc (§3.4) : plafonds de jetons et de durée, annulation par
  Ctrl+C (`AbortSignal`).

**Amendement #903 (D6, D7).**

- **D7 — foyer pressenti : le superviseur.** Le compromis ci-dessus reste tranché par #245, mais
  l'orientation est fixée : l'agent de développement vivra vraisemblablement dans le superviseur,
  hôte qui survit aux rechargements. Rien dans le socle (§11) ne doit lui fermer la porte : ses
  flux sont des canaux `agent:<id>`, sa conversation une vue, ses confirmations une bande.
- **D6 — une boucle d'événements partagée.** Relais des enfants, rendu, flux du modèle et outils
  de l'agent tourneront sur la MÊME boucle. Le rendu y est donc un invité borné : régions sales
  seulement, image sautée quand le terminal ne suit pas (§9). Un worker de rendu n'est envisagé
  que si le banc de #896 le montre nécessaire.

### 9. Rendu borné, terminal toujours rendu propre

- Images regroupées (au plus une toutes les 16 ms), dessin différentiel, sortie synchronisée
  (`ESC[?2026h` … `l`) quand la sonde l'a vue. Remonté dans le journal, une rafale de lignes ne
  redessine que l'indicateur.
- **Une image = UNE écriture** sur le flux, curseur masqué pendant le dessin puis replacé (sur
  l'invite quand elle existe) : jamais d'image à moitié peinte entre deux appels système.
- **La largeur se compte en colonnes, pas en caractères** : un émoji ou un idéogramme occupe deux
  colonnes, un accent combiné zéro. `fitStatus` (`statusLine.ts`) compte aujourd'hui des unités
  de code — une ligne d'émojis s'y replie, et un effacement « en remontant » rate alors sa cible.
  Une fonction unique de largeur visible (graphèmes par `Intl.Segmenter`, table des caractères
  larges, séquences de contrôle exclues) sert la barre, le repli à la largeur et le curseur de
  l'invite.
- **Redimensionnement** : regroupé comme une image, il invalide les hauteurs mémoïsées et redessine
  tout ; la fenêtre reste ancrée sur la même entrée (`seq`), pas sur le même numéro de ligne.
- Tout mode posé à l'entrée est coupé à la sortie — souris comprise, et même s'il n'a pas été
  posé : couper un mode absent est sans effet, en oublier un laisse le shell recevoir des
  séquences à chaque clic.
- Restauration sur TOUS les chemins — sortie normale, `SIGINT`/`SIGTERM`/`SIGHUP`,
  `uncaughtException`, `exit` — par le protocole unique (§5). Seul `kill -9` laisse un terminal à
  `reset` : c'est la raison d'être de la surface `inline`.
- Le verdict de crash du serveur s'arme sur l'évènement `close` de l'enfant (émis après la fin de
  ses flux), plus sur `exit` (`onProcessEnded`, `devProcess.ts#onProcessEnded`, partagé avec les hôtes portés) : sinon la pile d'un crash
  au démarrage arrive après le message, ou se perd.

**Amendement #903 (D2, D6) — différencier par segment, défiler par le terminal, sauter une
image.**

- **Diff par SEGMENT de ligne** : (ligne, colonne, texte rembourré à la largeur de la région).
  `ESC[K` n'est émis que si la région touche le bord droit ; à côté d'un volet voisin, le
  rembourrage par espaces le remplace. Une ligne inchangée se compare par IDENTITÉ de chaîne,
  grâce au cache de repli (§3), sans la reconstruire.
- **Défilement confié au terminal en rafale** : quand le journal est au direct et que N lignes
  arrivent, la région du journal défile de N lignes par `SU` (`CSI N S`) et seules les lignes
  neuves s'écrivent, au lieu de réécrire tout l'écran à chaque image. `SU` agit sur la zone de
  défilement : la région du journal y est bornée par `DECSTBM` (`CSI haut;bas r`), en plein écran
  SEULEMENT — l'écran alternatif n'a pas d'historique à vider, ce qui lève l'objection de #533
  (voir « Alternatives écartées »). Les marges sont remises (`CSI r`) à chaque image qui ne
  défile pas, et à la sortie par le protocole unique.
- **Livré à l'étape 6** (`devFrame.ts#diffFrameScrolled`) : le décalage se lit sur les origines
  (`seq`, colonne) de la ligne du haut, dans les deux sens — `SU` quand des lignes arrivent en
  direct, `SD` (`CSI N T`) quand on remonte d'une ligne. Le diff compare ensuite chaque ligne à
  ce que l'écran montre APRÈS le défilement : le choix du décalage ne joue que sur le coût, jamais
  sur l'exactitude, et il n'est retenu que s'il réécrit moins de lignes que sans lui. Attributs
  remis (`CSI 0 m`) avant `SU`, pour que les lignes libérées prennent le fond par défaut ; marges
  posées et remises DANS la même écriture, donc aucun état laissé au terminal entre deux images.
  Le mode se choisit par `paint` (`"scroll"` par défaut, `"diff"`, `"full"` pour le garde-fou
  ConPTY de D3). Mesuré au banc de #896 (rafale de 4 lignes par image, 7 tours entrelacés) :
  3 300 → 439 octets par image, temps d'image −14 à −16 %. Le même scénario rejoué en `scroll` et
  en `diff` donne le même écran xterm.js à chaque image (`devTerminalFullscreen.test.ts`).
- **Limite constatée de la norme** : `DECSTBM` ne borne que des lignes. Deux volets CÔTE À CÔTE
  exigeraient des marges gauche/droite (`DECSLRM`, sous le mode `DECLRMM`), dont la prise en
  charge par les terminaux visés n'est pas relevée. Tant qu'elle ne l'est pas, des volets côte à
  côte se différencient par segment, sans `SU` ; des volets EMPILÉS gardent `SU`.
- **Diff par cellule** (`Uint32Array`, double tampon — le patron de ratatui, bubbletea v2,
  notcurses) : gardé SEULEMENT s'il gagne en A/B sur le banc de #896, petite charge comprise.
- **Image sautée sous contre-pression** : quand `write` rend `false`, aucune image ne part avant
  `drain` ; les mutations continuent de marquer leurs régions, et l'image suivante les rend
  toutes. Un seul écouteur `drain` en vol, retiré à `close`. C'est ce qui garde le relais des
  enfants et l'agent (D6) vivants sous SSH ou sous Windows. Livré à l'étape 6
  (`DevTerminal.ts#DevTerminal.#drawFrame`) : l'image qui remplit le tampon part quand même (le
  diff suivant se compare à elle), puis `#scheduleFrame` ne programme plus rien jusqu'à `drain`.
  L'image d'après se calcule depuis le modèle, donc elle rend tout ce qui a changé entre-temps,
  sans file d'attente. Un flux sans `once` (un test) ne retient jamais d'image.
- **Régions sales** (§11) : une image ne recalcule que les régions marquées. Une graduation de la
  barre ne replie pas le journal ; une touche sans effet ne rebâtit rien. **Mesuré à l'étape 7,
  non retenu pour le journal** : sur le banc de #896, une graduation de la barre coûtait 241 µs,
  dont ~6 % hors de la barre (journal compris, ~13 µs) — le repli du journal est déjà en cache
  par vue. Ce qui coûtait, c'était la barre elle-même : elle se recompose à chaque graduation (ses
  chiffres changent) et remesurait toutes ses lignes. La région sale s'applique donc À LA LIGNE de
  la barre (`devFrame.ts#StatusBarCache.fittedLine`) : une ligne recomposée à l'identique, à la
  même largeur, reprend sa version bornée sans être remesurée — le filet et la marque, presque
  tout en non-ASCII, ne repassent plus par le segmenteur. Graduation −53 % (A/B entrelacé, 5
  manches), octets inchangés.
- **Largeur** : la fonction unique de largeur reste la seule règle, mais compte d'abord le
  préfixe ASCII sans segmenteur et saute les séquences de contrôle sans allouer ; le découpage
  en graphèmes ne sert qu'au-delà. Gardé seulement si le banc de #896 le montre. **Livré à
  l'étape 7** (`textWidth.ts#runWidth`) : dans une tranche mêlée, l'ASCII imprimable compte une
  colonne sans segmenteur et seuls les morceaux non ASCII sont découpés — chacun avec l'ASCII qui
  le suit, car un caractère préfixe (Unicode `Prepend`) s'y soude. Même résultat que le découpage
  entier, prouvé sur 20 000 textes tirés d'un alphabet piégé. Image d'une rafale −17 % à −26 %.

### 10. Hors du rendu humain, rien ne change

`plain` (agent sans terminal), `json`, `--debug`, production : ni plein écran, ni invite, ni
transit de la sortie. `--no-watch` : pas de superviseur, le serveur dessine sa barre comme
aujourd'hui (§1).

### 11. Zone centrale à plusieurs vues (amendement #903)

Le socle sur lequel Vite (#692), l'invite (#538) et l'assistant (#539) se branchent — posé
AVANT eux, pour ne pas être repris.

**Canaux, vues, régions — trois niveaux, trois responsabilités.**

| Niveau | Ce qu'il porte                                                                     | Qui le possède                                        |
| ------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Canal  | un anneau `DevTranscript`, un `seq` global, une ligne en cours par flux (§3)       | le superviseur — lu par le terminal, l'agent, Studio  |
| Vue    | { canaux, ancre, cache de repli, sélection, rendu de la ligne en cours } — légère  | le terminal ; deux vues peuvent montrer le même canal |
| Région | un rectangle de l'écran (ligne, colonne, largeur, hauteur) et son drapeau « sale » | la mise en page, recalculée à la taille ou à l'état   |

**Direction de travail — non figée, validée sur pièce au fil du développement** (maquette vue
par l'auteur, décisions N1 à N8 au ticket #903). L'écran partagé de la première version de ce
paragraphe est abandonné : **un onglet occupe TOUTE la zone centrale**, changer d'onglet la
remplace entière.

**Mise en page** : une fonction PURE `layout(taille, état) → régions`
(`src/nodefony/src/service/dev/devLayout.ts#layout`), rendant une liste PLATE de rectangles :
vue (la zone centrale), onglets (1 ligne), bande (menu, complétion, confirmation ; hauteur 0 si
absente, un tiers de l'écran au plus), invite, barre. Les onglets vivent **en bas, collés à
l'invite** : onglet actif, bande et invite forment un bloc — on voit à qui on parle. Quand la
hauteur manque, la priorité part du bas : barre, invite, bande, onglets ; la vue prend le reste.
Sans onglets ni bande, la mise en page rend exactement les trois zones d'aujourd'hui : c'est la
preuve d'équivalence de la refonte.

**Une vue lit UN OU PLUSIEURS canaux** (validé à l'étape 2) : ils sont fusionnés dans l'ordre des
numéros, sans copie (`src/nodefony/src/service/dev/devHistory.ts#MergedTranscript`), et un canal
ouvert plus tard entre de lui-même dans la vue qui le retient. La vue unique d'avant les onglets
lit tous les canaux — l'écran reste identique à l'octet près ; les onglets la scindent ensuite
(serveur : `server` + `supervisor` ; vite : `vite:*`).

**Une invite par onglet** : son préfixe, son brouillon, son historique, son menu ; changer
d'onglet garde le brouillon. Le résultat d'une commande s'affiche dans l'onglet où elle a été
tapée. **Plusieurs fenêtres ne vivent que DANS un onglet** : la vue reçoit son rectangle et des
coordonnées locales, et le découpe comme elle veut (un onglet de supervision à graphes) ; le
layout principal n'en sait rien. **Les onglets se créent et se détruisent à la volée** (un
sous-agent ouvre le sien) : `addView` rend sa poignée — `close`, qui libère aussi l'historique du
canal, et `finish`, qui marque l'issue ✓ / ✗ jusqu'à la fermeture.

**Trois contrats de branchement**, dans `src/nodefony/src/service/dev/` :

```typescript
interface IDevView {
  readonly id: string;
  readonly title: string; // l'onglet
  readonly channel: string;
  render(rect: IRegion): IViewFrame; // segments + origines (entrée, colonne) de chaque ligne
  handle?(event: InputEvent): boolean; // foyer local, coordonnées de la région
}
// addView(spec) rend sa poignée { finish, close } : qui crée l'onglet le détruit.
interface IDevBand {
  height(width: number): number; // lignes demandées à cette largeur, bornées par la mise en page
  render(rect: IRegion): readonly string[];
  handle(event: InputEvent): boolean; // modale : consomme tout ce qu'elle ne rend pas
}
// l'invite = une bande PERMANENTE : éditeur pur (tampon, curseur compté en graphèmes par la
// fonction de largeur, historique Ctrl+P / Ctrl+N)
```

- **Souris** : le test de région passe AVANT la chaîne de foyers (§4), et l'évènement arrive à
  la région en coordonnées LOCALES. Un clic ne traverse pas une bande ; un clic sur un onglet
  l'active — sélection et origines descendent dans la vue.
- **Défilement** : par vue, gardé quand on change d'onglet. Il lit la hauteur de la vue dans la
  mise en page mémorisée, sans rebâtir le modèle ; une touche qui ne défile pas ne coûte rien.
- **Changer d'onglet** : clic, `Alt+1` à `Alt+9` (`Ctrl+Tab` n'est pas transmis par la plupart
  des terminaux). Un onglet caché qui reçoit des lignes porte un compteur, rouge sur une erreur.
  `Alt` n'arrive que si le terminal envoie Échap pour Option — sous macOS, iTerm2 « Option = Esc+ »,
  Terminal.app « Utiliser Option comme touche méta », le terminal de VS Code
  `"terminal.integrated.macOptionIsMeta": true` ; le clic marche sans réglage (`--mouse`). Sur
  un clavier AZERTY, le chiffre exige Maj : le geste est Maj+Option+1 (l'aide le dit), et le
  terminal envoie bien `ESC 1`.
- **Onglets livrés à l'étape 3** : un onglet est une DONNÉE (`devView.ts#DevView` : son filtre de
  canaux, sa position de lecture, sa page propre, son cache de repli, ce qu'il n'a pas montré),
  jamais une sous-classe. `serveur` est le complément de `vite` (`vite:*`) : aucun canal ne reste
  sans onglet. La ligne d'onglets n'apparaît que quand un second onglet a quelque chose à montrer —
  sans Vite, l'écran reste celui d'une seule vue. La page propre d'`ESC[2J` et l'indicateur du
  superviseur restent dans l'onglet `serveur` ; changer d'onglet efface la sélection.
- **Onglets à la volée livrés à l'étape 4** (`DevTerminal.ts#DevTerminal.addView`) : un onglet
  ouvert par un producteur paraît dès l'ouverture, même vide, et prend ses canaux à `serveur`,
  devenu le complément de TOUS les autres onglets. Sa poignée rend `finish` (✓ / ✗ après le
  titre) et `close` (retour à `serveur` s'il était à l'écran, historique de ses canaux libéré).
  Une poignée plutôt que la seule fermeture : l'issue appartient à qui a ouvert l'onglet, sans
  chercher l'onglet par son identifiant. Trop d'onglets pour la largeur : une fenêtre autour de
  l'actif, bordée de `‹ +3` / `+2 ›` — un clic sur la marque montre le voisin caché, et la
  marque passe au gras ou au rouge quand un onglet qu'elle cache a reçu des lignes ou une erreur.
- **Bande livrée à l'étape 4** (`devBand.ts#IDevBand`, `DevTerminal.ts#DevTerminal.openBand`) :
  entre la ligne d'onglets et l'invite, de la hauteur qu'elle demande À CETTE LARGEUR (une bande
  se replie sur un écran étroit), bornée à un tiers de l'écran, complétée ou coupée à la hauteur
  donnée — le journal ne bouge pas d'une image à l'autre. La dernière ouverte reçoit le clavier
  avant le défilement ; ce qu'elle rend (`false`) continue la chaîne ; Ctrl+C et Ctrl+D ne lui
  parviennent jamais. La souris ne lui arrive que sur son rectangle, en coordonnées locales, et
  s'y arrête ; hors d'elle, elle atteint la vue. Premier usage : l'aide des gestes (`?` ou F1 ;
  `?`, `q`, Échap ou F1 la referment), qui laisse passer défilement et Alt+N. Avec l'invite
  (#538), `?` deviendra une frappe : F1 reste.
- **Régions sales** : chaque mutateur marque la sienne (§5) ; l'image ne rend que celles-là
  (§9).

**Matrice de défilement — chaque case est un scénario rejoué sur l'écran obtenu.** Banc sous
pseudo-terminal (`script`) et `@xterm/headless`, celui des Conséquences :

| Scénario                           | Ce qui doit tenir                                 |
| ---------------------------------- | ------------------------------------------------- |
| molette captée, et traduite (1007) | trois lignes par cran dans les deux régimes       |
| PgUp / PgDn / Début / Fin          | une page = la hauteur de la vue, pas de l'écran   |
| rafale pendant qu'on est remonté   | l'ancre (`seq`) ne bouge pas, l'indicateur compte |
| redimensionnement remonté          | même entrée en haut de la vue                     |
| glisser au bord                    | défile la vue qui porte la sélection              |
| crash pendant qu'on est remonté    | la pile reste lisible au retour au direct         |
| deux onglets défilés puis basculés | chacun retrouve sa position et son brouillon      |
| retour au direct                   | l'indicateur disparaît, `SU` reprend              |

Essais à la main, avec liste de contrôle : iTerm2, Terminal.app, tmux ; Windows Terminal à part.

## Conséquences

- Le serveur n'a plus de code de terminal partagé ; un seul écrivain rend l'écran prévisible.
- L'historique de l'écran devient une donnée : affichable, défilable, lisible par un modèle,
  publiable plus tard par lot à la demande.
- Le superviseur gagne une responsabilité (le terminal), isolée dans `DevTerminal`.
- Coût mémoire en développement : 8 Mio au plus pour l'historique.
- Souris captée, la copie lance un outil du système (`pbcopy`, `xclip`…) par sélection, avec un
  délai de 2 s ; aucun en rafale pendant le glisser. Le prix pour l'utilisateur : clic du milieu
  et menu du clic droit du terminal perdus, Ctrl+molette (zoom) avalé — d'où l'interrupteur dès
  le premier jour, et un défaut laissé au terminal.
- Une capacité de plus à prouver sur trois plateformes. La preuve automatique passe par la
  commande système `script` comme pseudo-terminal — aucun pseudo-terminal en Node pur sans
  dépendance native, et `node-pty` en est une — et par `@xterm/headless` (dépendance de
  développement, hors du paquet publié) comme émulateur qui rend l'écran obtenu. Deux grammaires
  de `script` coexistent (BSD sous macOS, util-linux sous Linux). Le banc vit dans
  `CliIntegration.test.ts`, déclaré comme décor (une absence se dit, elle ne se saute pas en
  silence) et joué sur les jobs Linux et macOS. Windows Terminal se vérifie à la main.
- **Amendement #903** — l'ordre des travaux devient une contrainte : banc et leviers à surface
  constante (#896, preuve d'équivalence ancien / nouveau rendu), PUIS Vite porté par le
  superviseur (#692, sa sortie entre d'abord dans l'historique unique), PUIS socle à plusieurs
  vues (#903, qui la range dans son canal), PUIS l'invite (#538). Chaque étape est prouvée à l'écran sur la matrice
  du §11 ; avec une seule vue, l'écran obtenu est identique à celui d'avant.
- Le plafond mémoire reste 8 Mio au total, quel que soit le nombre de canaux.
- Une seconde dépendance au terminal : `DECSTBM` + `SU` en plein écran. Leur restauration entre
  dans le protocole unique de sortie (§5, §9).

## Normes et antériorités

Le terminal n'a pas de norme d'application : ce qui fait foi, ce sont les séquences (ECMA-48,
la documentation des séquences de xterm, les extensions publiées) et ce que des projets mûrs ont
appris à leurs dépens. Relevé hors ligne : skill `nodefony-rfc`, `references/terminal/`.

| Source                                                                    | Ce que l'ADR reprend                                                   | Où il s'écarte, et pourquoi                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **ECMA-48** (`SU`, `CSI Pn S`) et **DEC** (`DECSTBM`, `DECSLRM`)          | défilement d'une région par le terminal, région bornée par `DECSTBM`   | pas de `DECSLRM` : prise en charge non relevée chez les terminaux visés (§9) |
| **xterm ctlseqs** (modes 1000, 1002, 1006, 1007, 1049, `ESC[6n`, DECRQM)  | souris, défilement alterné, écran alternatif, sonde                    | jamais 1003 ni 1004 (§2)                                                     |
| **Sortie synchronisée** (mode 2026, contour-terminal/vt-extensions)       | une image encadrée quand la sonde l'a vu                               | jamais une condition du plein écran (§2)                                     |
| **Protocole clavier kitty** (`CSI u`, sondé par `CSI ? u`)                | Maj+Entrée (saut de ligne dans l'invite), le jour où #538 le demande   | pas encore décodé (`src/nodefony/src/service/dev/inputDecoder.ts#csiEvent`)  |
| **ratatui, bubbletea v2, opentui, notcurses**, plein écran de Claude Code | double tampon : seul ce qui change part au terminal                    | par segment de ligne d'abord, par cellule seulement si l'A/B gagne (§9)      |
| **Textual**                                                               | régions et segments immuables en cache                                 | liste plate de régions, pas d'arbre de composants                            |
| **Ink**                                                                   | rendu par ligne                                                        | aucune dépendance d'exécution (voir Alternatives)                            |
| **Claude Code sous Windows Terminal (ConPTY)**                            | repeinte complète, les écritures positionnées y laissant des fragments | — (repris tel quel, §2)                                                      |
| **string-width**                                                          | préfixe ASCII compté sans segmenteur, un seul `Intl.Segmenter`         | aucune dépendance : la règle est reprise dans `textWidth.ts`                 |

## Alternatives écartées

| Alternative                                         | Pourquoi non                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zone de défilement `DECSTBM` sur l'écran PRINCIPAL  | historique vidé, non tenue par Windows Terminal, terminal cassé au `kill -9` (essayé en #533). Amendement #903 : l'objection tient pour l'écran principal (`inline`) ; en plein écran, l'écran alternatif n'a pas d'historique, `DECSTBM` y borne la région du journal pour `SU` (§9)                                                                         |
| Un seul historique filtré par source                | `seq` contigus perdus, défilement et sélection uniques : deux vues ne défileraient pas indépendamment ; et un producteur neuf rouvrirait l'union des sources (§3)                                                                                                                                                                                             |
| Un arbre générique de mise en page                  | une liste plate de régions suffit tant que les volets sont peu nombreux ; un arbre s'ajoutera sans changer les contrats de vue et de bande                                                                                                                                                                                                                    |
| Un diff par cellule d'emblée                        | gardé seulement s'il gagne en A/B : le diff par segment comparé par identité peut suffire, à moindre coût mémoire                                                                                                                                                                                                                                             |
| `Command.generate()` dans le serveur vivant         | `terminate()`, `process.exitCode`, `process.stdout`, `process.argv` et `kernel.command` partagés : la commande tuerait ou polluerait le serveur (§7)                                                                                                                                                                                                          |
| L'invite par `POST /nodefony/mcp`                   | URL, TLS, jeton et pipeline HTTP pour une lecture locale ; c'est la voie de l'assistant, pas de l'invite                                                                                                                                                                                                                                                      |
| Un worker de rendu d'emblée                         | une frontière de copie pour un rendu borné qui tient peut-être sur la boucle : seulement si le banc de #896 le montre                                                                                                                                                                                                                                         |
| Invite dans le serveur                              | suspendu par `SIGTTIN` (groupe détaché)                                                                                                                                                                                                                                                                                                                       |
| Sonde par DECRQM du mode 1049                       | extension que des terminaux capables d'écran alternatif n'implémentent pas : le plein écran ne s'allumerait jamais chez eux                                                                                                                                                                                                                                   |
| `node-pty`                                          | dépendance native, compilée par plateforme — non justifiée pour relayer des tubes                                                                                                                                                                                                                                                                             |
| Ink / blessed                                       | Ink embarque React ; blessed n'est plus maintenu ; quelques centaines de lignes maîtrisées valent mieux qu'une dépendance d'exécution                                                                                                                                                                                                                         |
| `node:readline` pour la saisie                      | ne décode ni la molette ni le collage entre crochets ; suppose un flux de sortie à lui                                                                                                                                                                                                                                                                        |
| L'historique comme instance de `Syslog` (des `Pdu`) | l'écran porte la sortie BRUTE du serveur — journal formaté, `console.log`, pile d'un crash, bilan — qui n'a ni sévérité ni module ; la limitation de débit de `Syslog` jetterait une partie d'une rafale ; et le superviseur n'a pas de `Syslog`. Les journaux structurés restent dans `Syslog`, lus par le plan d'administration ; seul l'anneau est partagé |
| Un type `IStatusView` dédié à la barre              | `IStartupView` est déjà plat et sérialisable : un second type dériverait                                                                                                                                                                                                                                                                                      |
| `confirm` booléen                                   | perd qui a décidé, quand, et le refus motivé que l'elicitation MCP distingue de l'annulation ; changer la signature après #538 rouvrirait chaque action                                                                                                                                                                                                       |
| Une boucle d'agent écrite dans le superviseur       | second moteur d'agent à côté de `@nodefony/agent`                                                                                                                                                                                                                                                                                                             |
| Une ligne de journal par message IPC                | un JSON par ligne, quand un tube relaie les octets sans coût                                                                                                                                                                                                                                                                                                  |

## Pour aller plus loin

- [Livre blanc de la couche IA](../ia/livre-blanc-couche-ia.md) — §2.2 invariants, §3 gouvernance, §6.6 auto-développement.
- [ADR-0004](0004-inference-llm-backend-supervise.md) — inférence orchestrée.
- `src/nodefony/src/service/dev/statusLine.ts`, `devChannel.ts`, `startupScreen.ts` — l'existant de #533.
