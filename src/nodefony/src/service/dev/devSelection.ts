/**
 * La sélection à la souris du plein écran, calculée sans terminal (#537,
 * ADR-0013 §2).
 *
 * Une extrémité de sélection est une CELLULE de l'historique : une entrée
 * (`seq`) et une colonne VISIBLE dans sa ligne logique — jamais une position
 * d'écran. Un défilement pendant le glisser, une ligne qui arrive, un
 * redimensionnement qui replie autrement : la sélection reste sur le même
 * texte. Le texte copié vient des ENTRÉES, pas de l'écran : une ligne repliée
 * se copie entière, sans le retour à la ligne du repli, sans couleurs ni
 * hyperliens, espaces de fin coupés.
 */
import { textUnits } from "../../runtime/textWidth";
import type { ITranscriptEntry } from "./devTranscript";

/** Une cellule de l'historique : une entrée et une colonne visible (depuis 0). */
export interface ISelectionPoint {
  readonly seq: number;
  readonly column: number;
}

/** Ce que sélectionne un geste : caractères (glisser), mot (double clic), ligne (triple). */
export type SelectionUnit = "char" | "word" | "line";

/** Une sélection en cours : là où le bouton a été enfoncé, là où il est. */
export interface ISelection {
  readonly anchor: ISelectionPoint;
  readonly head: ISelectionPoint;
  readonly unit: SelectionUnit;
}

/**
 * Une sélection normalisée : de `start` (inclus) à `end` (exclu), en colonnes
 * visibles. `end.column` vaut `Infinity` pour « jusqu'au bout de la ligne ».
 */
export interface ISelectionRange {
  readonly start: ISelectionPoint;
  readonly end: ISelectionPoint;
}

/** Ce que la sélection lit de l'historique (`DevTranscript` le fournit). */
export interface ISelectionReader {
  readonly length: number;
  at(index: number): ITranscriptEntry | undefined;
  indexOf(seq: number): number;
}

/**
 * Ce qui fait partie d'un mot pour le double clic : lettres, chiffres, et les
 * caractères d'un chemin ou d'une URL — `src/a.ts:12:3` ou
 * `https://x.dev/?a=1` se sélectionnent d'un geste (patron iTerm2).
 */
