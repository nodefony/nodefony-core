import { expect } from "chai";
import "mocha";
import { RichProcessProbe } from "../service/cluster/richProcessProbe";

/**
 * RichProcessProbe — sonde process RICHE (GC/heap-spaces/handles/ELU/ctx) d'un worker,
 * complément du lean ProcessProbe pour le drill-down (Phase 2). Lazy & opt-in : observer
 * GC attaché à enable()/1ᵉʳ read(), détaché à disable(). SERVEUR uniquement.
 */
describe("cluster / RichProcessProbe (sonde process riche du drill-down)", () => {
  it("read() retourne une sonde riche complète + cohérente", () => {
    const probe = new RichProcessProbe();
    const r = probe.read();
    expect(r.gc).to.include.keys(["count", "pauseMs", "major", "minor"]);
    expect(r.gc.count).to.be.a("number").and.to.be.at.least(0);
    expect(r.heapSpaces).to.be.an("array").and.to.not.be.empty;
    expect(r.heapSpaces[0]).to.include.keys(["name", "used", "size"]);
    expect(r.handles.total).to.be.a("number").and.to.be.at.least(0);
    expect(r.handles.byType).to.be.an("object");
    expect(r.elu).to.include.keys(["active", "idle"]);
    expect(r.ctx).to.include.keys(["voluntary", "involuntary"]);
    expect(r.loadavg).to.be.an("array").and.to.have.length(3);
    expect(r.heapLimit).to.be.a("number").and.to.be.greaterThan(0);
    expect(r.cpuCount).to.be.a("number").and.to.be.greaterThan(0);
    expect(r.ts).to.be.a("number");
    probe.disable();
  });

  it("deux read() successifs fonctionnent (deltas par intervalle)", () => {
    const probe = new RichProcessProbe();
    const a = probe.read();
    const b = probe.read();
    expect(b.ts).to.be.at.least(a.ts);
    // les compteurs GC sont remis à zéro à chaque read() (pression PAR intervalle).
    expect(b.gc.count).to.be.at.least(0);
    probe.disable();
  });

  it("disable() est idempotent (détache l'observer GC)", () => {
    const probe = new RichProcessProbe();
    probe.read();
    expect(() => {
      probe.disable();
      probe.disable();
    }).to.not.throw();
  });

  it("read() après disable() ré-active la sonde (auto-enable)", () => {
    const probe = new RichProcessProbe();
    probe.read();
    probe.disable();
    expect(() => probe.read()).to.not.throw();
    probe.disable();
  });
});
