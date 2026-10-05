/**
 * L'échantillon runtime du serveur de développement, pour la barre d'état du
 * superviseur (#537) : mémoire résidente, CPU sur l'intervalle, occupation de
 * la boucle d'évènements. La page Runtime de Studio montre bien plus ; la
 * barre ne garde que ce qu'on lit d'un coup d'œil.
 *
 * Coût : trois lectures natives par tick (`memoryUsage.rss`, `cpuUsage`,
 * `eventLoopUtilization`), aucun observateur, minuteur `unref` — rien sur le
 * chemin d'une requête.
 */
import { performance, type EventLoopUtilization } from "node:perf_hooks";
import type { IRuntimeSample } from "./startupScreen";

/** Cadence par défaut : assez vive pour voir bouger, assez lente pour ne rien coûter. */
export const RUNTIME_SAMPLE_MS = 2000;

/** Les sources d'un échantillon — injectables en test. */
export interface IRuntimeSources {
  rss: () => number;
  cpuUsage: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
  /**
   * Sans argument : la mesure cumulée ; avec la précédente : l'écart depuis
   * elle (`performance.eventLoopUtilization(précédente)` — un seul argument,
   * Node lève si l'on passe `(undefined, précédente)`).
   */
  elu: (previous?: EventLoopUtilization) => EventLoopUtilization;
  now: () => number;
}

const NODE_SOURCES: IRuntimeSources = {
  rss: () => process.memoryUsage.rss(),
  cpuUsage: (previous) => process.cpuUsage(previous),
  elu: (previous) =>
    previous === undefined
      ? performance.eventLoopUtilization()
      : performance.eventLoopUtilization(previous),
  now: () => performance.now(),
};

/**
 * Échantillonne toutes les `intervalMs` et confie chaque échantillon à
 * `send` — le premier part après UN intervalle (un delta exige deux points).
 *
 * @param send - qui reçoit l'échantillon (le canal vers le superviseur).
 * @param intervalMs - cadence.
 * @param sources - sources de mesure, injectables en test.
 * @returns l'arrêt, idempotent.
 */
export function startRuntimeSampler(
  send: (sample: IRuntimeSample) => void,
  intervalMs = RUNTIME_SAMPLE_MS,
  sources: IRuntimeSources = NODE_SOURCES,
): () => void {
  let cpu = sources.cpuUsage();
  let elu = sources.elu();
  let at = sources.now();
  const timer = setInterval(() => {
    // Une mesure n'a pas le droit de tuer le serveur qu'elle observe : une
    // exception ici arrête l'échantillonneur, jamais l'application.
    try {
      const now = sources.now();
      const cpuDelta = sources.cpuUsage(cpu);
      const eluDelta = sources.elu(elu);
      const elapsedUs = Math.max(1, (now - at) * 1000);
      send({
        rssBytes: sources.rss(),
        cpuPercent: ((cpuDelta.user + cpuDelta.system) / elapsedUs) * 100,
        eluPercent: eluDelta.utilization * 100,
      });
      cpu = sources.cpuUsage();
      elu = sources.elu();
      at = now;
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
