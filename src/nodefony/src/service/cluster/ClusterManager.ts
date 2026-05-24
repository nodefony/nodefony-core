import cluster from "node:cluster";
import { Severity } from "../../syslog/Pdu";

/**
 * Calcule le délai de respawn d'un worker mort selon un backoff exponentiel.
 *
 * Anti crash-loop : un worker qui crashe en boucle ne doit pas être re-forké en
 * rafale (CPU 100 %, logs noyés). Le délai double à chaque crash consécutif, plafonné.
 *
 * @param crashes - nombre de crashs consécutifs (>= 1).
 * @param baseMs - délai du 1er respawn.
 * @param maxMs - plafond du délai.
 * @returns délai en ms, dans `[baseMs, maxMs]`.
 */
export function computeBackoff(
  crashes: number,
  baseMs: number,
  maxMs: number,
): number {
  const n = Math.max(1, Math.floor(crashes));
  return Math.min(baseMs * 2 ** (n - 1), maxMs);
}

/** Handle minimal d'un worker — sous-ensemble de `cluster.Worker` réellement utilisé (testable). */
export interface IClusterWorker {
  readonly id: number;
  /** Envoie un signal au process worker (déconnecte + signale, cf `cluster.Worker.kill`). */
  kill(signal?: NodeJS.Signals): void;
  /** `true` si le process est mort. */
  isDead(): boolean;
}

/** Runtime cluster — abstrait `node:cluster` pour piloter fork/exit dans les tests sans forker de process. */
export interface IClusterRuntime {
  readonly isPrimary: boolean;
  fork(): IClusterWorker;
  onExit(
    cb: (
      worker: IClusterWorker,
      code: number | null,
      signal: string | null,
    ) => void,
  ): void;
}

/** Planificateur (setTimeout/clearTimeout) — injectable pour tester backoff + timeout sans horloge réelle. */
export interface ClusterScheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const nodeScheduler: ClusterScheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Adapter de production : `node:cluster`. */
const nodeClusterRuntime: IClusterRuntime = {
  get isPrimary() {
    return cluster.isPrimary;
  },
  fork() {
    const w = cluster.fork();
    return {
      id: w.id,
      kill: (s) => w.kill(s),
      isDead: () => w.isDead(),
    };
  },
  onExit(cb) {
    cluster.on("exit", (w, code, signal) =>
      cb(
        { id: w.id, kill: (s) => w.kill(s), isDead: () => w.isDead() },
        code,
        signal,
      ),
    );
  },
};

/** Options du {@link ClusterManager}. Tous les effets de bord (runtime, timers, exit, log) sont injectables. */
export interface ClusterManagerOptions {
  /** Nombre de workers à forker (résolu par {@link resolveWorkerCount}). */
  workers: number;
  log?: (msg: string, severity?: Severity) => void;
  runtime?: IClusterRuntime;
  scheduler?: ClusterScheduler;
  /** Sortie process — injectable pour ne pas tuer le process de test. Défaut : `process.exit`. */
  exit?: (code: number) => void;
  /** Délai du 1er respawn (ms). Défaut 200. */
  respawnBaseMs?: number;
  /** Plafond du délai de respawn (ms). Défaut 10 000. */
  respawnMaxMs?: number;
  /** Durée de vie minimale d'un worker pour réinitialiser le backoff (ms). Défaut 30 000. */
  stableMs?: number;
  /** Délai de drain gracieux avant SIGKILL des survivants (ms). Défaut 10 000. */
  shutdownTimeoutMs?: number;
}

/**
 * Superviseur cluster du process MASTER (Phase 2 du mode cluster sans PM2).
 *
 * Le master ne sert AUCUN HTTP : il fork N workers, les respawn avec backoff en cas
 * de crash, et coordonne un arrêt gracieux (drain SIGTERM → SIGKILL après timeout).
 * Cgroup-aware via {@link resolveWorkerCount} (le `workers` passé est déjà résolu).
 *
 * Toute la mécanique runtime (`node:cluster`, timers, `process.exit`, signaux) est
 * derrière des seams injectables : le state machine respawn/shutdown est testé sans
 * forker un seul process réel.
 */
export class ClusterManager {
  readonly #workers: number;
  readonly #log: (msg: string, severity?: Severity) => void;
  readonly #runtime: IClusterRuntime;
  readonly #scheduler: ClusterScheduler;
  readonly #exit: (code: number) => void;
  readonly #base: number;
  readonly #max: number;
  readonly #stableMs: number;
  readonly #shutdownTimeoutMs: number;

  readonly #live = new Map<
    number,
    { worker: IClusterWorker; forkedAt: number }
  >();
  #consecutiveCrashes = 0;
  #shuttingDown = false;
  #shutdownTimer: unknown = null;
  #started = false;

