import { withTimeout } from "nodefony";
import type { IBackplane } from "../../interfaces/IBackplane";
import type { RealtimeHub } from "./RealtimeHub";

/**
 * Délai laissé au bus pour faire partir ce qui est déjà émis à l'arrêt (ms) — sous la limite d'arrêt du noyau (15 s) et sous le délai de grâce d'un orchestrateur.
 */
export const BACKPLANE_STOP_TIMEOUT_MS = 2000;

/**
 * Arrêt propre du temps réel d'un processus — la présence répartie annonce sa fin (dernier lot, puis preuve de vie FINALE, ADR-0025 P5), puis le bus POSSÉDÉ s'arrête en laissant partir ce qui est émis, dans une limite de temps.
 *
 * Sans l'attente du bus, la sortie du processus au tick suivant perdait la
 * preuve de vie finale sur un bus réseau (Redis) : les pairs gardaient ce
 * serveur jusqu'au délai d'oubli. Un bus fourni par l'application (`owned`
 * `null`) n'est pas arrêté ici : c'est à elle de le faire.
 *
 * @param hub - le hub du processus.
 * @param owned - le bus que l'appelant a créé et doit arrêter, `null` sinon.
 * @param timeoutMs - limite de l'arrêt du bus.
 * @returns `false` si le bus n'a pas fini dans la limite (ou a échoué) — ce
 *   qui restait peut être perdu, les pairs oublieront ce serveur au délai.
 */
export async function shutdownRealtime(
  hub: RealtimeHub,
  owned: IBackplane | null,
  timeoutMs: number = BACKPLANE_STOP_TIMEOUT_MS,
): Promise<boolean> {
  hub.endPresence();
  if (owned === null) return true;
  try {
    await withTimeout(
      Promise.resolve(owned.stop()),
      timeoutMs,
      "realtime backplane stop",
    );
    return true;
  } catch {
    return false;
  }
}
