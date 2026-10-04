/**
 * La sonde du terminal : ce que le superviseur CONSTATE du terminal qu'il
 * possède (plein écran, sortie synchronisée). Cf ADR-0013 §1 et §3.
 *
 * Le verdict TRANSMIS au serveur (`NF_DEV_TERMINAL`) a UN codec, dans la porte
 * `runtime/isTerminal.ts` : c'est elle que le serveur lit. Ce qui s'y ajoute
 * (plein écran, couleurs) s'ajoute LÀ — deux codecs d'une même variable
 * divergent, et le lecteur strict rejetterait ce qu'écrit l'autre.
 *
 * Une capacité se constate, elle ne se déduit pas de `process.platform` :
 * le plein écran n'est accordé que si le terminal a RÉPONDU à la requête de
 * position du curseur, la sortie synchronisée que si DECRQM a vu le mode
 * 2026. Tout est pur ici — la sonde elle-même (écrire, attendre, lire) est
 * l'affaire de qui possède le terminal.
 */
import type { InputEvent } from "./inputDecoder";

/** Mode de la sortie synchronisée. */
const SYNCHRONIZED_OUTPUT_MODE = 2026;

/**
 * La sonde, à écrire sur le terminal en mode brut : DECRQM du mode 2026
 * d'abord, puis la requête de position du curseur. La réponse de position
 * arrive en DERNIER chez tous les terminaux qui répondent : elle sert de
 * sentinelle — reçue, la sonde est finie, que DECRQM ait répondu ou non.
 */
export const TERMINAL_PROBE = `\x1b[?${SYNCHRONIZED_OUTPUT_MODE}$p\x1b[6n`;

/** Ce que la sonde a établi. */
export interface IProbeResult {
  /** Une réponse de position du curseur est arrivée : plein écran utilisable. */
  fullscreen: boolean;
  /** DECRQM a reconnu le mode 2026. */
  synchronized: boolean;
  /** La sentinelle (position du curseur) est arrivée : plus rien à attendre. */
  complete: boolean;
}

/**
 * Interprète les évènements reçus pendant la sonde. Les autres évènements
 * (une frappe pendant l'attente) sont ignorés ici — à l'appelant de les
 * rejouer s'il le veut.
 *
 * @param events - ce que le décodeur d'entrée a rendu depuis l'envoi de la sonde.
 * @returns le constat.
 */
export function interpretProbe(events: readonly InputEvent[]): IProbeResult {
  const result: IProbeResult = {
    fullscreen: false,
    synchronized: false,
    complete: false,
  };
  for (const event of events) {
    if (event.kind !== "report") continue;
    if (event.report === "cursor-position") {
      result.fullscreen = true;
      result.complete = true;
    } else if (event.values[0] === SYNCHRONIZED_OUTPUT_MODE) {
      // DECRPM : 1 actif, 2 inactif, 3 actif en permanence — 0 et 4 = non pris en charge.
      const state = event.values[1] ?? 0;
      result.synchronized = state === 1 || state === 2 || state === 3;
    }
  }
  return result;
}
