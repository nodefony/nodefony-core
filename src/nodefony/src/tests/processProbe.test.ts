import { expect } from "vitest";
import {
  ProcessProbe,
  readEventLoopDelay,
  EVENT_LOOP_RESOLUTION_MS,
} from "../service/cluster/processProbe";

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

describe("readEventLoopDelay — le retard RÉEL de la boucle", () => {
  const ms = (v: number) => v * 1e6;

  it("retranche la période d'échantillonnage : une boucle libre a 0 de retard", () => {
    // Valeurs relevées sur une boucle au repos (résolution 20 ms).
    const idle = { mean: ms(20.5), max: ms(21.1), count: 100 };
    expect(readEventLoopDelay(idle)).to.deep.equal({ meanMs: 0.5, maxMs: 1.1 });
  });

  it("ne rend jamais de retard négatif (un réveil un peu en avance)", () => {
    const early = { mean: ms(19.4), max: ms(19.9), count: 10 };
    expect(readEventLoopDelay(early)).to.deep.equal({ meanMs: 0, maxMs: 0 });
  });

  it("rend le pire blocage, qu'une moyenne noie", () => {
    // Gel unique de 200 ms dans 2 s : la moyenne ne bouge que de 2,3 ms.
    const freeze = { mean: ms(22.8), max: ms(213.1), count: 87 };
    expect(readEventLoopDelay(freeze)).to.deep.equal({
      meanMs: 2.8,
      maxMs: 193.1,
    });
  });

  it("sans échantillon : 0, jamais NaN", () => {
    expect(
      readEventLoopDelay({ mean: Number.NaN, max: 0, count: 0 }),
    ).to.deep.equal({
      meanMs: 0,
      maxMs: 0,
    });
  });

  it("suit la résolution passée", () => {
    const h = { mean: ms(11), max: ms(15), count: 5 };
    expect(readEventLoopDelay(h, 10)).to.deep.equal({ meanMs: 1, maxMs: 5 });
    expect(EVENT_LOOP_RESOLUTION_MS).to.equal(20);
  });

  it("ProcessProbe voit un gel réel de la boucle dans son pire retard", async () => {
    const probe = new ProcessProbe();
    probe.read();
    await new Promise((r) => setTimeout(r, 100));
    const t = Date.now();
    while (Date.now() - t < 150);
    await new Promise((r) => setTimeout(r, 60));
    const h = probe.read();
    probe.dispose();
    expect(h.eventLoopMaxMs).to.be.at.least(100);
    expect(h.eventLoopMs).to.be.below(h.eventLoopMaxMs);
  });
});
