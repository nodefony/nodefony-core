/**
 * Une commande du CLI lancée depuis l'invite du terminal de développement,
 * en sous-processus (ADR-0013 §7, #538 lot 2a) : sortie en tubes vers son
 * onglet, code de sortie rendu, arbre ENTIER tué à l'interruption.
 *
 * L'entrée standard est fermée (`ignore`) : la commande n'a pas de terminal.
 * Ses questions remontent par un canal IPC (4ᵉ descripteur) et
 * {@link DEV_PROMPT_ENV} : la porte `ask()` de l'enfant les envoie, l'onglet
 * les dessine (`io.ask`), la réponse redescend (#538, lot 2b-2). Le canal ne
 * garde pas l'enfant en vie : il sort dès son travail fini.
 */
import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import type { QuestionValue } from "../../cli/question";
import {
  DEV_CHANNEL,
  DEV_PROMPT_ENV,
  type IDevAnswer,
  isDevChannelMessage,
} from "./devChannel";
import { IGNORE_SEND_ERROR } from "./heldChannel";
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
 * Une question de la commande est confiée à `io.ask` ; sa réponse — ou `null`
 * si elle est annulée — redescend sous le même identifiant. Commande finie ou
 * interrompue : les questions encore à l'écran sont retirées.
 *
 * @param launch - programme, arguments, répertoire, environnement.
 * @param io - où va la sortie (`write`), qui pose les questions (`ask`).
 * @param signal - l'interruption de l'invite.
 * @param killTree - tue un arbre ; injecté pour l'éprouver.
 * @returns le code de sortie ; {@link PROMPT_INTERRUPTED_CODE} si
 *   interrompue, {@link PROMPT_NOT_STARTED_CODE} si elle n'a pas démarré,
 *   128 + le numéro du signal qui l'a tuée sinon.
 */
export function launchPromptCommand(
  launch: IPromptLaunch,
  io: Pick<IPromptIO, "write" | "ask">,
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
        env: { ...launch.env, [DEV_PROMPT_ENV]: "1" },
        // 4ᵉ descripteur : le canal des questions. Tubes nommés sous Windows.
        stdio: ["ignore", "pipe", "pipe", "ipc"],
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
    // Alloué à la première question seulement : la plupart n'en posent pas.
    let asking: AbortController | null = null;
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      child.removeListener("message", onMessage);
      asking?.abort();
      if (force !== null) clearTimeout(force);
      resolve(code);
    };
    function answer(id: number, value: QuestionValue | null): void {
      if (!child.connected) return;
      const message: IDevAnswer = {
        channel: DEV_CHANNEL,
        type: "answer",
        id,
        value,
      };
      try {
        // Rappel posé : l'enfant mort entre-temps le reçoit, au lieu d'un
        // `'error'` émis sur lui, fatal sans écouteur.
        child.send(message, IGNORE_SEND_ERROR);
      } catch {
        // Canal en cours de fermeture : la commande s'arrête.
      }
    }
    function onMessage(message: unknown): void {
      if (!isDevChannelMessage(message) || message.type !== "question") return;
      const { id, question } = message;
      asking ??= new AbortController();
      io.ask(question, asking.signal).then(
        (outcome) =>
          answer(
            id,
            outcome.action === "accept" && outcome.value !== undefined
              ? outcome.value
              : null,
          ),
        () => answer(id, null),
      );
    }
    child.on("message", onMessage);
    function onAbort(): void {
      interrupted = true;
      asking?.abort();
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
