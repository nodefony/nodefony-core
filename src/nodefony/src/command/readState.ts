/**
 * Le contrat d'une commande servie EN DIRECT (ADR-0013, amendement #538 lot 3) :
 * ce qu'une commande rend quand elle LIT l'état de l'application sans sortie
 * standard, sans `terminate`, sans `process.exitCode`.
 *
 * La voie se CONSTATE à la présence de `Command.readState` : l'invite du
 * superviseur demande d'abord au serveur vivant, qui l'appelle ; `null` ou
 * méthode absente → la commande part en sous-processus.
 */
import type { IRpcProgressUpdate, RpcPart } from "../realtime/JsonRpcPeer";

/** Ce qu'une commande rend SANS sortie standard, sans `terminate`, sans `process.exitCode`. */
export interface ICommandResult {
  /** Code de sortie : celui que rend la CLI, et que l'invite range dans l'historique. */
  readonly code: number;
  /** Au moins une part `text` ; une part `data` s'y ajoute quand une surface sait la dessiner. */
  readonly parts: readonly RpcPart[];
}

/** Ce que reçoit `Command.readState`. */
export interface IReadStateContext {
  /** Largeur à laquelle rendre la part `text`. */
  readonly columns: number;
  /** Abandonné par Ctrl+C dans l'invite (`$/cancelRequest`), ou quand le superviseur disparaît. */
  readonly signal: AbortSignal;
  /**
   * Émet une étape (`$/progress`) ; sans flux demandé par l'appelant, ne fait rien.
   *
   * @returns `false` quand rien n'est parti.
   */
  progress(update: IRpcProgressUpdate): boolean;
}
