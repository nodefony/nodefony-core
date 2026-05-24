import {
  CLUSTER_PROBE_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
  isClusterMessage,
} from "./clusterMessage";
import { Severity } from "../../syslog/Pdu";

/**
 * Handle master-side d'un worker, vu par l'agrégateur — sous-ensemble **testable** de
 * `cluster.Worker` (même seam que `IRelayWorker`). Prouve la collecte + la diffusion
 * sans forker de process réel.
 */
export interface IProbeWorker {
  readonly id: number;
  /** Envoie un message IPC à CE worker (master → worker). */
  send(msg: unknown): void;
  /** Enregistre le récepteur des messages de CE worker (worker → master). */
  onMessage(cb: (msg: unknown) => void): void;
}

/** Options du {@link ClusterProbeAggregator}. */
export interface ClusterProbeAggregatorOptions {
  /** Cadence de diffusion du snapshot agrégé (ms). Défaut 2000. */
  intervalMs?: number;
  log?: (msg: string, severity?: Severity) => void;
}

/**
 * **Agrégateur de sondes** master-side du mode cluster (Phase 4c) — le « gardien » qui
 * collecte la santé de chaque worker et **rediffuse la vue d'ensemble** à tous.
 *
 * Pourquoi : chaque worker n'a que SA sonde (`RealtimeHub.probe()`) ; l'endpoint
 * `/nodefony/realtime/api/health` tombe sur UN worker au hasard → vue partielle. Le master
 * (qui ne sert aucun HTTP) collecte les remontées `CLUSTER_PROBE_KIND` de tous les workers
 * et **pousse** périodiquement le snapshot agrégé (`CLUSTER_PROBE_SNAPSHOT_KIND`) vers chacun
 * → n'importe quel worker peut alors servir la vue POD instantanément (modèle push, pas pull :
 * 0 latence de requête, cohérent avec les tickers Nodefony).
 *
 * **Opaque** comme le {@link "./ClusterRelay"} : le master ne lit JAMAIS le contenu d'une
 * sonde (il garde le dernier payload par workerId et diffuse la liste) → 0 dépendance à
 * `@nodefony/framework` (la consolidation des champs se fait côté worker, qui connaît le type).
 *
 * Cycle de vie d'un worker : `attach` au `fork` (collecte ses remontées), `detach` au `exit`
 * (le worker mort SORT de l'agrégat → le snapshot suivant ne le contient plus). Diffusion
 * sur timer `unref` (cloud-native).
 */
export class ClusterProbeAggregator {
  readonly #workers = new Map<number, IProbeWorker>();
  /** workerId → dernier payload de sonde (opaque). */
  readonly #probes = new Map<number, unknown>();
  readonly #intervalMs: number;
  readonly #log: (msg: string, severity?: Severity) => void;
  #timer: ReturnType<typeof setInterval> | null = null;
  #broadcastTotal = 0;

  constructor(opts: ClusterProbeAggregatorOptions = {}) {
    this.#intervalMs = opts.intervalMs ?? 2000;
    this.#log = opts.log ?? (() => {});
  }

  /** Nombre de workers rattachés. */
  get size(): number {
    return this.#workers.size;
  }

  /** Total de snapshots diffusés (sonde de la gateway). */
  get broadcastTotal(): number {
    return this.#broadcastTotal;
  }

  /**
   * Rattache un worker : cible de diffusion + récepteur de ses remontées de sonde.
   * Idempotent par `id` (un respawn réattache proprement).
   */
  attach(worker: IProbeWorker): void {
    this.#workers.set(worker.id, worker);
    worker.onMessage((msg) => this.#collect(worker.id, msg));
  }

  /** Détache un worker (au `exit`) : il sort de l'agrégat. No-op s'il est déjà parti. */
  detach(id: number): void {
    this.#workers.delete(id);
    this.#probes.delete(id);
  }

  /** Collecte une remontée de sonde. Ignore les autres kinds + les messages malformés. */
  #collect(fromId: number, msg: unknown): void {
    if (!isClusterMessage(msg) || msg.kind !== CLUSTER_PROBE_KIND) return;
    this.#probes.set(fromId, (msg as { payload?: unknown }).payload);
  }

  /** Démarre la diffusion périodique du snapshot agrégé. Idempotent. Timer `unref`. */
  start(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => this.broadcast(), this.#intervalMs);
    (this.#timer as { unref?: () => void }).unref?.();
  }

  /**
   * Diffuse immédiatement le snapshot courant (liste des dernières sondes connues) à
   * tous les workers vivants. Appelable directement (tests) ou par le timer. N'envoie
   * rien s'il n'y a aucun worker.
   */
  broadcast(): void {
    if (this.#workers.size === 0) return;
    const snap = {
      kind: CLUSTER_PROBE_SNAPSHOT_KIND,
      ts: Date.now(),
      instances: [...this.#probes.values()],
    };
    for (const w of this.#workers.values()) {
      try {
        w.send(snap);
      } catch {
        /* un worker mort / en drain ne bloque pas la diffusion aux autres */
      }
    }
    this.#broadcastTotal += 1;
  }

  /** Arrête le timer de diffusion. Idempotent. */
  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Vide l'agrégateur (arrêt du master). */
  clear(): void {
    this.stop();
    this.#workers.clear();
    this.#probes.clear();
  }
}

export default ClusterProbeAggregator;
