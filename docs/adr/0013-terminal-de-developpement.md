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

Proposé (2026-10-04), contre-revu avant toute ligne de code. Epic
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

Les faits qui contraignent la solution, au code :

- `src/nodefony/src/service/dev/DevSupervisor.ts:1474` — le serveur est lancé `detached` sous
  POSIX : un groupe en arrière-plan qui LIT le terminal reçoit `SIGTTIN` et est suspendu. Seul le
  superviseur (`DevSupervisor.ts:1657`, il reçoit Ctrl+C) peut lire le clavier.
- `src/nodefony/src/service/dev/DevSupervisor.ts:1134` — `stdio: ["inherit", "inherit", "inherit",
"ipc"]` : le serveur écrit directement dans le terminal.
- `src/nodefony/src/service/dev/DevSupervisor.ts:526` (`#log`) et `:535` (`#startSpin`) — le
  superviseur écrit lui aussi en direct, et anime son spinner de build par `\r`.
- Un terminal ne fige rien dans son propre historique. Une zone de défilement (`DECSTBM`) a été
  essayée en #533 : historique vidé, Windows Terminal ne garde pas ce qui en sort, terminal cassé
  au `kill -9`.
- `src/nodefony/src/runtime/isTerminal.ts:12` — la porte unique où le code constate « suis-je dans
  un terminal ? ». Quatorze lectures directes de `process.stdout.columns` la contournent encore,
  dans sept fichiers.
- Vite n'est PAS concerné : le serveur le lance déjà en tube, sans couleur
  (`src/packages/@nodefony/frontend/nodefony/service/ViteProcessSupervisor.ts:493-500`,
  `FORCE_COLOR: "0"`) ; il ne touche jamais le terminal et n'efface jamais l'écran.

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
  et `shouldAnimate` de `src/nodefony/src/cli/progress.ts:144`.
- **Deux tubes ne garantissent pas l'ordre relatif entre `out` et `err`** (aujourd'hui, `inherit`
  ordonne par appel système). C'est le prix du champ `stream` de l'historique ; il est accepté.
- **Sans superviseur** (`--no-watch`), le serveur garde `StatusLine` et dessine lui-même, comme
  aujourd'hui : `StatusLine` est partagée, pas déplacée.

### 2. Deux surfaces, un modèle

| Surface      | Ce qu'elle fait                                                                                               | Quand                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `fullscreen` | écran alternatif, historique tenu par nous, molette captée ; journal, invite et barre dessinés à chaque image | DEMANDÉ (`--ui` ou `NF_DEV_UI=1`), clavier en terminal, et le terminal répond à la sonde  |
| `inline`     | le rendu de #533 : le contenu part dans l'historique natif, invite et barre redessinées en dernières lignes   | par défaut ; et en repli : terminal muet, clavier hors terminal, `--no-ui`, `NF_DEV_UI=0` |

- **Le plein écran est OPT-IN.** La sonde ne suffit pas à l'allumer : elle CONDITIONNE une
  demande explicite. Il le reste tant que trois preuves manquent — la souris (capture et sélection
  par l'application), l'exécution sous Windows, et la contre-revue du code de la grappe. `inline`
  est le seul chemin que tout développeur prend sans le savoir ; il ne change de défaut qu'une
  fois ces preuves faites. Une valeur de `NF_DEV_UI` autre que `0` ou `1` est ignorée, et nommée.
- **La sonde** est une requête de position du curseur (`ESC[6n`, réponse `ESC[ligne;colonneR`),
  universelle chez les terminaux à séquences VT : une réponse ⇒ écran alternatif utilisable. La
  sortie synchronisée (mode `2026`) est demandée EN PLUS par DECRQM et reste optionnelle. Le plein
  écran n'est jamais conditionné à DECRQM, extension que tous les terminaux n'implémentent pas.
- **Windows** : PgUp/PgDn/Début/Fin défilent partout. La **molette** n'est promise sous Windows
  qu'une fois prouvé à la main que Node reçoit les évènements souris de la console (libuv lit la
  console sans `ENABLE_VIRTUAL_TERMINAL_INPUT`).
- Un pseudo-terminal qui répond à la sonde (tmux lancé par un agent) n'obtient le plein écran que
  si on le lui demande ; `--no-ui` et `--output plain` restent les issues, documentées.

Les deux surfaces consomment le **même modèle** et rendent la **même** invite.

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

- **Deux plafonds** : 10 000 entrées ET **8 Mio d'octets** — le second est celui qui compte
  (10 000 × 16 Kio feraient 160 Mio). Éviction par la tête tant que l'un est dépassé.
- **Un seul anneau dans le dépôt** : `CircularBuffer`, jusque-là interne à `Syslog.ts`, sort
  dans `src/nodefony/src/runtime/` (`src/nodefony/src/runtime/CircularBuffer.ts:13`), ÉTENDU de `at(i)` et `shift()` (O(1), sans
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
  `https` ou `file` (le serveur en émet, `#hyperlinks` à `BootReporter.ts:195`). Retiré : tout le reste —
  déplacement de curseur, titre de fenêtre, presse-papiers OSC 52, changement d'écran. Rendu ET
  sécurité : une ligne de journal ne pilote pas le terminal du développeur.
- **L'effacement d'écran a un sens** : `ESC[2J` (`CLEAR_SCREEN`, écrit par le serveur au boot,
  `Kernel.ts:1074`, et au `ready`, `BootReporter.ts:458`) n'est pas relayé brut ; il devient
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

#537 pose deux foyers : **défilement** (molette, PgUp/PgDn, Début, Fin) et **global** (Ctrl+C,
Ctrl+D ⇒ arrêt propre). #538 insère l'**invite** en tête. La chaîne est atteignable hors clavier
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

