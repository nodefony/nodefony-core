/**
 * L'hôte « pied de terminal » du moteur de question (#538 lot 2b-1) : la
 * question se dessine SOUS la sortie de la commande, sans plein écran, et se
 * redessine en place à chaque frappe. Une fois réglée, elle laisse une seule
 * ligne de résumé — un secret n'y figure jamais.
 *
 * L'hôte ne décide RIEN : touches, validation, lignes et résumé viennent de
 * `question.ts`. Il ne fait que passer le clavier en mode brut, verser les
 * octets dans le vrai `InputDecoder`, écrire les lignes rendues et rendre le
 * terminal tel qu'il l'a trouvé, sur tous les chemins (`guardTerminal`).
 */
import clc from "../colors";
import { terminalSize } from "../runtime/isTerminal";
import { guardTerminal } from "../runtime/terminalGuard";
import { ESCAPE_TIMEOUT_MS, InputDecoder } from "../service/dev/inputDecoder";
import {
  QuestionState,
  handleQuestion,
  renderQuestion,
  summarizeQuestion,
  type IQuestion,
  type IQuestionOutcome,
  type QuestionPaint,
} from "./question";

/** Le clavier, injectable en test. */
export interface IQuestionFooterInput {
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  removeListener(
    event: "data",
    listener: (chunk: Buffer | string) => void,
  ): unknown;
  removeListener(event: "end", listener: () => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

/** Le terminal, injectable en test. */
export interface IQuestionFooterOutput {
  write(chunk: string): unknown;
  columns?: number;
  rows?: number;
  on?(event: "resize", listener: () => void): unknown;
  removeListener?(event: "resize", listener: () => void): unknown;
}

/** Les réglages de l'hôte ; tout a un défaut sur le processus. */
export interface IQuestionFooterOptions {
  readonly input?: IQuestionFooterInput;
  readonly output?: IQuestionFooterOutput;
  /** Couleurs — le verdict de l'appelant (`NO_COLOR`, `FORCE_COLOR`, terminal). */
  readonly color?: boolean;
}

const CSI = "\x1b[";
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const CLEAR_BELOW = `${CSI}J`;
/** Repli quand le terminal ne dit pas sa taille. */
const FALLBACK_COLUMNS = 80;
const FALLBACK_ROWS = 24;

const COLOR_PAINT: QuestionPaint = (tone, text) => {
  if (tone === "accent") return clc.cyan(text);
  if (tone === "error") return clc.red(text);
  return clc.blackBright(text);
};
const NO_PAINT: QuestionPaint = (_tone, text) => text;

function up(rows: number): string {
  return rows > 0 ? `${CSI}${rows}A` : "";
}

function right(columns: number): string {
  return columns > 0 ? `${CSI}${columns}C` : "";
}

/**
 * Pose une question au pied du terminal et attend son issue.
 *
 * ⚠️ Exige un VRAI terminal en entrée comme en sortie : la porte (`ask.ts`)
 * le constate avant d'appeler, et refuse sinon en nommant le drapeau.
 *
 * @param question - la question.
 * @param options - clavier, terminal, couleurs.
 * @returns l'issue — `accept` avec la valeur, ou `cancel` (Échap, Ctrl+C,
 *   clavier fermé).
 */
export function askInFooter(
  question: IQuestion,
  options: IQuestionFooterOptions = {},
): Promise<IQuestionOutcome> {
  const input: IQuestionFooterInput = options.input ?? process.stdin;
  const output: IQuestionFooterOutput = options.output ?? process.stdout;
  const paint = options.color === true ? COLOR_PAINT : NO_PAINT;
  const state = new QuestionState(question);
  const decoder = new InputDecoder();
  const wasRaw = input.isRaw === true;
  /** Ligne du bloc où se trouve le curseur du terminal (0 = première). */
  let cursorRow = 0;
  let escapeTimer: ReturnType<typeof setTimeout> | null = null;

  const size = (): { columns: number; rows: number } => {
    const measured = terminalSize(output);
    return {
      columns: measured.columns ?? output.columns ?? FALLBACK_COLUMNS,
      rows: measured.rows ?? output.rows ?? FALLBACK_ROWS,
    };
  };

  /** Remonte au début du bloc et l'efface. */
  const erase = (): string => `${up(cursorRow)}\r${CLEAR_BELOW}`;

  const draw = (): void => {
    const { columns, rows } = size();
    // Une colonne de marge : écrire la dernière colonne déclenche le retour
    // automatique de certains terminaux, et le bloc compterait une ligne de trop.
    const view = renderQuestion(
      state,
      Math.max(1, columns - 1),
      Math.max(3, rows - 1),
      paint,
    );
    const last = view.lines.length - 1;
    let frame = erase() + view.lines.join("\r\n");
    if (view.cursor === null) {
      frame += HIDE_CURSOR;
      cursorRow = last;
    } else {
      frame += `${up(last - view.cursor.row)}\r${right(view.cursor.column)}${SHOW_CURSOR}`;
      cursorRow = view.cursor.row;
    }
    output.write(frame);
  };

  const restoreKeyboard = (): void => {
    input.setRawMode?.(wasRaw);
  };
  const release = guardTerminal(() => {
    restoreKeyboard();
    output.write(SHOW_CURSOR);
  });

  return new Promise<IQuestionOutcome>((resolve) => {
    const finish = (): void => {
      if (escapeTimer !== null) clearTimeout(escapeTimer);
      escapeTimer = null;
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      output.removeListener?.("resize", draw);
      input.pause();
      const summary = summarizeQuestion(state);
      output.write(
        `${erase()}${summary === "" ? "" : `${summary}\r\n`}${SHOW_CURSOR}`,
      );
      restoreKeyboard();
      release();
      resolve(state.outcome ?? { action: "cancel" });
    };
    const dispatch = (events: ReturnType<InputDecoder["feed"]>): boolean => {
      let changed = false;
      for (const event of events) {
        if (handleQuestion(state, event)) changed = true;
        if (state.settled) return true;
      }
      if (changed) draw();
      return false;
    };
    const onData = (chunk: Buffer | string): void => {
      if (escapeTimer !== null) {
        clearTimeout(escapeTimer);
        escapeTimer = null;
      }
      if (dispatch(decoder.feed(chunk))) {
        finish();
        return;
      }
      // Un Échap seul est indiscernable d'un début de séquence : il attend un
      // court instant sans octet avant d'être rendu.
      if (decoder.pending) {
        escapeTimer = setTimeout(() => {
          escapeTimer = null;
          if (dispatch(decoder.flush())) finish();
        }, ESCAPE_TIMEOUT_MS);
      }
    };
    // Clavier fermé (fin de flux) : personne ne répondra, la question s'annule.
    const onEnd = (): void => {
      if (!state.settled) state.outcome = { action: "cancel" };
      finish();
    };
    input.setRawMode?.(true);
    input.on("data", onData);
    input.on("end", onEnd);
    output.on?.("resize", draw);
    draw();
    input.resume();
  });
}
