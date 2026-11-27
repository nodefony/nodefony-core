/**
 * Une question posée dans un onglet du terminal de développement (#538, lot
 * 2b-2, D6-D7) : celle d'une commande lancée depuis l'invite, que le canal IPC
 * a remontée, ou la confirmation d'une action de l'invite.
 *
 * Le superviseur la fait tourner par le moteur UNIQUE (`cli/question.ts` :
 * `handleQuestion`, `renderQuestion`) et ne rend que la réponse finale — la
 * commande la juge. Elle prend la place de la ligne d'édition de son onglet ;
 * ailleurs, elle attend, et l'onglet porte un `?`.
 */
import {
  QuestionState,
  summarizeQuestion,
  type IQuestion,
  type IQuestionOutcome,
} from "../../cli/question";
import type { IFramePrompt } from "./devFrame";

/** L'issue d'une question retirée de l'écran sans réponse. */
export const QUESTION_CANCELLED: IQuestionOutcome = Object.freeze({
  action: "cancel",
});

/**
 * Une question en attente de sa réponse, dans un onglet. Forme stable : tous
 * les champs posés au constructeur.
 */
export class PendingQuestion {
  /** L'état du moteur : curseur, cases, saisie — jamais recopié ailleurs. */
  readonly state: QuestionState;
  /** L'image retenue tant que ni l'état ni la largeur ne bougent. */
  frame: IFramePrompt | null;
  /** La largeur pour laquelle {@link PendingQuestion.frame} a été faite. */
  frameWidth: number;
  /** Le focus de l'invite quand elle a été faite (curseur montré ou non). */
  frameFocused: boolean;
  readonly #resolve: (outcome: IQuestionOutcome) => void;
  readonly #release: () => void;
  readonly #summary: ((line: string) => void) | null;
  #settled: boolean;

  /**
   * @param question - la question, donnée pure.
   * @param resolve - rend l'issue à qui l'a posée.
   * @param release - retire les écouteurs posés pour elle.
   * @param summary - écrit la ligne qu'elle laisse une fois réglée, dans
   *   l'historique de son onglet ; `null` n'en laisse aucune.
   */
  constructor(
    question: IQuestion,
    resolve: (outcome: IQuestionOutcome) => void,
    release: () => void,
    summary: ((line: string) => void) | null,
  ) {
    this.state = new QuestionState(question);
    this.frame = null;
    this.frameWidth = -1;
    this.frameFocused = false;
    this.#resolve = resolve;
    this.#release = release;
    this.#summary = summary;
    this.#settled = false;
  }

  /** `true` une fois l'issue rendue. */
  get settled(): boolean {
    return this.#settled;
  }

  /** L'état a changé : l'image retenue ne vaut plus. */
  invalidate(): void {
    this.frame = null;
  }

  /**
   * Rend l'issue, une seule fois, et laisse sa ligne dans l'historique de
   * l'onglet. Un secret n'y figure JAMAIS (`summarizeQuestion`) : la valeur
   * saisie ne quitte le superviseur que par le canal, vers la commande.
   *
   * @param outcome - l'issue ; celle du moteur si `undefined`.
   */
  settle(outcome?: IQuestionOutcome): void {
    if (this.#settled) return;
    this.#settled = true;
    const final = outcome ?? this.state.outcome ?? QUESTION_CANCELLED;
    this.state.outcome ??= final;
    this.#release();
    if (this.#summary !== null) {
      const line = summarizeQuestion(this.state);
      if (line !== "") this.#summary(`${line}\n`);
    }
    this.#resolve(final);
  }
}
