import type {
  IBackplane,
  BackplaneHandler,
  IBackplaneInfo,
} from "../../interfaces/IBackplane";

/**
 * Défaut qu'un faux driver introduit exprès — chacun doit faire tomber UN cas de
 * la suite de conformité.
 */
export type MemoryBusFlaw =
  | "none"
  /** Ne livre qu'au premier autre pair : un groupe de lecteurs partagé. */
  | "unicast"
  /** Rejoue tout l'historique à qui démarre : lecture depuis le début du journal. */
  | "replay"
  /** Ignore le secret : rien n'est scellé ni vérifié. */
  | "unsealed";

/**
 * Bus en mémoire, livraison asynchrone (microtâche) comme un vrai réseau — le
 * banc d'épreuve de la suite de conformité elle-même : correct, il la passe ;
 * défectueux, il doit la faire tomber.
 */
export function memoryBus(flaw: MemoryBusFlaw = "none"): {
  makePeer: (secret: string | null) => IBackplane;
} {
  const peers = new Set<MemoryPeer>();
  const history: {
    channel: string;
    payload: unknown;
    originId: string;
    secret: string | null;
  }[] = [];
  let next = 0;

  class MemoryPeer implements IBackplane {
    readonly originId: string;
    #handler: BackplaneHandler | null = null;
    readonly #secret: string | null;

    constructor(secret: string | null) {
      next += 1;
      this.originId = `memory-${next}`;
      this.#secret = flaw === "unsealed" ? null : secret;
    }

    start(): void {
      if (peers.has(this)) return;
      peers.add(this);
      if (flaw === "replay") for (const m of history) this.deliver(m);
    }

    publish(channel: string, payload: unknown): void {
      const msg = {
        channel,
        payload: structuredClone(payload),
        originId: this.originId,
        secret: this.#secret,
      };
      history.push(msg);
      let delivered = 0;
      for (const peer of peers) {
        if (peer === this) continue;
        if (flaw === "unicast" && delivered > 0) break;
        peer.deliver(msg);
        delivered += 1;
      }
    }

    deliver(msg: {
      channel: string;
      payload: unknown;
      originId: string;
      secret: string | null;
    }): void {
      if (msg.originId === this.originId) return;
      // Sceau simulé : le même secret, ou le bus nu des deux côtés.
      if (msg.secret !== this.#secret) return;
      queueMicrotask(() =>
        this.#handler?.({
          channel: msg.channel,
          payload: msg.payload,
          originId: msg.originId,
        }),
      );
    }

    onMessage(handler: BackplaneHandler): void {
      this.#handler = handler;
    }

    stop(): void {
      peers.delete(this);
      this.#handler = null;
    }

    describe(): IBackplaneInfo {
      return {
        driver: "memory",
        kind: "local",
        originId: this.originId,
        crossPod: false,
      };
    }
  }

  return { makePeer: (secret) => new MemoryPeer(secret) };
}
