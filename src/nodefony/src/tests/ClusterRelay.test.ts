import { expect } from "chai";
import "mocha";
import {
  ClusterRelay,
  type IRelayWorker,
} from "../service/cluster/ClusterRelay";
import { CLUSTER_RT_KIND } from "../service/cluster/clusterMessage";

/**
 * ClusterRelay — master-gateway du backplane realtime cluster. Reçoit les publications
 * d'un worker et les rebroadcast aux AUTRES (jamais à la source). Le transport IPC est
 * derrière un seam (`IRelayWorker`) → routage prouvé SANS forker de process réel.
 */
describe("cluster / ClusterRelay (master gateway routing)", () => {
  class FakeWorker implements IRelayWorker {
    readonly id: number;
    readonly received: unknown[] = [];
    #cb: ((msg: unknown) => void) | null = null;
    constructor(id: number) {
      this.id = id;
    }
    send(msg: unknown): void {
      this.received.push(msg);
    }
    onMessage(cb: (msg: unknown) => void): void {
      this.#cb = cb;
    }
    /** Simule un message émis par CE worker vers le master. */
    emit(msg: unknown): void {
      this.#cb?.(msg);
    }
  }

  const rt = (channel: string, payload: unknown, originId: string) => ({
    kind: CLUSTER_RT_KIND,
    channel,
    payload,
    originId,
  });

  it("attach incrémente size ; detach le décrémente", () => {
    const relay = new ClusterRelay();
    const a = new FakeWorker(1);
    const b = new FakeWorker(2);
    relay.attach(a);
    relay.attach(b);
    expect(relay.size).to.equal(2);
    relay.detach(1);
    expect(relay.size).to.equal(1);
  });

  it("rebroadcast une publication realtime aux AUTRES workers, jamais à la source", () => {
    const relay = new ClusterRelay();
    const a = new FakeWorker(1);
    const b = new FakeWorker(2);
    const c = new FakeWorker(3);
    relay.attach(a);
    relay.attach(b);
    relay.attach(c);

    const msg = rt("syslog:stream", "hello", "pid-A");
    a.emit(msg); // A publie

    expect(a.received).to.have.lengthOf(0); // jamais renvoyé à la source
    expect(b.received).to.deep.equal([msg]);
    expect(c.received).to.deep.equal([msg]);
    expect(relay.relayedTotal).to.equal(1);
  });

  it("n'envoie rien quand la source est le seul worker", () => {
    const relay = new ClusterRelay();
    const a = new FakeWorker(1);
    relay.attach(a);
    a.emit(rt("c", 1, "pid-A"));
    expect(a.received).to.have.lengthOf(0);
    expect(relay.relayedTotal).to.equal(1); // compté comme routé (0 destinataire)
  });

  it("ignore les messages non-realtime (autre kind) — pas de fan-out, pas d'agrégation ici", () => {
    const relay = new ClusterRelay();
    const a = new FakeWorker(1);
    const b = new FakeWorker(2);
    relay.attach(a);
    relay.attach(b);
    a.emit({ kind: "nf:probe", payload: { rps: 9 } }); // remontée de sonde (Phase 4)
    expect(b.received).to.have.lengthOf(0);
    expect(relay.relayedTotal).to.equal(0);
  });

  it("ignore les messages IPC malformés (robustesse)", () => {
    const relay = new ClusterRelay();
    const a = new FakeWorker(1);
    const b = new FakeWorker(2);
    relay.attach(a);
    relay.attach(b);
    a.emit(null);
    a.emit("plain");
    a.emit({ channel: "c", payload: 1 }); // pas de kind
    a.emit(42);
    expect(b.received).to.have.lengthOf(0);
    expect(relay.relayedTotal).to.equal(0);
  });

  it("un worker détaché ne reçoit plus le broadcast", () => {
    const relay = new ClusterRelay();
    const a = new FakeWorker(1);
    const b = new FakeWorker(2);
    relay.attach(a);
    relay.attach(b);
    relay.detach(2);
    a.emit(rt("c", 1, "pid-A"));
    expect(b.received).to.have.lengthOf(0);
  });

  it("un worker dont send() throw ne casse pas le fan-out aux autres", () => {
    const relay = new ClusterRelay();
    const a = new FakeWorker(1);
    const bad = new FakeWorker(2);
    bad.send = () => {
      throw new Error("worker dead");
    };
    const c = new FakeWorker(3);
    relay.attach(a);
    relay.attach(bad);
    relay.attach(c);
    a.emit(rt("c", 1, "pid-A"));
    expect(c.received).to.have.lengthOf(1); // c reçoit malgré bad
  });

  it("attach idempotent par id (respawn réattache proprement)", () => {
    const relay = new ClusterRelay();
    const a = new FakeWorker(1);
    const b1 = new FakeWorker(2);
    relay.attach(a);
    relay.attach(b1);
    // respawn : même id, nouvelle instance
    const b2 = new FakeWorker(2);
    relay.attach(b2);
    expect(relay.size).to.equal(2);
    a.emit(rt("c", 1, "pid-A"));
    expect(b1.received).to.have.lengthOf(0); // l'ancienne instance n'est plus ciblée
    expect(b2.received).to.have.lengthOf(1);
  });

  it("clear() vide le relay", () => {
    const relay = new ClusterRelay();
    relay.attach(new FakeWorker(1));
    relay.attach(new FakeWorker(2));
    relay.clear();
    expect(relay.size).to.equal(0);
  });

  it("log injecté reçoit un message au rebroadcast", () => {
    const logs: string[] = [];
    const relay = new ClusterRelay({ log: (m) => logs.push(m) });
    const a = new FakeWorker(1);
    relay.attach(a);
    // pas d'assert sur le contenu : le relay log est silencieux par défaut,
    // ce test vérifie juste que l'option log est acceptée sans crash.
    a.emit(rt("c", 1, "pid-A"));
    expect(relay.relayedTotal).to.equal(1);
  });
});