- **Aucun type neuf pour la barre** : `IStartupView` (`startupScreen.ts:178`) est déjà un objet
  plat (le rendu `json` le sérialise), consommé tel quel par `renderStatusBlock` /
  `renderStatusLine` avec `IStatusContext`.
- **Le redimensionnement** : `terminalSize()` lit le verdict au boot puis le dernier `resize` reçu ;
  l'écoute s'installe à la porte, dans le cœur.
- Il perd `status` et `status-erased`.
- **Les lignes du journal ne passent jamais par l'IPC au fil de l'eau** (un JSON par ligne
  coûterait) : elles empruntent les tubes. Un **lot borné à la demande** (`transcript-request` /
  `transcript-batch`, servi par `since(seq)`) reste un membre légitime de l'union, le jour où la
  console d'administration ou un agent lira l'historique par le plan d'administration.
- **Ni l'invite ni l'assistant n'ajoutent de message** : les commandes tournent en sous-processus
  du superviseur, l'assistant parle à l'application par son serveur MCP.

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
  `computeCompletions`, `src/nodefony/src/cli/completion.ts:271` et `:271`) en #538 ;
  **assistant** en #539.

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
  `src/packages/@nodefony/devkit/nodefony/controllers/McpController.ts:139`) — les MÊMES qu'un
  agent externe, soumis au même RBAC. Aucun outil propre à l'invite.
- **Confirmation** : pour tout outil dont `annotations.readOnlyHint !== true`. Ce champ, la
  définition d'outil du dépôt ne le porte PAS encore (`src/nodefony/src/types/IMcpTool.ts:76`) :
  [#540](https://github.com/nodefony/nodefony-core/issues/540) l'ajoute et l'émet dans
  `tools/list` AVANT #539 — sans lui, les défauts de la spécification rendent tout outil
  destructif. Les annotations d'un serveur local de l'application sont tenues pour fiables ;
  celles d'un serveur tiers, non.
- **Audit** : l'`id` de la décision voyage dans `tools/call._meta` ; c'est le SERVEUR qui
  journalise l'appel et la décision (syslog, RBAC) — une piste d'audit, un seul endroit.
- **Contexte** : d'abord les journaux STRUCTURÉS et déjà expurgés des secrets, par le plan
  d'administration (`logs/search`, `src/packages/@nodefony/framework/nodefony/src/SyslogAdminApi.ts:270`) ;
  ensuite l'historique de l'écran, réduit aux sources `user` / `command` / `assistant` et à N
  lignes du serveur, borné. L'écran brut ne passe par aucun gestionnaire qui expurge.
- **Souveraineté** (livre blanc §3.1) : aucun envoi de contexte à un fournisseur `mode: "cloud"`
  sans confirmation explicite.
- **Garde-fous chiffrés** du livre blanc (§3.4) : plafonds de jetons et de durée, annulation par
  Ctrl+C (`AbortSignal`).

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
- Restauration sur TOUS les chemins — sortie normale, `SIGINT`/`SIGTERM`/`SIGHUP`,
  `uncaughtException`, `exit` — par le protocole unique (§5). Seul `kill -9` laisse un terminal à
  `reset` : c'est la raison d'être de la surface `inline`.
- Le verdict de crash du serveur s'arme sur l'évènement `close` de l'enfant (émis après la fin de
  ses flux), plus sur `exit` (`onServerEnded`, `DevSupervisor.ts:482`) : sinon la pile d'un crash
  au démarrage arrive après le message, ou se perd.

### 10. Hors du rendu humain, rien ne change

`plain` (agent sans terminal), `json`, `--debug`, production : ni plein écran, ni invite, ni
transit de la sortie. `--no-watch` : pas de superviseur, le serveur dessine sa barre comme
aujourd'hui (§1).

## Conséquences

- Le serveur n'a plus de code de terminal partagé ; un seul écrivain rend l'écran prévisible.
- L'historique de l'écran devient une donnée : affichable, défilable, lisible par un modèle,
  publiable plus tard par lot à la demande.
- Le superviseur gagne une responsabilité (le terminal), isolée dans `DevTerminal`.
- Coût mémoire en développement : 8 Mio au plus pour l'historique.
- Une capacité de plus à prouver sur trois plateformes. La preuve automatique passe par la
  commande système `script` comme pseudo-terminal — aucun pseudo-terminal en Node pur sans
  dépendance native, et `node-pty` en est une — et par `@xterm/headless` (dépendance de
  développement, hors du paquet publié) comme émulateur qui rend l'écran obtenu. Deux grammaires
  de `script` coexistent (BSD sous macOS, util-linux sous Linux). Le banc vit dans
  `CliIntegration.test.ts`, déclaré comme décor (une absence se dit, elle ne se saute pas en
  silence) et joué sur les jobs Linux et macOS. Windows Terminal se vérifie à la main.

## Alternatives écartées

| Alternative                                         | Pourquoi non                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zone de défilement `DECSTBM`                        | historique vidé, non tenue par Windows Terminal, terminal cassé au `kill -9` (essayé en #533)                                                                                                                                                                                                                                                                 |
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
