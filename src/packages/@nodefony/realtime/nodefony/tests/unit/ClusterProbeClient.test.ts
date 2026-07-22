import { describe, it, expect, vi } from "vitest";
import {
  ClusterProbeClient,
  mergeClusterHealth,
  clusterProbeHealth,
  clusterProbeInstance,
  clusterProbeRequestEnrich,
  setClusterProbeClient,
  type IClusterProbeTransport,
} from "../../src/cluster/ClusterProbeClient.js";
import {
  CLUSTER_PROBE_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
  CLUSTER_PROBE_CTL_KIND,
  CLUSTER_PROBE_ENRICH_KIND,
  setOrmRichProvider,
} from "nodefony";
import type { IRealtimeHealth } from "../../interfaces/IRealtimeProbe.js";

/** Santé per-instance factice (champs scalaires paramétrables). */
function health(over: Partial<IRealtimeHealth> = {}): IRealtimeHealth {
  return {
    instanceId: "x",
    ts: 1,
    channels: [],
    channelCount: 0,
    publishTotal: 0,
    fanoutTotal: 0,
    inboundTotal: 0,
    ingressRejectedTotal: 0,
    systemFloorDeniedTotal: 0,
    connectionCount: 0,
    bytesSentTotal: 0,
    messagesSentTotal: 0,
    backpressure: {
      maxBufferedAmount: 0,
      totalBufferedAmount: 0,
      slowConsumers: 0,
      drops: 0,
    },
    ...over,
  };
}

/** Transport factice : capture les reports sortants, expose `deliver()` (master → worker). */
class FakeTransport implements IClusterProbeTransport {
  sent: unknown[] = [];
  #cb: ((msg: unknown) => void) | null = null;
  send(report: unknown): void {
    this.sent.push(report);
  }
  onReceive(cb: (msg: unknown) => void): void {
    this.#cb = cb;
  }
  deliver(msg: unknown): void {
    this.#cb?.(msg);
  }
}

describe("mergeClusterHealth — consolidation pod", () => {
  it("somme les scalaires ; maxBufferedAmount = MAX (pas somme)", () => {
    const merged = mergeClusterHealth(
      [
        health({
          instanceId: "A",
          connectionCount: 3,
          publishTotal: 10,
          ingressRejectedTotal: 2,
          // `drops` fait partie du contrat `IRealtimeHealth.backpressure` : l'override
          // REMPLACE l'objet du helper → l'omettre rendait `totals.drops` NaN
          // (`mergeClusterHealth` fait `+= bp.drops`).
          backpressure: {
            maxBufferedAmount: 100,
            totalBufferedAmount: 100,
            slowConsumers: 1,
            drops: 0,
          },
        }),
        health({
          instanceId: "B",
          connectionCount: 5,
          publishTotal: 7,
          ingressRejectedTotal: 3,
          backpressure: {
            maxBufferedAmount: 40,
            totalBufferedAmount: 40,
            slowConsumers: 2,
            drops: 0,
          },
        }),
      ],
      123,
    );
    expect(merged.cluster).to.equal(true);
    expect(merged.ts).to.equal(123);
    expect(merged.instanceCount).to.equal(2);
    expect(merged.totals.connectionCount).to.equal(8);
    expect(merged.totals.publishTotal).to.equal(17);
    // Signal sécurité (F83) : les ingress backplane refusés sont sommés pod-wide.
    expect(merged.totals.ingressRejectedTotal).to.equal(5);
    expect(merged.totals.backpressure.maxBufferedAmount).to.equal(100); // MAX
    expect(merged.totals.backpressure.totalBufferedAmount).to.equal(140); // somme
    expect(merged.totals.backpressure.slowConsumers).to.equal(3);
    expect(merged.instances).to.have.length(2); // détail per-instance gardé
  });

  it("liste vide → totaux à zéro, instanceCount 0", () => {
    const merged = mergeClusterHealth([]);
    expect(merged.instanceCount).to.equal(0);
    expect(merged.totals.connectionCount).to.equal(0);
  });

  it("agrège ORM + erreurs par worker (sommes ; maxEwmaMs = pire)", () => {
    const merged = mergeClusterHealth([
      health({
        instanceId: "A",
        orm: {
          connectors: 1,
          connected: 1,
          queryTotal: 100,
          slowTotal: 2,
          errorTotal: 1,
          reconnectTotal: 0,
          maxEwmaMs: 12,
        },
        errors: { errorTotal: 3, criticTotal: 1 },
      }),
      health({
        instanceId: "B",
        orm: {
          connectors: 1,
          connected: 0,
          queryTotal: 50,
          slowTotal: 5,
          errorTotal: 4,
          reconnectTotal: 2,
          maxEwmaMs: 30,
        },
        errors: { errorTotal: 7, criticTotal: 0 },
      }),
    ]);
    expect(merged.totals.orm).to.deep.equal({
      connectors: 2,
      connected: 1,
      queryTotal: 150,
      slowTotal: 7,
      errorTotal: 5,
      reconnectTotal: 2,
      maxEwmaMs: 30, // MAX, pas somme
    });
    expect(merged.totals.errors).to.deep.equal({
      errorTotal: 10,
      criticTotal: 1,
    });
  });

  it("ORM/erreurs absents de TOUS les workers → totaux orm/errors omis", () => {
    const merged = mergeClusterHealth([health({ instanceId: "A" })]);
    expect(merged.totals.orm).to.equal(undefined);
    expect(merged.totals.errors).to.equal(undefined);
  });
});

