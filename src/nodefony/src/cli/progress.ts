import readline from "node:readline";

/**
 * Indicateurs d'attente et de progression pour un terminal — la seule
 * implémentation du framework.
 *
 * Ils existent parce qu'une commande qui annonce une étape puis se tait pendant
 * quarante secondes est indiscernable d'une commande plantée : l'utilisateur ne
 * peut pas savoir s'il doit attendre ou interrompre. Un point fixe n'est pas
 * une progression.
 *
 * ## Ce qu'il faut choisir
 *
 * | On sait…                                    | La forme      |
 * | ------------------------------------------- | ------------- |
 * | seulement que ça travaille                  | {@link Spinner} |
 * | combien d'unités sur combien                | {@link ProgressBar} |
 * | les deux (des lots en parallèle, par ex.)   | `ProgressBar` avec `spin: true` |
 *
 * ## 🔴 Rien de tout cela ne passe par le Syslog, et c'est structurel
 *
 * Une animation réécrit la même ligne dix fois par seconde. La faire passer par
 * le journal en ferait dix entrées allouées, poussées au tampon circulaire, aux
 * transports et au backplane — du décor d'affichage expédié à un collecteur de
 * logs. Ces objets écrivent DIRECTEMENT sur leur flux, et le journal les ignore.
 *
 * ## Hors terminal
 *
 * Quand le flux n'est pas un terminal (redirection, tube, forge d'intégration),
 * `\r` ne ramène nulle part et l'animation deviendrait une avalanche de lignes.
 * Rien n'est alors dessiné : seule la ligne finale de `stop()` est émise. C'est
 * ce qui rend ces objets posables sans condition dans du code qui tourne aussi
 * bien en local qu'en forge.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. STYLES — les jeux d'images et de caractères, tous remplaçables.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tourniquet braille — dix images, rotation fluide. Le défaut.
 *
 * Le braille est préféré aux `|/-\` : il occupe une seule cellule quelle que
 * soit l'image, donc la ligne ne « respire » pas au fil de l'animation.
 */
export const BRAILLE_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

/** Tourniquet ASCII — le repli quand la police ne porte pas le braille. */
export const LINE_FRAMES = ["-", "\\", "|", "/"] as const;

/** Arcs tournants — plus discret que le braille, même encombrement. */
export const ARC_FRAMES = ["◜", "◠", "◝", "◞", "◡", "◟"] as const;

/** Barres montantes — suggère une activité qui « pompe ». */
export const BLOCK_FRAMES = [
  "▁",
  "▂",
  "▃",
  "▄",
  "▅",
  "▆",
  "▇",
  "▆",
  "▅",
  "▄",
  "▃",
  "▂",
] as const;

/** Points qui s'ajoutent — le plus sobre, et le seul purement ASCII. */
export const DOT_FRAMES = ["   ", ".  ", ".. ", "..."] as const;

/** Paire de caractères d'une barre : ce qui est fait, ce qui reste. */
export interface IBarStyle {
  readonly filled: string;
  readonly empty: string;
}

/** Styles de barre prêts à l'emploi. */
export const BAR_STYLES = {
  /** `▰▰▰▱▱` — le défaut, lisible et compact. */
  blocks: { filled: "▰", empty: "▱" },
  /** `███░░` — dense, bon contraste sur fond sombre. */
  solid: { filled: "█", empty: "░" },
  /** `===--` — purement ASCII, pour un terminal pauvre ou un journal. */
  ascii: { filled: "=", empty: "-" },
  /** `●●●○○` — pour un petit nombre d'unités qu'on veut compter à l'œil. */
  dots: { filled: "●", empty: "○" },
} as const satisfies Record<string, IBarStyle>;

