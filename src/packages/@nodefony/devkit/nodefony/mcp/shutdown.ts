import { setTimeout as delay } from "node:timers/promises";
import type { IMcpToolRun } from "nodefony";

/**
 * Délai maximal, en ms, pendant lequel l'arrêt du serveur attend que le
 * rapport parte : le superviseur de développement tue le process 4 s après
 * le lui avoir demandé.
 */
const SHUTDOWN_REPORT_MAX_MS = 1000;

/** Marge, en ms, laissée à la porte pour écrire le rapport une fois rendu. */
const SHUTDOWN_REPORT_FLUSH_MS = 100;

/** Abonnement à l'arrêt du serveur, pour la durée d'UN appel d'outil. */
export type OnShutdown = (listener: () => Promise<void>) => () => void;

/** Ce qu'un outil long lit pour savoir s'il doit s'arrêter, et pourquoi. */
export interface IToolStop {
  /** Avorté quand l'agent abandonne l'appel OU que le serveur s'arrête. */
  readonly signal: AbortSignal;
  /** `true` si c'est l'arrêt du serveur qui a clos l'appel. */
  readonly interrupted: boolean;
  /**
   * Le rapport est rendu : l'arrêt du serveur, s'il attendait, reprend, et
   * l'écouteur quitte le kernel. À appeler sur TOUS les chemins de sortie.
   */
  release(): void;
}

/**
 * Arme l'arrêt d'un outil long : l'agent qui abandonne, ou le serveur qui
 * s'arrête (rechargement après une modification de fichier). Dans le second
 * cas, l'arrêt attend — borné — que le rapport partiel soit parti.
 *
 * @param run - l'appel en cours, porteur du signal d'abandon de l'agent.
 * @param onShutdown - abonnement à l'arrêt du serveur ; absent hors application.
 * @returns le signal combiné, la cause, et la libération.
 */
export function watchToolStop(
  run: IMcpToolRun | undefined,
  onShutdown: OnShutdown | undefined,
): IToolStop {
  const stop = new AbortController();
  const signal =
    run === undefined
      ? stop.signal
      : AbortSignal.any([run.signal, stop.signal]);
  const delivered = Promise.withResolvers<void>();
  let interrupted = false;
  const unsubscribe =
    onShutdown?.(async () => {
      interrupted = true;
      stop.abort();
      await Promise.race([
        delivered.promise.then(() =>
          delay(SHUTDOWN_REPORT_FLUSH_MS, undefined, { ref: false }),
        ),
        delay(SHUTDOWN_REPORT_MAX_MS, undefined, { ref: false }),
      ]);
    }) ?? null;
  let released = false;
  return {
    signal,
    get interrupted() {
      return interrupted;
    },
    release() {
      if (released) return;
      released = true;
      delivered.resolve();
      unsubscribe?.();
    },
  };
}
