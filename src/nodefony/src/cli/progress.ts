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

  constructor(options: ILiveLineOptions = {}) {
    this.stream = options.stream ?? process.stdout;
  }

  /** Vrai si le flux est un terminal — donc si l'on peut dessiner en place. */
  get isInteractive(): boolean {
    return Boolean(this.stream.isTTY);
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
    this.active = false;
    if (finalLine !== undefined) this.stream.write(`${finalLine}\n`);
  }

  /** Arrête la mécanique propre à la forme (minuteur, compteurs). */
  protected abstract halt(): void;

  /** Efface la ligne courante puis écrit la nouvelle. Muet hors terminal. */
  protected paint(text: string): void {
    if (!this.isInteractive) return;
    this.erase();
    this.stream.write(text);
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
    this.#frames = options.frames ?? BRAILLE_FRAMES;
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
    this.#style = options.style ?? BAR_STYLES.blocks;
    this.#spin = options.spin ?? false;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#frames = options.frames ?? BRAILLE_FRAMES;
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
