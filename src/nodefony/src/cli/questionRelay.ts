/**
 * La troisième voie de la porte des questions (#538, lot 2b-2, D5) : une
 * commande lancée depuis l'invite du terminal de développement n'a pas de
 * terminal — son entrée est fermée, sa sortie est un tube. Sa question
 * remonte au superviseur par le canal IPC, qui la dessine dans l'onglet de la
 * commande et rend la réponse.
 *
 * Chargé au premier relais seulement (`ask.ts`) : une commande qui ne pose
 * aucune question ne paie ni ce module ni le canal qu'il importe.
 *
 * Le canal IPC d'un processus enfant ne le garde en vie que tant qu'un
 * écouteur `message` ou `disconnect` y est posé : les deux écouteurs vivent le
 * temps d'UNE question, puis sont retirés — la commande sort ensuite d'elle-même.
 */
import {
  DEV_CHANNEL,
  isDevChannelMessage,
  type IDevQuestion,
} from "../service/dev/devChannel";
import type { IQuestion, IQuestionOutcome } from "./question";

/** Ce que le relais touche du processus — `process` le satisfait. */
export interface IQuestionRelayEndpoint {
  readonly connected?: boolean;
  send?(
    message: IDevQuestion,
    callback?: (error: Error | null) => void,
  ): boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "disconnect", listener: () => void): unknown;
  removeListener(
    event: "message",
    listener: (message: unknown) => void,
  ): unknown;
  removeListener(event: "disconnect", listener: () => void): unknown;
}

const CANCELLED: IQuestionOutcome = Object.freeze({ action: "cancel" });

/** Le dernier identifiant de question émis par ce processus. */
let lastQuestionId = 0;

/**
 * Pose une question au superviseur et attend sa réponse. Le superviseur
 * perdu — canal fermé, envoi refusé — vaut une annulation : personne ne
 * répondra plus.
 *
 * La réponse n'est PAS jugée ici : la porte la revalide (`checkAnswer`) et
 * repose la question avec son refus.
 *
 * @param question - la question, donnée pure.
 * @param endpoint - le processus porteur du canal ; `process` par défaut.
 * @returns l'issue : `accept` et la valeur, ou `cancel`.
 */
export function relayQuestion(
  question: IQuestion,
  endpoint: IQuestionRelayEndpoint = process,
): Promise<IQuestionOutcome> {
  lastQuestionId += 1;
  const id = lastQuestionId;
  return new Promise<IQuestionOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: IQuestionOutcome): void => {
      if (settled) return;
      settled = true;
      endpoint.removeListener("message", onMessage);
      endpoint.removeListener("disconnect", onLost);
      resolve(outcome);
    };
    function onMessage(message: unknown): void {
      if (
        isDevChannelMessage(message) &&
        message.type === "answer" &&
        message.id === id
      ) {
        settle(
          message.value === null
            ? CANCELLED
            : { action: "accept", value: message.value },
        );
      }
    }
    function onLost(): void {
      settle(CANCELLED);
    }
    endpoint.on("message", onMessage);
    endpoint.on("disconnect", onLost);
    if (endpoint.send === undefined || endpoint.connected !== true) {
      onLost();
      return;
    }
    try {
      // Rappel posé : un envoi refusé le reçoit, au lieu d'un `'error'` émis
      // sur le processus, fatal sans écouteur.
      endpoint.send(
        { channel: DEV_CHANNEL, type: "question", id, question },
        (error) => {
          if (error !== null) onLost();
        },
      );
    } catch {
      onLost();
    }
  });
}
