/// <reference types="node" />

/**
 * Mouchard de contre-pression — état vu par le TRANSPORT de la dernière
 * connexion de banc, lisible par une route publique.
 *
 * Pourquoi hors des instances : un controller ne survit pas à sa requête, et
 * surtout le banc doit lire ces compteurs **après** avoir cessé de drainer sa
 * socket — donc par un autre canal que celle-ci. Même raison que le mouchard
 * d'ordre du pipeline (`initializeProbe.ts`) : ce qu'une connexion écrit doit
 * pouvoir se relire ailleurs.
 *
 * Pourquoi côté SERVEUR : compter les frames reçues par le client ne prouve
 * rien — un client qui n'a pas fini de lire affiche le même déficit qu'un
 * client dont les frames ont été jetées. Seul le transport sait ce qu'il a
 * refusé.
 */
export interface IBackpressureProbe {
  /** Frames refusées par la contre-pression sur cette connexion. */
  dropped: number;
  /** Frames effectivement remises au transport. */
  messagesSent: number;
  /** File d'envoi non drainée au moment de la lecture. */
  bufferedAmount: number;
  /** `readyState` de la socket : 1 = ouverte, 3 = fermée. */
  readyState: number;
  /** Nombre de charges que le provider a tenté de pousser. */
  pushed: number;
  /** Réglages LUS AU HANDSHAKE (contexte WS) — pas ceux d'un contexte HTTP. */
  options: unknown;
}

/** Ce que le transport de la connexion courante expose au mouchard. */
export interface IProbedTransport {
  readonly dropped: number;
  readonly messagesSent: number;
  readonly bufferedAmount: number;
  readonly readyState: number;
}

let current: IProbedTransport | null = null;
let pushed = 0;
let options: unknown = null;

/**
 * Inscrit le transport de la connexion de banc ET les réglages lus au handshake.
 *
 * Les réglages doivent être capturés ICI : une route HTTP n'a pas de
 * `WebSocketServer` sur son contexte, donc les relire depuis la route de lecture
 * renverrait « protection désactivée » alors que la connexion, elle, est gardée.
 * Piège vécu — la sonde disait `max: 0` pendant que le transport refusait 272 frames.
 */
export const setProbedTransport = (
  t: IProbedTransport | null,
  opts: unknown = null,
): void => {
  current = t;
  options = opts;
  pushed = 0;
};

/** Compte une charge poussée par le provider (avant toute décision du transport). */
export const countPushed = (n: number): void => {
  pushed += n;
};

/** Lecture — `null` si aucune connexion de banc n'a encore été ouverte. */
export const readBackpressureProbe = (): IBackpressureProbe | null =>
  current === null
    ? null
    : {
        dropped: current.dropped,
        messagesSent: current.messagesSent,
        bufferedAmount: current.bufferedAmount,
        readyState: current.readyState,
        pushed,
        options,
      };