const WORD_CHAR = /^[\p{L}\p{M}\p{N}_/:.\-~+@%#?=&]+$/u;

/** Un graphème visible et les colonnes qu'il occupe. */
interface ICell {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Les graphèmes visibles d'une ligne, avec leurs colonnes — séquences de
 * contrôle retirées, graphèmes sans largeur rattachés au précédent.
 */
function cells(text: string): ICell[] {
  const out: ICell[] = [];
  let column = 0;
  for (const unit of textUnits(text)) {
    if (unit.control) continue;
    if (unit.width === 0) {
      const last = out.at(-1);
      if (last) out[out.length - 1] = { ...last, text: last.text + unit.text };
      continue;
    }
    out.push({ text: unit.text, start: column, end: column + unit.width });
    column += unit.width;
  }
  return out;
}

/**
 * Compare deux cellules dans l'ordre de l'historique.
 *
 * @param a - première cellule.
 * @param b - seconde cellule.
 * @returns négatif si `a` précède `b`, positif s'il la suit, `0` si égales.
 */
export function comparePoints(a: ISelectionPoint, b: ISelectionPoint): number {
  return a.seq === b.seq ? a.column - b.column : a.seq - b.seq;
}

/**
 * Le texte visible d'une ligne entre deux colonnes : un graphème est pris
 * dès qu'il chevauche l'intervalle — un caractère large à moitié couvert est
 * sélectionné entier.
 *
 * @param text - la ligne, couleurs comprises.
 * @param from - première colonne (incluse).
 * @param to - dernière colonne (exclue), `Infinity` pour la fin.
 * @returns le texte, sans aucune séquence de contrôle.
 */
export function sliceColumns(text: string, from: number, to: number): string {
  let out = "";
  for (const cell of cells(text)) {
    if (cell.start < to && cell.end > from) out += cell.text;
  }
  return out;
}

/**
 * Les bornes du mot sous une colonne (double clic). Hors d'un mot, le seul
 * graphème sous la colonne ; au-delà de la fin de la ligne, rien.
 *
 * @param text - la ligne, couleurs comprises.
 * @param column - la colonne visible cliquée.
 * @returns `[début, fin)` en colonnes visibles.
 */
export function wordBounds(text: string, column: number): [number, number] {
  const all = cells(text);
  const at = all.findIndex((cell) => cell.start <= column && column < cell.end);
  if (at === -1) return [column, column];
  const hit = all[at] as ICell;
  if (!WORD_CHAR.test(hit.text)) return [hit.start, hit.end];
  let first = at;
  let last = at;
  while (first > 0 && WORD_CHAR.test((all[first - 1] as ICell).text)) first--;
  while (last < all.length - 1 && WORD_CHAR.test((all[last + 1] as ICell).text))
    last++;
  return [(all[first] as ICell).start, (all[last] as ICell).end];
}

/** Le texte d'une entrée, ou `""` si elle a été évincée. */
function entryText(reader: ISelectionReader, seq: number): string {
  const index = reader.indexOf(seq);
  return index === -1 ? "" : (reader.at(index)?.text ?? "");
}

/**
 * Normalise une sélection : extrémités dans l'ordre, étendues au mot ou à la
 * ligne selon le geste. En caractères, la cellule de tête est incluse.
 *
 * @param selection - la sélection en cours.
 * @param reader - l'historique, pour les bornes de mot.
 * @returns l'intervalle `[start, end)`, ou `null` s'il est vide.
 */
export function selectionRange(
  selection: ISelection,
  reader: ISelectionReader,
): ISelectionRange | null {
  const forward = comparePoints(selection.anchor, selection.head) <= 0;
  const first = forward ? selection.anchor : selection.head;
  const last = forward ? selection.head : selection.anchor;
  let start: ISelectionPoint;
  let end: ISelectionPoint;
  if (selection.unit === "line") {
    start = { seq: first.seq, column: 0 };
    end = { seq: last.seq, column: Number.POSITIVE_INFINITY };
  } else if (selection.unit === "word") {
    const [from] = wordBounds(entryText(reader, first.seq), first.column);
    const [, to] = wordBounds(entryText(reader, last.seq), last.column);
    start = { seq: first.seq, column: from };
    end = { seq: last.seq, column: to };
  } else {
    start = first;
    end = { seq: last.seq, column: last.column + 1 };
  }
  return comparePoints(start, end) < 0 ? { start, end } : null;
}

/**
 * Le texte d'une sélection, tel qu'il part dans le presse-papiers : une ligne
 * logique par entrée, jointes par `\n`, sans séquences de contrôle, espaces
 * de fin coupés. Les entrées évincées entre-temps sont sautées.
 *
 * @param reader - l'historique.
 * @param range - l'intervalle normalisé.
 * @returns le texte sélectionné.
 */
export function extractSelection(
  reader: ISelectionReader,
  range: ISelectionRange,
): string {
  const { start, end } = range;
  const out: string[] = [];
  for (
    let index = firstIndexFrom(reader, start.seq);
    index < reader.length;
    index++
  ) {
    const entry = reader.at(index);
    if (!entry) continue;
    if (entry.seq > end.seq) break;
    const from = entry.seq === start.seq ? start.column : 0;
    const to = entry.seq === end.seq ? end.column : Number.POSITIVE_INFINITY;
    out.push(sliceColumns(entry.text, from, to).trimEnd());
  }
  return out.join("\n");
}

/** Index de la première entrée de numéro ≥ `seq` (l'entrée a pu être évincée). */
function firstIndexFrom(reader: ISelectionReader, seq: number): number {
  const index = reader.indexOf(seq);
  if (index !== -1) return index;
  const first = reader.at(0);
  return first !== undefined && first.seq > seq ? 0 : reader.length;
}
