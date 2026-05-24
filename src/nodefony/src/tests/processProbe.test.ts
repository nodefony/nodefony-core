import { expect } from "chai";
import "mocha";
import { ProcessProbe } from "../service/cluster/processProbe";

/**
 * ProcessProbe — sonde process (CPU/mém/event-loop) d'un worker, agrégée par worker dans
 * le snapshot pod. Métriques par INTERVALLE (deltas entre 2 read()). SERVEUR uniquement.
 */
describe("cluster / ProcessProbe (santé process par worker)", () => {
  it("read() retourne une santé process complète + cohérente", () => {
    const probe = new ProcessProbe();
    const h = probe.read();
    expect(h.pid).to.equal(process.pid);
    expect(h.cpuPercent).to.be.a("number").and.to.be.within(0, 100);
    expect(h.eventLoopMs).to.be.a("number").and.to.be.at.least(0);
    expect(h.eluUtilization).to.be.a("number").and.to.be.within(0, 1);
    expect(h.rss).to.be.a("number").and.to.be.greaterThan(0);
    expect(h.heapUsed).to.be.a("number").and.to.be.greaterThan(0);
    expect(h.uptime).to.be.a("number").and.to.be.at.least(0);
    expect(h.ts).to.be.a("number");
    probe.dispose();
  });

  it("deux read() successifs fonctionnent (deltas par intervalle)", () => {
    const probe = new ProcessProbe();
    const a = probe.read();
    const b = probe.read();
    expect(b.ts).to.be.at.least(a.ts);
    expect(b.cpuPercent).to.be.within(0, 100);
    probe.dispose();
  });

  it("dispose() est idempotent (libère le monitor event-loop)", () => {
    const probe = new ProcessProbe();
    probe.read();
    expect(() => {
      probe.dispose();
      probe.dispose();
    }).to.not.throw();
  });
});
