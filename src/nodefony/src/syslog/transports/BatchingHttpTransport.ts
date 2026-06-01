import type { ITransport } from "../../types/ITransport";
import type Pdu from "../Pdu";

/** Promesse résolue partagée — `send()` n'alloue pas une Promise par log. */
const RESOLVED_VOID: Promise<void> = Promise.resolve();

/** Compteurs d'observabilité d'un transport batché (introspection / debug). */
export interface BatchTransportStats {
  /** Pdu jetés faute de place (queue saturée = destination trop lente / down). */
  dropped: number;
  /** Lots dont le push HTTP a échoué (best-effort : on n'empile pas indéfiniment). */
  failedBatches: number;
  /** Pdu actuellement en attente de flush. */
  queued: number;
}

export interface BatchTransportOptions {
  /** Flush dès que la queue atteint cette taille (coalescence). Défaut 100. */
  batchSize?: number;
  /** Flush périodique du reliquat (ms). Défaut 2000. */
  flushIntervalMs?: number;
  /**
   * Plafond DUR de la queue (anti-OOM). Au-delà, les nouveaux logs sont DROP +
   * comptés — on ne bloque JAMAIS le hot path ni ne fait exploser la RAM si la
   * destination est lente/injoignable. Défaut 10000.
   */
  maxQueue?: number;
}

/**
 * Base d'un transport de logs HTTP **batché** — généralise le pattern LB.W
 * (ring borné → drain coalescé → drop borné) à une destination réseau (Loki,
 * OpenSearch). Mutualise toute la mécanique de file/flush/drop/cleanup ; la
 * sous-classe n'implémente QUE {@link flushBatch} (formatage + push spécifiques).
 *
 * **Garanties hot path** : `send(pdu)` est O(1) non-bloquant (enqueue + arme un
 * timer `unref`), retourne une Promise résolue partagée (0 alloc/log), et ne
 * `throw` jamais — un push qui rate est compté, pas propagé au pipeline requête.
 * Coalescence : un POST par lot (≠ 1 requête HTTP par log = catastrophe réseau).
 *
 * **Durabilité best-effort** : flush sur `beforeExit` (le seul hook où l'on peut
 * encore faire de l'async proprement). PAS de handler `SIGTERM`/`SIGINT` — il
 * casserait le `Ctrl+C` (leçon LB.W). Un crash dur peut perdre le dernier lot :
 * acceptable pour une destination réseau (les logs y sont déjà best-effort), les
 * sévérités fatales restant écrites par le sink local synchrone (LB.W).
 */
export abstract class BatchingHttpTransport implements ITransport {
  abstract readonly name: string;

  // Une queue par INSTANCE de transport (créée 1× au boot si le driver est actif),
  // jamais par requête → conforme à la règle d'alloc. Pdu gardés par référence ;
  // la projection (Pdu → ligne/doc) est différée au flush (hors hot path du send).
  #queue: Pdu[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #flushing = false;
  #dropped = 0;
  #failedBatches = 0;
  #exitHooked = false;

  readonly #batchSize: number;
  readonly #flushIntervalMs: number;
  readonly #maxQueue: number;

  constructor(options: BatchTransportOptions = {}) {
    this.#batchSize = options.batchSize ?? 100;
    this.#flushIntervalMs = options.flushIntervalMs ?? 2000;
    this.#maxQueue = options.maxQueue ?? 10000;
  }

  /**
   * Enfile un log (O(1), non-bloquant). Flush immédiat si le lot est plein, sinon
   * arme un timer `unref` pour drainer le reliquat. Queue saturée → DROP + compteur.
   */
  send(pdu: Pdu): Promise<void> {
    // Branche le flush de sortie au 1ᵉʳ usage réel (lazy : 0 effet si jamais utilisé).
    if (!this.#exitHooked) {
      this.#exitHooked = true;
      process.once("beforeExit", () => {
        void this.#flush();
      });
    }
    if (this.#queue.length >= this.#maxQueue) {
      this.#dropped++;
      return RESOLVED_VOID;
    }
    this.#queue.push(pdu);
    if (this.#queue.length >= this.#batchSize) {
      void this.#flush();
    } else if (this.#timer === null) {
      this.#timer = setTimeout(() => {
        this.#timer = null;
        void this.#flush();
      }, this.#flushIntervalMs);
      if (typeof (this.#timer as { unref?: () => void }).unref === "function") {
        (this.#timer as { unref: () => void }).unref();
      }
    }
    return RESOLVED_VOID;
  }

  /** Vide la queue par lots et pousse — réentrance protégée (un seul drain à la fois). */
  async #flush(): Promise<void> {
    if (this.#flushing || this.#queue.length === 0) return;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#flushing = true;
    // splice = retire la totalité de la queue en 1 fois → un POST coalescé.
    const batch = this.#queue.splice(0, this.#queue.length);
    try {
      await this.flushBatch(batch);
    } catch {
      // Best-effort : destination en panne → on ne ré-empile pas (ordre/croissance)
      // et on ne propage pas (jamais casser le pipeline). On compte, c'est tout.
      this.#failedBatches++;
    } finally {
      this.#flushing = false;
    }
    // Des logs sont arrivés pendant le push → re-drainer si un lot s'est reconstitué.
    if (this.#queue.length >= this.#batchSize) void this.#flush();
  }

  /**
   * Pousse un lot de Pdu vers la destination — implémenté par la sous-classe
   * (format + endpoint spécifiques). Peut `throw` : la base catche et compte.
   */
  protected abstract flushBatch(batch: Pdu[]): Promise<void>;

  /** Flush final explicite (arrêt gracieux). Best-effort, ne `throw` pas. */
  async close(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#flush();
  }

  /** Compteurs d'observabilité (drop/échecs/queue). */
  get stats(): BatchTransportStats {
    return {
      dropped: this.#dropped,
      failedBatches: this.#failedBatches,
      queued: this.#queue.length,
    };
  }
}
