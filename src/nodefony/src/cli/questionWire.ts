/**
 * La forme d'une question et d'une réponse qui VOYAGENT d'un processus à
 * l'autre (#538, lot 2b-2) : une commande lancée depuis l'invite du terminal
 * de développement pose sa question au superviseur, qui la dessine et rend la
 * réponse.
 *
 * Ce qui arrive d'un autre processus est relu avant d'être dessiné :
 * - **bornes** : textes, nombre de choix et réponses ont un plafond — au-delà,
 *   ce n'est plus une question mais un déversement ;
 * - **aucun caractère de contrôle** (saut de ligne excepté) : une séquence
 *   d'échappement glissée dans un libellé repeindrait l'écran du superviseur ;
 * - **motif compilable** : le moteur compile `pattern` à chaque frappe, une
 *   expression invalide y lèverait au milieu du dessin.
 *
 * Module sans dépendance d'exécution : le canal (`service/dev/devChannel.ts`)
 * l'importe, et le serveur de développement charge le canal.
 */
import type { IQuestion, IQuestionChoice, QuestionValue } from "./question";

/** Longueur maximale d'un texte de question (message, note, libellé, valeur). */
export const MAX_WIRE_TEXT = 4096;

/** Nombre maximal de choix, ou de valeurs d'une liste. */
export const MAX_WIRE_ITEMS = 1024;

/** Longueur maximale d'une réponse en texte. */
export const MAX_WIRE_ANSWER = 65_536;

/** Longueur maximale d'un motif : il se compile, puis s'exécute à chaque frappe. */
const MAX_WIRE_PATTERN = 1024;

/** Les formes connues — la seule liste que le garde consulte. */
const KINDS: ReadonlySet<string> = new Set<IQuestion["kind"]>([
  "input",
  "secret",
  "confirm",
  "select",
  "checkbox",
  "list",
]);

/** Contrôles C0, DEL et C1 — le saut de ligne excepté. */
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max = MAX_WIRE_TEXT): value is string {
  return (
    typeof value === "string" && value.length <= max && !CONTROL.test(value)
  );
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || isText(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isTextList(value: unknown, max: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_WIRE_ITEMS &&
    value.every((item) => isText(item, max))
  );
}

function isPattern(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length > MAX_WIRE_PATTERN) {
    return false;
  }
  try {
    return new RegExp(value, "u").unicode;
  } catch {
    return false;
  }
}

function isChoice(value: unknown): value is IQuestionChoice {
  if (!isFields(value)) return false;
  return (
    isText(value.value) &&
    isText(value.label) &&
    isOptionalText(value.hint) &&
    isOptionalBoolean(value.checked) &&
    (isOptionalBoolean(value.disabled) || isText(value.disabled))
  );
}

function isChoices(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_WIRE_ITEMS &&
    value.every((choice) => isChoice(choice))
  );
}

/**
 * Cette valeur, reçue d'un autre processus, est-elle une question qu'on peut
 * dessiner sans risque ?
 *
 * @param value - ce que le canal a livré.
 * @returns `true` si c'est une {@link IQuestion} bornée, sans contrôle, au
 *   motif compilable.
 */
export function isWireQuestion(value: unknown): value is IQuestion {
  if (!isFields(value)) return false;
  const { kind, key, message } = value;
  if (typeof kind !== "string" || !KINDS.has(kind)) return false;
  if (!isText(key) || key.length === 0 || !isText(message)) return false;
  if (
    !isOptionalText(value.note) ||
    !isOptionalText(value.flag) ||
    !isOptionalText(value.error)
  ) {
    return false;
  }
  switch (kind) {
    case "confirm":
      return isOptionalBoolean(value.default);
    case "select":
      return isChoices(value.choices) && isOptionalText(value.default);
    case "checkbox":
      return isChoices(value.choices) && isOptionalBoolean(value.required);
    case "list":
      return (
        (value.default === undefined ||
          isTextList(value.default, MAX_WIRE_TEXT)) &&
        isPattern(value.pattern) &&
        isOptionalText(value.patternHint) &&
        isOptionalBoolean(value.required)
      );
    default:
      // `input` et `secret` : un secret n'a jamais de valeur par défaut.
      return (
        (kind === "secret"
          ? value.default === undefined
          : isOptionalText(value.default)) &&
        isPattern(value.pattern) &&
        isOptionalText(value.patternHint) &&
        isOptionalBoolean(value.required)
      );
  }
}

/**
 * Cette valeur est-elle une réponse qui peut voyager — un texte, un booléen,
 * une liste de textes, bornés ? Le CONTENU se juge ensuite contre la question
 * (`checkAnswer`), par celui qui l'a posée.
 *
 * @param value - ce que le canal a livré.
 * @returns `true` si c'est une {@link QuestionValue} bornée.
 */
export function isWireAnswer(value: unknown): value is QuestionValue {
  if (typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= MAX_WIRE_ANSWER;
  return (
    Array.isArray(value) &&
    value.length <= MAX_WIRE_ITEMS &&
    value.every(
      (item) => typeof item === "string" && item.length <= MAX_WIRE_TEXT,
    )
  );
}