/**
 * Le terminal sait-il dessiner du braille et des blocs ?
 *
 * 🔴 Windows est un impératif produit ici, et `cmd.exe` rend `⠋` en carré vide
 * ou en point d'interrogation : une animation illisible est pire qu'aucune.
 * La capacité se CONSTATE sur l'environnement plutôt que de se déduire de
 * `process.platform` — Windows Terminal, VS Code et les consoles modernes
 * affichent parfaitement le braille, et les punir serait aussi faux que de
 * supposer que toutes y arrivent.
 *
 * Même méthode que `is-unicode-supported`, sans la dépendance.
 *
 * @param env - l'environnement à interroger (injecté : une fonction qui lit
 *   `process.env` en dur ne s'éprouve pas).
 */
export function supportsUnicode(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): boolean {
  if (platform !== "win32") {
    if (env["TERM"] === "linux") return false; // la console noyau, pas un émulateur
    const locale = env["LC_ALL"] ?? env["LC_CTYPE"] ?? env["LANG"] ?? "";
    return /UTF-?8$/i.test(locale) || locale === "";
  }
  return Boolean(
    env["WT_SESSION"] || // Windows Terminal
    env["TERMINUS_SUBLIME"] ||
    env["ConEmuTask"] === "{cmd::Cmder}" ||
    env["TERM_PROGRAM"] === "vscode" ||
    env["TERM"] === "xterm-256color" ||
    env["TERM"] === "alacritty",
  );
}

/**
 * Faut-il animer du tout ?
 *
 * Un terminal ne suffit pas : une forge d'intégration peut en fournir un
 * (`CI=true` avec un pseudo-terminal), et y déverser dix images par seconde
 * remplit un journal que personne ne pourra relire. `TERM=dumb` est la
 * déclaration explicite d'un terminal qui ne sait rien réécrire.
 */
export function shouldAnimate(
  stream: NodeJS.WriteStream,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!stream.isTTY) return false;
  if (env["TERM"] === "dumb") return false;
  if (env["CI"]) return false;
  if (env["NF_NO_PROGRESS"]) return false;
  return true;
}

// ── Curseur : masqué pendant l'animation, RESTAURÉ quoi qu'il arrive ────────
//
// 🔴 Un curseur laissé masqué survit au programme : l'utilisateur se retrouve
// avec un terminal où il tape à l'aveugle, et il n'a aucune raison de faire le
// lien avec l'outil qu'il vient d'interrompre. C'est le défaut le plus
// désagréable de cette famille d'objets, et il n'arrive JAMAIS au cas nominal —
// seulement sur Ctrl+C, c'est-à-dire précisément quand l'utilisateur est déjà
// contrarié.

/** Nombre d'indicateurs qui animent en ce moment — le curseur suit ce compte. */
let animatingCount = 0;
/** Le flux sur lequel le curseur a été masqué, `null` s'il ne l'est pas. */
let cursorHiddenOn: NodeJS.WriteStream | null = null;
/** Retrait des gardes de sortie — `null` tant qu'elles ne sont pas posées. */
let releaseGuards: (() => void) | null = null;

function showCursor(): void {
  if (cursorHiddenOn === null) return;
  cursorHiddenOn.write("\u001B[?25h");
  cursorHiddenOn = null;
  releaseGuards?.();
  releaseGuards = null;
}

function hideCursor(stream: NodeJS.WriteStream): void {
  if (cursorHiddenOn !== null) return;
  stream.write("\u001B[?25l");
  cursorHiddenOn = stream;

  const onExit = (): void => showCursor();
  // Le protocole est celui de `signal-exit`, lu dans ses sources plutôt que de
  // mémoire : (1) n'agir que si notre écouteur est le SEUL — sinon
  // l'application a son propre arrêt gracieux et c'est à lui de conclure ;
  // (2) se RETIRER avant d'agir, pour ne pas se rappeler soi-même ;
  // (3) réémettre le signal par `process.kill`, JAMAIS `process.exit`.
  //
  // Le point (3) n'est pas un détail : `process.exit(130)` ment au shell, qui
  // croit à une sortie ordinaire. `process.kill` laisse le système appliquer
  // la sémantique du signal — un `^C` reste un `^C`, et une boucle `bash` qui
  // teste l'interruption continue de fonctionner.
  //
  // ⚠️ **Windows** : `SIGHUP` y lève `ENOSYS` — `signal-exit` le remplace par
  // `SIGINT`. On ne l'écoute pas du tout, ce qui est le plus sûr : `SIGINT` et
  // `SIGTERM` sont les deux que Node émule sur toutes les plateformes.
  const onSignal = (signal: NodeJS.Signals): void => {
    if (process.listenerCount(signal) > 1) {
      showCursor();
      return;
    }
    showCursor(); // retire aussi nos écouteurs, via `releaseGuards`
    process.kill(process.pid, signal);
  };
  process.once("exit", onExit);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  releaseGuards = () => {
    process.removeListener("exit", onExit);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  };
}

