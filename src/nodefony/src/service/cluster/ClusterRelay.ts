import { CLUSTER_RT_KIND, isClusterMessage } from "./clusterMessage";
import { Severity } from "../../syslog/Pdu";

/**
 * Handle master-side d'un worker, vu par le relay — sous-ensemble **testable** de
 * `cluster.Worker` réellement utilisé (même approche que `IClusterWorker` du
 * ClusterManager). Permet de prouver le routage sans forker de process réel.
 */
export interface IRelayWorker {
  readonly id: number;
  /** Envoie un message IPC à CE worker (master → worker). */
  send(msg: unknown): void;
  /** Enregistre le récepteur des messages de CE worker (worker → master). */
  onMessage(cb: (msg: unknown) => void): void;
}

/** Options du {@link ClusterRelay}. Effets de bord (log) injectables. */
export interface ClusterRelayOptions {
  log?: (msg: string, severity?: Severity) => void;
}

/**
 * **Master-gateway** du backplane realtime cluster (Phase 3) — routeur IPC qui vit dans
 * le process MASTER (lequel ne sert AUCUN HTTP, cf {@link ClusterManager}).
 *
 * Les workers d'un cluster Node natif ne se parlent **jamais** directement : un worker
 * n'envoie qu'au master. Le relay reçoit les publications realtime d'un worker et les
 * **rebroadcast aux AUTRES** workers — ce qui réalise le fan-out cross-process intra-pod
 * « comme si Redis était là », sans aucune infra (cf vision cluster-backplane).
 *
 * Anti-echo de routage : le message **n'est jamais renvoyé à sa source** (le worker
 * filtre AUSSI son `originId` côté `ClusterBackplane` — ceinture + bretelles).
 *
 * Tri par `kind` : seuls les messages realtime (`CLUSTER_RT_KIND`) sont rebroadcastés.
 * Les autres messages de contrôle (ex. remontées de sondes à **agréger** au master,
 * Phase 4) sont laissés à un autre consommateur — le relay les ignore (il ne les fan-out
 * surtout PAS). Messages malformés ignorés silencieusement (robustesse IPC).
 *
 * Le master ne tient aucun hub realtime : il route des messages **opaques** (`channel`,
 * `payload`, `originId` ne sont pas inspectés) → 0 dépendance à `@nodefony/framework`
 * (respect du sens des dépendances framework→core).
 */
export class ClusterRelay {
  readonly #workers = new Map<number, IRelayWorker>();
  readonly #log: (msg: string, severity?: Severity) => void;
  #relayedTotal = 0;

  constructor(opts: ClusterRelayOptions = {}) {
    this.#log = opts.log ?? (() => {});
  }

  /** Nombre de workers actuellement rattachés au relay. */
  get size(): number {
    return this.#workers.size;
  }

  /** Total des messages realtime rebroadcastés (sonde gateway). */
  get relayedTotal(): number {
    return this.#relayedTotal;
  }

  /**
   * Rattache un worker : l'enregistre comme cible de broadcast et branche la réception
   * de ses messages. Idempotent par `id` (un respawn réattache proprement). À appeler
   * au `fork` (et à chaque respawn) côté ClusterManager.
   */
  attach(worker: IRelayWorker): void {
    this.#workers.set(worker.id, worker);
    worker.onMessage((msg) => this.#route(worker.id, msg));
    this.#log(
      `relay: worker ${worker.id} attaché au fan-out (${this.#workers.size} au total)`,
      "DEBUG",
    );
  }

  /** Détache un worker (au `exit`). No-op s'il est déjà parti. */
  detach(id: number): void {
    this.#workers.delete(id);
  }

  /**
   * Route un message reçu du worker `fromId` : si c'est une publication realtime, la
   * rebroadcast à tous les **autres** workers vivants. Sinon, ignore (autre kind /
   * malformé). N'alloue rien sur le chemin (réutilise le message IPC tel quel).
   */
  #route(fromId: number, msg: unknown): void {
    if (!isClusterMessage(msg) || msg.kind !== CLUSTER_RT_KIND) return;
    for (const [id, w] of this.#workers) {
      if (id === fromId) continue; // jamais à la source (anti-echo de routage)
      try {
        w.send(msg);
      } catch {
        /* un worker mort/en cours de drain ne bloque pas le fan-out aux autres */
      }
    }
    this.#relayedTotal += 1;
  }

  /** Vide le relay (arrêt du master). Les workers sont tués par le ClusterManager. */
  clear(): void {
    this.#workers.clear();
  }
}

export default ClusterRelay;
