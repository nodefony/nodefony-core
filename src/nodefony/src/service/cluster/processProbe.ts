import {
  performance,
  monitorEventLoopDelay,
  // `ELDHistogram` depuis @types/node 26.5.1, qui a retiré `IntervalHistogram` : c'est le type
  // que rend `monitorEventLoopDelay()`, mêmes membres (`enable`/`disable`/`mean`/`reset`).
  type ELDHistogram,
  type EventLoopUtilization,
} from "node:perf_hooks";
import v8 from "node:v8";
import type { IProcessHealth } from "../../realtime/platformHealth";

// Forme publiée : au cœur isomorphe, pour que le navigateur la lise sans recopie.
export type { IProcessHealth };

// Plafond heap V8 (constant pour un process) — capturé 1× au chargement, comme le PID.
// `heapUsed/heapTotal` est trompeur (V8 colle heapTotal à heapUsed → ~95 % au repos) ;
// `heapUsed/HEAP_LIMIT` est actionnable (= % avant OOM). Même métrique que `providers.ts`.
const HEAP_LIMIT = v8.getHeapStatistics().heap_size_limit;

/** Période d'échantillonnage des histogrammes de retard de la boucle (ms). */
export const EVENT_LOOP_RESOLUTION_MS = 20;

/** Retard de la boucle d'événements sur un intervalle, en ms. */
export interface IEventLoopDelay {
  /** Retard moyen : ce qu'un minuteur attend en plus de son échéance, en moyenne. */
  meanMs: number;
  /** Pire retard : le plus long blocage de la boucle sur l'intervalle. */
  maxMs: number;
}

/**
 * Lit le retard RÉEL de la boucle sur un histogramme `monitorEventLoopDelay`.
 *
 * Chaque échantillon de l'histogramme est l'intervalle entre deux réveils de
 * son minuteur interne — période d'échantillonnage COMPRISE : au repos, la
 * moyenne vaut la résolution (≈ 20 ms), pas zéro. Lue telle quelle, elle
 * annonçait 20 ms de retard sur une boucle libre. On la retranche ici, seul
 * endroit où cette lecture se fait.
 *
 * Le pire retard compte autant que la moyenne : un gel unique de 200 ms dans
 * un intervalle de 2 s ne déplace la moyenne que de quelques millisecondes.
 *
 * @param histogram - l'histogramme, lu AVANT son `reset()`.
 * @param resolutionMs - la résolution passée à `monitorEventLoopDelay`.
 * @returns retards moyen et maximal, bornés à 0 ; `0` sans échantillon.
 */
export function readEventLoopDelay(
  histogram: Pick<ELDHistogram, "mean" | "max" | "count">,
  resolutionMs: number = EVENT_LOOP_RESOLUTION_MS,
): IEventLoopDelay {
  if (histogram.count === 0 || !Number.isFinite(histogram.mean)) {
    return { meanMs: 0, maxMs: 0 };
  }
  return {
    meanMs: eventLoopLagMs(histogram.mean, resolutionMs),
    maxMs: eventLoopLagMs(histogram.max, resolutionMs),
  };
}

/**
 * Convertit une valeur lue sur un histogramme `monitorEventLoopDelay`
 * (moyenne, max, percentile — en nanosecondes) en retard RÉEL de la boucle,
 * en ms arrondies au centième.
 *
 * Seul endroit où la période d'échantillonnage est retranchée (cf
 * {@link readEventLoopDelay}) : un percentile lu sans elle annoncerait
 * 20 ms de retard sur une boucle libre.
 *
 * @param ns - valeur de l'histogramme, en nanosecondes.
 * @param resolutionMs - résolution de l'histogramme, en ms.
 * @returns le retard, en ms, jamais négatif.
 */
export function eventLoopLagMs(
  ns: number,
  resolutionMs: number = EVENT_LOOP_RESOLUTION_MS,
): number {
  return Math.max(0, Math.round((ns / 1e6 - resolutionMs) * 100) / 100);
}

/**
 * Sonde PROCESS **stateful** d'un worker — calcule les métriques par INTERVALLE (CPU,
 * event-loop lag, ELU sont des deltas entre 2 `read()`). Une instance par process worker.
 *
 * Perf (worker uniquement, JAMAIS hot path request) : `read()` appelé au tick de report
 * (≥ 1 s) → 1 `process.cpuUsage()` + 1 `memoryUsage()` + lecture histogramme. Le monitor
 * event-loop natif est **activé au 1ᵉʳ `read()`** (lazy — pas d'overhead « au cas où » à la
 * simple construction) puis reset à chaque tick (lag moyen sur l'intervalle). SERVEUR
 * uniquement (`node:perf_hooks`/`process`) → non importé par le bundle client.
 */
export class ProcessProbe {
  #prevCpu: NodeJS.CpuUsage = process.cpuUsage();
  #prevTs: number = Date.now();
  #prevElu: EventLoopUtilization = performance.eventLoopUtilization();
  readonly #eld: ELDHistogram = monitorEventLoopDelay({
    resolution: EVENT_LOOP_RESOLUTION_MS,
  });
  #enabled = false;

  /**
   * Lit la santé process courante (métriques par intervalle depuis le dernier `read()`).
   *
   * @returns {@link IProcessHealth} prêt à être joint au report de sonde du worker.
   */
  read(): IProcessHealth {
    if (!this.#enabled) {
      this.#eld.enable();
      this.#enabled = true;
    }
    const now = Date.now();
    const cur = process.cpuUsage();
    const userDelta = cur.user - this.#prevCpu.user;
    const sysDelta = cur.system - this.#prevCpu.system;
    const elapsedMs = Math.max(now - this.#prevTs, 1);
    this.#prevCpu = cur;
    this.#prevTs = now;
    // % d'UN cœur (cpuUsage est en µs) — pas de /cores : un worker saturant 1 cœur = ~100.
    const cpuPercent = Math.min(
      100,
      Math.round(((userDelta + sysDelta) / 1000 / elapsedMs) * 100),
    );
    // 1ᵉʳ read() : histogramme encore vide → 0 (jamais de NaN dans la grille).
    const loop = readEventLoopDelay(this.#eld);
    this.#eld.reset();
    const curElu = performance.eventLoopUtilization();
    const eluDelta = performance.eventLoopUtilization(curElu, this.#prevElu);
    this.#prevElu = curElu;
    const elu = Number.isFinite(eluDelta.utilization)
      ? Math.round(eluDelta.utilization * 1000) / 1000
      : 0;
    const mem = process.memoryUsage();
    return {
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      cpuPercent,
      eventLoopMs: loop.meanMs,
      eventLoopMaxMs: loop.maxMs,
      eluUtilization: elu,
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      heapLimit: HEAP_LIMIT,
      external: mem.external,
      ts: now,
    };
  }

  /** Libère le monitor event-loop natif (à l'arrêt du worker). Idempotent. */
  dispose(): void {
    if (this.#enabled) {
      this.#eld.disable();
      this.#enabled = false;
    }
  }
}

export default ProcessProbe;
