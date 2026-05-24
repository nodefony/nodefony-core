import { expect } from "chai";
import "mocha";
import {
  ClusterProbeAggregator,
  type IProbeWorker,
} from "../service/cluster/ClusterProbeAggregator";
import {
  CLUSTER_PROBE_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
} from "../service/cluster/clusterMessage";

/**
 * ClusterProbeAggregator — master-gateway de la sonde agrégée (Phase 4c). Collecte les
 * remontées de sonde de chaque worker (opaques) et rediffuse le snapshot à tous. Seam
 * `IProbeWorker` → collecte + diffusion prouvées SANS forker de process réel.
 */
describe("cluster / ClusterProbeAggregator (sonde agrégée master)", () => {
  class FakeWorker implements IProbeWorker {
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
    /** Simule une remontée de sonde de CE worker vers le master. */
    emit(msg: unknown): void {
      this.#cb?.(msg);
    }
  }

  const report = (payload: unknown) => ({ kind: CLUSTER_PROBE_KIND, payload });

  it("attach incrémente size ; detach le décrémente", () => {
    const agg = new ClusterProbeAggregator();
    const a = new FakeWorker(1);
    const b = new FakeWorker(2);
    agg.attach(a);
    agg.attach(b);
    expect(agg.size).to.equal(2);
    agg.detach(1);
    expect(agg.size).to.equal(1);
  });

  it("collecte les sondes et diffuse le snapshot agrégé à TOUS les workers", () => {
    const agg = new ClusterProbeAggregator();
    const a = new FakeWorker(1);
    const b = new FakeWorker(2);
    agg.attach(a);
    agg.attach(b);
    a.emit(report({ instanceId: "A", connectionCount: 3 }));
    b.emit(report({ instanceId: "B", connectionCount: 5 }));
    agg.broadcast();
    // chaque worker reçoit UN snapshot contenant les DEUX instances.
    for (const w of [a, b]) {
      expect(w.received).to.have.length(1);
      const snap = w.received[0] as {
        kind: string;
        instances: Array<{ instanceId: string }>;
      };
      expect(snap.kind).to.equal(CLUSTER_PROBE_SNAPSHOT_KIND);
      expect(snap.instances.map((i) => i.instanceId).sort()).to.deep.equal([
        "A",
        "B",
      ]);
    }
    expect(agg.broadcastTotal).to.equal(1);
  });

  it("detach retire la sonde du worker mort du snapshot suivant", () => {
    const agg = new ClusterProbeAggregator();
    const a = new FakeWorker(1);
    const b = new FakeWorker(2);
    agg.attach(a);
    agg.attach(b);
    a.emit(report({ instanceId: "A" }));
    b.emit(report({ instanceId: "B" }));
    agg.detach(2); // B meurt
    agg.broadcast();
    const snap = a.received[0] as { instances: Array<{ instanceId: string }> };
    expect(snap.instances.map((i) => i.instanceId)).to.deep.equal(["A"]);
  });

  it("garde la DERNIÈRE sonde par worker (écrase l'ancienne)", () => {
    const agg = new ClusterProbeAggregator();
    const a = new FakeWorker(1);
    agg.attach(a);
    a.emit(report({ instanceId: "A", connectionCount: 1 }));
    a.emit(report({ instanceId: "A", connectionCount: 9 }));
    agg.broadcast();
    const snap = a.received[0] as {
      instances: Array<{ connectionCount: number }>;
    };
    expect(snap.instances).to.deep.equal([
      { instanceId: "A", connectionCount: 9 },
    ]);
  });

  it("ignore les messages non-sonde (autre kind) et malformés", () => {
    const agg = new ClusterProbeAggregator();
    const a = new FakeWorker(1);
    agg.attach(a);
    a.emit({ kind: "nf:rt", channel: "c", payload: 1 }); // realtime → pas une sonde
    a.emit(null);
    a.emit("plain");
    a.emit({ payload: { x: 1 } }); // pas de kind
    agg.broadcast();
    const snap = a.received[0] as { instances: unknown[] };
    expect(snap.instances).to.deep.equal([]); // rien collecté
  });

  it("broadcast n'envoie rien sans worker ; clear() arrête tout", () => {
    const agg = new ClusterProbeAggregator();
    agg.broadcast();
    expect(agg.broadcastTotal).to.equal(0);
    const a = new FakeWorker(1);
    agg.attach(a);
    agg.clear();
    expect(agg.size).to.equal(0);
    agg.broadcast();
    expect(a.received).to.have.length(0);
  });
});
