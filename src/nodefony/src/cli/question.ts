/**
 * Le moteur de question UNIQUE (#538 lot 2b) : une question est une DONNÉE,
 * une machine d'état la fait vivre, un rendu en LIGNES la dessine.
 *
 * Ni terminal, ni flux, ni horloge : deux hôtes minces le montent sans rien
 * décider — le pied d'un vrai terminal (`questionFooter.ts`) et, plus tard, la
 * bande d'une vue du superviseur. La même question rend donc les mêmes lignes
 * et la même réponse partout ; un test de parité PAR OCTETS les tient ensemble.
 *
 * Six formes, fermées : `input`, `secret`, `confirm`, `select`, `checkbox`,
 * `list`. Une forme absente se refuse en nommant le prêt du terminal — jamais
 * une septième écrite à la volée.
 */
import {
  textUnits,
  visibleWidth,
  fitToWidth,
  wrapToWidth,
} from "../runtime/textWidth";
import { LineEditor } from "../service/dev/lineEditor";
import type { InputEvent } from "../service/dev/inputDecoder";

/** Les six formes d'une question. */
export type QuestionKind =
  "input" | "secret" | "confirm" | "select" | "checkbox" | "list";

/** Un choix d'une question `select` ou `checkbox`. */
export interface IQuestionChoice {
  /** La valeur rendue — un texte, pour voyager tel quel dans un drapeau. */
  readonly value: string;
  readonly label: string;
  /** Une précision grisée, après le libellé. */
  readonly hint?: string;
  /** Visible mais inatteignable. */
  readonly disabled?: boolean;
  /** `checkbox` : coché à l'ouverture. */
  readonly checked?: boolean;
}

/** Ce que partagent les six formes. */
interface IQuestionBase {
  /** La clé de la réponse — et le drapeau `--<key>` qui la fournit sans terminal. */
  readonly key: string;
  readonly message: string;
  /** Ce qui vaut pour la question ENTIÈRE, dit au moment où elle est posée. */
  readonly note?: string;
  /** Le drapeau qui fournit la réponse, quand il n'est pas `--<key>`. */
  readonly flag?: string;
  /**
   * Un refus déjà prononcé par la COMMANDE (D1 : la validation qui ne se
   * déclare pas se fait après coup, puis la question est reposée avec lui).
   */
  readonly error?: string;
}

/** Une ligne de texte. */
export interface IInputQuestion extends IQuestionBase {
  readonly kind: "input";
  readonly default?: string;
  /** Source d'une expression régulière (sans drapeaux, lue en `u`). */
  readonly pattern?: string;
  readonly patternHint?: string;
  readonly required?: boolean;
}

/** Une ligne de texte jamais affichée ni résumée. */
export interface ISecretQuestion extends IQuestionBase {
  readonly kind: "secret";
  readonly pattern?: string;
  readonly patternHint?: string;
  readonly required?: boolean;
}

/** Oui ou non. */
export interface IConfirmQuestion extends IQuestionBase {
  readonly kind: "confirm";
  /** Ce qu'Entrée répond ; `false` sans valeur. */
  readonly default?: boolean;
}

/** Une valeur parmi des choix. */
export interface ISelectQuestion extends IQuestionBase {
  readonly kind: "select";
  readonly choices: readonly IQuestionChoice[];
  readonly default?: string;
}

/** Plusieurs valeurs parmi des choix. */
export interface ICheckboxQuestion extends IQuestionBase {
  readonly kind: "checkbox";
  readonly choices: readonly IQuestionChoice[];
  /** Au moins une case. */
  readonly required?: boolean;
}

/**
 * Plusieurs valeurs LIBRES, chacune gardée entière : `"siteId,createdAt"` est
 * UN index de deux colonnes, jamais deux valeurs.
 */
export interface IListQuestion extends IQuestionBase {
  readonly kind: "list";
  readonly default?: readonly string[];
  /** Ce que chaque valeur doit satisfaire. */
  readonly pattern?: string;
  readonly patternHint?: string;
  /** Au moins une valeur. */
  readonly required?: boolean;
}

/** Une question : une donnée sérialisable, qui voyage telle quelle sur un canal. */
export type IQuestion =
  | IInputQuestion
  | ISecretQuestion
  | IConfirmQuestion
  | ISelectQuestion
  | ICheckboxQuestion
  | IListQuestion;

