/**
 * L'image du terminal de développement, calculée sans terminal : trois zones
 * fixes — le journal (une fenêtre de l'historique), l'invite, la barre d'état
 * — rendues en lignes, chacune bornée à `columns - 1` colonnes. Cf ADR-0013
 * §3 et §9.
 *
 * `renderFrame` est pur : il lit le modèle et rend `{ lines, cursor }` ; qui
 * possède le terminal écrit l'image en UNE écriture, de préférence par
 * {@link diffFrame} (seules les lignes qui ont changé).
 *
 * La fenêtre du journal est ANCRÉE sur une entrée (`seq`), pas sur un numéro
 * de ligne : des lignes qui arrivent, une éviction en tête ou un
 * redimensionnement ne la font pas glisser. Ancrée, elle signale ce qui est
 * arrivé dessous (« ↑ N nouvelles lignes — Fin »).
 */
import { fitToWidth, wrapToWidth } from "../../runtime/textWidth";
import type { ITranscriptEntry } from "./devTranscript";
import {
  renderStatusBar,
  type IStartupView,
  type IStatusContext,
  type ScreenCharset,
} from "./startupScreen";

/** Où en est le serveur, du point de vue du superviseur. */
export type DevPhase =
  "booting" | "building" | "ready" | "restarting" | "crashed";

/** Ce que l'image lit de l'historique (`DevTranscript` le fournit). */
export interface ITranscriptReader {
  readonly length: number;
  readonly lastSeq: number;
  at(index: number): ITranscriptEntry | undefined;
  indexOf(seq: number): number;
}

/**
 * Le bas de la fenêtre quand on a remonté le journal : l'entrée `seq`, dont
 * les `below` dernières lignes repliées sont cachées sous la fenêtre.
 */
export interface IScrollAnchor {
  readonly seq: number;
  readonly below: number;
}

/** La barre d'état : le bilan du serveur, s'il en a donné un, et la phase. */
export interface IFrameStatus {
  /** `null` tant que le serveur n'a rien dit. */
  readonly view: IStartupView | null;
  readonly context: IStatusContext;
  readonly phase: DevPhase;
}

/** L'invite (#538) : ses lignes et la position du curseur DANS ces lignes. */
export interface IFramePrompt {
  readonly lines: readonly string[];
  readonly cursor: { row: number; column: number };
}

/** Tout ce que l'image lit. */
export interface IFrameModel {
  readonly transcript: ITranscriptReader;
  /** `null` = en direct : la fenêtre suit la dernière entrée. */
  readonly anchor: IScrollAnchor | null;
  readonly status: IFrameStatus | null;
  /** Absente ou `null` : invite de hauteur 0. */
  readonly prompt?: IFramePrompt | null;
  readonly color: boolean;
  readonly charset: ScreenCharset;
  /** Les lignes de la marque (`brandMark`) pour le bloc d'état. */
  readonly mark: readonly string[];
  /** Cache des hauteurs repliées — à garder d'une image à l'autre. */
  readonly heights?: FrameHeights;
}

/** Dimensions du terminal. */
export interface IFrameSize {
  readonly columns: number;
  readonly rows: number;
}

/** Une image : exactement `rows` lignes, et le curseur s'il y a une invite. */
export interface IFrame {
  readonly lines: readonly string[];
  readonly cursor: { row: number; column: number } | null;
}

/** Une ligne à réécrire. */
export interface IFrameChange {
  readonly row: number;
  readonly text: string;
}

