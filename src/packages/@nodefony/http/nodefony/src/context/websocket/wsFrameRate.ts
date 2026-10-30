import {
  decideBackpressure,
  nextDropBalance,
  type BackpressureVerdict,
} from "nodefony";

/**
 * Options de la borne de débit ENTRANTE (client → serveur), lues dans `wss.options`.
 *
 * Knobs Nodefony (pas des options `ws`), conservés par le spread du constructeur
 * de `ws` — même voie que `IWsBackpressureOptions`.
 */
export interface IWsFrameRateOptions {
  /** Trames reçues admises par seconde et par connexion ; `0`/absent = désactivée. */
  maxFramesPerSecond?: number;
  /** Solde de trames écartées qui ferme la connexion (`1008`) ; `0` = jamais. */
  frameRateCloseAfterRejects?: number;
}

/**
 * Fenêtre de comptage d'une connexion, créée à la PREMIÈRE trame reçue borne activée.
 *
 * Mutée en place : aucune allocation par trame.
 */
export interface IFrameRateWindow {
  /** Début de la fenêtre courante (ms, `Date.now()`). */
  start: number;
  /** Trames reçues dans la fenêtre courante. */
  count: number;
  /** Solde de refus (+1 par trame écartée, −1 par trame admise). */
  balance: number;
}

/** Durée d'une fenêtre de comptage (ms) : la borne s'exprime en trames PAR SECONDE. */
export const FRAME_RATE_WINDOW_MS = 1000;

// Cumul du PROCESSUS : une trame écartée n'atteint jamais le routage, donc aucun
// hub ne la voit — la sonde le relit ici (`frameRateRejectedTotal`).
let rejectedTotal = 0;

/**
 * Nombre cumulé de trames entrantes écartées par la borne de débit dans ce processus (unité : une trame reçue).
 *
 * Monotone, `0` tant que la borne est désactivée. Relayé par la sonde du hub
 * temps réel sous le nom figé `frameRateRejectedTotal` (ADR-0021 §S9).
 *
 * @returns le cumul depuis le démarrage du processus
 */
export const frameRateRejectedTotal = (): number => rejectedTotal;

/**
 * Lit une borne numérique dans les options du serveur WebSocket d'un contexte.
 *
 * Sans allocation ni conversion de type : un serveur sans `options` (HTTP) ou
 * une clé absente rendent `0`.
 */
const readOption = (
  server: unknown,
  key: keyof IWsFrameRateOptions,
): number => {
  if (typeof server !== "object" || server === null) return 0;
  if (!("options" in server)) return 0;
  const opts = server.options;
  if (typeof opts !== "object" || opts === null || !(key in opts)) return 0;
  const value: unknown = Reflect.get(opts, key);
  return typeof value === "number" ? value : 0;
};

/**
 * Borne de débit entrante du serveur WebSocket (`maxFramesPerSecond`) ; `0` = désactivée.
 *
 * Appelée à chaque trame : une lecture de propriété, aucune allocation.
 *
 * @param server - le serveur du contexte (`context.server`)
 * @returns trames admises par seconde, `0` si la borne est désactivée
 */
export const readFrameRateBound = (server: unknown): number =>
  readOption(server, "maxFramesPerSecond");

/**
 * Solde de refus qui ferme la connexion (`frameRateCloseAfterRejects`) ; `0` = jamais.
 *
 * @param server - le serveur du contexte (`context.server`)
 * @returns le solde de fermeture
 */
export const readFrameRateCloseAfter = (server: unknown): number =>
  readOption(server, "frameRateCloseAfterRejects");

/**
 * Décide du sort d'une trame reçue, AVANT tout décodage : l'admettre, l'écarter, ou fermer la connexion.
 *
 * Compte des TRAMES, pas des octets (`maxPayload` borne déjà la taille). La
 * décision est la règle unique du cœur (`decideBackpressure`), appliquée au
 * nombre de trames de la fenêtre : écarter au-delà de la borne, fermer quand le
 * solde de refus atteint `closeAfter` — jamais au premier dépassement. Une
 * trame écartée est comptée dans {@link frameRateRejectedTotal}.
 *
 * @param win - la fenêtre de la connexion (mutée)
 * @param now - l'instant de réception (ms)
 * @param bound - trames admises par seconde (`> 0`)
 * @param closeAfter - solde de refus qui ferme (`0` = jamais)
 * @returns `"send"` (admettre), `"drop"` (écarter) ou `"close"` (fermer en `1008`)
 */
export const admitFrame = (
  win: IFrameRateWindow,
  now: number,
  bound: number,
  closeAfter: number,
): BackpressureVerdict => {
  if (now - win.start >= FRAME_RATE_WINDOW_MS) {
    win.start = now;
    win.count = 0;
  }
  win.count += 1;
  const verdict = decideBackpressure(
    win.count,
    bound,
    "drop",
    closeAfter,
    win.balance,
  );
  win.balance = nextDropBalance(verdict, win.balance);
  if (verdict !== "send") rejectedTotal += 1;
  return verdict;
};