/** Le type de la réponse d'une question, selon sa forme. */
export type QuestionAnswer<Q extends IQuestion> = Q extends IConfirmQuestion
  ? boolean
  : Q extends ICheckboxQuestion | IListQuestion
    ? string[]
    : string;

/** Toute réponse, quelle que soit la forme. */
export type QuestionValue = string | boolean | string[];

/**
 * L'issue d'une question — le triplet de l'élicitation MCP. Le moteur ne rend
 * que `accept` et `cancel` ; `decline` appartient aux hôtes distants.
 */
export interface IQuestionOutcome {
  readonly action: "accept" | "decline" | "cancel";
  readonly value?: QuestionValue;
}

/** Les trois tons du rendu ; l'hôte les peint (ou non). */
export type QuestionTone = "accent" | "dim" | "error";

/** Peint un texte dans un ton — l'identité sans couleur. */
export type QuestionPaint = (tone: QuestionTone, text: string) => string;

/** L'image d'une question : ses lignes et la place du curseur, s'il en faut un. */
export interface IQuestionView {
  readonly lines: readonly string[];
  /** Ligne et colonne (depuis 0) ; `null` = curseur masqué. */
  readonly cursor: { readonly row: number; readonly column: number } | null;
}

/** Nombre de choix visibles quand l'hôte ne borne pas la hauteur. */
const DEFAULT_PAGE = 10;
const NO_PAINT: QuestionPaint = (_tone, text) => text;

/**
 * L'état d'une question ouverte. Forme stable : chaque champ est posé au
 * constructeur, `null` quand la forme ne s'en sert pas.
 */
export class QuestionState {
  readonly question: IQuestion;
  /** `select` / `checkbox` : le choix sous le curseur. */
  cursor: number;
  /** `select` / `checkbox` : le premier choix visible. */
  top: number;
  /** `select` / `checkbox` : choix visibles au dernier rendu. */
  page: number;
  /** `checkbox` : les valeurs cochées. */
  readonly checked: Set<string> | null;
  /** `input` / `secret` / `list` : la ligne en cours. */
  readonly editor: LineEditor | null;
  /** `list` : les valeurs déjà ajoutées. */
  readonly values: string[] | null;
  /** Le refus à montrer sous la question, effacé à la frappe suivante. */
  error: string | null;
  /** L'issue, une fois la question réglée. */
  outcome: IQuestionOutcome | null;

  /**
   * Ouvre une question.
   *
   * @param question - la question, telle que la commande la pose.
   */
  constructor(question: IQuestion) {
    this.question = question;
    this.cursor = 0;
    this.top = 0;
    this.page = DEFAULT_PAGE;
    this.checked = null;
    this.editor = null;
    this.values = null;
    this.error = question.error ?? null;
    this.outcome = null;
    switch (question.kind) {
      case "select": {
        const at = question.choices.findIndex(
          (c) => c.value === question.default && c.disabled !== true,
        );
        this.cursor = at >= 0 ? at : firstEnabled(question.choices);
        break;
      }
      case "checkbox":
        this.checked = new Set(
          question.choices
            .filter((c) => c.checked === true)
            .map((c) => c.value),
        );
        this.cursor = firstEnabled(question.choices);
        break;
      case "list":
        this.values = question.default ? [...question.default] : [];
        this.editor = new LineEditor();
        break;
      case "input":
      case "secret":
        this.editor = new LineEditor();
        break;
      case "confirm":
        break;
    }
  }

  /** La question est-elle réglée ? */
  get settled(): boolean {
    return this.outcome !== null;
  }
}

/** Le premier choix atteignable (0 si aucun). */
function firstEnabled(choices: readonly IQuestionChoice[]): number {
  const at = choices.findIndex((c) => c.disabled !== true);
  return at >= 0 ? at : 0;
}

/** Le drapeau qui fournit la réponse d'une question. */
export function questionFlag(question: IQuestion): string {
  return question.flag ?? `--${question.key}`;
}

/**
 * Vérifie une réponse contre ce que la question DÉCLARE — quelle que soit sa
 * provenance (frappe, drapeau, canal). La seule validation : le moteur, la
 * porte et un hôte distant l'appellent tous.
 *
 * @param question - la question.
 * @param value - la réponse reçue.
 * @returns le refus à dire, ou `null` si la réponse tient.
 */
