/**
 * La porte UNIQUE par laquelle une commande pose une question (#538 lot 2b-1).
 *
 * Elle tranche, à UN endroit, ce que quinze gardes `stdin.isTTY` recopiées
 * tranchaient chacune à sa façon — « puis-je demander, et par où ? » :
 *
 * 1. une réponse déjà fournie (un drapeau) est validée par `checkAnswer` et
 *    rendue ; refusée, elle est reposée avec son refus si un terminal est là ;
 * 2. sinon, un vrai terminal en entrée ET en sortie → le pied de terminal ;
 * 3. sinon, une commande lancée depuis l'invite du terminal de développement
 *    → la question remonte au superviseur, qui la dessine dans l'onglet de la
 *    commande (`questionRelay.ts`) ; la réponse est revalidée ici ;
 * 4. sinon, le repli d'une question facultative (`fallback`) ;
 * 5. sinon → {@link QuestionRefusedError}, qui nomme le DRAPEAU à passer —
 *    jamais une attente que personne ne lira.
 *
 * Une question annulée (Échap, Ctrl+C) lève {@link QuestionCancelledError} :
 * `Command.action` la rend en sortie 130, sans pile.
 */
import { isTerminal } from "../runtime/isTerminal";
import { DEV_PROMPT_ENV } from "../service/dev/devChannelBase";
import { resolveColorEnabled } from "../syslog/logColor";
import { request } from "./prompts";
import {
  checkAnswer,
  questionFlag,
  type ICheckboxQuestion,
  type IConfirmQuestion,
  type IInputQuestion,
  type IListQuestion,
  type IQuestion,
  type ISecretQuestion,
  type ISelectQuestion,
  type QuestionValue,
} from "./question";
import type { IQuestionFooterOptions } from "./questionFooter";

/** Code de sortie d'une question annulée (128 + SIGINT, la convention des shells). */
export const QUESTION_CANCELLED_EXIT_CODE = 130;

/** La question a été annulée par la personne (Échap, Ctrl+C, clavier fermé). */
export class QuestionCancelledError extends Error {
  /** La clé de la question annulée. */
  readonly key: string;

  /**
   * @param question - la question annulée.
   */
  constructor(question: IQuestion) {
    super(`${question.message} : annulé`);
    this.name = "QuestionCancelledError";
    this.key = question.key;
  }
}

/**
 * La question ne peut pas être posée — aucun terminal, ou réponse fournie
 * refusée sans terminal pour la reposer. Le message nomme le drapeau.
 */
export class QuestionRefusedError extends Error {
  /** La clé de la question. */
  readonly key: string;
  /** Le drapeau qui fournit la réponse. */
  readonly flag: string;

  /**
   * @param question - la question refusée.
   * @param reason - pourquoi (aucun terminal, ou le refus de la réponse fournie).
   */
  constructor(question: IQuestion, reason: string) {
    const flag = questionFlag(question);
    super(`${question.message} — ${reason} : passe ${flag} <valeur>`);
    this.name = "QuestionRefusedError";
    this.key = question.key;
    this.flag = flag;
  }
}

/** Les réglages d'une question posée par la porte. */
export interface IAskOptions extends IQuestionFooterOptions {
  /** La réponse déjà fournie (un drapeau) ; `undefined` = à demander. */
  readonly answer?: unknown;
  /**
   * `false` interdit de demander même devant un terminal (`--json`, `--yes`) :
   * la question refuse alors en nommant son drapeau.
   */
  readonly prompt?: boolean;
  /** Verdict de terminal INJECTÉ (tests) ; constaté sur le processus sinon. */
  readonly terminal?: boolean;
  /**
   * La réponse d'une question FACULTATIVE quand personne ne peut répondre
   * (sans terminal, ou `prompt: false`) — au lieu du refus. Devant un
   * terminal, la question est posée : le repli n'en dispense pas.
   */
  readonly fallback?: unknown;
}

/** Par où une question atteint quelqu'un : le terminal, ou le superviseur. */
type AskRoute = "terminal" | "relay";

/**
 * Par où poser une question, s'il y a quelqu'un pour répondre.
 *
 * @param injected - verdict de terminal injecté (tests) : il tranche seul.
 * @returns la voie, ou `null` si personne ne peut répondre.
 */
function askRoute(injected: boolean | undefined): AskRoute | null {
  if (injected !== undefined) return injected ? "terminal" : null;
  const noTty = process.env.NF_NO_TTY;
  if (noTty !== undefined && noTty !== "") return null;
  if (isTerminal(process.stdin) && isTerminal(process.stdout)) {
    return "terminal";
  }
  // Lancée depuis l'invite : l'entrée est fermée, mais le superviseur écoute.
  // La variable nomme le superviseur : hérité par un petit-enfant dont le
  // canal IPC mène à un autre parent (un `fork`), le relais ne s'ouvre pas.
  return process.env[DEV_PROMPT_ENV] === String(process.ppid) &&
    typeof process.send === "function" &&
    process.connected
    ? "relay"
    : null;
}

/**
 * Peut-on poser une question à quelqu'un ? Un vrai terminal en entrée ET en
 * sortie (et `NF_NO_TTY` absent), ou une commande lancée depuis l'invite du
 * terminal de développement, dont le superviseur dessine les questions. Le
 * serveur supervisé, lui, n'a ni l'un ni l'autre : il refuse en nommant le
 * drapeau.
 *
 * @returns `true` si un humain peut répondre ici.
 */
export function canAsk(): boolean {
  return askRoute(undefined) !== null;
}