  constructor(opts: ClusterManagerOptions) {
    this.#workers = Math.max(1, opts.workers);
    this.#log = opts.log ?? (() => {});
    this.#runtime = opts.runtime ?? nodeClusterRuntime;
    this.#scheduler = opts.scheduler ?? nodeScheduler;
    this.#exit = opts.exit ?? ((code) => process.exit(code));
    this.#base = opts.respawnBaseMs ?? 200;
    this.#max = opts.respawnMaxMs ?? 10_000;
    this.#stableMs = opts.stableMs ?? 30_000;
    this.#shutdownTimeoutMs = opts.shutdownTimeoutMs ?? 10_000;
  }

  /** Nombre de workers actuellement vivants. */
  get size(): number {
    return this.#live.size;
  }

  /** `true` une fois `shutdown()` enclenché (plus aucun respawn). */
  get shuttingDown(): boolean {
    return this.#shuttingDown;
  }

  /**
   * Fork les workers initiaux et arme le respawn. Idempotent.
   *
   * @returns `this`.
   */
  start(): this {
    if (this.#started) {
      return this;
    }
    this.#started = true;
    this.#runtime.onExit((w, code, signal) => this.#onExit(w, code, signal));
    for (let i = 0; i < this.#workers; i += 1) {
      this.#fork();
    }
    this.#log(`cluster master up — ${this.#workers} worker(s)`, "INFO");
    return this;
  }

  #fork(): void {
    const worker = this.#runtime.fork();
    this.#live.set(worker.id, { worker, forkedAt: Date.now() });
  }

  #onExit(
    worker: IClusterWorker,
    code: number | null,
    signal: string | null,
  ): void {
    const rec = this.#live.get(worker.id);
    this.#live.delete(worker.id);
    const cause = signal ?? `code ${code}`;

    if (this.#shuttingDown) {
      this.#log(
        `worker ${worker.id} exited (${cause}) — ${this.#live.size} remaining`,
        "INFO",
      );
      if (this.#live.size === 0) {
        this.#finishShutdown(0);
      }
      return;
    }

    // Worker stable assez longtemps → ce crash repart de zéro (pas une boucle).
    const uptime = rec ? Date.now() - rec.forkedAt : 0;
    if (uptime >= this.#stableMs) {
      this.#consecutiveCrashes = 0;
    }
    this.#consecutiveCrashes += 1;
    const delay = computeBackoff(
      this.#consecutiveCrashes,
      this.#base,
      this.#max,
    );
    this.#log(
      `worker ${worker.id} died (${cause}) — respawn in ${delay}ms (crash #${this.#consecutiveCrashes})`,
      "WARNING",
    );
    this.#scheduler.set(() => {
      if (!this.#shuttingDown) {
        this.#fork();
      }
    }, delay);
  }

  /**
   * Arrêt gracieux : déconnecte/SIGTERM chaque worker (drain), puis SIGKILL les
   * survivants après `shutdownTimeoutMs`, et sort le process. Idempotent.
   *
   * @param signal - signal d'origine (log uniquement).
   */
  shutdown(signal: NodeJS.Signals = "SIGTERM"): void {
    if (this.#shuttingDown) {
      return;
    }
    this.#shuttingDown = true;
    this.#log(`${signal} — draining ${this.#live.size} worker(s)`, "CRITIC");
    if (this.#live.size === 0) {
      this.#finishShutdown(0);
      return;
    }
    for (const { worker } of this.#live.values()) {
      if (!worker.isDead()) {
        worker.kill("SIGTERM");
      }
    }
    this.#shutdownTimer = this.#scheduler.set(() => {
      this.#log(
        `graceful timeout — SIGKILL ${this.#live.size} worker(s)`,
        "ERROR",
      );
      for (const { worker } of this.#live.values()) {
        if (!worker.isDead()) {
          worker.kill("SIGKILL");
        }
      }
      this.#finishShutdown(1);
    }, this.#shutdownTimeoutMs);
  }

  #finishShutdown(code: number): void {
    if (this.#shutdownTimer !== null) {
      this.#scheduler.clear(this.#shutdownTimer);
      this.#shutdownTimer = null;
    }
    this.#log(`cluster master down (exit ${code})`, "INFO");
    this.#exit(code);
  }

  /**
   * Branche SIGTERM/SIGINT du process MASTER sur {@link shutdown}.
   *
   * Le master prend la main sur ces signaux : `Cli.handleSignals` les mapperait sinon
   * vers un `terminate()` immédiat (process.exit) qui tuerait le master AVANT que les
   * workers aient drainé. À n'appeler que dans le vrai process master.
   */
  installSignalHandlers(): void {
    for (const sig of ["SIGTERM", "SIGINT"] as NodeJS.Signals[]) {
      process.removeAllListeners(sig);
      process.on(sig, () => this.shutdown(sig));
    }
  }
}

export default ClusterManager;