/** Effacement de ligne : utile en rendu en ligne, destructeur dans une image. */
const ERASE_IN_LINE = /\x1b\[[012]?K/g;

/** Libellé de la barre quand le serveur n'a pas (ou plus) de bilan à montrer. */
const PHASE_LABELS: Readonly<Record<DevPhase, string>> = {
  booting: "démarrage…",
  building: "construction…",
  ready: "prêt",
  restarting: "redémarrage…",
  crashed: "arrêté — en attente d'une modification",
};

/**
 * Hauteurs repliées des entrées, mémoïsées pour UNE largeur : changer de
 * largeur invalide tout. De quoi faire défiler par lignes d'écran sans
 * replier tout l'historique à chaque geste.
 */
export class FrameHeights {
  #width = -1;
  readonly #heights = new Map<number, number>();

  /**
   * Replie une entrée et retient sa hauteur.
   *
   * @param entry - l'entrée.
   * @param width - largeur de repli, en colonnes.
   * @returns ses lignes repliées.
   */
  lines(entry: ITranscriptEntry, width: number): string[] {
    this.#reset(width);
    const lines = wrapToWidth(entry.text.replace(ERASE_IN_LINE, ""), width);
    this.#heights.set(entry.seq, lines.length);
    return lines;
  }

  /**
   * Hauteur repliée d'une entrée, calculée une seule fois par largeur.
   *
   * @param entry - l'entrée.
   * @param width - largeur de repli, en colonnes.
   * @returns le nombre de lignes d'écran.
   */
  height(entry: ITranscriptEntry, width: number): number {
    this.#reset(width);
    return this.#heights.get(entry.seq) ?? this.lines(entry, width).length;
  }

  /** Nombre de hauteurs retenues. */
  get size(): number {
    return this.#heights.size;
  }

  /**
   * Oublie les hauteurs des entrées évincées de l'historique.
   *
   * @param firstSeq - numéro de la plus ancienne entrée encore retenue.
   */
  prune(firstSeq: number): void {
    for (const seq of this.#heights.keys()) {
      if (seq < firstSeq) this.#heights.delete(seq);
    }
  }

  /** Une autre largeur rend toutes les hauteurs fausses. */
  #reset(width: number): void {
    if (width === this.#width) return;
    this.#width = width;
    this.#heights.clear();
  }
}

/**
 * Les lignes de la barre d'état : le bloc (ou la ligne) du bilan quand le
 * serveur est prêt, sinon la phase.
 */
function statusLines(model: IFrameModel, size: IFrameSize): readonly string[] {
  const status = model.status;
  if (status === null) return [];
  const { view, context, phase } = status;
  if (phase === "ready" && view !== null) {
    return renderStatusBar(
      view,
      context,
      {
        color: model.color,
        columns: size.columns,
        rows: size.rows,
        charset: model.charset,
      },
      model.mark,
    );
  }
  const label = `${context.project} · ${PHASE_LABELS[phase]}`;
  return [model.color ? `\x1b[2m${label}\x1b[0m` : label];
}

/**
 * L'indicateur de ce qui est arrivé sous une fenêtre remontée.
 *
 * @param count - entrées postérieures à l'ancre.
 * @param model - couleur et jeu de caractères.
 * @returns la ligne.
 */
function unseenLine(count: number, model: IFrameModel): string {
  const ascii = model.charset === "ascii";
  const plural = count > 1 ? "s" : "";
  const text = `${ascii ? "^" : "↑"} ${count} nouvelle${plural} ligne${plural} ${ascii ? "-" : "—"} Fin`;
  return model.color ? `\x1b[7m ${text} \x1b[0m` : text;
}

/**
 * Les `height` lignes du journal, de haut en bas, complétées par le haut.
 */
function journalLines(
  model: IFrameModel,
  heights: FrameHeights,
  width: number,
  height: number,
): string[] {
  if (height <= 0) return [];
  const transcript = model.transcript;
  const out: string[] = [];
  const first = transcript.at(0);
  if (first) {
    let index = transcript.length - 1;
    let below = 0;
    let fromTop = false;
    if (model.anchor !== null && model.anchor.seq <= transcript.lastSeq) {
      const at = transcript.indexOf(model.anchor.seq);
      if (at === -1)
        fromTop = true; // ancre évincée : on montre le plus ancien
      else {
        index = at;
        below = model.anchor.below;
      }
    }
    if (fromTop) {
      for (let i = 0; i < transcript.length && out.length < height; i++) {
        const entry = transcript.at(i);
        if (entry) out.push(...heights.lines(entry, width));
      }
      out.length = Math.min(out.length, height);
    } else {
      for (let i = index; i >= 0 && out.length < height; i--) {
        const entry = transcript.at(i);
        if (!entry) continue;
        let lines = heights.lines(entry, width);
        if (i === index && below > 0) {
          lines = lines.slice(0, Math.max(1, lines.length - below));
        }
        out.unshift(...lines);
      }
      if (out.length > height) out.splice(0, out.length - height);
    }
  }
  while (out.length < height) out.unshift("");
  return out;
}

/**
 * Calcule l'image du terminal.
 *
 * @param model - historique, ancre, barre, invite, rendu.
 * @param size - dimensions du terminal.
 * @returns exactement `rows` lignes, aucune plus large que `columns - 1`
 *   colonnes, et le curseur (sur l'invite) ou `null`.
 */
export function renderFrame(model: IFrameModel, size: IFrameSize): IFrame {
  const rows = Math.max(0, Math.floor(size.rows));
  const width = Math.max(1, Math.floor(size.columns) - 1);
  const heights = model.heights ?? new FrameHeights();
  const first = model.transcript.at(0);
  if (first && heights.size > 2 * model.transcript.length + 64) {
    heights.prune(first.seq);
  }
  const bar = statusLines(model, size);
  const prompt = model.prompt ?? null;
  const promptLines = prompt?.lines ?? [];
  const unseen =
    model.anchor === null
      ? 0
      : Math.max(0, model.transcript.lastSeq - model.anchor.seq);
  const indicator = unseen > 0 ? [unseenLine(unseen, model)] : [];
  const journalHeight =
    rows - bar.length - promptLines.length - indicator.length;
  const all = [
    ...journalLines(model, heights, width, journalHeight),
    ...indicator,
    ...promptLines,
    ...bar,
  ];
  // Trop bas pour tout : la barre et l'invite gagnent, par le bas.
  const lines = all
    .slice(Math.max(0, all.length - rows))
    .map((line) => fitToWidth(line.replace(ERASE_IN_LINE, ""), width));
  let cursor: IFrame["cursor"] = null;
  if (prompt !== null) {
    const top = lines.length - bar.length - promptLines.length;
    const row = top + prompt.cursor.row;
    if (row >= 0 && row < lines.length) {
      cursor = { row, column: Math.min(prompt.cursor.column, width) };
    }
  }
  return { lines, cursor };
}

/**
 * Les lignes à réécrire pour passer d'une image à la suivante.
 *
 * @param previous - l'image à l'écran, ou `null` (premier dessin).
 * @param next - l'image à dessiner.
 * @returns les lignes changées ; TOUTES si la hauteur a changé.
 */
export function diffFrame(
  previous: IFrame | null,
  next: IFrame,
): IFrameChange[] {
  const changes: IFrameChange[] = [];
  const full = previous === null || previous.lines.length !== next.lines.length;
  next.lines.forEach((text, row) => {
    if (full || previous.lines[row] !== text) changes.push({ row, text });
  });
  return changes;
}
