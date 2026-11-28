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
 *
 * Une ligne `!<ligne>` passe par le MÊME lanceur, confiée au shell
 * ({@link IPromptLaunch.shell}) — mêmes tubes, même interruption de l'arbre,
 * même code rendu — mais sans le canal des questions.
 */
import {
  type ChildProcess,
  type StdioOptions,
  spawn,
} from "node:child_process";
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
  /**
   * Le shell qui interprète `file`, alors une LIGNE entière (`!git status`) :
   * son chemin, ou `true` pour celui du système — l'option `shell` de
   * `spawn` ({@link promptShell}). `args` est ignoré. Une ligne du shell n'a
   * PAS le canal des questions : tout `node` qu'elle lance en hériterait, et
   * attendrait une réponse sur un canal qui ne mène pas à lui.
   */
  readonly shell?: string | true;
}

/**
 * Le shell d'une ligne `!` : `$SHELL` sous macOS et Linux, `/bin/sh` à
 * défaut ; sous Windows, celui du système — `true` laisse Node prendre
 * `%ComSpec%` (`cmd.exe` à défaut) et lui passer la ligne telle quelle.
 * `$SHELL` n'est pas lu sous Windows : Git Bash y pose `/usr/bin/bash`, un
 * chemin que `spawn` ne sait pas ouvrir.
 *
 * @param platform - la plateforme (`process.platform`), injectée pour l'éprouver.
 * @param env - l'environnement du superviseur.
 * @returns le shell, pour {@link IPromptLaunch.shell}.
 */
export function promptShell(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string | true {
  if (platform === "win32") return true;
  const shell = env.SHELL;
  return shell !== undefined && shell !== "" ? shell : "/bin/sh";
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
    const shell = launch.shell;
    // 4ᵉ descripteur : le canal des questions. Tubes nommés sous Windows.
    const stdio: StdioOptions =
      shell === undefined
        ? ["ignore", "pipe", "pipe", "ipc"]
        : ["ignore", "pipe", "pipe"];
    try {
      // Une ligne du shell part sans arguments : Node les concaténerait à la
      // ligne sans les échapper (DEP0190).
      child = spawn(launch.file, shell === undefined ? launch.args : [], {
        cwd: launch.cwd,
        // Le pid du superviseur, pas `1` : un petit-enfant hérite de la
        // variable, et son propre canal IPC (un `fork`) ne mène pas ici.
        env:
          shell === undefined
            ? { ...launch.env, [DEV_PROMPT_ENV]: String(process.pid) }
            : launch.env,
        stdio,
        ...(shell === undefined ? {} : { shell }),
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
