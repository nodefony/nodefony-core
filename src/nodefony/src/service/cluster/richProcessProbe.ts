import os from "node:os";
import v8 from "node:v8";
import {
  performance,
  PerformanceObserver,
  constants as perfConstants,
  type EventLoopUtilization,
} from "node:perf_hooks";

// Forme publiée : au cœur isomorphe, pour que le navigateur la lise sans recopie.
import type { IProcessRich } from "../../realtime/platformHealth";
export type { IProcessRich };

/**
 * Sonde process **riche stateful** d'un worker — calcule les métriques par INTERVALLE
 * (GC, ELU active/idle, changements de contexte sont des deltas entre deux `read()`).
 * Une instance par process worker, **lazy & opt-in** : créée seulement quand un drill
 * est actif sur ce worker (« on paie ce qu'on regarde »).
 *
 * Perf (worker uniquement, JAMAIS hot path request) : l'observer GC n'est attaché qu'à
 * {@link enable} (1ᵉʳ `read()` sinon) et **détaché à {@link disable}** (aucun listener
 * orphelin). Les sondes lourdes (`getHeapSpaceStatistics`, `getActiveResourcesInfo`,
 * `getrusage`) ne tournent qu'au `read()` (au tick de report, ≥ 1 s). SERVEUR uniquement
 * (`node:v8`/`node:perf_hooks`/`node:os`) → non importé par le bundle client.
 *
 * Logique portée de `createStatsTicker` (`@nodefony/studio`) en classe réutilisable :
 * source unique de la sonde process riche, partagée par le drill cluster et la
 * supervision mono-process.
 */
export class RichProcessProbe {
  readonly #heapLimit: number = v8.getHeapStatistics().heap_size_limit;
  readonly #cpuCount: number = os.cpus().length || 1;
  #prevElu: EventLoopUtilization = performance.eventLoopUtilization();
  #prevRu: NodeJS.ResourceUsage = process.resourceUsage();
  #gcObs: PerformanceObserver | null = null;
  #gcCount = 0;
  #gcPauseMs = 0;
  #gcMajor = 0;
  #gcMinor = 0;
  #enabled = false;

  /**
   * Attache l'observer GC et réinitialise les baselines de delta (ELU/ctx). Idempotent.
   * Appelé automatiquement au 1ᵉʳ `read()` ; explicite pour démarrer la collecte GC tôt.
   */
  enable(): void {
    if (this.#enabled) return;
    this.#enabled = true;
    this.#prevElu = performance.eventLoopUtilization();
    this.#prevRu = process.resourceUsage();
    this.#gcCount = this.#gcPauseMs = this.#gcMajor = this.#gcMinor = 0;
    this.#gcObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        this.#gcCount += 1;
        this.#gcPauseMs += e.duration;
        // `detail` n'est pas typé sur PerformanceEntry (selon la version @types/node) →
        // cast de l'entrée (présent à l'exécution pour les entrées GC).
        const kind = (e as { detail?: { kind?: number } | null }).detail?.kind;
        if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR)
          this.#gcMajor += 1;
        else if (kind === perfConstants.NODE_PERFORMANCE_GC_MINOR)
          this.#gcMinor += 1;
      }
    });
    try {
      this.#gcObs.observe({ entryTypes: ["gc"] });
    } catch {
      /* 'gc' indisponible : best-effort, on continue sans sonde GC */
    }
  }

  /**
   * Lit la sonde riche courante (deltas depuis le dernier `read()`, snapshots heap/handles).
   *
   * @returns {@link IProcessRich} prêt à être joint au report du worker drillé.
   */
  read(): IProcessRich {
    if (!this.#enabled) this.enable();

    const gc = {
      count: this.#gcCount,
      pauseMs: Math.round(this.#gcPauseMs * 100) / 100,
      major: this.#gcMajor,
      minor: this.#gcMinor,
    };
    this.#gcCount = this.#gcPauseMs = this.#gcMajor = this.#gcMinor = 0;

    const heapSpaces = v8.getHeapSpaceStatistics().map((s) => ({
      name: s.space_name,
      used: s.space_used_size,
      size: s.space_size,
    }));

    const resources = process.getActiveResourcesInfo();
    const byType = Object.create(null) as Record<string, number>;
    for (const r of resources) byType[r] = (byType[r] ?? 0) + 1;

    const curElu = performance.eventLoopUtilization();
    const eluDelta = performance.eventLoopUtilization(curElu, this.#prevElu);
    this.#prevElu = curElu;
    const elu = {
      active: Number.isFinite(eluDelta.active)
        ? Math.round(eluDelta.active * 100) / 100
        : 0,
      idle: Number.isFinite(eluDelta.idle)
        ? Math.round(eluDelta.idle * 100) / 100
        : 0,
    };

    const ru = process.resourceUsage();
    const ctx = {
      voluntary:
        ru.voluntaryContextSwitches - this.#prevRu.voluntaryContextSwitches,
      involuntary:
        ru.involuntaryContextSwitches - this.#prevRu.involuntaryContextSwitches,
    };
    this.#prevRu = ru;

    return {
      gc,
      heapSpaces,
      handles: { total: resources.length, byType },
      elu,
      ctx,
      loadavg: os.loadavg() as [number, number, number],
      heapLimit: this.#heapLimit,
      cpuCount: this.#cpuCount,
      ts: Date.now(),
    };
  }

  /** Détache l'observer GC (fin du drill / arrêt du worker). Idempotent. */
  disable(): void {
    if (this.#gcObs !== null) {
      this.#gcObs.disconnect();
      this.#gcObs = null;
    }
    this.#enabled = false;
  }
}

export default RichProcessProbe;