describe("ClusterProbeClient — report + cache snapshot (worker)", () => {
  it("start() : report immédiat de la santé per-instance (kind nf:probe)", () => {
    const t = new FakeTransport();
    const c = new ClusterProbeClient(t, 999999);
    c.start(() => health({ instanceId: "me", connectionCount: 2 }));
    expect(t.sent).to.have.length(1);
    const r = t.sent[0] as { kind: string; payload: IRealtimeHealth };
    expect(r.kind).to.equal(CLUSTER_PROBE_KIND);
    expect(r.payload.instanceId).to.equal("me");
    c.stop();
  });

  it("getClusterHealth : null avant snapshot, vue POD après réception", () => {
    const t = new FakeTransport();
    const c = new ClusterProbeClient(t, 999999);
    c.start(() => health({ instanceId: "me" }));
    expect(c.getClusterHealth()).to.equal(null); // cold start
    t.deliver({
      kind: CLUSTER_PROBE_SNAPSHOT_KIND,
      ts: 50,
      instances: [health({ instanceId: "A" }), health({ instanceId: "B" })],
    });
    const pod = c.getClusterHealth();
    expect(pod?.cluster).to.equal(true);
    expect(pod?.instanceCount).to.equal(2);
    expect(pod?.ts).to.equal(50);
    c.stop();
  });

  it("ignore les messages non-snapshot et malformés", () => {
    const t = new FakeTransport();
    const c = new ClusterProbeClient(t, 999999);
    c.start(() => health());
    t.deliver({ kind: "nf:rt", channel: "c", payload: 1 });
    t.deliver(null);
    t.deliver({ instances: [health()] }); // pas de kind
    expect(c.getClusterHealth()).to.equal(null);
    c.stop();
  });

  it("stop() purge le cache", () => {
    const t = new FakeTransport();
    const c = new ClusterProbeClient(t, 999999);
    c.start(() => health());
    t.deliver({
      kind: CLUSTER_PROBE_SNAPSHOT_KIND,
      ts: 1,
      instances: [health()],
    });
    expect(c.getClusterHealth()).to.not.equal(null);
    c.stop();
    expect(c.getClusterHealth()).to.equal(null);
  });
});