/**
 * Pose une question et rend sa réponse.
 *
 * @param question - la question.
 * @param options - réponse déjà fournie, droit de demander, hôte.
 * @returns la réponse, validée par la question.
 * @throws {QuestionRefusedError} sans terminal (le drapeau est nommé).
 * @throws {QuestionCancelledError} si la personne annule.
 */
export function ask(
  question: IConfirmQuestion,
  options?: IAskOptions,
): Promise<boolean>;
export function ask(
  question: ICheckboxQuestion | IListQuestion,
  options?: IAskOptions,
): Promise<string[]>;
export function ask(
  question: IInputQuestion | ISecretQuestion | ISelectQuestion,
  options?: IAskOptions,
): Promise<string>;
export function ask(
  question: IQuestion,
  options?: IAskOptions,
): Promise<QuestionValue>;
export async function ask(
  question: IQuestion,
  options: IAskOptions = {},
): Promise<QuestionValue> {
  const route = options.prompt === false ? null : askRoute(options.terminal);
  const interactive = route !== null;
  let asked = question;
  if (options.answer !== undefined) {
    const error = checkAnswer(question, options.answer);
    if (error === null && isQuestionValue(options.answer)) {
      return options.answer;
    }
    const reason = error ?? "réponse illisible";
    if (!interactive) throw new QuestionRefusedError(question, reason);
    // Devant un terminal, la réponse refusée est reposée avec son refus.
    asked = { ...question, error: `${questionFlag(question)} : ${reason}` };
  }
  if (!interactive) {
    if (options.fallback !== undefined) {
      const error = checkAnswer(question, options.fallback);
      if (error === null && isQuestionValue(options.fallback)) {
        return options.fallback;
      }
      // Un repli invalide est une faute de la COMMANDE, jamais de la personne.
      throw new Error(
        `${question.key} : repli invalide (${error ?? "réponse illisible"})`,
      );
    }
    throw new QuestionRefusedError(question, "aucun terminal pour le demander");
  }
  if (route === "relay") return relayed(question, asked);
  // Chargé au premier VRAI dialogue : décodeur et hôte n'ont rien à faire
  // dans un processus qui ne pose aucune question — le serveur, d'abord.
  const { askInFooter } = await import("./questionFooter");
  const outcome = await request(() =>
    askInFooter(asked, {
      ...options,
      color: options.color ?? resolveColorEnabled(isTerminal(process.stdout)),
    }),
  );
  if (outcome.action !== "accept" || outcome.value === undefined) {
    throw new QuestionCancelledError(question);
  }
  return outcome.value;
}

/**
 * Pose la question au superviseur, et la repose avec son refus tant que la
 * réponse ne tient pas : le superviseur dessine, la commande JUGE.
 *
 * @param question - la question, telle que la commande la pose.
 * @param first - la première forme posée (refus d'un drapeau compris).
 * @returns la réponse validée.
 * @throws {QuestionCancelledError} si la personne annule, ou si le
 *   superviseur disparaît.
 */
async function relayed(
  question: IQuestion,
  first: IQuestion,
): Promise<QuestionValue> {
  const { relayQuestion } = await import("./questionRelay");
  let asked = first;
  for (;;) {
    const outcome = await request(() => relayQuestion(asked));
    if (outcome.action !== "accept" || outcome.value === undefined) {
      throw new QuestionCancelledError(question);
    }
    const error = checkAnswer(question, outcome.value);
    if (error === null) return outcome.value;
    asked = { ...question, error };
  }
}

/** `EX_USAGE` (sysexits) : la réponse manquait à la ligne de commande. */
const USAGE_EXIT_CODE = 64;

/**
 * Rend le code de sortie d'une commande STANDALONE qui pose des questions —
 * celles qui ne passent pas par `Command.action` : annulée → 130, sans pile ;
 * refusée sans terminal → le refus (qui nomme le drapeau) sur la sortie
 * d'erreur, 64. Toute autre erreur remonte telle quelle.
 *
 * @param run - le corps de la commande.
 * @returns son code de sortie.
 */
export async function exitCodeOfQuestions(
  run: () => Promise<number>,
): Promise<number> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof QuestionCancelledError) {
      return QUESTION_CANCELLED_EXIT_CODE;
    }
    if (error instanceof QuestionRefusedError) {
      process.stderr.write(`${error.message}\n`);
      return USAGE_EXIT_CODE;
    }
    throw error;
  }
}

function isQuestionValue(value: unknown): value is QuestionValue {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((v) => typeof v === "string"))
  );
}

/**
 * Demande un secret NEUF deux fois, et le redemande tant que les deux
 * saisies diffèrent. Fourni par un drapeau, il n'est pas confirmé : la ligne
 * de commande l'a écrit une fois, en clair, sous les yeux de celui qui l'a tapée.
 *
 * @param question - le secret à demander.
 * @param confirmMessage - le libellé de la seconde saisie.
 * @param options - comme {@link ask}.
 * @returns le secret.
 * @throws comme {@link ask}.
 */
export async function askSecretTwice(
  question: ISecretQuestion,
  confirmMessage: string,
  options: IAskOptions = {},
): Promise<string> {
  if (options.answer !== undefined) return ask(question, options);
  let first: ISecretQuestion = question;
  for (;;) {
    const secret = await ask(first, options);
    const again = await ask(
      {
        kind: "secret",
        key: `${question.key}-confirm`,
        message: confirmMessage,
        ...(question.flag !== undefined ? { flag: question.flag } : {}),
      },
      options,
    );
    if (again === secret) return secret;
    first = { ...question, error: "les deux saisies diffèrent" };
  }
}
