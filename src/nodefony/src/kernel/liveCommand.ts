/**
 * L'exécuteur de `command.execute` dans le serveur vivant (ADR-0013 §6,
 * amendement #538 lot 3) : il retrouve la commande par son nom et appelle son
 * `readState()` — jamais `generate()`, qui terminerait le serveur, écraserait
 * `kernel.command` et écrirait sur sa sortie standard.
 */
import type Command from "../command/Command";
import type { IReadStateContext } from "../command/readState";
import { NOT_LIVE } from "../service/dev/devChannel";
import type { IRpcCall } from "../realtime/JsonRpcPeer";
import type { LiveCommandExecutor } from "./supervisorLink";

/**
 * Ce que l'exécuteur touche du CLI — `Cli.getCommand` le satisfait : d'une
 * commande, il ne lit que `readState`.
 */
export interface ICommandLookup {
  getCommand(name: string): Pick<Command, "readState"> | null;
}

/** Le contexte d'un `readState()` servi par un appel du pair. */
class CallReadStateContext implements IReadStateContext {
  constructor(
    readonly columns: number,
    readonly call: IRpcCall,
  ) {}

  /** Lu à la demande : le signal du pair ne naît qu'à la première lecture. */
  get signal(): AbortSignal {
    return this.call.signal;
  }

  progress(update: Parameters<IRpcCall["progress"]>[0]): boolean {
    return this.call.progress(update);
  }
}

/**
 * Construit l'exécuteur du serveur vivant.
 *
 * @param cli - le CLI qui porte les commandes (intégrées et de module) ;
 *   `null` (noyau sans CLI) : rien ne se sert en direct.
 * @returns l'exécuteur : `{ live: false }` quand la commande est inconnue, n'a
 *   pas de `readState()`, ou le refuse pour ces arguments (`null`).
 */
export function liveCommandExecutor(
  cli: ICommandLookup | null,
): LiveCommandExecutor {
  return async (params, call) => {
    const command = cli?.getCommand(params.command);
    if (command?.readState === undefined) return NOT_LIVE;
    const result = await command.readState(
      params.arguments,
      new CallReadStateContext(params.columns, call),
    );
    return result === null
      ? NOT_LIVE
      : { live: true, code: result.code, parts: result.parts };
  };
}
