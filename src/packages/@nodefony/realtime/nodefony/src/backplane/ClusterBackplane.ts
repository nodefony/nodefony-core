import type {
  IBackplane,
  BackplaneHandler,
  IBackplaneMessage,
  IBackplaneInfo,
} from "../../interfaces/IBackplane.js";
import { CLUSTER_RT_KIND } from "nodefony";

/**
 * Enveloppe IPC d'une publication realtime = {@link IBackplaneMessage} + discriminant.
 * Sérialisée une fois par `process.send`/`worker.send` (`structuredClone` IPC) → le
 * `payload` doit rester structurellement clonable (cf contrat IBackplane).
 */
export interface ClusterBackplaneEnvelope extends IBackplaneMessage {
  readonly kind: typeof CLUSTER_RT_KIND;
}

/**
 * Transport IPC du backplane cluster — abstrait `process.send` / la réception des
 * messages relayés par le master, derrière un seam **injectable** (même pattern que
 * `IClusterRuntime` côté ClusterManager). Permet de prouver le routage + l'anti-echo
 * **sans forker** de process réel.
 */
export interface IClusterBackplaneTransport {
  /**
   * Émet une enveloppe vers le master (worker → master). No-op silencieux si le
   * canal IPC est absent (process hors cluster) — le backplane reste sûr.
   */
  send(env: ClusterBackplaneEnvelope): void;
  /**
   * Enregistre le récepteur des messages IPC venus du master (master → worker).
   * Reçoit `unknown` (canal partagé) : le tri du `kind` est fait par le backplane.
   * Appelé une seule fois, au `start()`.
   */
  onReceive(cb: (msg: unknown) => void): void;
}

/**
 * Transport de production : `process.send` (émission) + `process.on("message")`
 * (réception). Standalone — utilisable tel quel. En vrai câblage cluster (Phase 3c),
 * un transport branché sur l'event kernel `onMessage` (déjà alimenté par
 * `Kernel.initCluster`) est préféré pour éviter un 2ᵉ listener + le log par message.
 */
export const processIpcTransport: IClusterBackplaneTransport = {
  send(env) {
    // `process.send` n'existe que dans un worker forké avec canal IPC.
    process.send?.(env);
  },
  onReceive(cb) {
    process.on("message", (msg) => cb(msg));
  },
};

/**
 * Type-guard d'enveloppe realtime — narrowing sûr d'un message IPC `unknown`.
 * Filtre tout ce qui n'est pas une publication realtime (autres messages de contrôle).
 */
function isEnvelope(m: unknown): m is ClusterBackplaneEnvelope {
  if (typeof m !== "object" || m === null) return false;
  const e = m as Partial<ClusterBackplaneEnvelope>;
  return (
    e.kind === CLUSTER_RT_KIND &&
    typeof e.channel === "string" &&
    typeof e.originId === "string"
  );
}

/**
 * Backplane **IPC cross-process** (Phase 3) — implémentation worker-side du port
 * {@link IBackplane} dans un cluster Node natif, où les workers ne se parlent qu'à
 * travers le **master-gateway** (un worker ne peut envoyer qu'au master via IPC).
 *
 * Flux d'une publication cross-process :
 *  - {@link publish} → emballe `{kind,channel,payload,originId}` → `transport.send`
 *    (worker → master) ; le master rebroadcast aux **autres** workers (cf `ClusterRelay`,
 *    Phase 3b) ; le fan-out **local** a déjà été fait par le hub avant cet appel ;
 *  - réception (master → worker) → {@link onMessage} handler → le hub réinjecte en
 *    fan-out **local uniquement** (`publishLocal`), jamais re-publié (anti-boucle).
 *
 * Anti-echo (2ᵉ barrière du contrat) : à la réception, on **filtre son propre
 * `originId`** — même si le master renvoyait à la source, le worker l'ignore.
 *
 * Perf : hors mono-process (où le hub garde `#backplane === null` → ce code ne tourne
 * jamais). En cluster, `publish` alloue 1 enveloppe + 1 sérialisation IPC (coût dominé
 * par l'IPC, pas par l'alloc) — sur le chemin realtime broadcast (tickers/fan-out),
 * PAS sur le hot path du request HTTP. SERVEUR uniquement (`process`).
 */
export class ClusterBackplane implements IBackplane {
  /** Nom du driver — source unique du littéral (registre + config). */
  static readonly driver = "cluster";

  readonly originId: string;
  readonly #transport: IClusterBackplaneTransport;
  #handler: BackplaneHandler | null = null;
  #started = false;

  constructor(
    transport: IClusterBackplaneTransport = processIpcTransport,
    originId: string = String(process.pid),
  ) {
    this.#transport = transport;
    this.originId = originId;
  }

  /** Branche la réception IPC. Idempotent. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#transport.onReceive((msg) => this.#ingress(msg));
  }

  /**
   * Propage une publication locale aux autres pairs via le master. NE refait PAS le
   * fan-out local (déjà fait par le hub). Sérialisé par le transport IPC.
   */
  publish(channel: string, payload: unknown): void {
    this.#transport.send({
      kind: CLUSTER_RT_KIND,
      channel,
      payload,
      originId: this.originId,
    });
  }

  /** Un seul handler d'ingress ; un appel ultérieur remplace le précédent. */
  onMessage(handler: BackplaneHandler): void {
    this.#handler = handler;
  }

  /** Tri + anti-echo + délégation au handler. Robuste : ignore tout message non-realtime. */
  #ingress(msg: unknown): void {
    if (!isEnvelope(msg)) return; // pas une publication realtime
    if (msg.originId === this.originId) return; // anti-echo (bretelle)
    this.#handler?.({
      channel: msg.channel,
      payload: msg.payload,
      originId: msg.originId,
    });
  }

  /** Détache le handler. Le listener du transport prod (`process`) survit au process. */
  stop(): void {
    this.#handler = null;
    this.#started = false;
  }

  describe(): IBackplaneInfo {
    return {
      driver: ClusterBackplane.driver,
      kind: "ipc",
      originId: this.originId,
      // IPC = fan-out entre workers d'un MÊME pod, pas multi-host.
      crossPod: false,
    };
  }
}

export default ClusterBackplane;
