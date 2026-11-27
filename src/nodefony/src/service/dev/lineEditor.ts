/**
 * L'éditeur de l'invite du superviseur (#538, ADR-0013 §7) : un tampon de
 * graphèmes, un curseur, et le rendu de ses lignes à une largeur donnée.
 *
 * PUR : ni terminal, ni horloge, ni disque. Il reçoit des évènements décodés
 * (`inputDecoder.ts`) et rend ce qu'ils ont fait ; l'historique lui est
 * PRÊTÉ par {@link IRecallSource}, il ne le possède pas.
 *
 * Le curseur se compte en UNITÉS : un graphème (ce que l'œil voit comme un
 * caractère, `Intl.Segmenter`) ou une pièce jointe entière (un long collage,
 * plus tard une image — #539). Jamais en unités UTF-16 : un emoji composé ne
 * se coupe pas en deux sous le curseur.
 */

import { graphemeWidth, textUnits } from "../../runtime/textWidth";
import type { InputEvent } from "./inputDecoder";
import type { IFramePrompt } from "./devFrame";

/** Au-delà de ce nombre de lignes, un collage devient une pièce jointe (D2). */
export const PASTE_ATTACH_LINES = 5;
/** Au-delà de ce nombre de caractères, un collage devient une pièce jointe (D2). */
export const PASTE_ATTACH_CHARS = 1000;
/** Lignes visibles de l'invite ; au-delà, une fenêtre suit le curseur (D3). */
export const PROMPT_MAX_ROWS = 8;
/** Pas des tabulations rendues en espaces. */
const TAB_STOP = 4;

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const ATTACHMENT_COLOR = "\x1b[36m";
/**
 * Le format des nombres d'une étiquette de collage, créé au PREMIER collage :
 * `new Intl.NumberFormat` charge les données ICU de la locale, ~18 ms mesurés
 * à l'import — payés jusqu'ici par tout `import "nodefony"`, serveur compris,
 * pour une étiquette que la plupart des processus n'affichent jamais.
 */
let numberFormat: Intl.NumberFormat | null = null;

function formatCount(n: number): string {
  numberFormat ??= new Intl.NumberFormat("fr-FR");
  return numberFormat.format(n);
}

/**
 * Une pièce jointe de l'invite : un collage trop long pour s'afficher, gardé
 * intact et restitué à l'envoi. Forme fixe, posée au constructeur.
 */
export class PromptAttachment {
  /** `text` aujourd'hui ; `image` arrivera avec #539 sans rien rouvrir. */
  readonly kind: "text";
  /** Numéro affiché, propre à l'éditeur (`[Collé #2 · …]`). */
  readonly id: number;
  /** Le texte collé, nettoyé (D1). */
  readonly text: string;
  readonly lines: number;
  readonly chars: number;
  /** L'étiquette affichée, calculée une fois. */
  readonly label: string;
  /** Sa largeur en colonnes, calculée une fois. */
  readonly width: number;

  constructor(id: number, text: string, lines: number, chars: number) {
    this.kind = "text";
    this.id = id;
    this.text = text;
    this.lines = lines;
    this.chars = chars;
    this.label =
      lines > 1
        ? `[Collé #${id} · ${formatCount(lines)} lignes]`
        : `[Collé #${id} · ${formatCount(chars)} caractères]`;
    let width = 0;
    for (const unit of textUnits(this.label)) width += unit.width;
    this.width = width;
  }
}

/** Une unité du tampon : un graphème, ou une pièce jointe entière. */
export type PromptUnit = string | PromptAttachment;

/** Ce qu'un évènement a fait à l'éditeur. */
export type EditResult =
  /** Entrée : la saisie est prête, à prendre par {@link LineEditor.take}. */
  | "submit"
  /** Le tampon ou le curseur a changé : à redessiner. */
  | "changed"
  /** L'évènement ne concerne pas l'éditeur : au foyer suivant. */
  | "ignored";

/**
 * L'historique vu par l'éditeur : il le LIT, jamais ne l'écrit — l'envoi
 * appartient au propriétaire de l'invite.
 */
export interface IRecallSource {
  /**
   * Les saisies qui prolongent `prefix` (sans l'égaler), la plus ANCIENNE
   * d'abord — Ctrl+P remonte depuis la fin.
   */
  matching(prefix: string): readonly string[];
  /**
   * La suite grisée proposée après `prefix` (la plus récente qui le
   * prolonge), ou `""`.
   */
  suggest(prefix: string): string;
}

