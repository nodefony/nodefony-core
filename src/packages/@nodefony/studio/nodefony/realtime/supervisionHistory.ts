/// <reference types="node" />
/**
 * Historique de la supervision (#618 D4/D5) — les dix dernières minutes d'un
 * process, envoyées d'un bloc à l'ouverture de la page Supervision au lieu de
 * courbes qui repartent de zéro.
 *
 * Le stockage est COLONNAIRE et en tableaux typés : une colonne par série, un
 * anneau de `capacity` points. C'est la forme que le fil transporte telle
 * quelle (octets petit-boutistes, cf `toLittleEndianBytes`) : CBOR la porte en
 * chaînes d'octets natives, JSON sous la convention `$bytes`.
 *
 * On paie ce qu'on regarde : rien n'est alloué ni échantillonné avant la
 * première visite ; ensuite l'enregistreur tourne pour la vie du process
 * (28,8 Ko de séries + 9,6 Ko de bandes, un minuteur par seconde), sans quoi
 * la visite suivante retrouverait un trou. Par process : en cluster, chaque
 * worker a le sien, comme le canal `nodefony:supervision`.
 */
import {
  monitorEventLoopDelay,
  performance,
  type ELDHistogram,
  type EventLoopUtilization,
} from "node:perf_hooks";
import {
  EVENT_LOOP_RESOLUTION_MS,
  eventLoopLagMs,
  readEventLoopDelay,
  toLittleEndianBytes,
  SUPERVISION_HISTORY_COLUMNS as HISTORY_COLUMNS,
  SUPERVISION_LOOP_BANDS as LOOP_BAND_COLUMNS,
  type ISupervisionHistory,
  type SupervisionHistoryPoint,
} from "nodefony";
import { cpuPercentOfOneCore } from "./providers";

/** Points retenus par série : dix minutes à une seconde. */
export const HISTORY_CAPACITY = 600;

/** Cadence d'échantillonnage, en ms. */
export const HISTORY_INTERVAL_MS = 1000;

/** Copie un anneau colonnaire dans `out`, linéarisé du plus ancien au plus récent. */
function linearize(
  ring: Float64Array | Float32Array,
  out: Float64Array | Float32Array,
  columns: number,
  capacity: number,
  start: number,
  length: number,
): void {
  const first = Math.min(length, capacity - start);
  for (let c = 0; c < columns; c += 1) {
    const base = c * capacity;
    out.set(ring.subarray(base + start, base + start + first), c * length);
    if (first < length) {
      out.set(ring.subarray(base, base + length - first), c * length + first);
    }
  }
}

/**
 * Enregistreur de l'historique de supervision : anneau colonnaire en tableaux
 * typés, alimenté par son propre minuteur.
 */
export class SupervisionRecorder {
  readonly capacity: number;
  readonly intervalMs: number;
  #values: Float64Array<ArrayBuffer> | null = null;
  #loop: Float32Array<ArrayBuffer> | null = null;
  /** Prochaine case écrite. */
  #head = 0;
  #length = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #eld: ELDHistogram | null = null;
  #prevCpu: NodeJS.CpuUsage | null = null;
  #prevTs = 0;
  #prevElu: EventLoopUtilization | null = null;

  /**
   * @param capacity - points retenus par série.
   * @param intervalMs - cadence d'échantillonnage, en ms.
   */
  constructor(
    capacity: number = HISTORY_CAPACITY,
    intervalMs: number = HISTORY_INTERVAL_MS,
  ) {
    this.capacity = capacity;
    this.intervalMs = intervalMs;
  }

  /** `true` tant que le minuteur d'échantillonnage tourne. */
  get running(): boolean {
    return this.#timer !== null;
  }

  /** Points présents dans l'anneau. */
  get length(): number {
    return this.#length;
  }

  /**
   * Démarre l'échantillonnage (idempotent) : alloue l'anneau, arme
   * l'histogramme de la boucle et le minuteur (`unref`).
   *
   * @returns l'enregistreur.
   */
  start(): this {
    if (this.#timer !== null) return this;
    this.#allocate();
    const eld = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
    eld.enable();
    this.#eld = eld;
    this.#prevCpu = process.cpuUsage();
    this.#prevTs = Date.now();
    this.#prevElu = performance.eventLoopUtilization();
    const timer = setInterval(() => this.sample(), this.intervalMs);
    timer.unref();
    this.#timer = timer;
    return this;
  }

  /** Arrête l'échantillonnage ; les points déjà enregistrés restent lisibles. */
  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#eld?.disable();
    this.#eld = null;
  }

