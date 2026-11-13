import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { signalProcessGroup } from "../service/dev/devProcess";

/**
 * Comment un exemplaire jetable s'est arrêté.
 *
 * - `graceful` : il a reçu `SIGTERM` et il est sorti de lui-même — ses
 *   crochets de sortie ont tourné (profil `--cpu-prof` écrit, connexions
 *   fermées).
 * - `forced` : il a été tué. Demandé (`graceful` absent), délai de grâce
 *   dépassé, ou plateforme sans arrêt gracieux d'arbre (Windows : le programme
 *   de kill d'arbre force toujours).
 * - `already-exited` : il était déjà sorti avant l'appel (crash, arrêt externe).
 */
export type SpareStopOutcome = "graceful" | "forced" | "already-exited";

/** Options d'arrêt d'un exemplaire jetable. */
export interface ISpareStopOptions {
  /**
   * `true` : `SIGTERM` d'abord, et `SIGKILL` seulement si l'exemplaire n'est
   * pas sorti dans `graceMs`. Défaut `false` : `SIGKILL` d'emblée — un test
   * n'a rien à attendre d'un arrêt propre.
   */
  graceful?: boolean;
  /** Délai de grâce avant `SIGKILL`, en ms (défaut 10 000). */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 10_000;

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Résout à la sortie du process — tout de suite s'il est déjà sorti. */
function exited(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

/**
 * Arrête l'ARBRE d'un process enfant chef de son groupe, et dit comment.
 *
 * N'arrête QUE cet arbre : jamais « tous les process du projet », comme le
 * fait `nodefony stop` — qui emporte avec l'exemplaire jetable le serveur de
 * développement lancé depuis le même dossier.
 *
 * @param child - process lancé `detached` (chef de groupe hors Windows).
 * @param options - arrêt gracieux ou non, délai de grâce.
 * @param signal - envoi du signal à l'arbre ; injecté par les tests pour
 * éprouver le verdict Windows (`forced-tree`) sans machine Windows.
 * @returns le verdict — `graceful` n'est rendu que si le process est sorti
 * de lui-même après `SIGTERM`.
 */
export async function stopChildTree(
  child: ChildProcess,
  options: ISpareStopOptions = {},
  signal: typeof signalProcessGroup = signalProcessGroup,
): Promise<SpareStopOutcome> {
  const pid = child.pid;
  if (hasExited(child) || pid === undefined) return "already-exited";
  if (options.graceful !== true) {
    signal(pid, "SIGKILL");
    await exited(child);
    return "forced";
  }
  // Windows : aucun arrêt gracieux d'arbre — le programme de kill d'arbre
  // force. Le verdict le DIT plutôt que de le masquer derrière un SIGTERM.
  const reached = signal(pid, "SIGTERM");
  if (reached === "forced-tree") {
    await exited(child);
    return "forced";
  }
  // Le minuteur de grâce est annulé dès la sortie : il ne retient pas la boucle.
  const grace = new AbortController();
  const late = await Promise.race([
    exited(child).then(() => false),
    delay(options.graceMs ?? DEFAULT_GRACE_MS, true, {
      signal: grace.signal,
    }).catch(() => false),
  ]);
  grace.abort();
  if (!late) return "graceful";
  signal(pid, "SIGKILL");
  await exited(child);
  return "forced";
}