/** Les options de rendu qui ne changent pas d'une frappe à l'autre. */
export interface IPromptRenderOptions {
  /** Le signe de l'invite, espace comprise (`"❯ "`, `"> "` en ASCII). */
  readonly sigil: string;
  /** Le texte grisé d'une invite vide. */
  readonly placeholder: string;
  readonly color: boolean;
}

/** Une fin de ligne, un espace ou une tabulation : ce qui sépare les mots. */
function isSpace(unit: PromptUnit | undefined): boolean {
  return unit === " " || unit === "\t" || unit === "\n";
}

/**
 * Les cellules qu'occupe une unité posée après `used` cellules de sa ligne —
 * UNE règle, lue par la mise en page et par la relecture d'une cellule.
 */
function cellsOf(unit: PromptUnit, used: number): number {
  if (typeof unit !== "string") return unit.width;
  if (unit === "\n") return 0;
  if (unit === "\t") return TAB_STOP - (used % TAB_STOP);
  return graphemeWidth(unit);
}

/**
 * Ce qui entre dans le tampon (D1) : fins de ligne unifiées en `\n`,
 * tabulations gardées, séquences de contrôle et caractères C0 retirés —
 * aucun Échap n'entre dans le tampon, donc aucun ne ressort à l'écran.
 *
 * Voie rapide d'abord : tant que le texte est de l'ASCII imprimable, une
 * tabulation ou `\n`, chaque caractère EST un graphème — ni segmenteur ni
 * générateur (1 Mio de collage : 191 → 29 ms, mesuré). Au premier autre code,
 * le dernier caractère retenu est rendu à la voie complète : une marque
 * combinante ou un sélecteur de variante (`e` + `´`, `1` + keycap) lui
 * appartient.
 *
 * @param raw - le texte reçu (frappe ou collage).
 * @param out - les graphèmes retenus, ajoutés à la fin.
 * @returns le nombre de fins de ligne retenues.
 */
function cleanInto(raw: string, out: string[]): number {
  let newlines = 0;
  let i = 0;
  const length = raw.length;
  for (; i < length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0x0a) {
      out.push("\n");
      newlines++;
    } else if ((code >= 0x20 && code < 0x7f) || code === 0x09) {
      out.push(raw.charAt(i));
    } else {
      break;
    }
  }
  if (i === length) return newlines;
  let start = i;
  if (start > 0 && raw.charCodeAt(start - 1) !== 0x0a) {
    out.pop();
    start--;
  }
  return newlines + cleanSlowInto(start === 0 ? raw : raw.slice(start), out);
}

/**
 * La voie complète de {@link cleanInto} : graphème par graphème.
 *
 * @param raw - le texte.
 * @param out - les graphèmes retenus, ajoutés à la fin.
 * @returns le nombre de fins de ligne retenues.
 */
function cleanSlowInto(raw: string, out: string[]): number {
  let newlines = 0;
  let previousCr = false;
  for (const unit of textUnits(raw)) {
    if (unit.control) {
      previousCr = false;
      continue;
    }
    const text = unit.text;
    // `\r\n` forme UN graphème pour le segmenteur.
    if (text === "\r\n" || text === "\n") {
      if (!(text === "\n" && previousCr)) {
        out.push("\n");
        newlines++;
      }
      previousCr = false;
      continue;
    }
    if (text === "\r") {
      out.push("\n");
      newlines++;
      previousCr = true;
      continue;
    }
    previousCr = false;
    const code = text.charCodeAt(0);
    if (text.length === 1 && code !== 0x09 && (code < 0x20 || code === 0x7f)) {
      continue;
    }
    out.push(text);
  }
  return newlines;
}

/** Le rendu mis en cache : rejoué tant que rien de ce qu'il lit n'a changé. */
interface IRenderCache {
  version: number;
  width: number;
  suggestion: string;
  options: IPromptRenderOptions;
  prompt: IFramePrompt;
}

/**
 * Le tampon d'une invite : saisie, curseur, rappel de l'historique, et son
 * image. Une instance par onglet (ADR-0013 §11) : le brouillon y survit
 * quand on change d'onglet.
 */