  /**
   * Lit le process une fois et enregistre le point : CPU et utilisation de la
   * boucle sur l'intervalle écoulé, retard moyen et bandes de percentiles de
   * l'histogramme (remis à zéro ensuite), tas et RSS courants.
   * Sans `start()` préalable, ne fait rien.
   */
  sample(): void {
    const eld = this.#eld;
    const prevCpu = this.#prevCpu;
    const prevElu = this.#prevElu;
    if (eld === null || prevCpu === null || prevElu === null) return;
    const now = Date.now();
    const cpu = process.cpuUsage();
    const elu = performance.eventLoopUtilization();
    const loop = readEventLoopDelay(eld);
    const empty = eld.count === 0;
    const mem = process.memoryUsage();
    this.record({
      ts: now,
      cpuPercent: cpuPercentOfOneCore(prevCpu, cpu, now - this.#prevTs),
      eventLoopMeanMs: loop.meanMs,
      eluUtilization: performance.eventLoopUtilization(elu, prevElu)
        .utilization,
      heapUsed: mem.heapUsed,
      rss: mem.rss,
      p50: empty ? 0 : eventLoopLagMs(eld.percentile(50)),
      p90: empty ? 0 : eventLoopLagMs(eld.percentile(90)),
      p99: empty ? 0 : eventLoopLagMs(eld.percentile(99)),
      max: loop.maxMs,
    });
    eld.reset();
    this.#prevCpu = cpu;
    this.#prevTs = now;
    this.#prevElu = elu;
  }

  /**
   * Écrit un point dans l'anneau (le plus ancien est écrasé une fois plein).
   *
   * @param sample - une valeur par colonne de {@link HISTORY_COLUMNS} et de
   *   {@link LOOP_BAND_COLUMNS}.
   */
  record(sample: SupervisionHistoryPoint): void {
    const { values, loop } = this.#allocate();
    const cap = this.capacity;
    const h = this.#head;
    HISTORY_COLUMNS.forEach((name, c) => {
      values[c * cap + h] = sample[name];
    });
    LOOP_BAND_COLUMNS.forEach((name, c) => {
      loop[c * cap + h] = sample[name];
    });
    this.#head = (h + 1) % cap;
    if (this.#length < cap) this.#length += 1;
  }

  /**
   * Rend l'historique prêt à voyager : une copie linéarisée (du plus ancien au
   * plus récent) de chaque anneau, en octets petit-boutistes.
   *
   * @returns l'historique ; `length` vaut 0 tant qu'aucun point n'est enregistré.
   */
  snapshot(): ISupervisionHistory {
    const length = this.#length;
    const values = new Float64Array(HISTORY_COLUMNS.length * length);
    const loop = new Float32Array(LOOP_BAND_COLUMNS.length * length);
    if (length > 0 && this.#values !== null && this.#loop !== null) {
      const start = length < this.capacity ? 0 : this.#head;
      linearize(
        this.#values,
        values,
        HISTORY_COLUMNS.length,
        this.capacity,
        start,
        length,
      );
      linearize(
        this.#loop,
        loop,
        LOOP_BAND_COLUMNS.length,
        this.capacity,
        start,
        length,
      );
    }
    return {
      intervalMs: this.intervalMs,
      capacity: this.capacity,
      length,
      columns: HISTORY_COLUMNS,
      values: toLittleEndianBytes(values),
      loopColumns: LOOP_BAND_COLUMNS,
      loop: toLittleEndianBytes(loop),
    };
  }

  /** Alloue les anneaux au premier usage. */
  #allocate(): {
    values: Float64Array<ArrayBuffer>;
    loop: Float32Array<ArrayBuffer>;
  } {
    if (this.#values === null || this.#loop === null) {
      this.#values = new Float64Array(HISTORY_COLUMNS.length * this.capacity);
      this.#loop = new Float32Array(LOOP_BAND_COLUMNS.length * this.capacity);
    }
    return { values: this.#values, loop: this.#loop };
  }
}

/** Enregistreur du process, créé à la première visite. */
let shared: SupervisionRecorder | null = null;

/**
 * Enregistreur partagé du process — créé et démarré au premier appel (la
 * première visite de la Supervision), puis rendu tel quel.
 *
 * @returns l'enregistreur, en marche.
 */
export function sharedSupervisionRecorder(): SupervisionRecorder {
  shared ??= new SupervisionRecorder();
  return shared.start();
}
