import { expect } from "chai";
import "mocha";
import {
  ClusterProbeAggregator,
  type IProbeWorker,
} from "../service/cluster/ClusterProbeAggregator";
import {
  CLUSTER_PROBE_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
  CLUSTER_PROBE_CTL_KIND,
  CLUSTER_PROBE_ENRICH_KIND,
} from "../service/cluster/clusterMessage";

/**
 * ClusterProbeAggregator — master-gateway de la sonde agrégée (Phase 4c). Collecte les
 * remontées de sonde de chaque worker (opaques) et rediffuse le snapshot à tous. Seam
 * `IProbeWorker` → collecte + diffusion prouvées SANS forker de process réel.
 */
describe("cluster / ClusterProbeAggregator (sonde agrégée master)", () => {
  class FakeWorker implements IProbeWorker {
    readonly id: number;
    readonly pid: number;
    readonly received: unknown[] = [];
    #cb: ((msg: unknown) => void) | null = null;
    constructor(id: number, pid: number = id) {
      this.id = id;
      this.pid = pid;
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

  // Drill-down Phase 2 : un worker (celui qui tient le navigateur) émet un ordre
  // d'enrichissement `nf:probe:ctl {op,pid}` ; le master le route en `nf:probe:enrich
  // {enabled}` vers le SEUL worker ciblé par son pid. Le master ne lit jamais une sonde.
  describe("drill-down (ctl → enrich ciblé par pid)", () => {
    const ctl = (
      op: "enrich" | "stop",
      pid: number,
      facet?: "process" | "orm",
    ) => ({
      kind: CLUSTER_PROBE_CTL_KIND,
      op,
      pid,
      ...(facet ? { facet } : {}),
    });

    it("route enrich vers le SEUL worker ciblé par pid (pas les autres)", () => {
      const agg = new ClusterProbeAggregator();
      const nav = new FakeWorker(1, 1001); // tient le navigateur
      const target = new FakeWorker(2, 1002); // worker drillé
      const other = new FakeWorker(3, 1003);
      agg.attach(nav);
      agg.attach(target);
      agg.attach(other);
      nav.emit(ctl("enrich", 1002)); // drill du worker pid=1002 (facette défaut = process)
      expect(target.received).to.deep.equal([
        { kind: CLUSTER_PROBE_ENRICH_KIND, enabled: true, facet: "process" },
      ]);
      expect(other.received).to.have.length(0);
      expect(nav.received).to.have.length(0);
    });

    it("op:stop route enabled:false vers le worker ciblé", () => {
      const agg = new ClusterProbeAggregator();
      const nav = new FakeWorker(1, 1001);
      const target = new FakeWorker(2, 1002);
      agg.attach(nav);
      agg.attach(target);
      nav.emit(ctl("stop", 1002));
      expect(target.received).to.deep.equal([
        { kind: CLUSTER_PROBE_ENRICH_KIND, enabled: false, facet: "process" },
      ]);
    });

    it("PROPAGE la facette 'orm' (drill ORM @pid) vers le worker ciblé", () => {
      const agg = new ClusterProbeAggregator();
      const nav = new FakeWorker(1, 1001);
      const target = new FakeWorker(2, 1002);
      agg.attach(nav);
      agg.attach(target);
      nav.emit(ctl("enrich", 1002, "orm"));
      expect(target.received).to.deep.equal([
        { kind: CLUSTER_PROBE_ENRICH_KIND, enabled: true, facet: "orm" },
      ]);
    });

    it("ctl vers un pid inconnu = no-op (pas de throw)", () => {
      const agg = new ClusterProbeAggregator();
      const nav = new FakeWorker(1, 1001);
      agg.attach(nav);
      expect(() => nav.emit(ctl("enrich", 9999))).to.not.throw();
    });

    it("un worker détaché sort de la map pid → son drill devient no-op", () => {
      const agg = new ClusterProbeAggregator();
      const nav = new FakeWorker(1, 1001);
      const target = new FakeWorker(2, 1002);
      agg.attach(nav);
      agg.attach(target);
      agg.detach(2); // le worker drillé meurt
      nav.emit(ctl("enrich", 1002));
      expect(target.received).to.have.length(0);
    });

    it("le ctl n'est PAS collecté comme une sonde (absent du snapshot)", () => {
      const agg = new ClusterProbeAggregator();
      const nav = new FakeWorker(1, 1001);
      agg.attach(nav);
      nav.emit(ctl("enrich", 1001));
      agg.broadcast();
      const snap = nav.received.find(
        (m) => (m as { kind?: string }).kind === CLUSTER_PROBE_SNAPSHOT_KIND,
      ) as { instances: unknown[] };
      expect(snap.instances).to.deep.equal([]); // ctl ≠ remontée de sonde
    });
  });
});