export class LineEditor {
  #units: PromptUnit[] = [];
  #cursor = 0;
  /** Numéro de la prochaine pièce jointe. */
  #attachments = 0;
  /** Incrémenté à chaque changement : la clé du cache de rendu. */
  #version = 0;
  /** Rappel en cours (Ctrl+P) : `null` hors rappel — alloué au premier. */
  #recall: {
    list: readonly string[];
    index: number;
    draft: PromptUnit[];
  } | null = null;
  #rendered: IRenderCache | null = null;
  /**
   * La mise en page du dernier rendu, pour qu'une cellule de l'écran se
   * relise en unité (sélection à la souris) : l'unité qui ouvre chaque
   * ligne, la première ligne de la fenêtre, la largeur du signe.
   */
  #rowFirsts: number[] = [0];
  #windowStart = 0;
  #sigilWidth = 0;

  /** Le tampon est vide. */
  get empty(): boolean {
    return this.#units.length === 0;
  }

  /** La position du curseur, en unités. */
  /** Le nombre d'unités du tampon (graphèmes et pièces jointes). */
  get length(): number {
    return this.#units.length;
  }

  get cursor(): number {
    return this.#cursor;
  }

  /** Le curseur est en fin de saisie. */
  get atEnd(): boolean {
    return this.#cursor === this.#units.length;
  }

  /** Change à chaque modification du tampon ou du curseur. */
  get version(): number {
    return this.#version;
  }

  /** Le texte saisi, pièces jointes restituées intactes. */
  get text(): string {
    let text = "";
    for (const unit of this.#units) {
      text += typeof unit === "string" ? unit : unit.text;
    }
    return text;
  }

  /**
   * Le texte tel qu'il est AFFICHÉ : les pièces jointes par leur étiquette
   * (`[Collé #1 · 40 lignes]`) — l'écho d'un envoi, jamais le collage entier.
   */
  get display(): string {
    let text = "";
    for (const unit of this.#units) {
      text += typeof unit === "string" ? unit : unit.label;
    }
    return text;
  }

  /** Le tampon porte au moins une pièce jointe. */
  get hasAttachment(): boolean {
    for (const unit of this.#units) {
      if (typeof unit !== "string") return true;
    }
    return false;
  }

  /**
   * Insère du texte frappé au curseur, nettoyé (D1).
   *
   * @param raw - le texte.
   */
  insert(raw: string): void {
    const units: string[] = [];
    cleanInto(raw, units);
    this.#insertUnits(units);
  }

  /**
   * Insère un collage (D1/D2) : tel quel s'il est court, en UNE pièce jointe
   * au-delà de {@link PASTE_ATTACH_LINES} lignes ou
   * {@link PASTE_ATTACH_CHARS} caractères. Ne lance jamais rien.
   *
   * @param raw - le texte collé.
   */
  paste(raw: string): void {
    const units: string[] = [];
    const newlines = cleanInto(raw, units);
    if (units.length === 0) return;
    const lines = newlines + 1;
    if (lines > PASTE_ATTACH_LINES || units.length > PASTE_ATTACH_CHARS) {
      this.#insertUnits([this.#attach(units, lines)]);
      return;
    }
    this.#insertUnits(units);
  }

  /**
   * Remplace la saisie par `text`, curseur en fin (un rappel, un brouillon
   * restauré). Au-delà de {@link PASTE_ATTACH_CHARS} caractères, le texte
   * revient en UNE pièce jointe : le tampon n'est jamais plus long que la
   * borne, quel que soit le chemin.
   *
   * @param text - le nouveau texte.
   */
  setText(text: string): void {
    this.#units = this.#unitsOf(text);
    this.#cursor = this.#units.length;
    this.#recall = null;
    this.#touch();
  }

  /** Les unités d'un texte entier : graphèmes, ou une pièce jointe au-delà de la borne. */
  #unitsOf(text: string): PromptUnit[] {
    const units: string[] = [];
    const newlines = cleanInto(text, units);
    return units.length > PASTE_ATTACH_CHARS
      ? [this.#attach(units, newlines + 1)]
      : units;
  }

  #attach(units: readonly string[], lines: number): PromptAttachment {
    return new PromptAttachment(
      ++this.#attachments,
      units.join(""),
      lines,
      units.length,
    );
  }

  /**
   * Prend la saisie pour l'envoyer et vide le tampon.
   *
   * @returns le texte, pièces jointes restituées.
   */
  take(): string {
    const text = this.text;
    this.#units = [];
    this.#cursor = 0;
    this.#recall = null;
    this.#touch();
    return text;
  }

  /** Vide la saisie (Ctrl+C sur une saisie non vide). */
  clear(): void {
    if (this.#units.length === 0 && this.#recall === null) return;
    this.#units = [];
    this.#cursor = 0;
    this.#recall = null;
    this.#touch();
  }

  /**
   * Applique un évènement du clavier (D4, D5, D6).
   *
   * @param event - l'évènement décodé.
   * @param source - l'historique à rappeler, ou `null` sans historique.
   * @returns ce que l'évènement a fait.
   */
  handle(event: InputEvent, source: IRecallSource | null): EditResult {
    if (event.kind === "paste") {
      this.paste(event.text);
      return "changed";
    }
    if (event.kind === "text") {
      // D5 : `?` est un caractère, sauf sur une invite vide (l'aide).
      if (this.#units.length === 0 && event.text === "?") return "ignored";
      // Un collage SANS crochets (terminal sans mode 2004) arrive en une
      // tranche de frappe : au-delà de la borne, il est traité en collage.
      if (event.text.length > PASTE_ATTACH_CHARS) this.paste(event.text);
      else this.insert(event.text);
      return "changed";
    }
    if (event.kind !== "key") return "ignored";
    const { key, ctrl, alt } = event;
    if (ctrl && !alt) return this.#control(key, source);
    if (alt && !ctrl) return this.#meta(key);
    if (ctrl || alt) return "ignored";
    switch (key) {
      case "enter":
        // `\` puis Entrée : une fin de ligne, comme dans un shell (D3).
        if (this.#units[this.#cursor - 1] === "\\") {
          this.#units[this.#cursor - 1] = "\n";
          this.#recall = null;
          this.#touch();
          return "changed";
        }
        return "submit";
      case "space":
        this.#insertUnits([" "]);
        return "changed";
      case "left":
        return this.#moveTo(this.#cursor - 1);
      case "right":
        if (this.#cursor === this.#units.length && source !== null) {
          return this.#acceptSuggestion(source);
        }
        return this.#moveTo(this.#cursor + 1);
      case "home":
        // Invite vide : Début/Fin restent au défilement du journal (D4).
        return this.#units.length === 0
          ? "ignored"
          : this.#moveTo(this.#lineStart());
      case "end":
        return this.#units.length === 0
          ? "ignored"
          : this.#moveTo(this.#lineEnd());
      case "backspace":
        return this.#cut(this.#cursor - 1, this.#cursor);
      case "delete":
        return this.#cut(this.#cursor, this.#cursor + 1);
      case "up":
        return this.#vertical(-1, source);
      case "down":
        return this.#vertical(1, source);
      // PgUp/PgDn au défilement, Échap aux bandes, Tab à la complétion,
      // F1 à l'aide : rien de tout ça n'est à l'éditeur.
      case "escape":
      case "tab":
      case "insert":
      case "pageup":
      case "pagedown":
      case "f1":
      case "f2":
      case "f3":
      case "f4":
      case "f5":
      case "f6":
      case "f7":
      case "f8":
      case "f9":
      case "f10":
      case "f11":
      case "f12":
        return "ignored";
      default:
        // Une touche « caractère » sans modificateur n'arrive pas : le décodeur
        // en fait un évènement `text`.
        return "ignored";
    }
  }

  /** Ctrl+touche. */
  #control(key: string, source: IRecallSource | null): EditResult {
    switch (key) {
      case "a":
        return this.#moveTo(this.#lineStart());
      case "e":
        return this.#moveTo(this.#lineEnd());
      case "b":
        return this.#moveTo(this.#cursor - 1);
      case "f":
        return this.#moveTo(this.#cursor + 1);
      case "w":
        return this.#cut(this.#wordLeft(), this.#cursor);
      case "u":
        return this.#cut(this.#lineStart(), this.#cursor);
      case "k":
        return this.#cut(this.#cursor, this.#lineEnd());
      case "p":
        return this.#recallStep(-1, source);
      case "n":
        return this.#recallStep(1, source);
      case "c":
        // D6 : saisie non vide → l'efface ; vide → l'arrêt (foyer global).
        if (this.#units.length === 0) return "ignored";
        this.clear();
        return "changed";
      case "d":
        // D6 : saisie non vide → le caractère sous le curseur ; vide → l'arrêt.
        if (this.#units.length === 0) return "ignored";
        this.#cut(this.#cursor, this.#cursor + 1);
        return "changed";
      default:
        return "ignored";
    }
  }

  /** Alt+touche. */
  #meta(key: string): EditResult {
    switch (key) {
      case "enter":
        this.#insertUnits(["\n"]);
        return "changed";
      case "left":
      case "b":
        return this.#moveTo(this.#wordLeft());
      case "right":
      case "f":
        return this.#moveTo(this.#wordRight());
      case "backspace":
        return this.#cut(this.#wordLeft(), this.#cursor);
      default:
        return "ignored";
    }
  }

  /**
   * ↑/↓ : d'une ligne à l'autre dans une saisie de plusieurs lignes, puis
   * l'historique depuis la première (ou la dernière) — comme un shell.
   */
  #vertical(direction: -1 | 1, source: IRecallSource | null): EditResult {
    const start = this.#lineStart();
    const column = this.#cursor - start;
    if (direction < 0 && start > 0) {
      // Début de la ligne précédente : `start - 1` est sa fin de ligne.
      let previous = start - 1;
      while (previous > 0 && this.#units[previous - 1] !== "\n") previous--;
      return this.#moveTo(Math.min(previous + column, start - 1));
    }
    const end = this.#lineEnd();
    if (direction > 0 && end < this.#units.length) {
      const next = end + 1;
      let nextEnd = next;
      while (nextEnd < this.#units.length && this.#units[nextEnd] !== "\n")
        nextEnd++;
      return this.#moveTo(Math.min(next + column, nextEnd));
    }
    return this.#recallStep(direction, source);
  }

  /**
   * Un pas dans l'historique, filtré par ce qui était tapé au premier pas ;
   * redescendre au-delà de la plus récente rend le brouillon.
   */
  #recallStep(direction: -1 | 1, source: IRecallSource | null): EditResult {
    if (source === null) return "ignored";
    let recall = this.#recall;
    if (recall === null) {
      if (direction > 0) return "ignored";
      const list = source.matching(this.text);
      if (list.length === 0) return "ignored";
      recall = { list, index: list.length, draft: this.#units.slice() };
      this.#recall = recall;
    }
    const next = recall.index + direction;
    if (next < 0) return "ignored";
    if (next >= recall.list.length) {
      this.#units = recall.draft;
      this.#recall = null;
    } else {
      recall.index = next;
      this.#units = this.#unitsOf(recall.list[next] ?? "");
    }
    this.#cursor = this.#units.length;
    this.#touch();
    return "changed";
  }

  /** → en fin de saisie : la suggestion grisée entre dans le tampon. */
  #acceptSuggestion(source: IRecallSource): EditResult {
    const suggestion = this.suggestion(source);
    if (suggestion === "") return "ignored";
    this.insert(suggestion);
    return "changed";
  }

  /**
   * La suite grisée à proposer : seulement en fin de saisie, sur une seule
   * ligne, sans pièce jointe ni menu (`/`).
   *
   * @param source - l'historique.
   * @returns la suite, ou `""`.
   */
  suggestion(source: IRecallSource | null): string {
    if (source === null || this.#units.length === 0) return "";
    if (this.#cursor !== this.#units.length || this.#recall !== null) return "";
    if (this.#units[0] === "/") return "";
    for (const unit of this.#units) {
      if (unit === "\n" || typeof unit !== "string") return "";
    }
    const suggestion = source.suggest(this.text);
    return suggestion.includes("\n") ? "" : suggestion;
  }

  #insertUnits(units: readonly PromptUnit[]): void {
    const single = units.length === 1 ? units[0] : undefined;
    if (single !== undefined && this.#cursor === this.#units.length) {
      // La frappe ordinaire : en fin de tampon, sans tableau intermédiaire.
      this.#units.push(single);
    } else if (units.length > 0) {
      this.#units.splice(this.#cursor, 0, ...units);
    } else {
      return;
    }
    this.#cursor += units.length;
    this.#recall = null;
    this.#touch();
  }

  #cut(from: number, to: number): EditResult {
    const start = Math.max(0, from);
    const end = Math.min(this.#units.length, to);
    if (end <= start) return "ignored";
    this.#units.splice(start, end - start);
    this.#cursor = start;
    this.#recall = null;
    this.#touch();
    return "changed";
  }

  #moveTo(position: number): EditResult {
    const target = Math.max(0, Math.min(this.#units.length, position));
    if (target === this.#cursor) return "ignored";
    this.#cursor = target;
    this.#touch();
    return "changed";
  }

  #lineStart(): number {
    let i = this.#cursor;
    while (i > 0 && this.#units[i - 1] !== "\n") i--;
    return i;
  }

  #lineEnd(): number {
    let i = this.#cursor;
    while (i < this.#units.length && this.#units[i] !== "\n") i++;
    return i;
  }

  #wordLeft(): number {
    let i = this.#cursor;
    while (i > 0 && isSpace(this.#units[i - 1])) i--;
    while (i > 0 && !isSpace(this.#units[i - 1])) i--;
    return i;
  }

  #wordRight(): number {
    let i = this.#cursor;
    while (i < this.#units.length && isSpace(this.#units[i])) i++;
    while (i < this.#units.length && !isSpace(this.#units[i])) i++;
    return i;
  }

  #touch(): void {
    this.#version++;
  }

  /**
   * L'image de l'invite à `width` colonnes : repli à la largeur, lignes de
   * continuation alignées sous la saisie, fenêtre de {@link PROMPT_MAX_ROWS}
   * lignes autour du curseur. Rejouée depuis le cache tant que ni le tampon,
   * ni la largeur, ni la suggestion, ni les options n'ont changé — `#model`
   * la redemande à chaque image.
   *
   * @param width - colonnes utiles (celles de l'image, `columns - 1`).
   * @param options - signe, texte d'invite vide, couleur.
   * @param suggestion - la suite grisée ({@link LineEditor.suggestion}).
   * @returns les lignes et la position du curseur dans ces lignes.
   */
  render(
    width: number,
    options: IPromptRenderOptions,
    suggestion = "",
  ): IFramePrompt {
    const cached = this.#rendered;
    if (
      cached !== null &&
      cached.version === this.#version &&
      cached.width === width &&
      cached.suggestion === suggestion &&
      cached.options === options
    ) {
      return cached.prompt;
    }
    const prompt = this.#layout(width, options, suggestion);
    if (cached === null) {
      this.#rendered = {
        version: this.#version,
        width,
        suggestion,
        options,
        prompt,
      };
    } else {
      cached.version = this.#version;
      cached.width = width;
      cached.suggestion = suggestion;
      cached.options = options;
      cached.prompt = prompt;
    }
    return prompt;
  }

  /**
   * L'unité sous une cellule du dernier rendu ({@link LineEditor.render}) —
   * la sélection à la souris. Sur le signe : la première unité de la ligne ;
   * au-delà de la fin d'une ligne : la position qui la termine.
   *
   * @param row - la ligne, comptée dans les lignes rendues (0 = la première).
   * @param column - la colonne, signe compris (0 = la première).
   * @returns l'indice d'unité, entre 0 et la longueur du tampon.
   */
  indexAt(row: number, column: number): number {
    const firsts = this.#rowFirsts;
    const units = this.#units;
    const line = this.#windowStart + Math.max(0, row);
    const first = firsts[line];
    if (first === undefined) return units.length;
    const end = firsts[line + 1] ?? units.length;
    const target = column - this.#sigilWidth;
    let used = 0;
    for (let index = first; index < end; index++) {
      const unit = units[index];
      if (unit === undefined || unit === "\n") return index;
      const cells = cellsOf(unit, used);
      if (target < used + cells) return index;
      used += cells;
    }
    return end;
  }

  /**
   * La cellule d'une unité dans le dernier rendu — l'inverse de
   * {@link LineEditor.indexAt}. La ligne peut tomber hors de la fenêtre.
   *
   * @param index - l'indice d'unité.
   * @returns la ligne (rendue) et la colonne, signe compris.
   */
  positionOf(index: number): { row: number; column: number } {
    const firsts = this.#rowFirsts;
    let line = 0;
    while (line + 1 < firsts.length && (firsts[line + 1] ?? 0) <= index) line++;
    const units = this.#units;
    let used = 0;
    for (let at = firsts[line] ?? 0; at < index; at++) {
      const unit = units[at];
      if (unit === undefined) break;
      used += cellsOf(unit, used);
    }
    return { row: line - this.#windowStart, column: this.#sigilWidth + used };
  }

  /**
   * Le texte d'une tranche d'unités — une pièce jointe par son contenu
   * entier, pas son étiquette : c'est ce qu'on copie.
   *
   * @param from - premier indice, inclus.
   * @param to - dernier indice, exclu.
   * @returns le texte.
   */
  textOf(from: number, to: number): string {
    let text = "";
    const units = this.#units;
    const end = Math.min(to, units.length);
    for (let index = Math.max(0, from); index < end; index++) {
      const unit = units[index];
      if (unit !== undefined)
        text += typeof unit === "string" ? unit : unit.text;
    }
    return text;
  }

  #layout(
    width: number,
    options: IPromptRenderOptions,
    suggestion: string,
  ): IFramePrompt {
    const { sigil, color } = options;
    let sigilWidth = 0;
    for (const unit of textUnits(sigil)) sigilWidth += unit.width;
    // Trop étroit pour le signe et une colonne : une colonne de saisie quand même.
    const room = Math.max(1, width - sigilWidth);
    const rows: string[] = [""];
    const firsts: number[] = [0];
    let used = 0;
    let cursorRow = 0;
    let cursorColumn = 0;
    const newRow = (first: number): void => {
      rows.push("");
      firsts.push(first);
      used = 0;
    };
    const units = this.#units;
    const cursor = this.#cursor;
    if (units.length === 0) {
      cursorColumn = 0;
      const placeholder = options.placeholder;
      if (placeholder !== "" && room > 2) {
        let text = "";
        let cells = 0;
        for (const unit of textUnits(placeholder)) {
          if (unit.control) continue;
          if (cells + unit.width > room - 1) break;
          text += unit.text;
          cells += unit.width;
        }
        // Le curseur occupe la première case ; le texte grisé commence après.
        rows[0] = color ? ` ${DIM}${text}${RESET}` : ` ${text}`;
        used = cells + 1;
      }
    }
    let index = 0;
    for (const unit of units) {
      if (unit === "\n") {
        if (index === cursor) {
          cursorRow = rows.length - 1;
          // Après le dernier caractère, jamais dessus : l'image garde une
          // colonne libre et `renderFrame` borne le curseur.
          cursorColumn = used;
        }
        newRow(index + 1);
        index++;
        continue;
      }
      let cells = cellsOf(unit, used);
      // Un seul point de repli : l'unité qui ne tient plus passe à la ligne,
      // et le curseur posé sur elle la suit — une tabulation repliée repart
      // d'un taquet plein.
      if (used + cells > room && used > 0) {
        newRow(index);
        cells = cellsOf(unit, used);
      }
      const text =
        typeof unit !== "string"
          ? color
            ? `${ATTACHMENT_COLOR}${unit.label}${RESET}`
            : unit.label
          : unit === "\t"
            ? " ".repeat(cells)
            : unit;
      if (index === cursor) {
        cursorRow = rows.length - 1;
        cursorColumn = used;
      }
      rows[rows.length - 1] += text;
      used += cells;
      index++;
    }
    if (units.length > 0 && cursor === units.length) {
      if (used >= room) newRow(units.length);
      cursorRow = rows.length - 1;
      cursorColumn = used;
      if (suggestion !== "") {
        let text = "";
        let cells = 0;
        for (const unit of textUnits(suggestion)) {
          if (unit.control) continue;
          if (used + cells + unit.width > room) break;
          text += unit.text;
          cells += unit.width;
        }
        if (text !== "")
          rows[rows.length - 1] += color ? `${DIM}${text}${RESET}` : text;
      }
    }
    // Fenêtre de PROMPT_MAX_ROWS lignes autour du curseur.
    const start = Math.max(
      0,
      Math.min(cursorRow - PROMPT_MAX_ROWS + 1, rows.length - PROMPT_MAX_ROWS),
    );
    const end = Math.min(rows.length, start + PROMPT_MAX_ROWS);
    this.#rowFirsts = firsts;
    this.#windowStart = start;
    this.#sigilWidth = sigilWidth;
    const head = color ? `\x1b[1m\x1b[35m${sigil}${RESET}` : sigil;
    const indent = " ".repeat(sigilWidth);
    // Des lignes au-dessus de la fenêtre : la première visible le dit.
    const above =
      sigilWidth >= 2
        ? `${" ".repeat(sigilWidth - 2)}${color ? `${DIM}↑${RESET}` : "↑"} `
        : indent;
    const lines: string[] = [];
    for (let row = start; row < end; row++) {
      const prefix = row === 0 ? head : row === start ? above : indent;
      lines.push(prefix + (rows[row] ?? ""));
    }
    return {
      lines,
      cursor: { row: cursorRow - start, column: sigilWidth + cursorColumn },
    };
  }
}