/**
 * Tronque une ligne à la largeur du terminal, séquences ANSI non comptées.
 *
 * 🔴 Sans cela, une ligne trop longue passe à la ligne — et `clearLine` n'en
 * efface qu'UNE : la queue reste à l'écran, l'animation laisse une traînée. Le
 * dépôt a déjà payé ce défaut ailleurs (`inspect routes` sortait à 900
 * colonnes). Deux colonnes sont laissées libres : certains terminaux passent à
 * la ligne dès la dernière atteinte.
 */
export function fitToWidth(line: string, columns: number | undefined): string {
  const width = columns && columns > 8 ? columns - 2 : 78;
  // eslint-disable-next-line no-control-regex
  const ansi = /\u001B\[[0-9;]*m/g;
  let visible = 0;
  let out = "";
  let index = 0;
  for (const match of line.matchAll(ansi)) {
    const text = line.slice(index, match.index);
    for (const ch of text) {
      if (visible >= width) return out;
      out += ch;
      visible++;
    }
    out += match[0]; // une séquence de couleur n'occupe aucune colonne
    index = match.index + match[0].length;
  }
  for (const ch of line.slice(index)) {
    if (visible >= width) return out;
    out += ch;
    visible++;
  }
  return out;
}

/**
 * Séquences de sortie synchronisée (mode 2026) et d'effacement de ligne.
 *
 * `\u001B[2K` efface la ligne entière, `\u001B[1G` ramène en colonne 1 : c'est
 * ce que fait `readline.clearLine` + `cursorTo`, en UNE écriture au lieu de
 * deux — ce qui est exactement ce que la sortie synchronisée cherche à obtenir.
 */
const SYNC_BEGIN = "\u001B[?2026h";
const SYNC_END = "\u001B[?2026l";
const ERASE_LINE = "\u001B[2K\u001B[1G";

/** Cadence par défaut, en millisecondes — au-delà l'animation saccade. */
const DEFAULT_INTERVAL_MS = 80;

/** Largeur par défaut d'une barre, en cellules. */
const DEFAULT_BAR_WIDTH = 20;

// ═══════════════════════════════════════════════════════════════════════════
// 2. RENDU PUR — dessiner une barre sans rien afficher.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ramène une valeur à un compte utilisable : entier, positif, FINI.
 *
 * 🔴 `NaN` est le piège : il traverse `Math.min`, `Math.max` et `Math.round`
 * sans jamais lever, puis `"▰".repeat(NaN)` rend la chaîne VIDE. Une barre
 * censée faire vingt cellules disparaissait donc en silence — le pire mode de
 * panne pour un indicateur, qui n'affiche rien là où il devrait alerter.
 */
function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** Rapport `done/total` borné à `[0, 1]` ; `0` si le total est nul ou absurde. */
function ratioOf(done: number, total: number): number {
  const t = safeCount(total);
  if (t === 0) return 0;
  return Math.min(1, Math.max(0, safeCount(done) / t));
}

/** Réglages de {@link renderBar}. */
export interface IRenderBarOptions {
  /** Largeur en cellules. Défaut : 20. */
  readonly width?: number;
  /** Caractères plein/vide. Défaut : {@link BAR_STYLES.blocks}. */
  readonly style?: IBarStyle;
}

/**
 * Dessine une barre de progression, et rien d'autre.
 *
 * Fonction PURE : elle n'écrit nulle part, ne connaît aucun terminal et se
 * teste par simple comparaison de chaînes. C'est ce qui permet de la réutiliser
 * dans un rendu sur mesure — un rapport, un journal, une page — sans traîner
 * derrière soi la machinerie d'affichage.
 *
 * Les bornes sont tenues : un `done` négatif, supérieur au total, ou un total
 * nul ne produisent jamais une barre plus longue ou plus courte que `width`.
 * Un total nul rend une barre vide plutôt que de diviser par zéro.
 *
 * @param done - unités faites
 * @param total - unités attendues
 * @param options - largeur et style
 * @returns la barre, sans couleur ni texte autour
 *
 * @example
 * ```ts
 * renderBar(3, 10, { width: 10 });        // "▰▰▰▱▱▱▱▱▱▱"
 * renderBar(1, 2, { style: BAR_STYLES.ascii, width: 4 }); // "==--"
 * ```
 */
export function renderBar(
  done: number,
  total: number,
  options: IRenderBarOptions = {},
): string {
  const width = safeCount(options.width ?? DEFAULT_BAR_WIDTH);
  const { filled, empty } = options.style ?? BAR_STYLES.blocks;
  const full = Math.min(width, Math.round(ratioOf(done, total) * width));
  return filled.repeat(full) + empty.repeat(width - full);
}

/**
 * Met en forme une durée pour un humain : `840ms`, `12.3s`, `4m 05s`.
 *
 * @param ms - durée en millisecondes
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. SOCLE — une ligne qui se réécrit, et qui sait se taire.
// ═══════════════════════════════════════════════════════════════════════════

/** Réglages communs à toutes les formes. */
export interface ILiveLineOptions {
  /** Flux de sortie. Défaut : `process.stdout`. */
  readonly stream?: NodeJS.WriteStream;
  /**
   * Forcer ou interdire l'animation, court-circuitant {@link shouldAnimate}.
   *
   * À ne poser que pour éprouver le comportement : en usage normal, c'est
   * l'environnement qui décide, et lui seul sait s'il est une forge.
   */
  readonly animate?: boolean;
  /** Environnement à interroger. Défaut : `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Une ligne de terminal qu'on réécrit en place.
 *
 * Porte ce que toutes les formes répètent sinon : le choix du flux, la
 * détection du terminal, l'effacement AVANT écriture (sans quoi un texte court
 * laisse derrière lui la queue d'un texte plus long), et le fait de ne rien
 * dessiner hors terminal.
 *
 * Classe de base : on instancie {@link Spinner} ou {@link ProgressBar}.
 */
export abstract class LiveLine {
  protected readonly stream: NodeJS.WriteStream;
  /** Vrai entre `start()` et `stop()`, même hors terminal. */
  protected active = false;
  /** Résultat de {@link shouldAnimate}, résolu UNE fois à la construction. */
  protected readonly interactive: boolean;

  constructor(options: ILiveLineOptions = {}) {
    this.stream = options.stream ?? process.stdout;
    this.interactive =
      options.animate ?? shouldAnimate(this.stream, options.env);
  }

  /** Vrai si l'on peut dessiner en place — terminal, hors forge, `TERM` utile. */
  get isInteractive(): boolean {
    return this.interactive;
  }

  /** Vrai entre `start()` et `stop()`. */
  get running(): boolean {
    return this.active;
  }

  /**
   * Arrête et fige éventuellement une ligne à la place de celle qui vivait.
   *
   * Sans terminal, la ligne finale est écrite telle quelle — c'est la seule
   * trace du passage, et c'est ce qui rend les journaux de forge lisibles.
   *
   * @param finalLine - la ligne à laisser ; omise, la ligne vivante disparaît.
   */
  stop(finalLine?: string): void {
    this.halt();
    this.erase();
    if (this.active && this.isInteractive) {
      animatingCount = Math.max(0, animatingCount - 1);
      if (animatingCount === 0) showCursor();
    }
    this.active = false;
    if (finalLine !== undefined) this.stream.write(`${finalLine}\n`);
  }

  /** Masque le curseur au premier indicateur qui anime, et le compte. */
  protected claimCursor(): void {
    animatingCount++;
    hideCursor(this.stream);
  }

  /** Arrête la mécanique propre à la forme (minuteur, compteurs). */
  protected abstract halt(): void;

  /** Efface la ligne courante puis écrit la nouvelle. Muet hors terminal. */
  protected paint(text: string): void {
    if (!this.isInteractive) return;
    // Sortie SYNCHRONISÉE (mode 2026) : le terminal retient l'affichage entre
    // les deux séquences et le publie d'un coup. Sans elle, l'effacement puis
    // la réécriture peuvent être rendus séparément — la ligne clignote dix fois
    // par seconde. Les terminaux qui ne connaissent pas ce mode ignorent
    // simplement les séquences, il n'y a donc rien à détecter. Repris de
    // `log-update`, dont c'est l'apport le plus visible.
    //
    // ⚠️ Limite ASSUMÉE : ces indicateurs écrivent UNE ligne. Un rendu
    // multi-lignes exigerait de compter les lignes déjà écrites pour toutes les
    // effacer (ce que fait `log-update` avec `wrap-ansi` et la hauteur du
    // terminal) ; ce n'est pas le besoin ici, et le supposer silencieusement
    // laisserait des traînées.
    this.stream.write(
      SYNC_BEGIN +
        ERASE_LINE +
        fitToWidth(text, this.stream.columns) +
        SYNC_END,
    );
  }

  /** Ramène le curseur en début de ligne et efface ce qui s'y trouvait. */
  protected erase(): void {
    // 🔴 Ne JAMAIS effacer une ligne qu'on n'a pas écrite : hors de son cycle
    // de vie, l'objet effacerait la sortie de quelqu'un d'autre — un `stop()`
    // défensif sur un indicateur jamais démarré suffisait à le faire.
    if (!this.active || !this.isInteractive) return;
    readline.clearLine(this.stream, 0);
    readline.cursorTo(this.stream, 0);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. SPINNER — l'attente dont on ne connaît pas la durée.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rendu d'une ligne animée : c'est le CONSOMMATEUR qui décide du contenu.
 *
 * @param frame - l'image courante du tourniquet
 * @param label - le libellé courant
 * @returns la ligne complète, SANS retour à la ligne
 */
export type SpinnerRenderer = (frame: string, label: string) => string;

/** Réglages d'un {@link Spinner}. */
export interface ISpinnerOptions extends ILiveLineOptions {
  /** Cadence de l'animation en millisecondes. Défaut : 80. */
  readonly intervalMs?: number;
  /** Images du tourniquet. Défaut : {@link BRAILLE_FRAMES}. */
  readonly frames?: readonly string[];
  /** Rendu de la ligne. Défaut : `"  <image> <libellé>…"`. */
  readonly render?: SpinnerRenderer;
}

/**
 * Attente **indéterminée** : on montre que ça vit, sans promettre de fin.
 *
 * Le minuteur est `unref()` — il n'empêche jamais le processus de se terminer —
 * et {@link LiveLine.stop} l'arrête explicitement. Un `Spinner` arrêté est
 * réutilisable : un nouveau {@link start} repart proprement.
 *
 * @example
 * ```ts
 * const spinner = new Spinner();
 * spinner.start("Compilation");
 * await build();
 * spinner.stop(`✓ Compilation (${formatDuration(elapsed)})`);
 * ```
 */
export class Spinner extends LiveLine {
  readonly #intervalMs: number;
  readonly #frames: readonly string[];
  readonly #render: SpinnerRenderer;

  /** Minuteur d'animation — `null` tant que rien ne tourne. */
  #timer: NodeJS.Timeout | null = null;
  #frame = 0;
  #label = "";

  constructor(options: ISpinnerOptions = {}) {
    super(options);
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    // Le braille par DÉFAUT, l'ASCII quand le terminal ne sait pas le dessiner.
    // Un jeu d'images EXPLICITE est respecté tel quel : l'appelant a choisi.
    this.#frames =
      options.frames ??
      (supportsUnicode(options.env) ? BRAILLE_FRAMES : LINE_FRAMES);
    this.#render = options.render ?? ((frame, label) => `  ${frame} ${label}…`);
  }

  /** Vrai si l'animation tourne RÉELLEMENT (donc sur un terminal). */
  get animating(): boolean {
    return this.#timer !== null;
  }

  /**
   * Démarre l'attente sous un libellé.
   *
   * Un `start()` sur un tourniquet déjà lancé change simplement le libellé : il
   * ne crée jamais un second minuteur.
   *
   * @param label - ce qu'on est en train d'attendre
   */
  start(label: string): void {
    this.#label = label;
    if (this.active) {
      // La TSDoc promet « change simplement le libellé » : encore faut-il le
      // MONTRER. Sans ce redessin, la ligne gardait l'ancien libellé jusqu'à
      // la prochaine image — et pas du tout si le minuteur ne tourne pas.
      this.#draw();
      return;
    }
    this.active = true;
    if (!this.isInteractive) return;
    this.claimCursor();
    this.#frame = 0;
    this.#draw();
    this.#timer = setInterval(() => {
      this.#frame = (this.#frame + 1) % this.#frames.length;
      this.#draw();
    }, this.#intervalMs);
    // Une animation ne doit JAMAIS retenir le processus en vie.
    this.#timer.unref?.();
  }

  /**
   * Change le libellé sans interrompre l'animation.
   *
   * @param label - le nouveau libellé
   */
  setLabel(label: string): void {
    this.#label = label;
    if (this.#timer !== null) this.#draw();
  }

  /** Redessine tout de suite, sans attendre la prochaine image. */
  refresh(): void {
    if (this.#timer !== null) this.#draw();
  }

  protected halt(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  #draw(): void {
    this.paint(this.#render(this.#frames[this.#frame]!, this.#label));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. PROGRESSBAR — la progression dont on connaît le total.
// ═══════════════════════════════════════════════════════════════════════════

/** Ce qu'un rendu de barre reçoit pour composer sa ligne. */
export interface IProgressState {
  /** Unités faites. */
  readonly done: number;
  /** Unités attendues. */
  readonly total: number;
  /** Rapport `done/total`, borné à `[0, 1]` ; `0` si le total est nul. */
  readonly ratio: number;
  /** La barre déjà dessinée par {@link renderBar}. */
  readonly bar: string;
  /** Libellé courant. */
  readonly label: string;
  /** Image du tourniquet, ou `""` si `spin` est faux. */
  readonly frame: string;
  /** Millisecondes écoulées depuis {@link ProgressBar.start}. */
  readonly elapsedMs: number;
}

/** Rendu d'une ligne de progression. */
export type ProgressRenderer = (state: IProgressState) => string;

/** Réglages d'une {@link ProgressBar}. */
export interface IProgressBarOptions extends ILiveLineOptions {
  /** Largeur de la barre. Défaut : 20. */
  readonly width?: number;
  /** Caractères plein/vide. Défaut : {@link BAR_STYLES.blocks}. */
  readonly style?: IBarStyle;
  /**
   * Ajoute un tourniquet en tête, animé indépendamment de l'avancement.
   *
   * À poser quand l'avancement peut rester longtemps immobile : la barre dit
   * OÙ l'on en est, le tourniquet dit que ça VIT encore. Sans lui, une étape
   * lente est indiscernable d'un blocage.
   */
  readonly spin?: boolean;
  /** Cadence du tourniquet, en millisecondes. Défaut : 80. */
  readonly intervalMs?: number;
  /** Images du tourniquet. Défaut : {@link BRAILLE_FRAMES}. */
  readonly frames?: readonly string[];
  /** Rendu de la ligne. Défaut : `"  <barre> <faits>/<total> <libellé>"`. */
  readonly render?: ProgressRenderer;
}

/**
 * Progression **déterminée** : on connaît le total, on montre où l'on en est.
 *
 * Redessine à chaque {@link update}. Avec `spin: true`, un minuteur anime en
 * plus un tourniquet en tête — utile quand l'avancement peut rester immobile un
 * long moment, ce qu'une barre seule ne distingue pas d'un blocage.
 *
 * @example
 * ```ts
 * const bar = new ProgressBar({ spin: true });
 * bar.start(files.length, "Compilation");
 * for (const file of files) {
 *   await compile(file);
 *   bar.increment();
 * }
 * bar.stop(`✓ ${files.length} fichiers`);
 * ```
 */
export class ProgressBar extends LiveLine {
  readonly #width: number;
  readonly #style: IBarStyle;
  readonly #spin: boolean;
  readonly #intervalMs: number;
  readonly #frames: readonly string[];
  readonly #render: ProgressRenderer;

  #timer: NodeJS.Timeout | null = null;
  #frame = 0;
  #done = 0;
  #total = 0;
  #label = "";
  #startedAt = 0;

  constructor(options: IProgressBarOptions = {}) {
    super(options);
    this.#width = options.width ?? DEFAULT_BAR_WIDTH;
    // Même règle pour la barre : `▰▱` sur un terminal qui les dessine, `=-`
    // sinon. Une barre en carrés vides ne dit rien de la progression.
    this.#style =
      options.style ??
      (supportsUnicode(options.env) ? BAR_STYLES.blocks : BAR_STYLES.ascii);
    this.#spin = options.spin ?? false;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#frames =
      options.frames ??
      (supportsUnicode(options.env) ? BRAILLE_FRAMES : LINE_FRAMES);
    this.#render =
      options.render ??
      (({ bar, done, total, label, frame }) =>
        `  ${frame ? `${frame} ` : ""}${bar} ${done}/${total}${label ? ` ${label}` : ""}`);
  }

  /** Unités faites. */
  get done(): number {
    return this.#done;
  }

  /** Unités attendues. */
  get total(): number {
    return this.#total;
  }

  /** Vrai si le tourniquet tourne réellement. */
  get animating(): boolean {
    return this.#timer !== null;
  }

  /**
   * Démarre la progression.
   *
   * @param total - unités attendues
   * @param label - libellé facultatif
   */
  start(total: number, label = ""): void {
    this.#total = safeCount(total);
    this.#label = label;
    this.#done = 0;
    this.#startedAt = Date.now();
    if (this.active) {
      this.#draw();
      return;
    }
    this.active = true;
    if (!this.isInteractive) return;
    this.claimCursor();
    this.#draw();
    if (!this.#spin) return;
    this.#timer = setInterval(() => {
      this.#frame = (this.#frame + 1) % this.#frames.length;
      this.#draw();
    }, this.#intervalMs);
    this.#timer.unref?.();
  }

  /**
   * Pose l'avancement à une valeur absolue.
   *
   * @param done - unités faites
   * @param label - nouveau libellé, facultatif
   */
  update(done: number, label?: string): void {
    this.#done = safeCount(done);
    if (label !== undefined) this.#label = label;
    this.#draw();
  }

  /**
   * Avance de `step` unités.
   *
   * @param step - pas d'avancement. Défaut : 1.
   */
  increment(step = 1): void {
    this.update(this.#done + step);
  }

  /** Change le total en cours de route (une découverte, un lot qui grossit). */
  setTotal(total: number): void {
    this.#total = safeCount(total);
    this.#draw();
  }

  /** Change le libellé sans toucher à l'avancement. */
  setLabel(label: string): void {
    this.#label = label;
    this.#draw();
  }

  protected halt(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  #draw(): void {
    if (!this.active) return;
    const ratio = ratioOf(this.#done, this.#total);
    this.paint(
      this.#render({
        done: this.#done,
        total: this.#total,
        ratio,
        bar: renderBar(this.#done, this.#total, {
          width: this.#width,
          style: this.#style,
        }),
        label: this.#label,
        frame: this.#spin ? this.#frames[this.#frame]! : "",
        elapsedMs: this.#startedAt === 0 ? 0 : Date.now() - this.#startedAt,
      }),
    );
  }
}
