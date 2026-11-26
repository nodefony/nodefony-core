/**
 * Une commande du CLI lancée depuis l'invite du terminal de développement,
 * en sous-processus (ADR-0013 §7, #538 lot 2a) : sortie en tubes vers son
 * onglet, code de sortie rendu, arbre ENTIER tué à l'interruption.
 *
 * L'entrée standard est fermée (`ignore`) : une commande qui voudrait poser
 * une question le constate et refuse en nommant la ligne à taper — elle ne
 * pend jamais. Les questions dessinées dans l'onglet viennent au lot 2b.
 */
import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import {
  onProcessEnded,
  signalProcessGroup,
  spawnsAsGroupLeader,
} from "./devProcess";
import type { IPromptIO } from "./promptAction";

/** Ce qu'il faut pour lancer une commande : le programme, ses arguments, son décor. */
export interface IPromptLaunch {
  /** Le programme (`process.execPath`). */
  readonly file: string;
  /** Ses arguments, bin du CLI compris. */
  readonly args: readonly string[];
  /** Le répertoire du projet. */
  readonly cwd: string;
  /** L'environnement complet de la commande. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** Délai laissé à l'arbre pour finir après `SIGTERM`, avant `SIGKILL`. */
export const PROMPT_KILL_GRACE_MS = 1500;

/** Code d'une commande interrompue (Ctrl+C) : 128 + `SIGINT`, la convention des shells. */
export const PROMPT_INTERRUPTED_CODE = 130;

/** Code d'une commande qui n'a pas pu démarrer : « introuvable », la convention des shells. */
export const PROMPT_NOT_STARTED_CODE = 127;

/**
 * Lance une commande et relaie sa sortie à l'invite jusqu'à sa fin.
 *
 * L'interruption (`signal`) emporte l'ARBRE — la commande et ses enfants —
 * par {@link signalProcessGroup}, seule implémentation du dépôt : `SIGTERM`,
 * puis `SIGKILL` passé {@link PROMPT_KILL_GRACE_MS}. Sous Windows, il n'y a
 * pas de groupe : l'arbre est tué net (`taskkill /T /F`), sans arrêt propre.
 *
 * @param launch - programme, arguments, répertoire, environnement.
 * @param io - où va la sortie (`write`).
 * @param signal - l'interruption de l'invite.
 * @param killTree - tue un arbre ; injecté pour l'éprouver.
 * @returns le code de sortie ; {@link PROMPT_INTERRUPTED_CODE} si
 *   interrompue, {@link PROMPT_NOT_STARTED_CODE} si elle n'a pas démarré,
 *   128 + le numéro du signal qui l'a tuée sinon.
 */
export function launchPromptCommand(
  launch: IPromptLaunch,
  io: Pick<IPromptIO, "write">,
  signal: AbortSignal,
  killTree: (
    pid: number,
    signal: NodeJS.Signals,
  ) => unknown = signalProcessGroup,
): Promise<number> {
  if (signal.aborted) return Promise.resolve(PROMPT_INTERRUPTED_CODE);
  return new Promise<number>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(launch.file, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        stdio: ["ignore", "pipe", "pipe"],
        // POSIX : leader de groupe, pour que `kill(-pid)` emporte les
        // petits-enfants. Windows : rattaché — `taskkill /T` suit la filiation.
        detached: spawnsAsGroupLeader(),
        windowsHide: true,
      });
    } catch (error) {
      io.write(`lancement impossible : ${describe(error)}\n`, "err");
      resolve(PROMPT_NOT_STARTED_CODE);
      return;
    }
    let interrupted = false;
    let force: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (force !== null) clearTimeout(force);
      resolve(code);
    };
    function onAbort(): void {
      interrupted = true;
      const pid = child.pid;
      if (pid === undefined) return;
      killTree(pid, "SIGTERM");
      force = setTimeout(() => killTree(pid, "SIGKILL"), PROMPT_KILL_GRACE_MS);
      force.unref();
    }
    signal.addEventListener("abort", onAbort, { once: true });
    // `setEncoding` : un caractère coupé entre deux paquets se recolle.
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => io.write(chunk, "out"));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => io.write(chunk, "err"));
    child.once("error", (error) => {
      // Le lancement a échoué (programme ou répertoire introuvable) : aucun
      // `exit` ne suivra forcément.
      if (child.pid !== undefined) return;
      io.write(`lancement impossible : ${describe(error)}\n`, "err");
      settle(PROMPT_NOT_STARTED_CODE);
    });
    onProcessEnded(child, (code, killedBy) => {
      if (interrupted) settle(PROMPT_INTERRUPTED_CODE);
      else if (code !== null) settle(code);
      else settle(128 + (killedBy ? os.constants.signals[killedBy] : 0));
    });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