export function checkAnswer(
  question: IQuestion,
  value: unknown,
): string | null {
  switch (question.kind) {
    case "confirm":
      return typeof value === "boolean" ? null : "réponds oui ou non";
    case "input":
    case "secret":
      if (typeof value !== "string") return "une réponse en texte est attendue";
      if (value === "")
        return question.required === true ? "une réponse est requise" : null;
      return checkPattern(question.pattern, question.patternHint, value);
    case "select": {
      if (typeof value !== "string") return "un choix est attendu";
      const choice = question.choices.find((c) => c.value === value);
      if (!choice)
        return `choix inconnu : ${value} (${allowed(question.choices)})`;
      return choice.disabled === true ? `choix indisponible : ${value}` : null;
    }
    case "checkbox": {
      if (!isStringArray(value)) return "une liste de choix est attendue";
      for (const v of value) {
        const choice = question.choices.find((c) => c.value === v);
        if (!choice)
          return `choix inconnu : ${v} (${allowed(question.choices)})`;
        if (choice.disabled === true) return `choix indisponible : ${v}`;
      }
      return value.length === 0 && question.required === true
        ? "coche au moins une case"
        : null;
    }
    case "list": {
      if (!isStringArray(value)) return "une liste de valeurs est attendue";
      for (const v of value) {
        const error = checkPattern(question.pattern, question.patternHint, v);
        if (error !== null) return `${v} : ${error}`;
      }
      return value.length === 0 && question.required === true
        ? "au moins une valeur est requise"
        : null;
    }
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function allowed(choices: readonly IQuestionChoice[]): string {
  return choices
    .filter((c) => c.disabled !== true)
    .map((c) => c.value)
    .join(" | ");
}

function checkPattern(
  pattern: string | undefined,
  hint: string | undefined,
  value: string,
): string | null {
  if (pattern === undefined || new RegExp(pattern, "u").test(value))
    return null;
  return hint ?? `doit satisfaire ${pattern}`;
}

/**
 * Applique un évènement du clavier — celui que rend `InputDecoder`, jamais un
 * évènement fabriqué : l'Espace nu y arrive en `text`.
 *
 * @param state - la question ouverte (modifiée en place).
 * @param event - l'évènement décodé.
 * @returns `true` si l'image a changé (à redessiner).
 */
export function handleQuestion(
  state: QuestionState,
  event: InputEvent,
): boolean {
  if (state.outcome !== null) return false;
  if (event.kind === "key") {
    const plain = !event.ctrl && !event.alt;
    if (
      (plain && event.key === "escape") ||
      (event.ctrl && event.key === "c")
    ) {
      state.outcome = { action: "cancel" };
      return true;
    }
  }
  const { question } = state;
  switch (question.kind) {
    case "confirm":
      return handleConfirm(state, question, event);
    case "select":
    case "checkbox":
      return handleChoices(state, question, event);
    case "input":
    case "secret":
    case "list":
      return handleLine(state, question, event);
  }
}

function accept(state: QuestionState, value: QuestionValue): true {
  state.outcome = { action: "accept", value };
  state.error = null;
  return true;
}

function refuse(state: QuestionState, error: string): true {
  state.error = error;
  return true;
}

function isPlainKey(event: InputEvent, key: string): boolean {
  return event.kind === "key" && event.key === key && !event.ctrl && !event.alt;
}

/** L'Espace : `text` pour le décodeur réel, `key` pour une de ses formes. */
function isSpace(event: InputEvent): boolean {
  return (
    (event.kind === "text" && event.text === " ") || isPlainKey(event, "space")
  );
}

function handleConfirm(
  state: QuestionState,
  question: IConfirmQuestion,
  event: InputEvent,
): boolean {
  if (event.kind === "text") {
    const answer = event.text.toLowerCase();
    if (answer === "o" || answer === "y") return accept(state, true);
    if (answer === "n") return accept(state, false);
    return refuse(state, "o pour oui, n pour non, Entrée pour le défaut");
  }
  return isPlainKey(event, "enter")
    ? accept(state, question.default === true)
    : false;
}

function handleChoices(
  state: QuestionState,
  question: ISelectQuestion | ICheckboxQuestion,
  event: InputEvent,
): boolean {
  const { choices } = question;
  if (event.kind === "key" && !event.ctrl && !event.alt) {
    const { key } = event;
    if (key === "enter") return submitChoices(state, question);
    if (key === "up") return moveChoice(state, choices, state.cursor - 1, -1);
    if (key === "down") return moveChoice(state, choices, state.cursor + 1, 1);
    if (key === "home") return moveChoice(state, choices, 0, 1);
    if (key === "end") {
      return moveChoice(state, choices, choices.length - 1, -1);
    }
    if (key === "pageup") {
      return moveChoice(state, choices, state.cursor - state.page, -1);
    }
    if (key === "pagedown") {
      return moveChoice(state, choices, state.cursor + state.page, 1);
    }
  }
  if (
    question.kind === "checkbox" &&
    isSpace(event) &&
    state.checked !== null
  ) {
    const choice = choices[state.cursor];
    if (choice === undefined || choice.disabled === true) return false;
    if (state.checked.has(choice.value)) state.checked.delete(choice.value);
    else state.checked.add(choice.value);
    state.error = null;
    return true;
  }
  return false;
}

/** Va au choix `target` (borné), en sautant les choix indisponibles dans le sens `step`. */
function moveChoice(
  state: QuestionState,
  choices: readonly IQuestionChoice[],
  target: number,
  step: -1 | 1,
): boolean {
  const last = choices.length - 1;
  let at = Math.max(0, Math.min(last, target));
  while (choices[at]?.disabled === true) {
    const next = at + step;
    if (next < 0 || next > last) {
      // Aucun choix atteignable plus loin dans ce sens : on reste où l'on est.
      at = state.cursor;
      break;
    }
    at = next;
  }
  if (at === state.cursor) return false;
  state.cursor = at;
  return true;
}

function submitChoices(
  state: QuestionState,
  question: ISelectQuestion | ICheckboxQuestion,
): boolean {
  if (question.kind === "select") {
    const choice = question.choices[state.cursor];
    if (choice === undefined || choice.disabled === true) {
      return refuse(state, "aucun choix disponible");
    }
    return accept(state, choice.value);
  }
  const checked = state.checked ?? new Set<string>();
  // L'ordre des choix, jamais celui des coches.
  const value = question.choices
    .filter((c) => checked.has(c.value))
    .map((c) => c.value);
  const error = checkAnswer(question, value);
  return error === null ? accept(state, value) : refuse(state, error);
}

function handleLine(
  state: QuestionState,
  question: IInputQuestion | ISecretQuestion | IListQuestion,
  event: InputEvent,
): boolean {
  const editor = state.editor;
  if (editor === null) return false;
  if (event.kind === "text" || event.kind === "paste") {
    // Une seule ligne : un collage de plusieurs n'en garde que la première,
    // et rien ne se valide sans Entrée. La tabulation devient une espace.
    const line = event.text.split(/\r\n|\r|\n/u, 1)[0] ?? "";
    if (line === "") return false;
    editor.insert(line.replace(/\t/gu, " "));
    state.error = null;
    return true;
  }
  if (event.kind !== "key") return false;
  if (isPlainKey(event, "enter")) return submitLine(state, question, editor);
  if (
    question.kind === "list" &&
    isPlainKey(event, "up") &&
    editor.empty &&
    state.values !== null &&
    state.values.length > 0
  ) {
    // ↑ sur une ligne vide reprend la dernière valeur, pour la corriger.
    editor.setText(state.values.pop() ?? "");
    state.error = null;
    return true;
  }
  // Ni historique ni ligne de plus : ↑/↓ et les touches de l'invite restent sans effet.
  if (event.key === "up" || event.key === "down" || event.key === "tab")
    return false;
  const result = editor.handle(event, null);
  if (result !== "changed") return false;
  state.error = null;
  return true;
}

function submitLine(
  state: QuestionState,
  question: IInputQuestion | ISecretQuestion | IListQuestion,
  editor: LineEditor,
): boolean {
  if (question.kind === "list") {
    const values = state.values ?? [];
    const item = editor.text.trim();
    if (item !== "") {
      const error = checkPattern(question.pattern, question.patternHint, item);
      if (error !== null) return refuse(state, error);
      values.push(item);
      editor.clear();
      state.error = null;
      return true;
    }
    // Entrée sur une ligne vide : la liste est finie.
    const error = checkAnswer(question, values);
    return error === null ? accept(state, [...values]) : refuse(state, error);
  }
  // Un secret se prend tel quel ; une ligne de texte perd ses blancs de bord.
  let value = question.kind === "secret" ? editor.text : editor.text.trim();
  if (
    value === "" &&
    question.kind === "input" &&
    question.default !== undefined
  ) {
    value = question.default;
  }
  const error = checkAnswer(question, value);
  return error === null ? accept(state, value) : refuse(state, error);
}

/**
 * Les lignes de la question à cette largeur — le SEUL rendu, quel que soit
 * l'hôte. Chaque ligne tient dans `width` colonnes.
 *
 * @param state - la question ouverte (sa fenêtre de choix est recalée en place).
 * @param width - colonnes utiles.
 * @param height - lignes disponibles (borne la liste des choix).
 * @param paint - peint les tons ; sans couleur par défaut.
 * @returns les lignes et le curseur.
 */
export function renderQuestion(
  state: QuestionState,
  width: number,
  height = Number.POSITIVE_INFINITY,
  paint: QuestionPaint = NO_PAINT,
): IQuestionView {
  const { question } = state;
  const lines: string[] = [];
  const cols = Math.max(1, width);
  if (question.note !== undefined) {
    for (const line of wrapToWidth(question.note, cols))
      lines.push(paint("dim", line));
  }
  let cursor: IQuestionView["cursor"] = null;
  const ask = `${paint("accent", "?")} ${question.message}`;
  switch (question.kind) {
    case "confirm": {
      const head = `${ask} ${paint("dim", question.default === true ? "(O/n)" : "(o/N)")} `;
      cursor = {
        row: lines.length,
        column: Math.min(visibleWidth(head), cols - 1),
      };
      lines.push(fitToWidth(head, cols));
      break;
    }
    case "input":
    case "secret": {
      const placeholder =
        question.kind === "input" &&
        question.default !== undefined &&
        question.default !== ""
          ? paint("dim", `(${question.default}) `)
          : "";
      cursor = pushEditorLine(
        lines,
        `${ask} ${placeholder}`,
        state.editor,
        question.kind === "secret",
        cols,
      );
      break;
    }
    case "list": {
      lines.push(fitToWidth(ask, cols));
      for (const value of state.values ?? [])
        lines.push(fitToWidth(`  · ${value}`, cols));
      cursor = pushEditorLine(
        lines,
        `  ${paint("accent", "›")} `,
        state.editor,
        false,
        cols,
      );
      lines.push(
        fitToWidth(
          paint(
            "dim",
            "  Entrée ajoute · Entrée sur une ligne vide termine · Échap annule",
          ),
          cols,
        ),
      );
      break;
    }
    case "select":
    case "checkbox": {
      lines.push(fitToWidth(ask, cols));
      // Question, aide et deux marques « de plus » : le reste est aux choix.
      const room = Math.max(
        1,
        Math.min(question.choices.length, height - lines.length - 3),
      );
      pushChoices(lines, state, question, room, cols, paint);
      lines.push(
        fitToWidth(
          paint(
            "dim",
            question.kind === "checkbox"
              ? "  ↑↓ choisir · Espace cocher · Entrée valider · Échap annuler"
              : "  ↑↓ choisir · Entrée valider · Échap annuler",
          ),
          cols,
        ),
      );
      break;
    }
  }
  if (state.error !== null) {
    lines.push(fitToWidth(paint("error", `  → ${state.error}`), cols));
  }
  return { lines, cursor };
}

/**
 * Pousse la ligne d'édition : le préfixe, puis la saisie (des `•` pour un
 * secret), décalée pour que le curseur reste visible.
 */
function pushEditorLine(
  lines: string[],
  prefix: string,
  editor: LineEditor | null,
  masked: boolean,
  cols: number,
): IQuestionView["cursor"] {
  const row = lines.length;
  const units: { text: string; width: number }[] = [];
  if (editor !== null) {
    for (const unit of textUnits(editor.display)) {
      if (unit.control) continue;
      units.push(
        masked
          ? { text: "•", width: 1 }
          : { text: unit.text, width: unit.width },
      );
    }
  }
  const at = editor === null ? 0 : Math.min(editor.cursor, units.length);
  const prefixWidth = visibleWidth(prefix);
  // Pas de place pour le préfixe : la saisie passe avant le libellé.
  const shownPrefix = prefixWidth < cols - 8 ? prefix : "";
  const room = Math.max(1, cols - 1 - (shownPrefix === "" ? 0 : prefixWidth));
  // Fenêtre qui FINIT au curseur quand la saisie déborde.
  let start = 0;
  let before = 0;
  for (let i = 0; i < at; i++) before += units[i]?.width ?? 0;
  while (before > room - 1 && start < at) {
    before -= units[start]?.width ?? 0;
    start++;
  }
  let text = "";
  let used = 0;
  for (let i = start; i < units.length; i++) {
    const unit = units[i];
    if (unit === undefined || used + unit.width > room) break;
    text += unit.text;
    used += unit.width;
  }
  lines.push(`${shownPrefix}${text}`);
  return {
    row,
    column: (shownPrefix === "" ? 0 : prefixWidth) + before,
  };
}

/** Pousse la fenêtre de choix, recalée autour du curseur. */
function pushChoices(
  lines: string[],
  state: QuestionState,
  question: ISelectQuestion | ICheckboxQuestion,
  room: number,
  cols: number,
  paint: QuestionPaint,
): void {
  const { choices } = question;
  state.page = room;
  if (state.cursor < state.top) state.top = state.cursor;
  if (state.cursor >= state.top + room) state.top = state.cursor - room + 1;
  state.top = Math.max(
    0,
    Math.min(state.top, Math.max(0, choices.length - room)),
  );
  const end = Math.min(choices.length, state.top + room);
  if (state.top > 0)
    lines.push(paint("dim", fitToWidth(`  ↑ ${state.top} de plus`, cols)));
  for (let i = state.top; i < end; i++) {
    const choice = choices[i];
    if (choice === undefined) continue;
    const on = i === state.cursor;
    const box =
      question.kind === "checkbox"
        ? state.checked?.has(choice.value) === true
          ? "◉ "
          : "◯ "
        : "";
    const hint =
      choice.hint !== undefined ? paint("dim", ` — ${choice.hint}`) : "";
    const off = choice.disabled === true ? paint("dim", " (indisponible)") : "";
    const label = on ? paint("accent", choice.label) : choice.label;
    lines.push(
      fitToWidth(
        `${on ? paint("accent", "▸") : " "} ${box}${label}${off}${hint}`,
        cols,
      ),
    );
  }
  if (end < choices.length) {
    lines.push(
      paint("dim", fitToWidth(`  ↓ ${choices.length - end} de plus`, cols)),
    );
  }
}

/**
 * La ligne laissée une fois la question réglée. Un secret n'y figure JAMAIS.
 *
 * @param state - la question.
 * @returns la ligne, ou `""` tant qu'elle n'est pas réglée.
 */
export function summarizeQuestion(state: QuestionState): string {
  const { question, outcome } = state;
  if (outcome === null) return "";
  if (outcome.action !== "accept") return `✗ ${question.message} (annulé)`;
  const value = outcome.value;
  switch (question.kind) {
    case "secret":
      return `✔ ${question.message} (saisi)`;
    case "confirm":
      return `✔ ${question.message} ${value === true ? "oui" : "non"}`;
    case "select":
      return `✔ ${question.message} ${labelOf(question.choices, String(value))}`;
    case "checkbox": {
      const list = Array.isArray(value) ? value : [];
      return `✔ ${question.message} ${
        list.length === 0
          ? "aucun"
          : list.map((v) => labelOf(question.choices, v)).join(", ")
      }`;
    }
    case "list": {
      const list = Array.isArray(value) ? value : [];
      return `✔ ${question.message} ${list.length === 0 ? "aucune" : list.join(" ; ")}`;
    }
    case "input":
      return `✔ ${question.message} ${typeof value === "string" ? value : ""}`;
  }
}

function labelOf(choices: readonly IQuestionChoice[], value: string): string {
  return choices.find((c) => c.value === value)?.label ?? value;
}
