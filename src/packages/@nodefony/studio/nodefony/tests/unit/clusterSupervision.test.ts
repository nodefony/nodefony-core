import { expect } from "chai";
import { mapInstanceToSupervision } from "../../realtime/clusterSupervision";
import type { IRealtimeHealth } from "@nodefony/realtime";
import type { IProcessHealth, IProcessRich } from "nodefony";

/**
 * mapInstanceToSupervision — adapte la santé d'un worker (lean `process` + sonde riche
 * `rich`) du snapshot pod vers le format du canal `dashboard:supervision`, pour réutiliser
 * le composant front de Supervision sur un worker distant (drill-down cluster).
 */
describe("studio / clusterSupervision.mapInstanceToSupervision", () => {
  const health = (over: Partial<IRealtimeHealth> = {}): IRealtimeHealth => ({
    instanceId: "1234",
    ts: 1,
    channels: [],
    channelCount: 0,
    publishTotal: 0,
    fanoutTotal: 0,
    inboundTotal: 0,
    ingressRejectedTotal: 0,
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
  });

  const proc: IProcessHealth = {
    pid: 1234,
    uptime: 10,
    cpuPercent: 5,
    eventLoopMs: 1,
    eluUtilization: 0.2,
    rss: 100,
    heapUsed: 50,
    heapTotal: 80,
    heapLimit: 4096,
    external: 5,
    ts: 9,
  };

  const rich: IProcessRich = {
    gc: { count: 2, pauseMs: 1, major: 0, minor: 2 },
    heapSpaces: [{ name: "old_space", used: 1, size: 2 }],
    handles: { total: 3, byType: { Timeout: 3 } },
    elu: { active: 5, idle: 95 },
    ctx: { voluntary: 10, involuntary: 1 },
    loadavg: [1, 2, 3],
    heapLimit: 4096,
    cpuCount: 8,
    ts: 9,
  };

  it("rich absent → richPending=true, partie lean publiée, gc=null", () => {
    const out = mapInstanceToSupervision(health({ process: proc }));
    expect(out.richPending).to.equal(true);
    expect(out.pid).to.equal(1234);
    expect(out.cpuPercent).to.equal(5);
    expect((out.memory as { rss: number }).rss).to.equal(100);
    expect(out.gc).to.equal(null);
    expect(out.heapSpaces).to.deep.equal([]);
  });

  it("rich présent → richPending=false, champs riches mappés + ELU fusionnée", () => {
    const out = mapInstanceToSupervision(health({ process: proc, rich }));
    expect(out.richPending).to.equal(false);
    expect(out.gc).to.deep.equal({ count: 2, pauseMs: 1, major: 0, minor: 2 });
    // utilization vient du lean (process), active/idle de la sonde riche.
    expect(out.elu).to.deep.equal({ utilization: 0.2, active: 5, idle: 95 });
    expect((out.memory as { heapLimit: number }).heapLimit).to.equal(4096);
    expect(out.cpuCount).to.equal(8);
    expect(out.handles).to.deep.equal({ total: 3, byType: { Timeout: 3 } });
    expect(out.heapSpaces).to.have.length(1);
  });

  it("process absent → defaults sûrs (pid déduit de instanceId, pas de crash)", () => {
    const out = mapInstanceToSupervision(health({ instanceId: "77" }));
    expect(out.pid).to.equal(77);
    expect(out.cpuPercent).to.equal(0);
    expect((out.memory as { rss: number }).rss).to.equal(0);
    expect(out.richPending).to.equal(true);
  });
});