describe("ClusterProbeClient — drill-down (enrich/rich, Phase 2)", () => {
  it("requestEnrich envoie un ctl op:enrich/stop avec le pid ciblé (facette défaut process)", () => {
    const t = new FakeTransport();
    const c = new ClusterProbeClient(t, 999999);
    c.start(() => health()); // consomme le report immédiat
    t.sent.length = 0;
    c.requestEnrich(1234, true);
    c.requestEnrich(1234, false);
    expect(t.sent).to.deep.equal([
      {
        kind: CLUSTER_PROBE_CTL_KIND,
        op: "enrich",
        pid: 1234,
        facet: "process",
      },
      { kind: CLUSTER_PROBE_CTL_KIND, op: "stop", pid: 1234, facet: "process" },
    ]);
    c.stop();
  });

  it("requestEnrich(pid, true, 'orm') émet un ctl avec la facette orm", () => {
    const t = new FakeTransport();
    const c = new ClusterProbeClient(t, 999999);
    c.start(() => health());
    t.sent.length = 0;
    c.requestEnrich(1234, true, "orm");
    expect(t.sent).to.deep.equal([
      { kind: CLUSTER_PROBE_CTL_KIND, op: "enrich", pid: 1234, facet: "orm" },
    ]);
    c.stop();
  });

  it("après enrich le report inclut la sonde riche ; après stop il ne l'inclut plus", () => {
    vi.useFakeTimers();
    try {
      const t = new FakeTransport();
      const c = new ClusterProbeClient(t, 1000);
      c.start(() => health({ instanceId: "me" })); // report #1 (pas de rich)
      expect((t.sent[0] as { payload: IRealtimeHealth }).payload.rich).to.equal(
        undefined,
      );
      t.deliver({ kind: CLUSTER_PROBE_ENRICH_KIND, enabled: true });
      vi.advanceTimersByTime(1000); // report #2 → enrichi
      const r2 = (t.sent[1] as { payload: IRealtimeHealth }).payload;
      expect(r2.rich).to.be.an("object");
      expect(r2.rich).to.include.keys([
        "gc",
        "heapSpaces",
        "handles",
        "elu",
        "ctx",
      ]);
      t.deliver({ kind: CLUSTER_PROBE_ENRICH_KIND, enabled: false });
      vi.advanceTimersByTime(1000); // report #3 → rich coupé
      expect((t.sent[2] as { payload: IRealtimeHealth }).payload.rich).to.equal(
        undefined,
      );
      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("facette orm : après enrich ORM le report inclut ormRich ; après stop, non", async () => {
    vi.useFakeTimers();
    try {
      const blob = {
        health: [{ name: "default", pingOk: true }],
        flow: { ts: 9 },
      };
      setOrmRichProvider(async () => blob);
      const t = new FakeTransport();
      const c = new ClusterProbeClient(t, 1000);
      c.start(() => health({ instanceId: "me" })); // report #1 (pas d'ormRich)
      expect(
        (t.sent[0] as { payload: IRealtimeHealth }).payload.ormRich,
      ).to.equal(undefined);
      t.deliver({
        kind: CLUSTER_PROBE_ENRICH_KIND,
        enabled: true,
        facet: "orm",
      });
      // Flush le refresh immédiat (provider async) → #ormRich rempli avant le report.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(1000); // report #2 → enrichi ORM
      expect(
        (t.sent[1] as { payload: IRealtimeHealth }).payload.ormRich,
      ).to.deep.equal(blob);
      t.deliver({
        kind: CLUSTER_PROBE_ENRICH_KIND,
        enabled: false,
        facet: "orm",
      });
      vi.advanceTimersByTime(1000); // report #3 → ormRich coupé (cache purgé)
      expect(
        (t.sent[2] as { payload: IRealtimeHealth }).payload.ormRich,
      ).to.equal(undefined);
      c.stop();
    } finally {
      setOrmRichProvider(null);
      vi.useRealTimers();
    }
  });

  it("facette orm n'active PAS la sonde process (rich reste absent)", async () => {
    vi.useFakeTimers();
    try {
      setOrmRichProvider(async () => ({ health: [], flow: {} }));
      const t = new FakeTransport();
      const c = new ClusterProbeClient(t, 1000);
      c.start(() => health({ instanceId: "me" }));
      t.deliver({
        kind: CLUSTER_PROBE_ENRICH_KIND,
        enabled: true,
        facet: "orm",
      });
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
      const r = (t.sent[1] as { payload: IRealtimeHealth }).payload;
      expect(r.rich).to.equal(undefined); // facette process restée OFF
      expect(r.ormRich).to.not.equal(undefined);
      c.stop();
    } finally {
      setOrmRichProvider(null);
      vi.useRealTimers();
    }
  });

  it("clusterProbeInstance trouve l'instance par pid (instanceId)", () => {
    const t = new FakeTransport();
    const c = new ClusterProbeClient(t, 999999);
    setClusterProbeClient(c);
    c.start(() => health({ instanceId: "me" }));
    t.deliver({
      kind: CLUSTER_PROBE_SNAPSHOT_KIND,
      ts: 1,
      instances: [health({ instanceId: "7" }), health({ instanceId: "9" })],
    });
    expect(clusterProbeInstance(7)?.instanceId).to.equal("7");
    expect(clusterProbeInstance(404)).to.equal(null); // pid absent
    c.stop();
  });

  it("clusterProbeRequestEnrich (helper singleton) émet le ctl et renvoie true", () => {
    const t = new FakeTransport();
    const c = new ClusterProbeClient(t, 999999);
    setClusterProbeClient(c);
    c.start(() => health());
    t.sent.length = 0;
    expect(clusterProbeRequestEnrich(55, true)).to.equal(true);
    expect(t.sent[0]).to.deep.equal({
      kind: CLUSTER_PROBE_CTL_KIND,
      op: "enrich",
      pid: 55,
      facet: "process",
    });
    c.stop();
  });
});

describe("clusterProbeHealth — singleton worker (fallback per-instance)", () => {
  it("null tant qu'aucun client branché OU aucun snapshot", () => {
    const t = new FakeTransport();
    const c = new ClusterProbeClient(t, 999999);
    setClusterProbeClient(c);
    c.start(() => health({ instanceId: "me" }));
    expect(clusterProbeHealth()).to.equal(null); // branché mais pas de snapshot
    t.deliver({
      kind: CLUSTER_PROBE_SNAPSHOT_KIND,
      ts: 2,
      instances: [health({ instanceId: "me" })],
    });
    expect(clusterProbeHealth()?.cluster).to.equal(true);
    c.stop();
  });
});
