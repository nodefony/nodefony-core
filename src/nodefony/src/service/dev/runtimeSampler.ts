/**
 * L'échantillon runtime du serveur de développement, pour la barre d'état du
 * superviseur (#537) : mémoire résidente, CPU sur l'intervalle, occupation de
 * la boucle d'évènements. La page Runtime de Studio montre bien plus ; la
 * barre ne garde que ce qu'on lit d'un coup d'œil.
 *
 * Coût : UNE lecture native par source et par tick (`memoryUsage.rss`,
 * `cpuUsage`, `eventLoopUtilization`, horloge) — les écarts se calculent sur
 * le relevé précédent, gardé ; aucun observateur, minuteur `unref` — rien sur
 * le chemin d'une requête.
 */
import { performance, type EventLoopUtilization } from "node:perf_hooks";
import type { IRuntimeSample } from "./startupScreen";

/** Cadence par défaut : assez vive pour voir bouger, assez lente pour ne rien coûter. */
export const RUNTIME_SAMPLE_MS = 2000;

/** Les sources d'un échantillon, toutes en relevés CUMULÉS — injectables en test. */
export interface IRuntimeSources {
  rss: () => number;
  /** Temps CPU cumulé du process (µs). */
  cpuUsage: () => NodeJS.CpuUsage;
  /** Temps actif et inactif cumulés de la boucle d'évènements (ms). */
  elu: () => EventLoopUtilization;
  now: () => number;
}

const NODE_SOURCES: IRuntimeSources = {
  rss: () => process.memoryUsage.rss(),
  cpuUsage: () => process.cpuUsage(),
  elu: () => performance.eventLoopUtilization(),
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
      // Un relevé par source ; l'écart se calcule sur le précédent, qui devient
      // la nouvelle référence. Le relevé suivant ne recompte donc rien.
      const now = sources.now();
      const cpuNow = sources.cpuUsage();
      const eluNow = sources.elu();
      const elapsedUs = Math.max(1, (now - at) * 1000);
      const active = eluNow.active - elu.active;
      const loopMs = active + (eluNow.idle - elu.idle);
      send({
        rssBytes: sources.rss(),
        cpuPercent:
          ((cpuNow.user - cpu.user + (cpuNow.system - cpu.system)) /
            elapsedUs) *
          100,
        eluPercent: loopMs > 0 ? (active / loopMs) * 100 : 0,
      });
      cpu = cpuNow;
      elu = eluNow;
      at = now;
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
